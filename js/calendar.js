const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function renderCalendar(month, year, supplements, calendarEl, labelEl) {
  calendarEl.innerHTML = "";
  const monthName = new Date(year, month).toLocaleString("default", { month: "long" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayIndex = new Date(year, month, 1).getDay();
  const supplementsContainer = document.createElement("div");
  supplementsContainer.className = "supplements-container";
  labelEl.textContent = `${monthName} ${year}`;

  // Weekday header row
  const weekdayRow = document.createElement("div");
  weekdayRow.className = "weekday-row";
  weekdayNames.forEach(day => {
    const cell = document.createElement("div");
    cell.className = "weekday-cell";
    cell.textContent = day;
    weekdayRow.appendChild(cell);
  });
  calendarEl.appendChild(weekdayRow);

  // Day grid
  const daysGrid = document.createElement("div");
  daysGrid.className = "days-grid";

  // Empty cells before first day
  for (let i = 0; i < firstDayIndex; i++) {
    const emptyCell = document.createElement("div");
    emptyCell.className = "day";
    daysGrid.appendChild(emptyCell);
  }

for (let day = 1; day <= daysInMonth; day++) {
  const date = new Date(year, month, day);
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const dateString = `${year}-${mm}-${dd}`;  // local YYYY-MM-DD


  const dayEl = document.createElement("div");
  dayEl.className = "day";

  const numberEl = document.createElement("div");
  numberEl.className = "day-number";
  numberEl.textContent = day;
  dayEl.appendChild(numberEl);

  // Highlight today's date
const _today = new Date();
const _isToday =
  _today.getFullYear() === date.getFullYear() &&
  _today.getMonth() === date.getMonth() &&
  _today.getDate() === day;

if (_isToday) {
  dayEl.classList.add("today");
}

  // Create a fresh container for this day's supplements
  const supplementsContainer = document.createElement("div");
  supplementsContainer.className = "supplements-container";

  // Get all supplements for this day
  const supplementsForDay = supplements.filter(s => s.date === dateString);
  supplementsForDay.forEach(supplement => {
    if (supplement && supplement.hiddenInGrid) return; // skip grid clutter
    const supplementEl = document.createElement("div");
    supplementEl.className = "supplement";
    supplementEl.textContent = supplement.name;

    {
      const color = supplement.color || (typeof window !== 'undefined' && typeof window.pickColor === 'function' ? window.pickColor(supplement.name) : null);
      if (color) {
        supplementEl.style.backgroundColor = color;
        supplementEl.style.color = "#fff";
        supplementEl.style.padding = "2px 4px";
        supplementEl.style.borderRadius = "4px";
        supplementEl.style.marginTop = "2px";
        supplementEl.style.fontSize = "0.75rem";
      }
    }

    supplementsContainer.appendChild(supplementEl);
  });

  dayEl.appendChild(supplementsContainer);

  // Open a modal with this day's details (works on mobile and desktop)
  dayEl.addEventListener('click', () => {
    try {
      const modal = document.getElementById('dayModal');
      const list = document.getElementById('dayModalList');
      const title = document.getElementById('dayModalTitle');
      if (!modal || !list || !title) return;
      // Clear previous
      while (list.firstChild) list.removeChild(list.firstChild);
      // Title pretty format
      const dt = new Date(year, month, day);
      const opts = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
      title.textContent = dt.toLocaleDateString(undefined, opts);
      // Track selected day for cross-module use
      const ymd = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      try { window.__selectedDayYMD = ymd; } catch {}
      // Group by time of day for the modal view
      const groups = { Morning: [], Afternoon: [], Evening: [] };
      supplementsForDay.forEach(s => {
        const times = Array.isArray(s?.times) ? s.times
                    : (Array.isArray(s?.time) ? s.time
                       : (typeof s?.time === 'string' && s.time ? [s.time] : []));
        let placed = false;
        ['Morning','Afternoon','Evening'].forEach(slot => {
          if (times.includes(slot)) { groups[slot].push(s); placed = true; }
        });
        if (!placed) { groups.Morning.push(s); } // default bucket
      });

      const renderGroup = (label, items) => {
        if (!items || !items.length) return;
        const h = document.createElement('div');
        h.className = 'day-section-title';
        h.textContent = label;
        list.appendChild(h);
        items.forEach(s => {
          const item = document.createElement('div');
          item.className = 'supplement';
          item.textContent = s.name;
          // Choose a more contrasting style for user-toggled entries
          try {
            let bg = s && s.color ? s.color : null;
            if (s && s.type === 'userToggle') {
              if (!bg || bg.toLowerCase() === '#cccccc') bg = '#2563eb';
            }
            if (!bg) {
              if (typeof window !== 'undefined' && typeof window.pickColor === 'function') {
                bg = window.pickColor(s && s.name);
              } else {
                bg = '#2563eb';
              }
            }
            item.style.backgroundColor = bg;
            // Compute readable text color (YIQ)
            const hex = String(bg).replace('#','');
            const r = parseInt(hex.substring(0,2),16);
            const g = parseInt(hex.substring(2,4),16);
            const b = parseInt(hex.substring(4,6),16);
            const yiq = ((r*299)+(g*587)+(b*114))/1000;
            item.style.color = yiq >= 150 ? '#111827' : '#fff';
          } catch(_) { item.style.color = '#fff'; }
          // Reorder CTA for reminder items
          if (s && s.type === 'orderReminder' && s.id) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = 'Mark reordered';
            btn.style.marginLeft = '8px';
            btn.addEventListener('click', (e) => {
              e.stopPropagation();
              try { window.markSupplementReordered && window.markSupplementReordered(s.id); } catch {}
            });
            const wrap = document.createElement('div');
            wrap.style.display = 'flex';
            wrap.style.alignItems = 'center';
            wrap.style.gap = '6px';
            wrap.appendChild(item);
            wrap.appendChild(btn);
            list.appendChild(wrap);
          } else {
            list.appendChild(item);
          }
        });
      };

      if (supplementsForDay.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No supplements scheduled.';
        list.appendChild(empty);
      } else {
        renderGroup('Morning', groups.Morning);
        renderGroup('Afternoon', groups.Afternoon);
        renderGroup('Evening', groups.Evening);
      }
      // (Removed) Add-to-day header button
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } catch (e) { /* noop */ }
  });
  daysGrid.appendChild(dayEl);
}

// Close handlers for day modal
// Robust binding for the day modal (works even if module loads after DOMContentLoaded)
(function bindDayModalControls(){
  function tryBind(){
    const modal = document.getElementById('dayModal');
    if (!modal) return false;
    if (modal._bound) return true;
    const closeBtn = document.getElementById('closeDayBtn');
    const close = () => { modal.classList.add('hidden'); document.body.style.overflow=''; };
    if (closeBtn) closeBtn.addEventListener('click', close);
    modal.addEventListener('click', (e) => {
      if (e.target === modal || (e.target && e.target.matches('[data-close-modal]'))) close();
    });
    window.addEventListener('keydown', (e) => { if (!modal.classList.contains('hidden') && e.key === 'Escape') close(); });
    modal._bound = true;
    return true;
  }
  if (!tryBind()) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryBind, { once: true });
    } else {
      // In case the modal is added later
      const mo = new MutationObserver(() => { if (tryBind()) mo.disconnect(); });
      mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }
  }
})();

  calendarEl.appendChild(daysGrid);
}
