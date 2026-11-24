// The next time a card's due day comes around, counted in whole local days so
// a bill due today is "today" until midnight, not a month away. A due day past
// the end of a short month falls on that month's last day.
const dayInMonth = (year, month, day) => new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate()));
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export function nextDueDate(dueDay, now = new Date()) {
  if (!dueDay) return null;
  const today = startOfDay(now);
  const thisMonth = dayInMonth(today.getFullYear(), today.getMonth(), dueDay);
  return thisMonth >= today ? thisMonth : dayInMonth(today.getFullYear(), today.getMonth() + 1, dueDay);
}

export function daysUntilDue(dueDay, now = new Date()) {
  const due = nextDueDate(dueDay, now);
  // Rounded, because a daylight-saving change makes one day 23 or 25 hours.
  return due ? Math.round((due - startOfDay(now)) / 86400000) : null;
}

export function dueDateLabel(dueDay, now = new Date()) {
  return nextDueDate(dueDay, now)?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) ?? null;
}
