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

// Stock kept on purpose (sealed product held for a price): hidden for longer.
export const HOLDS = [
  { label: 'Holding · 1 month', days: 30 },
  { label: 'Holding · 3 months', days: 90 },
  { label: 'Holding · 6 months', days: 180 },
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

// Items fold into one expandable row: three or more of one kind in a section
// ("Ship it" x3), or two that read exactly alike (the same product sold the
// same way from two purchase lots). Reminders are each their own thing and
// never fold.
const FOLD_AT = 3;
const ALIKE_AT = 2;
const alikeId = (entry) => `${entry.type}|${entry.title}|${entry.detail}`;
export function foldByType(items) {
  const byType = {};
  const byAlike = {};
  for (const entry of items) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    byAlike[alikeId(entry)] = (byAlike[alikeId(entry)] || 0) + 1;
  }
  const rows = [];
  const folded = {};
  for (const entry of items) {
    let id = null;
    if (entry.type !== 'reminder') {
      if (byType[entry.type] >= FOLD_AT) id = `type:${entry.type}`;
      else if (byAlike[alikeId(entry)] >= ALIKE_AT) id = `alike:${alikeId(entry)}`;
    }
    if (!id) { rows.push(entry); continue; }
    if (!folded[id]) {
      folded[id] = { fold: true, id, alike: id.startsWith('alike:'), type: entry.type, group: entry.group, urgency: entry.urgency, items: [] };
      rows.push(folded[id]);
    }
    folded[id].items.push(entry);
  }
  return rows;
}

const FOLD_TITLES = { aging_stock: 'Not listed for 30+ days' };

// A folded row's title: the items' shared title ("Ship it"), a set name for
// some kinds, or the first one's without its number.
export const foldTitle = (row) => {
  if (row.items.every((entry) => entry.title === row.items[0].title)) return row.items[0].title;
  return FOLD_TITLES[row.type] || row.items[0].title.replace(/\s+\d.*$/, '');
};

// "$1,234.50"
export const money = (value) => `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The money across a folded row's items, or null when none carry any.
export const foldAmount = (row) => {
  const amounts = row.items.map((entry) => entry.amount).filter((value) => value != null);
  return amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null;
};
