import {
  AlertTriangle, BadgeDollarSign, Bell, Boxes, CalendarClock, CalendarDays, Clock, CreditCard, HandCoins, Info,
} from 'lucide-react';

// Shared looks for the To-Do page's pieces (components/Todos/*).

// Urgency, most pressing first. Colors are theme tokens (inline styles), so
// the light theme's soft remap of Tailwind tints can't wash them out.
export const URGENCIES = [
  { id: 'overdue', label: 'Overdue', caption: 'Past due', icon: AlertTriangle, color: 'var(--dp-red-text)', bg: 'var(--dp-red-bg)' },
  { id: 'today', label: 'Today', caption: 'Due today or tomorrow', icon: Clock, color: 'var(--dp-warning-text)', bg: 'var(--dp-warning-bg)' },
  { id: 'soon', label: 'This week', caption: 'Coming up', icon: CalendarDays, color: 'var(--dp-info-text)', bg: 'var(--dp-info-bg)' },
  { id: 'info', label: 'For your info', caption: 'Worth a look', icon: Info, color: 'var(--dp-text-label)', bg: 'var(--dp-neutral-bg)' },
];
export const URGENCY_BY_ID = Object.fromEntries(URGENCIES.map((urgency) => [urgency.id, urgency]));

export const GROUPS = [
  { id: 'reminders', label: 'Reminders', icon: Bell },
  { id: 'cashout', label: 'Cash-outs', icon: HandCoins },
  { id: 'cards', label: 'Cards', icon: CreditCard },
  { id: 'sales', label: 'Sales', icon: BadgeDollarSign },
  { id: 'purchases', label: 'Purchases', icon: Boxes },
  { id: 'bookkeeping', label: 'Bookkeeping', icon: CalendarClock },
];
export const GROUP_BY_ID = Object.fromEntries(GROUPS.map((group) => [group.id, group]));

export const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: 'In 3 days', days: 3 },
  { label: 'Next week', days: 7 },
];

// Panels pick up the app's card look (index.css remaps this background in
// the default style; the glass style keeps it dark).
export const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A]';
export const PANEL_TITLE = 'text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)]';

const REPEAT_TEXT = { weekly: 'every week', biweekly: 'every 2 weeks', monthly: 'every month', yearly: 'every year' };

export function clockTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// "Sun, Nov 23 at 3:30 PM, every month"
export function whenText(reminder) {
  const date = new Date(`${reminder.due_date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = reminder.due_time ? ` at ${clockTime(reminder.due_time)}` : '';
  const repeat = REPEAT_TEXT[reminder.repeat] ? `, ${REPEAT_TEXT[reminder.repeat]}` : '';
  return `${date}${time}${repeat}`;
}

export const repeatText = (repeat) => REPEAT_TEXT[repeat] || null;

// Three or more of one kind in one section fold into a single expandable
// row. Reminders are each their own thing and never fold.
const FOLD_AT = 3;
export function foldByType(items) {
  const counts = {};
  for (const entry of items) counts[entry.type] = (counts[entry.type] || 0) + 1;
  const rows = [];
  const folded = {};
  for (const entry of items) {
    if (counts[entry.type] >= FOLD_AT && entry.type !== 'reminder') {
      if (!folded[entry.type]) {
        folded[entry.type] = { fold: true, type: entry.type, group: entry.group, urgency: entry.urgency, items: [] };
        rows.push(folded[entry.type]);
      }
      folded[entry.type].items.push(entry);
    } else {
      rows.push(entry);
    }
  }
  return rows;
}

// A folded row's title: the items' shared title ("Ship it"), or the first
// one's without its number ("Sitting 41 days" -> "Sitting").
export const foldTitle = (row) => (row.items.every((entry) => entry.title === row.items[0].title)
  ? row.items[0].title
  : row.items[0].title.replace(/\s+\d.*$/, ''));
