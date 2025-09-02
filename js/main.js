import { login, signup, logout, deleteAccount, monitorAuthState, changePassword, resetPassword } from "./auth.js";
import { renderCalendar } from "./calendar.js";
import { fetchSupplements } from "./supplements.js";
import { EmailAuthProvider, reauthenticateWithCredential } from "https://www.gstatic.com/firebasejs/10.5.0/firebase-auth.js";
import { auth } from "./firebaseConfig.js";
import { onAuthStateChanged } from "firebase/auth";

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
  const logoutBtn = document.getElementById("logoutBtn");
  const calendarEl = document.getElementById("calendar");
  const labelEl = document.getElementById("currentMonthLabel");
  const loginForm = document.getElementById("loginForm");
  const prevBtn = document.getElementById("prevMonth");
  const nextBtn = document.getElementById("nextMonth");

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
        await resetPassword();
        alert("Password reset email sent (check your inbox).");
      } catch (err) {
        console.error("Password reset error:", err);
        alert("Could not send reset email: " + (err?.message || err));
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

      const event = new CustomEvent("user-authenticated", { detail: user });
      window.dispatchEvent(event);

      await refreshCalendar();
    } else {
      document.body.classList.remove("logged-in");
      calendarEl.innerHTML = "";
      labelEl.textContent = "";
    }

onAuthStateChanged(auth, (user) => {
  const notesBtn = document.getElementById("notesBtn");
  if (user) {
    // User logged in
    notesBtn.style.display = "inline-block";
  } else {
    // User logged out
    notesBtn.style.display = "none";
  }
});

  });

  // --- Month navigation ---
  if (prevBtn && nextBtn) {
    prevBtn.addEventListener("click", async () => {
      currentMonth--;
      if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
      }
      await refreshCalendar();
    });

    nextBtn.addEventListener("click", async () => {
      currentMonth++;
      if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
      }
      await refreshCalendar();
    });
  }

  // --- Login / Signup form ---
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const email = document.getElementById("emailInput").value;
      const password = document.getElementById("passwordInput").value;
      const clickedButton = e.submitter?.id;

      if (!email || !password) {
        alert("Please enter both email && password.");
        return;
      }

      if (password.length < 6) {
        alert("Password must be at least 6 characters long.");
        return;
      }

      try {
        if (clickedButton === "loginBtn") {
          await login(email, password);
        } else if (clickedButton === "signupBtn") {
          await signup(email, password);
          alert("Account created & logged in!");
        } else {
          alert("Unknown action.");
          return;
        }

        window.location.href = "index.html";
      } catch (error) {
        const action = clickedButton === "loginBtn" ? "Login" : "Signup";
        alert(`${action} failed: ${error.message}`);
        console.error(`${action} error:`, error);
      }
    });
  } else {
    console.warn("loginForm not found in DOM.");
  }

  // --- Logout ---
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await logout();
      alert("You have been logged out.");
      window.location.href = "index.html";
    });
  }
});

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
        alert("No user is currently signed in.");
        closePasswordConfirmModal();
        return;
      }
      const input = document.getElementById("confirmPasswordInput");
      const password = input ? input.value : "";
      if (!password) {
        alert("Please enter your password.");
        return;
      }
      try {
        const credential = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, credential);
        await deleteAccount(user);
        alert("Your account has been deleted.");
        window.location.href = "index.html";
      } catch (error) {
        console.error(error);
        if (error.code === "auth/wrong-password") {
          alert("Incorrect password. Please try again.");
        } else if (error.code === "auth/too-many-requests") {
          alert("Too many attempts. Please try again later.");
        } else {
          alert("An error occurred. " + (error.message || ""));
        }
      } finally {
        closePasswordConfirmModal();
      }
    });
  }
}
