// Helpers that turn the dashboard API's `trend` array into chart points.
// The backend sends per-period deltas keyed YYYY-MM (YTD / All Time) or
// YYYY-MM-DD (7 / 30 Days).

export const TREND_FIELDS = ['totalCost', 'grossProfit', 'netProfit', 'cashback', 'totalTax', 'totalRevenue', 'soldCost'];

const ZERO_VALUES = Object.fromEntries(TREND_FIELDS.map(f => [f, 0]));

export function normalizeTrendPoints(trend) {
  if (!Array.isArray(trend) || trend.length === 0) return [];
  return trend
    .filter(point => typeof point?.date === 'string')
    .map(point => {
      const out = { date: point.date };
      TREND_FIELDS.forEach(f => { out[f] = Number(point[f]) || 0; });
      return out;
    });
}

// Fill every day in the window with a $0 point (period mode, daily views).
export function fillDailyWindow(points, trendMeta) {
  if (!trendMeta?.windowStart || !trendMeta?.windowEnd) return points;
  if (points.some(p => p.date.length === 7)) return points;
  const byDate = new Map(points.map(p => [p.date, p]));
  const result = [];
  const cursor = new Date(trendMeta.windowStart + 'T00:00:00.000Z');
  const end = new Date(trendMeta.windowEnd + 'T00:00:00.000Z');
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) return points;
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    result.push(byDate.get(key) ?? { date: key, ...ZERO_VALUES });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

// Per-period deltas -> running totals.
export function toCumulative(points) {
  const running = { ...ZERO_VALUES };
  return points.map(point => {
    const out = { date: point.date };
    TREND_FIELDS.forEach(f => {
      running[f] += point[f] || 0;
      out[f] = running[f];
    });
    return out;
  });
}

function parseKey(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return { year, month, day, monthly: dateKey.length === 7 };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Axis label: "Aug 25" on the first point and each January, otherwise "Feb".
// Daily keys render as "Nov 3".
export function formatAxisLabel(dateKey, index) {
  const { year, month, day, monthly } = parseKey(dateKey);
  const name = MONTHS[month - 1] || '';
  if (!monthly) return `${name} ${day}`;
  return index === 0 || month === 1 ? `${name} ${String(year).slice(-2)}` : name;
}

// Tooltip title: "Mar 2026" or "Nov 3, 2026".
export function formatLongLabel(dateKey) {
  const { year, month, day, monthly } = parseKey(dateKey);
  const name = MONTHS[month - 1] || '';
  return monthly ? `${name} ${year}` : `${name} ${day}, ${year}`;
}

// Short chip under the x axis: "Mar" / "Nov 3".
export function formatChipLabel(dateKey) {
  const { month, day, monthly } = parseKey(dateKey);
  const name = MONTHS[month - 1] || '';
  return monthly ? name : `${name} ${day}`;
}

// Round a domain out to "nice" steps (1, 2, 2.5, 5 x 10^n) with ~`count` ticks.
export function niceTicks(minValue, maxValue, count = 5) {
  const lo = Math.min(0, minValue);
  let hi = Math.max(0, maxValue);
  if (hi === lo) hi = lo + 1000;
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

// Monotone cubic interpolation (same tangents as d3.curveMonotoneX), so the
// curve never overshoots the data. Returns an SVG path for the line.
export function monotonePath(pts) {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  if (n === 2) return `M${pts[0][0]},${pts[0][1]}L${pts[1][0]},${pts[1][1]}`;

  const slope = (i) => (pts[i + 1][1] - pts[i][1]) / ((pts[i + 1][0] - pts[i][0]) || 1);
  const secants = Array.from({ length: n - 1 }, (_, i) => slope(i));
  const tangents = new Array(n);
  tangents[0] = secants[0];
  tangents[n - 1] = secants[n - 2];
  for (let i = 1; i < n - 1; i += 1) {
    const a = secants[i - 1];
    const b = secants[i];
    if (a * b <= 0) {
      tangents[i] = 0;
    } else {
      const h0 = pts[i][0] - pts[i - 1][0];
      const h1 = pts[i + 1][0] - pts[i][0];
      const p = (a * h1 + b * h0) / (h0 + h1);
      tangents[i] = (Math.sign(a) + Math.sign(b)) * Math.min(Math.abs(a), Math.abs(b), 0.5 * Math.abs(p));
    }
  }
  // Endpoint tangents, d3-style.
  const end = (t, s) => {
    const v = (3 * s - t) / 2;
    return Math.sign(v) !== Math.sign(s) ? 0 : (Math.abs(v) > 3 * Math.abs(s) ? 3 * s : v);
  };
  tangents[0] = end(tangents[1], secants[0]);
  tangents[n - 1] = end(tangents[n - 2], secants[n - 2]);

  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${x0 + dx},${y0 + dx * tangents[i]},${x1 - dx},${y1 - dx * tangents[i + 1]},${x1},${y1}`;
  }
  return d;
}
