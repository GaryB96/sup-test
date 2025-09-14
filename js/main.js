import { showToast } from "./toast.js";
import { login, signup, logout, deleteAccount, monitorAuthState, changePassword, resetPassword, resendVerification } from "./auth.js";
import { renderCalendar } from "./calendar.js";
import { fetchSupplements, addSupplement } from "./supplements.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { auth } from "./firebaseConfig.js";
import { updateSupplement } from "./supplements.js";

document.documentElement.classList.add("auth-pending");

// Deterministic palette-based color picker shared by summary + calendar
if (!window.pickColor) {
  window.pickColor = function pickColor(seed) {
    const palette = [
      "#2196F3", "#FF9800", "#9C27B0", "#1EE92F",
      "#E91E63", "#3F51B5", "#009688", "#795548"
    ];
    let h = 2166136261 >>> 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % palette.length;
    return palette[idx];
  };
}

// Modal State - edit vs add
let SUPP_MODAL_CTX = { mode: "add", id: null };

// Inline status helper (avoids browser alert banners)
// Inline status helper (avoids browser alert banners)
function showInlineStatus(message, type = "info") {
  const el =
    document.getElementById("auth-status") ||
    document.getElementById("app-status");

  if (!el) {
    console[type === "error" ? "error" : "log"](message);
    return;
  }

  // Clear previous state
  el.classList.remove("error", "success", "warn", "info");
  if (type) el.classList.add(type);

  // Set text and show the pill
  el.textContent = message || "";
  el.style.display = message ? "inline-block" : "none";

  // Auto-hide after 8s
  clearTimeout(el._hideTimer);
  if (message) {
    el._hideTimer = setTimeout(() => {
      el.style.display = "none";
      el.textContent = "";
      el.classList.remove("error", "success", "warn", "info");
    }, 8000);
  }
}

// ==== Notifications UI & ICS Export ====
import { db } from "./firebaseConfig.js";
import { collection, getDocs, doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-firestore.js";

function el(id){ return document.getElementById(id); }
function guessTZ(){ try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Halifax"; } catch { return "America/Halifax"; } }

async function openNotificationsModal() {
  if (!currentUser) return;
  el("notificationsModal")?.classList.remove("hidden");
  const statusEl = el("notifStatus"); if (statusEl) statusEl.textContent = "";
  const chk = el("notifyEmailChk"); if (chk) chk.checked = false;
  const emailEl = el("notifyEmailInput"); if (emailEl) emailEl.value = (auth.currentUser?.email || "");
  const tzEl = el("timezoneSelect"); if (tzEl) tzEl.value = guessTZ();
  try {
    try { const cal = document.getElementById("calendar"); if (cal) cal.classList.add('is-loading'); } catch {}
    const ref = doc(db, `users/${currentUser.uid}/settings/notifications`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const s = snap.data();
      if (chk) chk.checked = !!s.notifyEmail;
      if (emailEl && s.email) emailEl.value = s.email;
      if (tzEl && s.timezone) tzEl.value = s.timezone;
    }
  } catch (e) { console.error("Failed to load notif settings", e); }
}
function closeNotificationsModal(){ el("notificationsModal")?.classList.add("hidden"); }

// simple debounce
function debounce(fn, wait){ let t; return function(...args){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,args), wait); }; }


function setNotesButtonVisibility(isLoggedIn) {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (isLoggedIn) {
    sidebar.classList.remove("hidden");
  } else {
    sidebar.classList.add("hidden");
  }
}


function openNotesModal() {
  if (!currentUser) return;

  const modal  = document.getElementById("notesModal");
  const status = document.getElementById("notesStatus");
  const ta     = document.getElementById("notesTextarea");
  if (!modal || !ta) return;

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
  if (status) status.textContent = "Loading…";

  // Helper for a consistent ref
  const notesRef = () => doc(db, "users", currentUser.uid, "notes", "personal");

  // Load latest
  (async () => {
    try {
      const snap = await getDoc(notesRef());
      const data = snap.exists() ? snap.data() : null;
      ta.value = (data && typeof data.notesText === "string") ? data.notesText : "";
      if (status) status.textContent = (data && data.notesUpdatedAt)
        ? ("Saved " + new Date(data.notesUpdatedAt).toLocaleTimeString())
        : "Loaded.";
    } catch (err) {
      console.error("[notes] load failed:", err);
      if (status) status.textContent = "Could not load notes.";
    }
  })();

  // Save helper: always re-query the current textarea to avoid stale references
  const saveNow = async () => {
    if (!currentUser) return;
    const curTa = document.getElementById("notesTextarea");
    if (!curTa) return;
    if (status) status.textContent = "Saving…";
    try {
      await setDoc(notesRef(), {
        notesText: curTa.value || "",
        notesUpdatedAt: new Date().toISOString()
      }, { merge: true });
      if (status) status.textContent = "Saved just now";
    } catch (e) {
      console.error("[notes] save failed:", e);
      if (status) status.textContent = "Save failed. Retry (Ctrl/Cmd+S).";
    }
  };

  // Debounced handler
  const debouncedSave = (function(fn, wait){
    let t; return function(){
      clearTimeout(t); t = setTimeout(fn, wait);
    };
  })(saveNow, 800);

  // Clean up any old handlers before attaching new ones
  if (!window._notesHandlers) window._notesHandlers = {};
  const H = window._notesHandlers;
  // Remove previous
  if (H.input)   ta.removeEventListener("input", H.input);
  if (H.blur)    ta.removeEventListener("blur", H.blur);
  if (H.keydown) modal.removeEventListener("keydown", H.keydown);
  if (H.backdrop) modal.removeEventListener("click", H.backdrop);

  // Add fresh
  H.input = () => { if (status) status.textContent = "Saving…"; debouncedSave(); };
  H.blur  = () => { saveNow(); };
  H.keydown = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault(); saveNow();
    }
  };
  H.backdrop = async (ev) => {
    // Close when clicking outside the card (on the dark backdrop)
    if (ev && ev.target === modal) {
      try { await saveNow(); } catch {}
      closeNotesModal();
    }
  };
  ta.addEventListener("input", H.input);
  ta.addEventListener("blur", H.blur);
  modal.addEventListener("keydown", H.keydown);
  modal.addEventListener("click", H.backdrop);

  // Ensure the close button flushes one final save
  const closeBtn = document.getElementById("closeNotesBtn");
  if (closeBtn) {
    closeBtn.onclick = async (e) => {
      e.preventDefault();
      await saveNow();
      closeNotesModal();
    };
  }
}
function closeNotesModal(){ const m=document.getElementById("notesModal"); if(m) m.classList.add("hidden"); document.body.style.overflow=""; }

