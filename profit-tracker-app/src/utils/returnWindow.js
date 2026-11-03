// Store return windows on purchases. Dates are calendar days (the API stores
// them at noon UTC), so every comparison here works on YYYY-MM-DD strings and
// the viewer's local "today" -- never on raw timestamps, which would flip a day
// early or late around midnight.
const DAY_MS = 24 * 60 * 60 * 1000;
// Within this many days the badge turns amber.
export const RETURN_WINDOW_WARNING_DAYS = 7;

const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
};

export const toDateOnly = (value) => {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
};

export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Purchase date + N days, as YYYY-MM-DD. Returns '' for a missing or invalid input.
export function addDays(dateValue, days) {
  const start = toDateOnly(dateValue);
  // Number('') is 0, so a blank field must be rejected before converting.
  if (!start || days === '' || days === null || days === undefined) return '';
  const count = Number(days);
  if (!Number.isInteger(count) || count < 0) return '';
  return new Date((dayNumber(start) + count) * DAY_MS).toISOString().slice(0, 10);
}

// Whole days from `from` to `to` (negative when `to` is earlier).
export function daysBetween(from, to) {
  const a = toDateOnly(from);
  const b = toDateOnly(to);
  if (!a || !b) return null;
  return dayNumber(b) - dayNumber(a);
}

// What to show for a purchase: null when there is no window or nothing left
// in stock to send back (a sold item can't be returned to the store).
export function returnWindowStatus(item = {}, now = new Date()) {
  if (!item.return_by_date) return null;
  if (item.qty_on_hand !== undefined && Number(item.qty_on_hand) <= 0) return null;
  const daysLeft = daysBetween(localToday(now), item.return_by_date);
  if (daysLeft === null) return null;
  if (daysLeft < 0) return { daysLeft, tone: 'closed', label: 'Return window closed' };
  if (daysLeft === 0) return { daysLeft, tone: 'warning', label: 'Last day to return' };
  return {
    daysLeft,
    tone: daysLeft <= RETURN_WINDOW_WARNING_DAYS ? 'warning' : 'ok',
    label: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left to return`,
  };
}
