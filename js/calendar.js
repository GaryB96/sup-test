const weekdayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function renderCalendar(month, year, supplements, calendarEl, labelEl) {
  calendarEl. = "";
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

  // Create a fresh container for this day's supplements
  const supplementsContainer = document.createElement("div");
  supplementsContainer.className = "supplements-container";

  // Get all supplements for this day
  const supplementsForDay = supplements.filter(s => s.date === dateString);
  supplementsForDay.forEach(supplement => {
    const supplementEl = document.createElement("div");
    supplementEl.className = "supplement";
    supplementEl.textContent = supplement.name;

    if (supplement.color) {
      supplementEl.style.backgroundColor = supplement.color;
      supplementEl.style.color = "#fff";
      supplementEl.style.padding = "2px 4px";
      supplementEl.style.borderRadius = "4px";
      supplementEl.style.marginTop = "2px";
      supplementEl.style.fontSize = "0.75rem";
    }

    supplementsContainer.appendChild(supplementEl);
  });

  dayEl.appendChild(supplementsContainer);
  daysGrid.appendChild(dayEl);
}

  calendarEl.appendChild(daysGrid);
}