async function saveNotes(){ /* deprecated: autosave handles this */ }

async function saveNotifications() {
  if (!currentUser) return;
  const chk = el("notifyEmailChk");
  const emailEl = el("notifyEmailInput");
  const tzEl = el("timezoneSelect");
  const ref = doc(db, `users/${currentUser.uid}/settings/notifications`);
  await setDoc(ref, { notifyEmail: !!(chk && chk.checked), email: (emailEl && emailEl.value ? emailEl.value.trim() : "") || null, timezone: (tzEl && tzEl.value) || guessTZ() }, { merge:true });
  const statusEl = el("notifStatus"); if (statusEl) statusEl.textContent = "Saved.";
}

// --- ICS helpers ---
function addDaysUTC(dateUTC, days){ const d = new Date(Date.UTC(dateUTC.getUTCFullYear(), dateUTC.getUTCMonth(), dateUTC.getUTCDate())); d.setUTCDate(d.getUTCDate()+days); return d; }
function ymdUTC(d){ return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`; }

function buildIcs(boundaries, calendarName){
  const fmtDate = d => `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  let ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Supplement Tracker//Cycle Reminders//EN\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n";
  ics += `X-WR-CALNAME:${(calendarName||"Cycle Reminders").replace(/[\r\n]/g,' ')}\r\n`;
  for (const evt of boundaries){
    const dt = fmtDate(evt.dateUTC);
    const dtEnd = fmtDate(addDaysUTC(evt.dateUTC,1));
    ics += "BEGIN:VEVENT\r\n";
    ics += `UID:${evt.uid}\r\n`;
    ics += `DTSTAMP:${stamp}\r\n`;
    ics += `SUMMARY:${evt.title.replace(/[\r\n]/g,' ')}\r\n`;
    ics += `DTSTART;VALUE=DATE:${dt}\r\n`;
    ics += `DTEND;VALUE=DATE:${dtEnd}\r\n`;
    ics += "END:VEVENT\r\n";
  }
  ics += "END:VCALENDAR\r\n";
  return ics;
}

