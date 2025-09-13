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

  // Mobile expand: open a modal with this day's details
  dayEl.addEventListener('click', () => {
    try {
      if (!window.matchMedia || !window.matchMedia('(max-width: 600px)').matches) return;
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
      if (supplementsForDay.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'No supplements scheduled.';
        list.appendChild(empty);
      } else {
        supplementsForDay.forEach(s => {
          const item = document.createElement('div');
          item.className = 'supplement';
          item.textContent = s.name;
          if (s.color) { item.style.backgroundColor = s.color; item.style.color = '#fff'; }
          list.appendChild(item);
        });
      }
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    } catch (e) { /* noop */ }
  });
  daysGrid.appendChild(dayEl);
}

// Close handlers for day modal
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('dayModal');
  const closeBtn = document.getElementById('closeDayBtn');
  if (!modal) return;
  function close(){ modal.classList.add('hidden'); document.body.style.overflow=''; }
  if (closeBtn) closeBtn.addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal || (e.target && e.target.matches('[data-close-modal]'))) close();
  });
  window.addEventListener('keydown', (e) => { if (!modal.classList.contains('hidden') && e.key === 'Escape') close(); });
});

  calendarEl.appendChild(daysGrid);
}
