import {
  fetchSupplements,
  addSupplement,
  deleteSupplement,
  updateSupplement
} from "./supplements.js";
import { db } from "./firebaseConfig.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";
import { renderCalendar } from "./calendar.js";

// ----------------------------------------------------------------------------
// State
// ----------------------------------------------------------------------------
let currentUser = null;
let supplements = [];
let editingSupplementId = null;

// Form + UI nodes
const form = document.getElementById("supplementForm");
const cycleCheckbox = document.getElementById("cycleCheckbox");
const cycleDetails = document.getElementById("cycleDetails");
const supplementSummaryContainer = document.getElementById("supplementSummaryContainer");
const cancelEditBtn = document.getElementById("cancelEditBtn");
let calendarEl, labelEl;
const notesBtn   = document.getElementById("notesBtn");
const notesModal = document.getElementById("notesModal");
const notesClose = document.getElementById("notesClose");
const notesSave  = document.getElementById("notesSave");
const notesInput = document.getElementById("notesInput");

document.addEventListener("DOMContentLoaded", () => {
  calendarEl = document.getElementById("calendar");
  labelEl = document.getElementById("currentMonthLabel");
});

window.addEventListener("user-authenticated", async (e) => {
  currentUser = e.detail;
  await refreshData();
});

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------
function getTimeCheckboxes() {
  // Supports either .checkbox-tiles or .checkbox-group containers; excludes the cycle checkbox
  return document.querySelectorAll(
    ".checkbox-tiles input[type='checkbox']:not(#cycleCheckbox), .checkbox-group input[type='checkbox']:not(#cycleCheckbox)"
  );
}

if (cycleCheckbox && cycleDetails) {
  cycleCheckbox.addEventListener("change", () => {
    cycleDetails.classList.toggle("hidden", !cycleCheckbox.checked);
  });
}

if (form) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser || !currentUser.uid) return;

    const name = document.getElementById("nameInput").value.trim();
    const dosage = document.getElementById("dosageInput").value.trim();

    const timeCheckboxes = getTimeCheckboxes();
    const time = Array.from(timeCheckboxes)
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    const onCycle = cycleCheckbox?.checked || false;
    const onDays = parseInt(document.getElementById("onDaysInput")?.value, 10) || 0;
    const offDays = parseInt(document.getElementById("offDaysInput")?.value, 10) || 0;
    const picked =
      document.getElementById("cycleStartInput") &&
      document.getElementById("cycleStartInput").value
        ? document.getElementById("cycleStartInput").value
        : null;

    // If cycling, allow user to pick the cycle start date; otherwise default to today
    const startDate = onCycle && picked ? picked : new Date().toISOString().split("T")[0];
    const color = onCycle ? getRandomColor() : "#cccccc";

    const supplement = {
      name,
      dosage,
      time,
      startDate,
      cycle:
        onCycle && (onDays > 0 || offDays > 0)
          ? { on: onDays, off: offDays, startDate: startDate }
          : null,
      color
    };

    try {
      if (editingSupplementId) {
        await deleteSupplement(currentUser.uid, editingSupplementId);
        editingSupplementId = null;
      }

      await addSupplement(currentUser.uid, supplement);

      // Reset form UI
      form.reset();
      if (cycleCheckbox) cycleCheckbox.checked = false;
      if (cycleDetails) cycleDetails.classList.add("hidden");
      timeCheckboxes.forEach((cb) => (cb.checked = false));
      if (cancelEditBtn) cancelEditBtn.classList.add("hidden");

      await refreshData();
      if (typeof window.refreshCalendar === "function") {
        await window.refreshCalendar();
      }
    } catch (error) {
      console.error("❌ Failed to submit supplement:", error);
    }
  });
}