async function downloadIcs(){
  if (!currentUser) return;
  const statusEl = el("notifStatus"); if (statusEl) statusEl.textContent = "Building calendar…";
  const supps = await fetchSupplements(currentUser.uid);
  const nowUTC = new Date();
  const endUTC = addDaysUTC(nowUTC, 365);
  const boundaries = [];
  for (const s of supps){
    const name = s.name || "Supplement";
    const on = (s.cycle && s.cycle.on) || 0;
    const off = (s.cycle && s.cycle.off) || 0;
    if (!s.startDate || on <= 0 || off < 0) continue;
    const start = new Date(s.startDate);
    const startUTC = new Date(Date.UTC(start.getUTCFullYear(), start.getMonth(), start.getDate()));
    const period = on + off; if (period <= 0) continue;
    const pushIfInRange = (boundaryUTC, title) => {
      const notifyDay = addDaysUTC(boundaryUTC, -1);
      if (notifyDay >= nowUTC && notifyDay <= endUTC){
        const uid = `${s.id}-${title}-${ymdUTC(notifyDay)}`;
        boundaries.push({ dateUTC: notifyDay, title: `${name}: ${title} tomorrow`, uid });
      }
    };
    let k = -2;
    while (true){
      const onEnds = addDaysUTC(startUTC, on + k*period);
      const onBegins = addDaysUTC(startUTC, period + k*period);
      if (onEnds > addDaysUTC(endUTC, 2) && onBegins > addDaysUTC(endUTC, 2)) break;
      if (onEnds >= addDaysUTC(nowUTC, -2)) pushIfInRange(onEnds, "ON ends");
      if (onBegins >= addDaysUTC(nowUTC, -2)) pushIfInRange(onBegins, "ON begins");
      k++; if (k > 2000) break;
    }
  }
  boundaries.sort((a,b)=> a.dateUTC - b.dateUTC);
  const ics = buildIcs(boundaries, "Cycle Reminders");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "cycle-reminders.ics"; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 0);
  if (statusEl) statusEl.textContent = `Calendar generated with ${boundaries.length} reminders.`;
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("openNotifications")?.addEventListener("click", (e)=>{ e.preventDefault(); openNotificationsModal(); });
  document.getElementById("closeNotificationsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); closeNotificationsModal(); });
  document.getElementById("saveNotificationsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); saveNotifications(); });
  document.getElementById("downloadIcsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); downloadIcs(); });
});

// Persist calendar view (month/year)
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
const CAL_VIEW_KEY = "calendar_view_v1";
try {
  const saved = JSON.parse(localStorage.getItem(CAL_VIEW_KEY) || "null");
  if (saved && Number.isInteger(saved.m) && Number.isInteger(saved.y)) {
    currentMonth = Math.min(11, Math.max(0, saved.m));
    currentYear = saved.y;
  }
} catch {}
let currentUser = null;

// Make cycle boundaries available to notifications.js
window.getCycleBoundaries = async function(startISO, endISO) {
  if (!currentUser) return [];

  const startUTC = new Date(`${startISO}T00:00:00Z`);
  const endUTC   = new Date(`${endISO}T00:00:00Z`);

  const supps = await fetchSupplements(currentUser.uid);
  const out = [];

  for (const s of supps) {
    const name = s.name || "Supplement";
    const on   = (s.cycle && s.cycle.on)  || 0;
    const off  = (s.cycle && s.cycle.off) || 0;
    if (!s.startDate || on <= 0 || off < 0) continue;

    const start = new Date(s.startDate);
    const start0 = new Date(Date.UTC(start.getUTCFullYear(), start.getMonth(), start.getDate()));
    const period = on + off;
    if (period <= 0) continue;

    // Walk forward/back to cover [startISO, endISO]
    let k = -2;
    // On-ends happen at start0 + on + k*period
    // Next on-begins happen at start0 + period + k*period
    while (true) {
      const onEndsUTC   = addDaysUTC(start0, on + k * period);
      const onBeginsUTC = addDaysUTC(start0, period + k * period);

      // stop once both are past range (with a small buffer)
      if (onEndsUTC > addDaysUTC(endUTC, 2) && onBeginsUTC > addDaysUTC(endUTC, 2)) break;

      // include if within range (with a tiny look-behind buffer)
      if (onEndsUTC >= addDaysUTC(startUTC, -2) && onEndsUTC <= addDaysUTC(endUTC, 2)) {
        out.push({
          date: ymdUTC(onEndsUTC),      // YYYY-MM-DD
          type: "end",
          title: `${name}: ON ends tomorrow`
        });
      }
      if (onBeginsUTC >= addDaysUTC(startUTC, -2) && onBeginsUTC <= addDaysUTC(endUTC, 2)) {
        out.push({
          date: ymdUTC(onBeginsUTC),    // YYYY-MM-DD
          type: "begin",
          title: `${name}: ON begins tomorrow`
        });
      }
      k++;
      if (k > 2000) break; // safety
    }
  }

  // sort by date
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
};

// --- Delete Account: modal helpers ---
function openConfirmDeleteModal() {
  const modal = document.getElementById("confirmDeleteModal");
  modal?.classList.remove("hidden");
}
function closeConfirmDeleteModal() {
  const modal = document.getElementById("confirmDeleteModal");
  modal?.classList.add("hidden");
}
function openPasswordConfirmModal() {
  const pwdModal = document.getElementById("passwordConfirmModal");
  const input = document.getElementById("confirmPasswordInput");
  if (pwdModal) {
    pwdModal.classList.remove("hidden");
    // clear previous input
    if (input) input.value = "";
    setTimeout(() => input?.focus(), 50);
  }
}
function closePasswordConfirmModal() {
  const pwdModal = document.getElementById("passwordConfirmModal");
  pwdModal?.classList.add("hidden");
}

document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  const calendarEl = document.getElementById("calendar");
  const labelEl = document.getElementById("currentMonthLabel");
  const loginForm = document.getElementById("loginForm");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  // Notes modal wiring
  const notesBtn = document.getElementById("notesBtn");
  const closeNotesBtn = document.getElementById("closeNotesBtn");
  const saveNotesBtn = document.getElementById("saveNotesBtn");
  if (notesBtn) {
    notesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      openNotesModal();
    });
  }
  if (closeNotesBtn) {
    closeNotesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      closeNotesModal();
    });
  }
  if (saveNotesBtn) {
    saveNotesBtn.addEventListener("click", (e) => {
      e.preventDefault();
      saveNotes();
    });
  }

