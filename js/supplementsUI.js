import {
  fetchSupplements,
  addSupplement,
  deleteSupplement
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


// Add Supplement modal controls
const addSuppBtn   = document.getElementById("addSupplementBtn");
const addSuppModal = document.getElementById("addSupplementModal");
const addSuppClose = document.getElementById("addSuppClose");
const addSuppCancel= document.getElementById("addSuppCancel");
function openAddSupp(){ addSuppModal && addSuppModal.classList.remove("hidden"); }
function closeAddSupp(){ addSuppModal && addSuppModal.classList.add("hidden"); }
addSuppBtn && addSuppBtn.addEventListener("click", (e)=>{ e.preventDefault(); openAddSupp(); });
addSuppClose && addSuppClose.addEventListener("click", closeAddSupp);ck", closeAddSupp);
addSuppCancel && addSuppCancel.addEventListener("click", closeAddSupp);
// close when clicking backdrop
addSuppModal && addSuppModal.addEventListener("click", (e)=>{ if(e.target === addSuppModal) closeAddSupp(); });


document.addEventListener("DOMContentLoaded", () => {
  calendarEl = document.getElementById("calendar");
  labelEl = document.getElementById("currentMonthLabel");
});

if (window.__currentUser) { currentUser = window.__currentUser; refreshData(); }

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
      if (typeof window.refreshCalendar === "function") await window.refreshCalendar();
      try { closeAddSupp(); } catch(_) {}// Close add-supplement modal on success
      try { closeAddSupp(); } catch(_) {}}
    } catch (error) {
      console.error("❌ Failed to submit supplement:", error);
    }
  });
}

function getRandomColor() {
  const colors = ["#2196F3", "#FF9800", "#9C27B0", "#E91E63"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function editSupplement(id) {
  const supplement = supplements.find((s) => s.id === id);
  if (!supplement) return;

  editingSupplementId = id;

  document.getElementById("nameInput").value = supplement.name || "";
  document.getElementById("dosageInput").value = supplement.dosage || "";

  const timeCheckboxes = getTimeCheckboxes();
  timeCheckboxes.forEach((cb) => {
    cb.checked = Array.isArray(supplement.time) && supplement.time.includes(cb.value);
  });

  const hasCycle = !!(
    supplement.cycle &&
    (Number(supplement.cycle["on"]) > 0 || Number(supplement.cycle["off"]) > 0)
  );
  if (cycleCheckbox) cycleCheckbox.checked = hasCycle;
  if (cycleDetails) cycleDetails.classList.toggle("hidden", !hasCycle);

  const onInput = document.getElementById("onDaysInput");
  const offInput = document.getElementById("offDaysInput");
  const startInput = document.getElementById("cycleStartInput");
  if (onInput) onInput.value = hasCycle ? Number(supplement.cycle["on"]) : "";
  if (offInput) offInput.value = hasCycle ? Number(supplement.cycle["off"]) : "";
  if (startInput)
    startInput.value = hasCycle
      ? supplement.cycle["startDate"] || supplement.startDate || ""
      : "";

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
  const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const cap1 = (s) => (s && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const ORDER = ["Morning", "Afternoon", "Evening", "Unscheduled"];
  const groups = { Morning: [], Afternoon: [], Evening: [], Unscheduled: [] };
  (supplements || []).forEach((supplement) => {
    const times = Array.isArray(supplement && supplement.time) ? supplement.time : [];
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
    box.style.borderLeftColor = (supplement && supplement.color) || "#cccccc";
    const nameRow = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = (supplement && supplement.name) ? supplement.name : "";
    nameRow.appendChild(strong);
    const doseRow = document.createElement("div");
    doseRow.textContent = "Dosage: " + ((supplement && supplement.dosage) ? supplement.dosage : "");
    const timeRow = document.createElement("div");
    if (labelForTime) timeRow.textContent = "Time: " + labelForTime;
    else {
      const timesText = Array.isArray(supplement && supplement.time) && supplement.time.length
        ? supplement.time.join(", ") : "None selected";
      timeRow.textContent = "Time: " + timesText;
    }
    const c = (supplement && supplement.cycle) || {};
    const onDays = Number(c["on"] || 0);
    const offDays = Number(c["off"] || 0);
    if (onDays > 0 || offDays > 0) {
      const cycleDiv = document.createElement("div");
      cycleDiv.textContent = `Cycle: ${onDays} days on / ${offDays} days off`;
      box.appendChild(cycleDiv);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const editBtn = document.createElement("button");
    editBtn.className = "edit-btn";
    editBtn.dataset.id = (supplement && supplement.id) ? supplement.id : "";
    editBtn.textContent = "Edit";
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.dataset.id = (supplement && supplement.id) ? supplement.id : "";
    delBtn.textContent = "Delete";
    actions.append(editBtn, delBtn);
    box.append(nameRow, doseRow, timeRow, actions);
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
      try { closeAddSupp(); } catch(_) {}// Close add-supplement modal on success
      try { closeAddSupp(); } catch(_) {}});
  });
}

// (module has side effects; no explicit exports)
