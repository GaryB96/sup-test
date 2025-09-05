import { login, signup, logout, deleteAccount, monitorAuthState, changePassword, resetPassword, resendVerification } from "./auth.js";
import { renderCalendar } from "./calendar.js";
import { fetchSupplements } from "./supplements.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { auth } from "./firebaseConfig.js";
document.documentElement.classList.add("auth-pending");

// Inline status helper (avoids browser alert banners)
// Inline status helper (avoids browser alert banners)

// Accessible toast helper
function showToast(message, type = "info", opts = {}) {
  const container = document.getElementById("toast-container");
  if (!container) { return showInlineStatus(message, type); }

  const toast = document.createElement("div");
  toast.className = "toast " + (type || "info");
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.tabIndex = 0;

  const row = document.createElement("div");
  row.className = "toast-row";

  const msg = document.createElement("div");
  msg.className = "toast-msg";
  msg.textContent = message;

  const close = document.createElement("button");
  close.className = "toast-close";
  close.setAttribute("aria-label", "Close notification");
  close.innerHTML = "&times;";
  close.addEventListener("click", () => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  });

  row.appendChild(msg);
  row.appendChild(close);
  toast.appendChild(row);
  container.appendChild(toast);

  // animate in
  requestAnimationFrame(() => toast.classList.add("show"));

  const ttl = opts.ttl ?? 5000;
  if (ttl > 0) setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 200);
  }, ttl);
}
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
  const btn = document.getElementById("notesBtn");
  if (!btn) return;
  btn.style.display = isLoggedIn ? "inline-block" : "none"; btn.disabled = !isLoggedIn;
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

  // Add fresh
  H.input = () => { if (status) status.textContent = "Saving…"; debouncedSave(); };
  H.blur  = () => { saveNow(); };
  H.keydown = (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "s") {
      ev.preventDefault(); saveNow();
    }
  };
  ta.addEventListener("input", H.input);
  ta.addEventListener("blur", H.blur);
  modal.addEventListener("keydown", H.keydown);

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
  // --- Public header & hero modals ---
  const openSignUpBtn = document.getElementById("openSignUpBtn");
  const openSignInBtn = document.getElementById("openSignInBtn");
  const heroSignUp = document.getElementById("heroSignUp");
  const heroSignIn = document.getElementById("heroSignIn");
  const signinModal = document.getElementById("signinModal");
  const signupModal = document.getElementById("signupModal");
  const closeSigninModal = document.getElementById("closeSigninModal");
  const closeSignupModal = document.getElementById("closeSignupModal");

  function openModal(el){ if (el) el.classList.remove("hidden"); }
  function closeModal(el){ if (el) el.classList.add("hidden"); }

  [openSignUpBtn, heroSignUp].forEach(btn => btn && btn.addEventListener("click", (e)=>{ e.preventDefault(); openModal(signupModal); }));
  [openSignInBtn, heroSignIn].forEach(btn => btn && btn.addEventListener("click", (e)=>{ e.preventDefault(); openModal(signinModal); }));

  closeSigninModal?.addEventListener("click", ()=> closeModal(signinModal));
  closeSignupModal?.addEventListener("click", ()=> closeModal(signupModal));

  // Close when clicking backdrop
  [signinModal, signupModal].forEach(mod => {
    mod?.addEventListener("click", (e) => {
      if (e.target === mod) closeModal(mod);
    });
  });
  // Escape closes modal
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") {
      closeModal(signinModal);
      closeModal(signupModal);
    }
  });

  document.getElementById("openNotifications")?.addEventListener("click", (e)=>{ e.preventDefault(); openNotificationsModal(); });
  document.getElementById("closeNotificationsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); closeNotificationsModal(); });
  document.getElementById("saveNotificationsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); saveNotifications(); });
  document.getElementById("downloadIcsBtn")?.addEventListener("click", (e)=>{ e.preventDefault(); downloadIcs(); });
});

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
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
  // --- Public header & hero modals ---
  const openSignUpBtn = document.getElementById("openSignUpBtn");
  const openSignInBtn = document.getElementById("openSignInBtn");
  const heroSignUp = document.getElementById("heroSignUp");
  const heroSignIn = document.getElementById("heroSignIn");
  const signinModal = document.getElementById("signinModal");
  const signupModal = document.getElementById("signupModal");
  const closeSigninModal = document.getElementById("closeSigninModal");
  const closeSignupModal = document.getElementById("closeSignupModal");

  function openModal(el){ if (el) el.classList.remove("hidden"); }
  function closeModal(el){ if (el) el.classList.add("hidden"); }

  [openSignUpBtn, heroSignUp].forEach(btn => btn && btn.addEventListener("click", (e)=>{ e.preventDefault(); openModal(signupModal); }));
  [openSignInBtn, heroSignIn].forEach(btn => btn && btn.addEventListener("click", (e)=>{ e.preventDefault(); openModal(signinModal); }));

  closeSigninModal?.addEventListener("click", ()=> closeModal(signinModal));
  closeSignupModal?.addEventListener("click", ()=> closeModal(signupModal));

  // Close when clicking backdrop
  [signinModal, signupModal].forEach(mod => {
    mod?.addEventListener("click", (e) => {
      if (e.target === mod) closeModal(mod);
    });
  });
  // Escape closes modal
  document.addEventListener("keydown", (e)=>{
    if (e.key === "Escape") {
      closeModal(signinModal);
      closeModal(signupModal);
    }
  });

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
// --- Month navigation ---
if (prevBtn) {
  prevBtn.addEventListener("click", async () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    await refreshCalendar();
  });
}
if (nextBtn) {
  nextBtn.addEventListener("click", async () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
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
        showToast(result.message, "success");
      } catch (err) {
        console.error("Password reset error:", err);
        if (err && err.code === "auth/missing-email") {
          showInlineStatus("Please enter your email first.", "error");
        } else {
          // Keep UX non-enumerating even on errors
          showInlineStatus("If an account exists for that email, a reset link has been sent. Please check your inbox and spam.", "success");
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
    if (user) {
      document.body.classList.add("logged-in");
      currentUser = user;
      setNotesButtonVisibility(true);
      const event = new CustomEvent("user-authenticated", { detail: user });
      window.dispatchEvent(event);

      await refreshCalendar();
    
      setNotesButtonVisibility(true);
} else {
      document.body.classList.remove("logged-in");
      calendarEl.innerHTML = "";
      labelEl.textContent = "";
      
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
      } catch (err) {
        console.error(err);
        // Keep UX non-enumerating even on errors
        showInlineStatus("If an account exists for that email, a reset link has been sent. Please check your inbox and spam.", "success");
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
async function refreshCalendar() {
  if (!currentUser || !currentUser.uid) return;
  try {
    const rawSupplements = await fetchSupplements(currentUser.uid);
    const expandedSupplements = [];
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
          expandedSupplements.push({
            name: supp.name,
            date: toLocalYMD(date),       // <— local YYYY-MM-DD
            color: supp.color || "#cccccc"
          });
          }
        }
      } else if (supp.date) {
        // fallback for one-off supplements
        const date = new Date(supp.date);
        if (
          date.getMonth() === currentMonth &&
          date.getFullYear() === currentYear
        ) {
          expandedSupplements.push({
            name: supp.name,
            date: supp.date,
            color: supp.color || "#cccccc"
          });
        }
      }
    }

    const calendarEl = document.getElementById("calendar");
    const labelEl = document.getElementById("currentMonthLabel");
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