// --- Month navigation ---
if (prevBtn) {
  prevBtn.addEventListener("click", async () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    try { localStorage.setItem(CAL_VIEW_KEY, JSON.stringify({ m: currentMonth, y: currentYear })); } catch {}
    await refreshCalendar();
  });
}
if (nextBtn) {
  nextBtn.addEventListener("click", async () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    try { localStorage.setItem(CAL_VIEW_KEY, JSON.stringify({ m: currentMonth, y: currentYear })); } catch {}
    await refreshCalendar();
  });
}
})

  // --- Profile dropdown ---
  const profileButton = document.getElementById("profileButton");
  const dropdownContainer = profileButton ? profileButton.closest(".dropdown") : null;
  const resetPasswordLink = document.getElementById("resetPassword");
  const deleteAccountLink = document.getElementById("deleteAccount");

  if (dropdownContainer && profileButton) {
    profileButton.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropdownContainer.classList.toggle("show");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dropdown")) {
        dropdownContainer.classList.remove("show");
      }
    });
  }

  if (resetPasswordLink) {
    resetPasswordLink.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        const result = await resetPassword();
        showInlineStatus(result.message, "success");
    try { showToast(result.message, "success", 5000); } catch(e) {}
      } catch (err) {
        console.error("Password reset error:", err);
        if (err && err.code === "auth/missing-email") {
          showInlineStatus("Please enter your email first.", "error");
        } else {
          // Keep UX non-enumerating even on errors
          showInlineStatus("If an account exists for that email, a reset link has been sent. Please check your inbox and spam.", "success");
        try { showToast("Password reset email sent. Check your inbox and spam.", "success", 5000); } catch(e) {}
        }
      }
    });
  }

  // Open delete confirmation modal from dropdown
  if (deleteAccountLink) {
    deleteAccountLink.addEventListener("click", (e) => {
      e.preventDefault();
      openConfirmDeleteModal();
    });
  }

  // --- Confirm Delete Modal wiring ---
  const confirmYes = document.getElementById("confirmDeleteYes");
  const confirmNo = document.getElementById("confirmDeleteNo");

  if (confirmNo) {
    confirmNo.addEventListener("click", () => {
      closeConfirmDeleteModal();
    });
  }

  if (confirmYes) {
    confirmYes.addEventListener("click", async () => {
      // Step 1 done -> open password modal
      closeConfirmDeleteModal();
      openPasswordConfirmModal();
    });
  }

  // --- Auth state → show/hide app && render calendar ---

  monitorAuthState(async user => {
    // Re-query DOM elements inside this scope to avoid ReferenceError
    const calendarEl = document.getElementById("calendar");
    const labelEl = document.getElementById("currentMonthLabel");
if (user) {
      document.body.classList.add("logged-in");
      currentUser = user;
      // Collapse sidebar on sign-in (no change to animation speed)
      try {
        localStorage.setItem('sidebar_collapsed_v1', 'true');
        const sidebar = document.getElementById('sidebar');
        if (sidebar) sidebar.setAttribute('data-collapsed','true');
        document.body.classList.add('sidebar-collapsed');
      } catch {}
      setNotesButtonVisibility(true);
      const event = new CustomEvent("user-authenticated", { detail: user });
      window.dispatchEvent(event);

      setNotesButtonVisibility(true);
    } else {
      document.body.classList.remove("logged-in");
      if (calendarEl) calendarEl.innerHTML = "";
      if (labelEl) labelEl.textContent = "";
      
      setNotesButtonVisibility(false);
    }
    await refreshCalendar();
  });      
// --- Login / Signup form ---
  // Tabs
  const tabs = Array.from(document.querySelectorAll(".tabs .tab"));
  const panes = {
    signin: document.getElementById("signinForm"),
    signup: document.getElementById("signupForm")
  };
  function setTab(name) {
    tabs.forEach(t => {
      const active = t.dataset.tab === name;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true" : "false");
    });
    Object.entries(panes).forEach(([key, pane]) => {
      if (pane) pane.classList.toggle("active", key === name);
    });
    const firstInput = panes[name]?.querySelector("input");
    if (firstInput) firstInput.focus();
  }
  tabs.forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));

  // Sign In
  const signinForm = document.getElementById("signinForm");
  const signinEmail = document.getElementById("signinEmail");
  const signinPass = document.getElementById("signinPassword");
  const forgotLink = document.getElementById("forgotPasswordLink");

  if (forgotLink) {
    forgotLink.addEventListener("click", async (e) => {
      e.preventDefault();
      const email = signinEmail?.value?.trim();
      if (!email) { showInlineStatus("Enter your email above, then click Forgot password.", "error"); return; }
      try {
        const result = await resetPassword(email);
        showInlineStatus(result.message, "success");
    try { showToast(result.message, "success", 5000); } catch(e) {}
      } catch (err) {
        console.error(err);
        // Keep UX non-enumerating even on errors
        showInlineStatus("If an account exists for that email, a reset link has been sent. Please check your inbox and spam.", "success");
        try { showToast("Password reset email sent. Check your inbox and spam.", "success", 5000); } catch(e) {}
      }
    });
  }

  if (signinForm) {
    signinForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = signinEmail?.value?.trim();
      const password = signinPass?.value || "";
      if (!email || !password) { showInlineStatus("Please enter both email and password.", "error"); return; }
      try {
        await login(email, password);            // monitorAuthState will flip the UI
        showInlineStatus("Signed in.", "success");  // optional
      } catch (error) {
        showInlineStatus("Login failed: " + (error?.message || ""), "error");
        console.error("Login error:", error);
      }
    });
  }

  // Sign Up
  const signupForm = document.getElementById("signupForm");
  const signupEmail = document.getElementById("signupEmail");
  const signupPass = document.getElementById("signupPassword");
  const signupPass2 = document.getElementById("signupPassword2");
  const resendBtn = document.getElementById("resendVerificationBtn");

  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = signupEmail?.value?.trim();
      const p1 = signupPass?.value || "";
      const p2 = signupPass2?.value || "";
      if (!email || !p1 || !p2) { showInlineStatus("Please complete all fields.", "error"); return; }
      if (p1.length < 6) { showInlineStatus("Password must be at least 6 characters.", "error"); return; }
      if (p1 !== p2) { showInlineStatus("Those passwords don’t match. Please re-enter the same password in both fields.", "error"); return; }
      try {
        await signup(email, p1);
      } catch (err) {
        if (err && err.code === "auth/email-not-verified") {
          showInlineStatus("Account created. We sent a verification email to " + email + ". Please click the link to activate your account.", "success");
          if (resendBtn) resendBtn.style.display = "inline-block";
          setTab("signin");
          return;
        }
        if (err && err.code === "auth/email-already-in-use") {
  showInlineStatus("An account with this email already exists. Please sign in or use ‘Forgot password’ to reset it.", "error");
  const tabBtn = document.querySelector('.tabs .tab[data-tab="signin"]');
  if (tabBtn) tabBtn.click();
  const emailField = document.getElementById("signinEmail");
  if (emailField && email) emailField.value = email;
  return;
} else {
          showInlineStatus("Signup failed: " + (err?.message || ""), "error");
        }
        console.error("Signup error:", err);
      }
    });
  }

  if (resendBtn) {
    resendBtn.addEventListener("click", async () => {
      try {
        await resendVerification();
        showInlineStatus("Verification email sent. Please check your inbox.", "success");
      } catch (e) {
        showInlineStatus(e?.message || "Could not send verification email.", "error");
      }
    });
  }
