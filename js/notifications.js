// js/notifications.js  (ICS-only, modal-friendly)
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // Your actual opener id is #openNotifications (from the Profile dropdown)
  const OPENERS = [
    '#openNotifications',
    '#menu-notifications',
    '[data-action="open-notifications"]',
    '#profile-menu [data-id="notifications"]'
  ];

  function wireOpeners() {
    OPENERS
      .map((s) => $$((s)))
      .flat()
      .forEach((el) =>
        el.addEventListener('click', (e) => {
          e.preventDefault();
          openModal();
        })
      );
  }

  function ensureModalStyles(modal) {
    // If your markup still has noty-* classes, add modal-content so it picks up site styles.
    // (Safe no-op if it already has .modal-content.)
    const content =
      modal.querySelector('.modal-content') ||
      modal.querySelector('.noty-card') ||
      modal.firstElementChild;
    content?.classList.add('modal-content');
  }

  function injectImportTip(modal) {
    // Add a one-time hint encouraging a separate calendar for easy toggling/removal
    if (!modal) return;
    const body = modal.querySelector('.modal-content') || modal;
    const TIP_ID = 'ics-separate-calendar-tip';
    if (!body.querySelector('#' + TIP_ID)) {
      const p = document.createElement('p');
      p.id = TIP_ID;
      p.className = 'muted';
      // Insert just before the buttons at the bottom if present, else append
      const bottomBtn = body.querySelector('#notificationsCloseBtnBottom');
      if (bottomBtn?.parentElement) {
        bottomBtn.parentElement.insertBefore(p, bottomBtn);
      } else {
        body.appendChild(p);
      }
    }
  }

  function openModal() {
    const modal = $('#notificationsModal');
    if (!modal) return console.warn('Notifications modal not found');
    ensureModalStyles(modal);
    injectImportTip(modal);
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const modal = $('#notificationsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
  }

  function bindCloseButtons() {
    $('#notificationsCloseBtn')?.addEventListener('click', closeModal);
    $('#notificationsCloseBtnBottom')?.addEventListener('click', closeModal);
    // Click outside content closes modal
    const modal = $('#notificationsModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
      });
    }
    // ESC key closes modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  // ------- ICS helpers -------
  function startOfTomorrowUTC() {
    const now = new Date();
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 1);
    return t;
  }
  function oneYearLaterUTC(d) {
    const t = new Date(d);
    t.setUTCFullYear(t.getUTCFullYear() + 1);
    return t;
  }

  // All-day formatting helpers (avoid times entirely)
  function fmtYMD(yyyy_mm_dd) { return String(yyyy_mm_dd).replace(/-/g, ''); }
  function plusDaysISO(yyyy_mm_dd, days) {
    const d = new Date(yyyy_mm_dd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const esc = (s) => String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');

  async function fetchCycleBoundaries() {
    const start = startOfTomorrowUTC();
    const end = oneYearLaterUTC(start);
    const startISO = start.toISOString().slice(0, 10);
    const endISO = end.toISOString().slice(0, 10);

    if (typeof window.getCycleBoundaries === 'function') return await window.getCycleBoundaries(startISO, endISO);
    if (typeof window.getCyclesForNextYear === 'function') return await window.getCyclesForNextYear();
    if (Array.isArray(window.__CYCLE_BOUNDARIES__)) return window.__CYCLE_BOUNDARIES__;
    return null;
  }

  function buildICS(boundaries, calendarName) {
    const lines = [];
    const now = new Date();
    const dtstamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

    lines.push(
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//YourApp//Notifications//EN',
      `X-WR-CALNAME:${esc(calendarName)}`
    );

    boundaries.forEach((b, idx) => {
      // We create an all-day reminder on the day BEFORE the boundary
      const boundary = new Date(b.date + 'T00:00:00Z');
      boundary.setUTCDate(boundary.getUTCDate() - 1);
      const dayBeforeISO = boundary.toISOString().slice(0, 10);
      const dayAfterISO  = plusDaysISO(dayBeforeISO, 1); // DTEND is end-exclusive

      const uid = `noty-${idx}-${dayBeforeISO}@yourapp`;
      const summary = b.title || (b.type === 'begin' ? 'Cycle begins tomorrow' : 'Cycle ends tomorrow');

      lines.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtstamp}`,
        // True all-day: VALUE=DATE and end-exclusive DTEND to prevent time display
        `DTSTART;VALUE=DATE:${fmtYMD(dayBeforeISO)}`,
        `DTEND;VALUE=DATE:${fmtYMD(dayAfterISO)}`,
        `SUMMARY:${esc(summary)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    });

    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  function handleICS() {
    const btn = $('#notificationsIcsBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const t = btn.textContent;
      btn.textContent = 'Building .ics…';
      try {
        const boundaries = await fetchCycleBoundaries();
        if (!Array.isArray(boundaries) || boundaries.length === 0) {
          alert('No cycle data available to build the calendar. Make sure your app provides cycle boundaries.');
          return;
        }
        const ics = buildICS(boundaries, 'Cycle Notifications (Next Year)');
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'cycle-notifications-next-year.ics';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        btn.disabled = false;
        btn.textContent = t;
      }
    });

    if (!window.getCycleBoundaries && !window.getCyclesForNextYear && !Array.isArray(window.__CYCLE_BOUNDARIES__)) {
      btn.title = 'Requires cycle data from the app to generate events.';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireOpeners();
    bindCloseButtons();
    handleICS();
  });
})();