function getRandomColor() {
  const colors = ["#2196F3", "#FF9800", "#9C27B0", "#1ee92f"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function editSupplement(id) {
  const supplement = supplements.find((s) => s.id === id);
  if (!supplement) return;

  // Tell the modal we're editing this doc
  window.SUPP_MODAL_CTX = { mode: "edit", id };

  // Open the modal by clicking the existing "Add Supplement" button
  const openBtn = document.getElementById("addSupplementBtn");
  if (openBtn) {
    openBtn.click();
  }

  // Prefill modal fields
  const formModal = document.getElementById("supplementModalForm") || document.querySelector("#supplementModal form");
  if (!formModal) return;

  const q = (sel) => formModal.querySelector(sel);

  const nameEl   = q("#suppName");
  const dosageEl = q("#suppDosage");
  if (nameEl)   nameEl.value   = supplement.name || "";
  if (dosageEl) dosageEl.value = supplement.dosage || "";

  // Times checkboxes in modal
  const selectedTimes = Array.isArray(supplement.times)
    ? supplement.times
    : (Array.isArray(supplement.time) ? supplement.time : []);
  formModal.querySelectorAll('input[name="time"]').forEach((cb) => {
    cb.checked = selectedTimes.includes(cb.value);
  });

  // Cycle fields
  const chk   = q("#suppCycleChk");
  const onEl  = q("#suppDaysOn");
  const offEl = q("#suppDaysOff");
  const startEl = q("#suppCycleStart");
  const hasCycle = !!(supplement.cycle && (Number(supplement.cycle.on) > 0 || Number(supplement.cycle.off) > 0));
  if (chk) {
    chk.checked = hasCycle;
    // Let existing UI logic show/hide the cycle section
    chk.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (onEl)   onEl.value   = hasCycle ? Number(supplement.cycle.on)  : "";
  if (offEl)  offEl.value  = hasCycle ? Number(supplement.cycle.off) : "";
  if (startEl) startEl.value = hasCycle ? (supplement.startDate || supplement.cycle.startDate || "") : "";

  // Optional color
  const colorEl = q("#suppColor");
  if (colorEl) colorEl.value = supplement.color || (window.pickColor ? window.pickColor(supplement.name) : "#cccccc");

  // Optionally show a cancel-edit button if you have one
  if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    editingSupplementId = null;
    form.reset();
    if (cycleCheckbox) cycleCheckbox.checked = false;
    if (cycleDetails) cycleDetails.classList.add("hidden");
    getTimeCheckboxes().forEach((cb) => (cb.checked = false));
    cancelEditBtn.classList.add("hidden");
  });
}

async function refreshData() {
  if (!currentUser || !currentUser.uid) {
    console.warn("⛔ currentUser is not ready yet.");
    return;
  }

  try {
    supplements = await fetchSupplements(currentUser.uid);
    renderSupplements();

    if (typeof window.refreshCalendar === "function") {
      await window.refreshCalendar();
    }
  } catch (error) {
    console.error("❌ Failed to fetch supplements:", error);
  }
}
window.refreshSuppSummary = refreshData;

function openNotes() {
  if (!currentUser?.uid) return;
  notesModal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Load latest notes from /users/{uid}
  loadNotes().catch(console.error);
}
function closeNotes() {
  notesModal.classList.add("hidden");
  document.body.style.overflow = "";
}

async function loadNotes() {
  const ref = doc(db, "users", currentUser.uid);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : {};
  notesInput.value = data?.notes || "";
}

async function saveNotes() {
  if (!currentUser?.uid) return;
  const ref = doc(db, "users", currentUser.uid);
  await setDoc(ref, { notes: notesInput.value || "" }, { merge: true });
}

// ----------------------------------------------------------------------------
// Collapsible state helpers
// ----------------------------------------------------------------------------
const COLLAPSE_KEY = "supplementCollapseV1";
function getCollapseState() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {};
  } catch {
    return {};
  }
}
function setCollapseState(state) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state));
}