// --- Logout ---
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      showInlineStatus("You have been logged out.", "info");
      window.location.href = "index.html";
    });
  }

// Helpers to keep everything in LOCAL time (no UTC parsing)
function parseLocalDate(ymd) {
  // ymd: "YYYY-MM-DD"
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m - 1), d); // local midnight
}
function toLocalYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 🔁 Generate all "on" dates for a supplement cycle (LOCAL dates)
function generateCycleDates(startDateStr, cycle, endDate) {
  const dates = [];
  if (!startDateStr || !cycle || (cycle.on === 0 && cycle.off === 0)) return dates;

  let current = parseLocalDate(startDateStr);
  // normalize end to local midnight
  const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());

  if (isNaN(current)) {
    console.warn("Invalid startDate:", startDateStr);
    return dates;
  }

  while (current <= end) {
    for (let i = 0; i < cycle.on && current <= end; i++) {
      dates.push(new Date(current));              // local midnight
      current.setDate(current.getDate() + 1);     // advance by 1 day (local)
    }
    current.setDate(current.getDate() + cycle.off); // skip off days (local)
  }
  return dates;
}

// 🌐 Expose calendar refresh globally
// Helper: compute order reminder date (7 days before last dose)
function _computeOrderReminderDate(supp) {
  try {
    const servings = Number(supp && supp.servings);
    const startStr = (supp && supp.startDate) ? String(supp.startDate) : '';
    const timesArr = Array.isArray(supp?.times) ? supp.times
                    : (Array.isArray(supp?.time) ? supp.time
                       : (typeof supp?.time === 'string' && supp.time ? [supp.time] : []));
    // Try to infer daily count from dosage text (e.g., "2 per day", "2/day", "2x daily")
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
    const parsedDaily = parseDailyFromDosage(supp && supp.dosage);
    const perDay = (Number(supp && supp.dailyDose) || 0) || parsedDaily || timesArr.length || 1;
    if (!servings || servings <= 0 || !startStr || perDay <= 0) return null;
    const m = startStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2]-1, d = +m[3];
    const start = new Date(y, mo, d);
    start.setHours(0,0,0,0);
    const needOnDays = Math.max(1, Math.ceil(servings / perDay));
    let last = null;
    if (supp && supp.cycle && (Number(supp.cycle.on)||0) + (Number(supp.cycle.off)||0) > 0) {
      const on = Math.max(0, Number(supp.cycle.on)||0);
      const off = Math.max(0, Number(supp.cycle.off)||0);
      const period = Math.max(1, on + off);
      let i = 0, count = 0; const date = new Date(start);
      let guard = 0;
      while (count < needOnDays && guard < 5000) {
        if ((i % period) < on) {
          count++;
          last = new Date(date);
        }
        if (count >= needOnDays) break;
        date.setDate(date.getDate() + 1);
        i++; guard++;
      }
    } else {
      last = new Date(start);
      last.setDate(last.getDate() + (needOnDays - 1));
    }
    if (!last) return null;
    const reminder = new Date(last);
    reminder.setDate(reminder.getDate() - 7);
    return reminder;
  } catch { return null; }
}

