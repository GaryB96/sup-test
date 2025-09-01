import {
  fetchSupplements,
  addSupplement,
  deleteSupplement
} from "./supplements.js";

import { renderCalendar } from "./calendar.js";

let currentUser = null;
let supplements = [];
let editingSupplementId = null;

const form = document.getElementById("supplementForm");
const cycleCheckbox = document.getElementById("cycleCheckbox");
const cycleDetails = document.getElementById("cycleDetails");
const supplementSummaryContainer = document.getElementById("supplementSummaryContainer");
const cancelEditBtn = document.getElementById("cancelEditBtn");
let calendarEl, labelEl;

document.addEventListener("DOMContentLoaded", () => {
  calendarEl = document.getElementById("calendar");
  labelEl = document.getElementById("currentMonthLabel");
});

window.addEventListener("user-authenticated", async e => {
  currentUser = e.detail;
  await refreshData();
});

function getTimeCheckboxes() {
  // Support either .checkbox-tiles or .checkbox-group containers; exclude the cycle checkbox
  return document.querySelectorAll(".checkbox-tiles input[type='checkbox']:not(#cycleCheckbox), .checkbox-group input[type='checkbox']:not(#cycleCheckbox)");
}

if (cycleCheckbox && cycleDetails) {
  cycleCheckbox.addEventListener("change", () => {
    cycleDetails.classList.toggle("hidden", !cycleCheckbox.checked);
  });
}

