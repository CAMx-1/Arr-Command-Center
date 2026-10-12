// Date helpers for the Calendar page (pure; unit-tested).
const WEEK_DAYS = 7;

export function monthFor(today, offset) {
  const d = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}

// One fetch covering the shown month and the next 7 days.
export function fetchRange(today, { year, month }) {
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + WEEK_DAYS);
  return {
    start: monthStart < weekStart ? monthStart : weekStart,
    end: monthEnd > weekEnd ? monthEnd : weekEnd,
    weekStart, weekEnd,
  };
}