async function refreshCalendar() {
  if (!currentUser || !currentUser.uid) return;
  try {
    const rawSupplements = await fetchSupplements(currentUser.uid);
    const expandedSupplements = [];
    const seen = new Set(); // key: id|date
    const monthStart = new Date(currentYear, currentMonth, 1);
    const monthEnd = new Date(currentYear, currentMonth, 1);
    monthEnd.setDate(monthEnd.getDate() + 60); // show 60 days ahead
    window.refreshCalendar = refreshCalendar;
    for (const supp of rawSupplements) {
      if (supp.cycle && supp.startDate) {
        const cycleDates = generateCycleDates(supp.startDate, supp.cycle, monthEnd);
        for (const date of cycleDates) {
          if (
            date.getMonth() === currentMonth &&
            date.getFullYear() === currentYear
          ) {
          const ymd = toLocalYMD(date);
          const key = (supp.id || supp.name) + '|' + ymd;
          if (!seen.has(key)) {
            seen.add(key);
            const timesArr = Array.isArray(supp?.times) ? supp.times
                           : (Array.isArray(supp?.time) ? supp.time
                              : (typeof supp?.time === 'string' && supp.time ? [supp.time] : []));
            expandedSupplements.push({
              id: supp.id,
              name: supp.name,
              date: ymd,
              color: supp.color || "#cccccc",
              times: timesArr
            });
          }
          }
        }
      } else if (supp.date) {
        // fallback for one-off supplements
        const date = new Date(supp.date);
        if (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        ) {
          const ymd = supp.date;
          const key = (supp.id || supp.name) + '|' + ymd;
          if (!seen.has(key)) {
            seen.add(key);
            const timesArr = Array.isArray(supp?.times) ? supp.times
                           : (Array.isArray(supp?.time) ? supp.time
                              : (typeof supp?.time === 'string' && supp.time ? [supp.time] : []));
            expandedSupplements.push({
              id: supp.id,
              name: supp.name,
              date: ymd,
              color: supp.color || "#cccccc",
              times: timesArr
            });
          }
        }
      }
    }

    // Add one-time order reminders (7 days before last dose) for this month
    try {
      for (const supp of rawSupplements) {
        if (!supp || !supp.orderReminder) continue;
        const rDate = _computeOrderReminderDate(supp);
        if (!rDate) continue;
        if (rDate.getMonth() === currentMonth && rDate.getFullYear() === currentYear) {
          const ymd = toLocalYMD(rDate);
          const key = (supp.id || `order-${supp.name}`) + '|' + ymd;
          if (!seen.has(key)) {
            seen.add(key);
            expandedSupplements.push({
              id: supp.id,
              name: `Order more: ${supp.name}`,
              date: ymd,
              color: '#b45309',
              type: 'orderReminder',
              hiddenInGrid: true
            });
          }
        }
      }
    } catch {}

    // Include user-toggled supplements for each day of the current month (modal only)
    try {
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      for (const supp of rawSupplements) {
        if (!supp || !supp.showOnCalendar) continue;
        const timesArr = Array.isArray(supp?.times) ? supp.times
                       : (Array.isArray(supp?.time) ? supp.time
                          : (typeof supp?.time === 'string' && supp.time ? [supp.time] : []));
        for (let d = 1; d <= daysInMonth; d++) {
          const ymd = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const key = (supp.id || supp.name) + '|' + ymd;
          if (seen.has(key)) continue; // don't duplicate cycle or one-off
          expandedSupplements.push({
            id: supp.id,
            name: supp.name,
            date: ymd,
            color: supp.color || '#cccccc',
            times: timesArr,
            hiddenInGrid: true
          });
        }
      }
    } catch {}

    const calendarEl = document.getElementById("calendar");
    const labelEl = document.getElementById("currentMonthLabel");
    try { if (calendarEl) calendarEl.classList.remove('is-loading'); } catch {}
    renderCalendar(currentMonth, currentYear, expandedSupplements, calendarEl, labelEl);
  } catch (error) {
    console.error("❌ Failed to fetch supplements for calendar:", error);
  }

  // --- Password confirm modal buttons ---
  const passwordCancelBtn = document.getElementById("passwordCancelBtn");
  const passwordConfirmBtn = document.getElementById("passwordConfirmBtn");

  if (passwordCancelBtn) {
    passwordCancelBtn.addEventListener("click", () => {
      closePasswordConfirmModal();
    });
  }

  if (passwordConfirmBtn) {
    passwordConfirmBtn.addEventListener("click", async () => {
      const user = auth.currentUser;
      if (!user) {
        showInlineStatus("No user is currently signed in.", "error");
        closePasswordConfirmModal();
        return;
      }
      const input = document.getElementById("confirmPasswordInput");
      const password = input ? input.value : "";
      if (!password) {
        showInlineStatus("Please enter your password.", "error");
        return;
      }
      try {
        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
        await deleteAccount(user);
        showInlineStatus("Your account has been deleted.", "success");
        window.location.href = "index.html";
      } catch (error) {
        console.error(error);
        if (error.code === "auth/wrong-password") {
          showInlineStatus("Incorrect password. Please try again.", "error");
        } else if (error.code === "auth/too-many-requests") {
          showInlineStatus("Too many attempts. Please try again later.", "warn");
        } else {
          showInlineStatus("An error occurred. " + (error.message || ""), "error");
        }
      } finally {
        closePasswordConfirmModal();
      }
    });
  }
}