if (form) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    if (!currentUser || !currentUser.uid) return;

    const name = document.getElementById("nameInput").value.trim();
    const dosage = document.getElementById("dosageInput").value.trim();

    const timeCheckboxes = getTimeCheckboxes();
    const time = Array.from(timeCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);

    const onCycle = cycleCheckbox?.checked || false;
    const onDays = parseInt(document.getElementById("onDaysInput")?.value, 10) || 0;
    const offDays = parseInt(document.getElementById("offDaysInput")?.value, 10) || 0;
    const picked = (document.getElementById("cycleStartInput") && document.getElementById("cycleStartInput").value) ? document.getElementById("cycleStartInput").value : null;

    // If cycling, allow user to pick the cycle start date; otherwise default to today
    const startDate = onCycle && picked ? picked : new Date().toISOString().split("T")[0];
    const color = onCycle ? getRandomColor() : "#cccccc";

    const supplement = {
      name,
      dosage,
      time,
      startDate,
      cycle: (onCycle && (onDays > 0 || offDays > 0)) ? { on: onDays, off: offDays, startDate: startDate } : null,
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
      timeCheckboxes.forEach(cb => cb.checked = false);
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
  const colors = ["#2196F3", "#FF9800", "#9C27B0", "#E91E63"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function editSupplement(id) {
  const supplement = supplements.find(s => s.id === id);
  if (!supplement) return;

  editingSupplementId = id;

  document.getElementById("nameInput").value = supplement.name || "";
  document.getElementById("dosageInput").value = supplement.dosage || "";

  const timeCheckboxes = getTimeCheckboxes();
  timeCheckboxes.forEach(cb => {
    cb.checked = Array.isArray(supplement.time) && supplement.time.includes(cb.value);
  });

  const hasCycle = !!(supplement.cycle && (Number(supplement.cycle["on"]) > 0 || Number(supplement.cycle["off"]) > 0));
  if (cycleCheckbox) cycleCheckbox.checked = hasCycle;
  if (cycleDetails) cycleDetails.classList.toggle("hidden", !hasCycle);
  const onInput = document.getElementById("onDaysInput");
  const offInput = document.getElementById("offDaysInput");
  const startInput = document.getElementById("cycleStartInput");
  if (onInput) onInput.value = hasCycle ? Number(supplement.cycle["on"]) : "";
  if (offInput) offInput.value = hasCycle ? Number(supplement.cycle["off"]) : "";
  if (startInput) startInput.value = hasCycle ? (supplement.cycle["startDate"] || (supplement.startDate || "")) : "";

  if (cancelEditBtn) cancelEditBtn.classList.remove("hidden");
}

if (cancelEditBtn) {
  cancelEditBtn.addEventListener("click", () => {
    editingSupplementId = null;
    form.reset();
    if (cycleCheckbox) cycleCheckbox.checked = false;
    if (cycleDetails) cycleDetails.classList.add("hidden");
    getTimeCheckboxes().forEach(cb => cb.checked = false);
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

function renderSupplements() {
  // Clear container
  supplementSummaryContainer.innerHTML = "";

  // Helpers
  const norm = (v) => (typeof v === "string" ? v.trim().toLowerCase() : "");
  const cap1 = (s) => (s && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s);

  const ORDER = ["Morning", "Afternoon", "Evening", "Unscheduled"];
  const groups = { Morning: [], Afternoon: [], Evening: [], Unscheduled: [] };

  (supplements || []).forEach((supplement) => {
    const times = Array.isArray(supplement && supplement.time) ? supplement.time : [];
    const normalized = times
      .map(norm)
      .map((t) => t.startsWith("m") ? "morning" : t.startsWith("a") ? "afternoon" : t.startsWith("e") ? "evening" : "")
      .filter(Boolean);

    if (normalized.length === 0) {
      groups.Unscheduled.push(supplement);
    } else {
      normalized.forEach((t) => {
        const key = cap1(t);
        if (groups[key]) groups[key].push(supplement);
        else groups.Unscheduled.push(supplement);
      });
    }
  });

  const total = ORDER.reduce((n, k) => n + (groups[k] ? groups[k].length : 0), 0);
  if (total === 0) {
    // Fallback: flat list
    (supplements || []).forEach((supplement) => {
      const box = document.createElement("div");
      box.className = "supplement-box cycle-strip";
      box.style.borderLeftColor = (supplement && supplement.color) || "#cccccc";

      const c = (supplement && supplement.cycle) || {};
      const onDays = Number(c["on"] || 0);
      const offDays = Number(c["off"] || 0);
      const hasCycle = onDays > 0 || offDays > 0;

      const timesText = (Array.isArray(supplement && supplement.time) && supplement.time.length)
        ? supplement.time.join(", ")
        : "None selected";

      const cycleInfo = hasCycle
        ? '<div>Cycle: ' + onDays + ' days on / ' + offDays + ' days off</div>'
        : '';

      const html = ''
        + '<div><strong>' + (supplement && supplement.name ? supplement.name : '') + '</strong></div>'
        + '<div>Dosage: ' + (supplement && supplement.dosage ? supplement.dosage : '') + '</div>'
        + '<div>Time: ' + timesText + '</div>'
        + cycleInfo
        + '<div class="actions">'
        +   '<button class="edit-btn" data-id="' + (supplement && supplement.id ? supplement.id : '') + '">Edit</button>'
        +   '<button class="delete-btn" data-id="' + (supplement && supplement.id ? supplement.id : '') + '">Delete</button>'
        + '</div>';

      box.innerHTML = html;
      supplementSummaryContainer.appendChild(box);
    });

    wireSummaryActions();
    return;
  }

  // Grouped render
  ORDER.forEach((label) => {
    const arr = groups[label];
    if (!arr || arr.length === 0) return;

    const header = document.createElement("div");
    header.className = "summary-group-title";
    header.textContent = label;
    supplementSummaryContainer.appendChild(header);

    arr.forEach((supplement) => {
      const box = document.createElement("div");
      box.className = "supplement-box cycle-strip";
      box.style.borderLeftColor = (supplement && supplement.color) || "#cccccc";

      const c = (supplement && supplement.cycle) || {};
      const onDays = Number(c["on"] || 0);
      const offDays = Number(c["off"] || 0);
      const hasCycle = onDays > 0 || offDays > 0;

      const cycleInfo = hasCycle
        ? '<div>Cycle: ' + onDays + ' days on / ' + offDays + ' days off</div>'
        : '';

      const html = ''
        + '<div><strong>' + (supplement && supplement.name ? supplement.name : '') + '</strong></div>'
        + '<div>Dosage: ' + (supplement && supplement.dosage ? supplement.dosage : '') + '</div>'
        + '<div>Time: ' + label + '</div>'
        + cycleInfo
        + '<div class="actions">'
        +   '<button class="edit-btn" data-id="' + (supplement && supplement.id ? supplement.id : '') + '">Edit</button>'
        +   '<button class="delete-btn" data-id="' + (supplement && supplement.id ? supplement.id : '') + '">Delete</button>'
        + '</div>';

      box.innerHTML = html;
      supplementSummaryContainer.appendChild(box);
    });
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

// Export nothing; this module sets up listeners and functions by side effect.