// ----------------------------------------------------------------------------
// Render
// ----------------------------------------------------------------------------
function renderSupplements() {
  if (!supplementSummaryContainer) return;
  if (typeof supplementSummaryContainer.replaceChildren === "function") {
    supplementSummaryContainer.replaceChildren();
  } else {
    while (supplementSummaryContainer.firstChild) {
      supplementSummaryContainer.removeChild(supplementSummaryContainer.firstChild);
    }
  }
  // Local date formatter: 2025-09-01 -> Sept. 1, 2025
  function fmtYMDPretty(ymd) {
    try {
      if (!ymd || typeof ymd !== 'string') return '';
      const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return ymd;
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      const months = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
      const mon = months[Math.max(1, Math.min(12, mo)) - 1] || '';
      return mon ? `${mon} ${d}, ${y}` : ymd;
    } catch { return ymd || ''; }
  }
  const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const cap1 = (s) => (s && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const ORDER = ["Morning", "Afternoon", "Evening", "Unscheduled"];
  const groups = { Morning: [], Afternoon: [], Evening: [], Unscheduled: [] };
  (supplements || []).forEach((supplement) => {
    const times = Array.isArray(supplement?.time)
  ? supplement.time
  : Array.isArray(supplement?.times)
    ? supplement.times
    : [];
    const normalized = times.map(norm).map((t) =>
      t.startsWith("m") ? "morning" : t.startsWith("a") ? "afternoon" : t.startsWith("e") ? "evening" : ""
    ).filter(Boolean);
    if (normalized.length === 0) groups.Unscheduled.push(supplement);
    else normalized.forEach((t) => { const key = cap1(t); (groups[key] || groups.Unscheduled).push(supplement); });
  });
  const total = ORDER.reduce((n, k) => n + (groups[k] ? groups[k].length : 0), 0);
  const buildBox = (supplement, labelForTime) => {
    const box = document.createElement("div");
    box.className = "supplement-box cycle-strip";
    const __defaultAccent = (getComputedStyle(document.documentElement)
  .getPropertyValue("--supp-accent-default").trim()) || "#cccccc";
const __accent = (supplement && supplement.color) ? supplement.color : __defaultAccent;
box.style.borderLeftColor = __accent;
// Bottom strip: match left if on a cycle; otherwise use the same default
box.style.borderBottom = `6px solid ${ (supplement && supplement.cycle) ? __accent : __defaultAccent }`;

    const nameRow = document.createElement("div");
    const strong = document.createElement("strong");
    const nm = (supplement && supplement.name) ? String(supplement.name).trim() : "";
    let br = "";
    if (supplement) {
      const rawBrand = supplement.brand || supplement.Brand || supplement.brandname || supplement.brand_name || "";
      br = typeof rawBrand === "string" ? rawBrand.trim() : (rawBrand ? String(rawBrand).trim() : "");
    }
    strong.textContent = br ? (nm ? nm + ", " + br : br) : nm;
    nameRow.appendChild(strong);
    const doseRow = document.createElement("div");
    doseRow.textContent = "Dosage: " + ((supplement && supplement.dosage) ? supplement.dosage : "");

    // Optional start date (shown when present)
    const start = (supplement && supplement.startDate) ? String(supplement.startDate).trim() : "";
    const dateRow = document.createElement("div");
    if (start) {
      dateRow.textContent = "Start: " + fmtYMDPretty(start);
    }
    const timeRow = document.createElement("div");
    if (labelForTime) timeRow.textContent = "Time: " + labelForTime;
    else {
      const timesText = Array.isArray(supplement && supplement.time) && supplement.time.length
        ? supplement.time.join(", ") : "None selected";
      timeRow.textContent = "Time: " + timesText;
    }
    const c = (supplement && supplement.cycle) || {};
    const onDays = Number(c.on || 0);
    const offDays = Number(c.off || 0);

let cycleDiv = null;
if (onDays > 0 || offDays > 0) {
  cycleDiv = document.createElement("div");
  cycleDiv.textContent = `Cycle: ${onDays} days on / ${offDays} days off`;
  // optional: a small class if you want to style it
  // cycleDiv.className = "cycle-line";
}

 // Remaining doses (approx)
 const remainRow = document.createElement("div");
 (function computeRemaining(){
   try {
     const totalServings = Number(supplement && supplement.servings);
     const startStr = (supplement && supplement.startDate) ? String(supplement.startDate).trim() : '';
     // times per day
     const timesArr = Array.isArray(supplement?.times) ? supplement.times
                      : (Array.isArray(supplement?.time) ? supplement.time
                         : (typeof supplement?.time === 'string' && supplement.time ? [supplement.time] : []));
     const perDay = timesArr.length;
     if (!totalServings || totalServings <= 0 || !startStr || perDay <= 0) return;
     const m = startStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
     if (!m) return;
     const y = +m[1], mo = +m[2]-1, d = +m[3];
     const start = new Date(y, mo, d);
     const today = new Date();
     // normalize to local midnight
     start.setHours(0,0,0,0); today.setHours(0,0,0,0);
     let daysElapsed = Math.floor((today - start) / 86400000) + 1; // include start day
     if (daysElapsed < 0) daysElapsed = 0;
     let onDaysCount = daysElapsed;
     if (onDays > 0 || offDays > 0) {
       const period = Math.max(1, onDays + Math.max(0, offDays));
       const full = Math.floor(daysElapsed / period);
       const rem = daysElapsed % period;
       onDaysCount = full * onDays + Math.min(onDays, rem);
     }
     const consumed = Math.max(0, onDaysCount * perDay);
     const remaining = Math.max(0, totalServings - consumed);
     remainRow.textContent = `Approx. Doses Remaining: ${remaining} of ${totalServings}`;
   } catch {}
 })();

const actions = document.createElement("div");
actions.className = "actions";

const editBtn = document.createElement("button");
editBtn.className = "edit-btn btn-edit-supp";
editBtn.dataset.id = (supplement && supplement.id) ? supplement.id : "";
editBtn.textContent = "Edit";

const delBtn = document.createElement("button");
delBtn.className = "delete-btn";
delBtn.dataset.id = (supplement && supplement.id) ? supplement.id : "";
delBtn.textContent = "Delete";

actions.append(editBtn, delBtn);

// append rows based on card size (compact vs large)
const isCompact = !!(supplementSummaryContainer && supplementSummaryContainer.classList && supplementSummaryContainer.classList.contains('size-compact'));
const children = [nameRow, doseRow, timeRow];
 if (!isCompact) {
  if (start) children.push(dateRow);
  if (cycleDiv) children.push(cycleDiv);
  if (remainRow && remainRow.textContent) children.push(remainRow);
  // Add reminder toggle when remaining can be computed
  try {
    const totalServings = Number(supplement && supplement.servings);
    const hasStart = !!(supplement && supplement.startDate);
    const timesArr = Array.isArray(supplement?.times) ? supplement.times
                     : (Array.isArray(supplement?.time) ? supplement.time
                        : (typeof supplement?.time === 'string' && supplement.time ? [supplement.time] : []));
    const perDay = timesArr.length;
    if (totalServings > 0 && hasStart && perDay > 0) {
      const row = document.createElement('div');
      row.className = 'toggle order-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'toggle-input';
      cb.checked = !!supplement.orderReminder;
      cb.setAttribute('aria-label', 'Order reminder (7 days before last dose)');
      cb.addEventListener('change', async ()=>{
        try {
          if (!currentUser?.uid || !supplement?.id) return;
          await updateSupplement(currentUser.uid, supplement.id, { orderReminder: !!cb.checked });
          if (typeof window.refreshCalendar==='function') await window.refreshCalendar();
        } catch(e){ console.error('[reminder] failed', e); }
      });
      const lab = document.createElement('span');
      lab.className = 'toggle-label';
      lab.textContent = 'Order reminder (7 days before last dose)';
      row.append(cb, lab);
      children.push(row);
    }
  } catch {}
}
if (cycleDiv) children.push(cycleDiv);
children.push(actions);

box.append(...children);
return box;

  };
  if (total === 0) {
    (supplements || []).forEach((supplement) => {
      const box = buildBox(supplement, null);
      supplementSummaryContainer.appendChild(box);
    });
    wireSummaryActions();
    return;
  }
  const controls = document.createElement("div");
  controls.className = "summary-controls";
  const btnExpand = document.createElement("button");
  btnExpand.type = "button";
  btnExpand.className = "btn-expand-all";
  btnExpand.textContent = "Expand all";
  const btnCollapse = document.createElement("button");
  btnCollapse.type = "button";
  btnCollapse.className = "btn-collapse-all";
  btnCollapse.textContent = "Collapse all";
  controls.append(btnExpand, btnCollapse);
  supplementSummaryContainer.appendChild(controls);
  const collapseState = getCollapseState();
  ORDER.forEach((label) => {
    const arr = groups[label];
    if (!arr) return;
    const details = document.createElement("details");
    details.className = "supp-group";
    details.open = collapseState[label] === undefined ? true : !collapseState[label];
    const summary = document.createElement("summary");
    summary.className = "supp-group__summary";
    summary.textContent = `${label} (${arr.length})`;
    const content = document.createElement("div");
    content.className = "supp-group__content";
    arr.forEach((supplement) => {
      const box = buildBox(supplement, label);
      content.appendChild(box);
    });
    details.append(summary, content);
    supplementSummaryContainer.appendChild(details);
    details.addEventListener("toggle", () => {
      collapseState[label] = !details.open;
      setCollapseState(collapseState);
    });
  });
  btnExpand.addEventListener("click", () => {
    document.querySelectorAll(".supp-group").forEach((d) => (d.open = true));
    ["Morning","Afternoon","Evening","Unscheduled"].forEach((k) => collapseState[k] = false);
    setCollapseState(collapseState);
  });
  btnCollapse.addEventListener("click", () => {
    document.querySelectorAll(".supp-group").forEach((d) => (d.open = false));
    ["Morning","Afternoon","Evening","Unscheduled"].forEach((k) => collapseState[k] = true);
    setCollapseState(collapseState);
  });
  wireSummaryActions();
}

function wireSummaryActions() {
  document.querySelectorAll(".edit-btn").forEach((btn) => {
    btn.addEventListener("click", () => editSupplement(btn.dataset.id));
  });
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await deleteSupplement(currentUser && currentUser.uid, btn.dataset.id);
      await refreshData();
      if (typeof window.refreshCalendar === "function") await window.refreshCalendar();
    });
  });
}

// ---- Size controls (optional) ----
const summaryContainer = document.getElementById("supplementSummaryContainer");
const sizeControls = document.getElementById("summarySizeControls");
const SIZE_KEY = "suppSummarySize";

function applySavedSize() {
  const saved = localStorage.getItem(SIZE_KEY) || "size-cozy";
  summaryContainer.classList.remove("size-compact", "size-cozy", "size-comfy");
  summaryContainer.classList.add(saved);
}
applySavedSize();

if (sizeControls) {
  sizeControls.querySelectorAll("button[data-size]").forEach(btn => {
    btn.addEventListener("click", () => {
      const size = btn.getAttribute("data-size");
      localStorage.setItem(SIZE_KEY, size);
      applySavedSize();
      // Re-render cards so compact vs large rows update instantly
      try { renderSupplements(); } catch (_) {}
    });
  });
}

// (module has side effects; no explicit exports)