// === Add New Supplement Modal (self-contained) ===
document.addEventListener("DOMContentLoaded", () => {
  const openBtn = document.getElementById("addSupplementBtn");
  const modal   = document.getElementById("supplementModal");
  if (!openBtn || !modal) return;

  // Prefer the dedicated modal form id; else fall back to any form inside the modal
  const form = document.getElementById("supplementModalForm") || modal.querySelector("form");
  if (!form) return;

  // ---------- Focus trap + open/close ----------
  let lastFocusedEl = null;
  const focusableSelector = `a[href],area[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),button:not([disabled]),[tabindex]:not([tabindex="-1"])`;

  function trapFocus(e) {
    if (e.key !== "Tab") return;
    const focusables = Array.from(modal.querySelectorAll(focusableSelector))
      .filter(el => el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last  = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function openModal() {
    lastFocusedEl = document.activeElement;
    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
    modal.addEventListener("keydown", trapFocus);
    const first = modal.querySelector(focusableSelector);
    if (first) first.focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    modal.removeEventListener("keydown", trapFocus);
    if (lastFocusedEl && typeof lastFocusedEl.focus === "function") lastFocusedEl.focus();
  }

  // Open
  openBtn.addEventListener("click", (e) => { e.preventDefault(); openModal(); });

  // Close on backdrop / explicit close targets
  modal.addEventListener("click", (e) => {
    if (e.target.matches("[data-close-modal]")) {
      e.preventDefault();
      closeModal();
    }
  });

  // Close on ESC
  window.addEventListener("keydown", (e) => {
    if (!modal.classList.contains("hidden") && e.key === "Escape") closeModal();
  });

  // ---------- Cycle UI toggle (non-collapsing by default) ----------
  const cycleChk   = form.querySelector("#suppCycleChk");
  const startWrap  = form.querySelector("#suppCycleStartWrap");
  const startInput = form.querySelector("#suppCycleStart");
  const startReq   = form.querySelector("#startDateReqStar");
  if (cycleChk && startWrap) {
    // Prefer .is-hidden (keeps space reserved); fallback to .hidden if that's what you have
    const hideClass = startWrap.classList.contains("is-hidden") ? "is-hidden" : "hidden";
    const sync = () => {
      if (hideClass === "is-hidden") {
        startWrap.classList.toggle("is-hidden", !cycleChk.checked);
      } else {
        // If you must use .hidden, also ensure your CSS preserves layout; otherwise this will reflow.
        startWrap.classList.toggle("hidden", !cycleChk.checked);
      }
      if (startInput) startInput.required = !!cycleChk.checked;
      if (startReq) startReq.style.display = cycleChk.checked ? 'inline' : 'none';
    };
    cycleChk.addEventListener("change", sync);
    sync();
  }

// ---------- Submit (writes to Firestore and refreshes UI) ----------
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const uid = auth?.currentUser?.uid || window.currentUser?.uid;
  if (!uid) {
    try { typeof showInlineStatus === "function" && showInlineStatus("Please sign in first.", "error"); } catch {}
    return;
  }

  // Collect values from the modal
  const name   = form.querySelector("#suppName")?.value?.trim() || "";
  const brand  = form.querySelector("#suppBrand")?.value?.trim() || "";
  const dosage = form.querySelector("#suppDosage")?.value?.trim() || "";
  const dailyDoseRaw = form.querySelector("#suppDailyDose")?.value || "";
  const servingsRaw = form.querySelector("#suppServings")?.value;

  const times = Array.from(form.querySelectorAll('input[name="time"]:checked'))
    .map(cb => cb.value); // e.g., ["Morning","Evening"]

  // Basic validation: require name, dosage, and at least one time of day
  if (!name) {
    try { typeof showInlineStatus === "function" && showInlineStatus("Please enter a name.", "error"); } catch {}
    return;
  }
  if (!dosage) {
    try { typeof showInlineStatus === "function" && showInlineStatus("Please enter a dosage.", "error"); } catch {}
    return;
  }
  if (!times.length) {
    try { typeof showInlineStatus === "function" && showInlineStatus("Select at least one time of day.", "error"); } catch {}
    return;
  }

  const onCycle   = !!form.querySelector("#suppCycleChk")?.checked;
  // Always capture a start date if provided; require only when cycling
  const startDate = (form.querySelector("#suppCycleStart")?.value || null);
  const daysOn    = onCycle ? (form.querySelector("#suppDaysOn")?.value || "") : "";
  const daysOff   = onCycle ? (form.querySelector("#suppDaysOff")?.value || "") : "";

  // Require start date when cycling
  if (onCycle && !startDate) {
    try { typeof showInlineStatus === "function" && showInlineStatus("Please select a cycle start date.", "error"); } catch {}
    return;
  }

  // Ensure color (important for summary + calendar). Only color cycle items.
  let color = onCycle
    ? (typeof window.pickColor === 'function' ? window.pickColor(name) : "#2196F3")
    : null;

  const data = {
    name,
    brand: brand || null,
    dosage,
    dailyDose: (dailyDoseRaw && !isNaN(parseInt(dailyDoseRaw,10))) ? parseInt(dailyDoseRaw,10) : null,
    servings: (servingsRaw != null && String(servingsRaw).trim() !== "") ? (parseInt(servingsRaw, 10) || null) : null,
    times,
    cycle: onCycle ? { on: daysOn, off: daysOff } : null,
    startDate,
    color
  };

  // Read modal context to decide add vs edit
  // Prefer the shared window context if it indicates edit; otherwise fall back to local default
  const ctx = (window.SUPP_MODAL_CTX && window.SUPP_MODAL_CTX.mode)
    ? window.SUPP_MODAL_CTX
    : ((typeof SUPP_MODAL_CTX !== "undefined" && SUPP_MODAL_CTX) || { mode: "add", id: null });
  try { console.info('[supp-modal] submit ctx:', ctx); } catch {}

  try {
    if (ctx.mode === "edit" && ctx.id) {
      try { console.info('[supp-modal] updating', ctx.id); } catch {}
      // UPDATE path
      if (typeof updateSupplement === "function") {
        await updateSupplement(uid, ctx.id, data);
      } else {
        throw new Error("updateSupplement(...) is not defined. Please import or implement it.");
      }
    } else {
      // ADD path
      try { console.info('[supp-modal] adding new'); } catch {}
      await addSupplement(uid, data);
    }

    // Refresh the SUMMARY (which also rebuilds calendar inside)
    if (typeof window.refreshSuppSummary === "function") {
      await window.refreshSuppSummary();
    } else if (typeof window.refreshCalendar === "function") {
      await window.refreshCalendar();
    }

    // Toast (optional)
    try {
      typeof showInlineStatus === "function" &&
        showInlineStatus("Supplement saved.", "success");
    } catch {}

    // Reset + close modal
    form.reset();
    if (startWrap && startWrap.classList.contains("is-hidden")) {
      startWrap.classList.add("is-hidden"); // keep cycle section hidden after reset
    }
    closeModal();

    // Reset context to default add mode in both places
    window.SUPP_MODAL_CTX = { mode: "add", id: null };
    if (typeof SUPP_MODAL_CTX !== "undefined") {
      SUPP_MODAL_CTX = window.SUPP_MODAL_CTX;
    }
  } catch (err) {
    console.error("Save failed:", err);
    try {
      typeof showInlineStatus === "function" &&
        showInlineStatus(err?.message || "Failed to save supplement.", "error");
    } catch {}
  }
});

// Expose a helper to mark a supplement as reordered (turn off reminders)
window.markSupplementReordered = async function markSupplementReordered(id) {
  try {
    if (!currentUser || !currentUser.uid || !id) return;
    await updateSupplement(currentUser.uid, id, { orderReminder: false });
    await refreshCalendar();
  } catch (e) { console.error('Failed to update reorder flag', e); }
};

// Service worker registration for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Register relative to repo path (works on GitHub Pages project sites)
    navigator.serviceWorker.register('sw.js', { scope: './' })
      .catch((e) => console.warn('SW register failed', e));
  });
}

