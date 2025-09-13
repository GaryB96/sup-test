import {
  fetchSupplements,
  addSupplement,
  deleteSupplement,
  updateSupplement
} from "./supplements.js";
import { showConfirmToast } from "./toast.js";
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

// Derive daily servings from explicit field, dosage text, or times selected
function getPerDay(s) {
  try {
    const explicit = Number(s && s.dailyDose);
    if (explicit && explicit > 0) return explicit;
    if (typeof parseDailyFromDosage === 'function') {
      const parsed = parseDailyFromDosage(s && s.dosage);
      if (parsed && parsed > 0) return parsed;
    }
    const timesArr = Array.isArray(s?.times) ? s.times
                    : (Array.isArray(s?.time) ? s.time
                       : (typeof s?.time === 'string' && s.time ? [s.time] : []));
    return Math.max(1, timesArr.length || 1);
  } catch { return 1; }
}

// Estimate remaining doses based on startDate, servings, times/day, and cycle on/off
function computeRemainingDoses(s) {
  try {
    const totalServings = Number(s && s.servings);
    const startStr = (s && s.startDate) ? String(s.startDate).trim() : '';
    const timesArr = Array.isArray(s?.times) ? s.times
                    : (Array.isArray(s?.time) ? s.time
                       : (typeof s?.time === 'string' && s.time ? [s.time] : []));
    function parseDailyFromDosage(txt){
      try {
        if (!txt) return null;
        const t = String(txt).toLowerCase();
        const regs = [
          /(\d+(?:\.\d+)?)\s*(?:x|×)\s*(?:per\s*day|\/\s*day|a\s*day|daily)?/,
          /(\d+)\s*(?:per\s*day|\/\s*day|a\s*day|daily)/,
          /take\s+(\d+)/,
          /(\d+)\s*(?:capsules?|tablets?|pills?)\s*(?:daily|per\s*day|a\s*day)/
        ];
        for (let r of regs){ const m = t.match(r); if (m && m[1]) return Math.max(1, Math.floor(Number(m[1]))); }
        return null;
      } catch { return null; }
    }
    const parsedDaily = parseDailyFromDosage(s && s.dosage);
    const perDay = (Number(s && s.dailyDose) || 0) || parsedDaily || timesArr.length || 1;
    if (!totalServings || totalServings <= 0 || !startStr || perDay <= 0) return null;

    const m = startStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2]-1, d = +m[3];
    const start = new Date(y, mo, d);
    const today = new Date();
    start.setHours(0,0,0,0); today.setHours(0,0,0,0);

    let daysElapsed = Math.floor((today - start) / 86400000) + 1; // include start day
    if (daysElapsed < 0) daysElapsed = 0;

    let onDaysCount = daysElapsed;
    const on = Number(s?.cycle?.on || 0);
    const off = Number(s?.cycle?.off || 0);
    if (on > 0 || off > 0) {
      const period = Math.max(1, on + Math.max(0, off));
      const full = Math.floor(daysElapsed / period);
      const rem = daysElapsed % period;
      onDaysCount = full * on + Math.min(on, rem);
    }

    const consumed = Math.max(0, onDaysCount * perDay);
    const remaining = Math.max(0, totalServings - consumed);
    return remaining;
  } catch {
    return null;
  }
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
  const brandEl  = q("#suppBrand");
  const dosageEl = q("#suppDosage");
  const dailyEl  = q("#suppDailyDose");
  if (nameEl)   nameEl.value   = supplement.name || "";
  if (brandEl)  brandEl.value  = supplement.brand || "";
  if (dosageEl) dosageEl.value = supplement.dosage || "";
  if (dailyEl)  dailyEl.value  = (supplement && supplement.dailyDose != null) ? String(supplement.dailyDose) : "";

  // Populate servings with the amount remaining (fallback to total if unavailable)
  const servingsEl = q("#suppServings");
  if (servingsEl) {
    const rem = computeRemainingDoses(supplement);
    if (rem !== null && rem !== undefined) servingsEl.value = String(rem);
    else if (supplement && supplement.servings != null) servingsEl.value = String(supplement.servings);
    else servingsEl.value = "";
  }

  // Times checkboxes in modal
  const selectedTimes = Array.isArray(supplement.times)
    ? supplement.times
    : (Array.isArray(supplement.time) ? supplement.time : []);
  formModal.querySelectorAll('input[name="time"]').forEach((cb) => {
    cb.checked = selectedTimes.includes(cb.value);
  });

  // Cycle fields
  const chk      = q("#suppCycleChk");
  const onEl     = q("#suppDaysOn");
  const offEl    = q("#suppDaysOff");
  const startEl  = q("#suppCycleStart");
  const startWrap= q("#suppCycleStartWrap");
  const hasCycle = !!(supplement.cycle && (Number(supplement.cycle.on) > 0 || Number(supplement.cycle.off) > 0));
  const savedStart = (supplement.startDate || (supplement.cycle && supplement.cycle.startDate) || "");
  if (chk) {
    // Keep the user's cycle choice: only check when a real cycle exists
    chk.checked = hasCycle;
    chk.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (onEl)   onEl.value   = hasCycle ? Number(supplement.cycle.on)  : "";
  if (offEl)  offEl.value  = hasCycle ? Number(supplement.cycle.off) : "";
  if (startEl) startEl.value = savedStart;
  // If we have a saved start date but not on a cycle, ensure the picker is visible
  if (!hasCycle && savedStart && startWrap) {
    startWrap.classList.remove('hidden','is-hidden');
  }

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
  // Toggle summary title and size controls visibility when no supplements
  try {
    const titleEl   = document.getElementById('summaryTitle');
    const sizeCtrls = document.getElementById('summarySizeControls');
    const tutEl     = document.getElementById('summaryTutorial');
    const hasSupps  = Array.isArray(supplements) && supplements.length > 0;
    if (titleEl)   titleEl.style.display = hasSupps ? '' : 'none';
    if (sizeCtrls) sizeCtrls.style.display = hasSupps ? 'flex' : 'none';
    if (tutEl)     tutEl.classList.toggle('hidden', !!hasSupps);
  } catch(_){}
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
    const perDay = getPerDay(supplement);
    doseRow.textContent = "Dose per day: " + String(perDay);

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

  // Days remaining (uses dailyDose if provided)
  const remainRow = document.createElement("div");
  try {
    const totalServings = Number(supplement && supplement.servings);
    const remainingServings = computeRemainingDoses(supplement);
    const perDay = getPerDay(supplement);
    if (totalServings > 0 && remainingServings != null && perDay > 0) {
      const daysRemaining = Math.max(0, Math.ceil(remainingServings / perDay));
      remainRow.textContent = `Days remaining: ${daysRemaining}`;
    }
  } catch {}

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
if (isCompact) {
  if (remainRow && remainRow.textContent) children.push(remainRow); // show days remaining on compact
} else {
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
      try {
        const ok = await showConfirmToast('Delete this supplement?', { confirmText: 'Delete', cancelText: 'Cancel', type: 'warn', anchor: btn });
        if (!ok) return;
        await deleteSupplement(currentUser && currentUser.uid, btn.dataset.id);
        await refreshData();
        if (typeof window.refreshCalendar === "function") await window.refreshCalendar();
      } catch(e) { console.error('Delete cancelled/failed', e); }
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
