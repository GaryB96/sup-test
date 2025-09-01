
/**
 * notifications.js (standalone)
 * Adds a Notifications modal (open via #menu-notifications), stores opt-in,
 * auto-uses signed-in email, and generates a next-year .ics from your cycle data.
 */
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  function getSignedInEmail() {
    try {
      if (window.currentUser?.email) return window.currentUser.email;
      if (typeof window.getSignedInEmail === 'function') return window.getSignedInEmail();
      const meta = document.querySelector('meta[name="app-user-email"]');
      if (meta?.content) return meta.content;
      const ls = localStorage.getItem('userEmail');
      if (ls) return ls;
    } catch(_) {}
    return "";
  }

  function setReadonlyEmailField() {
    const el = $("#notificationsEmail");
    if (!el) return;
    const email = getSignedInEmail();
    el.value = email || "";
    el.readOnly = true;
    el.placeholder = email ? "" : "Sign in to populate your email";
    el.title = email ? "Using your sign-in email" : "No signed-in email detected";
  }

  function readPrefs() {
    try { return JSON.parse(localStorage.getItem('noty:prefs')||'{}'); } catch { return {}; }
  }
  function writePrefs(p) {
    try { localStorage.setItem('noty:prefs', JSON.stringify(p)); } catch {}
  }

  function openModal() {
    const modal = $("#notificationsModal");
    if (!modal) return console.warn("Notifications modal not found");
    setReadonlyEmailField();
    const prefs = readPrefs();
    const opt = $("#notificationsOptIn");
    if (opt) opt.checked = !!prefs.optIn;
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('open');
  }
  function closeModal() {
    const modal = $("#notificationsModal");
    if (!modal) return;
    modal.setAttribute('aria-hidden', 'true');
    modal.classList.remove('open');
  }

  function wireOpeners() {
    ["#menu-notifications",'[data-action="open-notifications"]','#profile-menu [data-id="notifications"]']
      .map((s)=>$$(s)).flat().forEach((el)=>el.addEventListener('click',(e)=>{e.preventDefault();openModal();}));
  }
  function bindButtons() {
    $("#notificationsCloseBtn")?.addEventListener('click', closeModal);
    $("#notificationsSaveBtn")?.addEventListener('click', async () => {
      const optIn = !!$("#notificationsOptIn")?.checked;
      const email = getSignedInEmail();
      writePrefs({ optIn, savedAt: new Date().toISOString() });
      try {
        if (window.fetch) {
          fetch('/api/notifications/prefs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ optIn, email })
          }).catch(()=>{});
        }
      } catch {}
      const btn = $("#notificationsSaveBtn");
      if (btn) { const t=btn.textContent; btn.textContent="Saved ✔"; setTimeout(()=>btn.textContent=t,1200); }
    });
  }

  function startOfTomorrowUTC() {
    const now = new Date();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    t.setUTCDate(t.getUTCDate()+1);
    return t;
  }
  function oneYearLaterUTC(d) { const t=new Date(d); t.setUTCFullYear(t.getUTCFullYear()+1); return t; }
  function fmtICSDate(yyyy_mm_dd){ return yyyy_mm_dd.replace(/-/g,"")+"T000000Z"; }

  async function fetchCycleBoundaries() {
    const start = startOfTomorrowUTC();
    const end = oneYearLaterUTC(start);
    const startISO = start.toISOString().slice(0,10);
    const endISO = end.toISOString().slice(0,10);
    if (typeof window.getCycleBoundaries === 'function') return await window.getCycleBoundaries(startISO, endISO);
    if (typeof window.getCyclesForNextYear === 'function') return await window.getCyclesForNextYear();
    if (Array.isArray(window.__CYCLE_BOUNDARIES__)) return window.__CYCLE_BOUNDARIES__;
    return null;
  }

  function buildICS(boundaries, calendarName) {
    const lines = [];
    const now = new Date();
    const dtstamp = now.toISOString().replace(/[-:]/g,"").split(".")[0]+"Z";
    lines.push("BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//YourApp//Notifications//EN",`X-WR-CALNAME:${calendarName}`);
    boundaries.forEach((b, idx)=>{
      const d = new Date(b.date+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()-1);
      const dayBefore = d.toISOString().slice(0,10);
      const uid = `noty-${idx}-${dayBefore}@yourapp`;
      const summary = b.title || (b.type==="begin" ? "Cycle begins tomorrow" : "Cycle ends tomorrow");
      lines.push("BEGIN:VEVENT",
                 `UID:${uid}`,
                 `DTSTAMP:${dtstamp}`,
                 `DTSTART:${fmtICSDate(dayBefore)}`,
                 `DTEND:${fmtICSDate(dayBefore)}`,
                 `SUMMARY:${summary}`,
                 "TRANSP:TRANSPARENT",
                 "END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function handleICS() {
    const btn = $("#notificationsIcsBtn");
    if (!btn) return;
    btn.addEventListener('click', async ()=>{
      btn.disabled = true; const t=btn.textContent; btn.textContent="Building .ics…";
      try {
        const boundaries = await fetchCycleBoundaries();
        if (!Array.isArray(boundaries) || boundaries.length===0) { alert("No cycle data available for .ics."); return; }
        const ics = buildICS(boundaries, "Cycle Notifications (Next Year)");
        const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href=url; a.download="cycle-notifications-next-year.ics";
        document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      } finally { btn.disabled=false; btn.textContent=t; }
    });
    if (!window.getCycleBoundaries && !window.getCyclesForNextYear && !Array.isArray(window.__CYCLE_BOUNDARIES__)) {
      btn.title = "Requires cycle data from the app to generate events.";
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireOpeners();
    bindButtons();
    handleICS();
    setReadonlyEmailField();
  });
})();