function getModalValues() {
  const name = document.querySelector("#supp-name").value.trim();
  const dosage = document.querySelector("#supp-dosage").value.trim();
  const times = getTimesUI(); // <-- read from your chips/times control

  const onCycle = document.querySelector("#cycle-toggle").checked;
  const startDate = (document.querySelector("#supp-start-date").value || "").trim();

  let cycle = null;
  if (onCycle) {
    const on = parseInt(document.querySelector("#cycle-days-on").value, 10) || 0;
    const off = parseInt(document.querySelector("#cycle-days-off").value, 10) || 0;
    cycle = { on, off };
  }

  const colorInput = document.querySelector("#supp-color");
  const color = colorInput ? (colorInput.value || "").trim() : null;

  return { name, dosage, times, cycle, startDate, color };
}

// Let supplementsUI.js handle opening + prefill for edit buttons.
document.addEventListener("click", (e) => {
  const editBtn = e.target.closest(".btn-edit-supp");
  if (!editBtn) return;
  const id = editBtn.dataset.id;
  if (!id) return;
  window.SUPP_MODAL_CTX = { mode: "edit", id };
});

});

// === Sidebar peek tab init ===
document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector(".sidebar");
  if (!sidebar) return;

  // Ensure a tab exists or create one
  let tab = sidebar.querySelector(".sidebar-tab");
  if (!tab) {
    tab = document.createElement("button");
    tab.className = "sidebar-tab";
    tab.type = "button";
    tab.setAttribute("aria-controls", "sidebar");
    tab.setAttribute("aria-expanded", "true");
    const span = document.createElement("span");
    span.className = "sidebar-tab-icon";
    span.textContent = "❮";
    tab.appendChild(span);
    sidebar.insertBefore(tab, sidebar.firstChild);
  }

  const setIcon = (collapsed) => {
    const ico = tab.querySelector(".sidebar-tab-icon");
    if (!ico) return;
    ico.textContent = collapsed ? "❯" : "❮";
  };

  const applyCollapsed = (collapsed) => {
    sidebar.setAttribute("data-collapsed", String(collapsed));
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    tab.setAttribute("aria-expanded", String(!collapsed));
    setIcon(collapsed);
  };

  // Restore last state or default
  const saved = localStorage.getItem("sidebar-collapsed");
  if (saved === "true" || saved === "false") {
    applyCollapsed(saved === "true");
  } else {
    applyCollapsed(false); // default expanded
  }

  tab.addEventListener("click", () => {
    const next = sidebar.getAttribute("data-collapsed") !== "true";
    applyCollapsed(next);
    localStorage.setItem("sidebar-collapsed", String(next));
  });
});
