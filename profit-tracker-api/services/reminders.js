// Reminders the user writes themselves (To-Do page). Dates are the user's local
// calendar dates (YYYY-MM-DD) and an optional local time (HH:MM); nothing here
// converts time zones.
const { z } = require('zod');

const REPEATS = ['none', 'weekly', 'biweekly', 'monthly', 'yearly'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const isRealDate = (value) => DATE_RE.test(value)
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

const blankToNull = (value) => (typeof value === 'string' && value.trim() === '' ? null : value);

const fields = {
  title: z.string().trim().min(1, 'Give the reminder a title.').max(200, 'Keep the title under 200 characters.'),
  notes: z.preprocess(blankToNull, z.string().max(1000, 'Keep notes under 1,000 characters.').nullable()),
  due_date: z.string().refine(isRealDate, 'Pick a valid date.'),
  due_time: z.preprocess(blankToNull, z.string().regex(TIME_RE, 'Time must be HH:MM.').nullable()),
  repeat: z.enum(REPEATS, { message: 'Repeat must be none, weekly, every 2 weeks, monthly or yearly.' }),
  payment_method_id: z.preprocess(blankToNull, z.string().uuid('Not a card.').nullable()),
};

const createReminder = z.object({
  title: fields.title,
  notes: fields.notes.optional(),
  due_date: fields.due_date,
  due_time: fields.due_time.optional(),
  repeat: fields.repeat.default('none'),
  payment_method_id: fields.payment_method_id.optional(),
}).strict();

const updateReminder = z.object({
  title: fields.title.optional(),
  notes: fields.notes.optional(),
  due_date: fields.due_date.optional(),
  due_time: fields.due_time.optional(),
  repeat: fields.repeat.optional(),
  payment_method_id: fields.payment_method_id.optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'Nothing to change.');

const undoComplete = z.object({ due_date: fields.due_date }).strict();

// ─── Dates ───────────────────────────────────────────────────────────────────
const toUtc = (str) => {
  const [y, m, d] = str.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
const addDays = (str, n) => fromUtc(toUtc(str) + n * 86400000);

function clampedDate(year, monthIndex, day) {
  const last = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return fromUtc(Date.UTC(year, monthIndex, Math.min(day, last)));
}

// The occurrence after `date`, keeping the day (and month, for yearly) of
// `from` -- so the 31st comes back after a short month.
function stepOnce(date, repeat, from) {
  if (repeat === 'weekly') return addDays(date, 7);
  if (repeat === 'biweekly') return addDays(date, 14);
  const [y, m] = date.split('-').map(Number);
  const [, fromMonth, fromDay] = (from || date).split('-').map(Number);
  if (repeat === 'monthly') return clampedDate(y, m, fromDay);
  if (repeat === 'yearly') return clampedDate(y + 1, fromMonth - 1, fromDay);
  return null;
}

// Where a repeating reminder goes once completed: the first occurrence after
// both its current due date and today (catching up on missed ones).
function nextDueDate(reminder, today) {
  if (!reminder.repeat || reminder.repeat === 'none') return null;
  let next = stepOnce(reminder.due_date, reminder.repeat, reminder.repeat_from);
  for (let guard = 0; guard < 2000 && next <= today; guard += 1) {
    next = stepOnce(next, reminder.repeat, reminder.repeat_from);
  }
  return next;
}

// Every occurrence of a reminder from its due date through `end`, for the
// Calendar and the phone feed. A one-off has just the one.
function occurrences(reminder, start, end, cap = 60) {
  const dates = [];
  let date = reminder.due_date;
  for (let guard = 0; guard < 2000 && date && date <= end && dates.length < cap; guard += 1) {
    if (date >= start) dates.push(date);
    if (!reminder.repeat || reminder.repeat === 'none') break;
    date = stepOnce(date, reminder.repeat, reminder.repeat_from);
  }
  return dates;
}

const REPEAT_LABEL = { weekly: 'Every week', biweekly: 'Every 2 weeks', monthly: 'Every month', yearly: 'Every year' };

module.exports = {
  REPEATS,
  REPEAT_LABEL,
  createReminder,
  updateReminder,
  undoComplete,
  nextDueDate,
  occurrences,
  stepOnce,
};
