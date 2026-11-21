// Projecting a tax year's Schedule C profit from what's happened so far.
// `actual` is line 31 to date; `inputs` comes from the API's books.forecast.
// Every method is shown side by side; the chosen one feeds the tax estimate.
export const FORECAST_METHODS = ['run_rate', 'recent', 'seasonal', 'target', 'actual'];
export const FORECAST_LABELS = {
  run_rate: 'Same pace as so far this year',
  recent: 'Pace of the last 90 days',
  seasonal: 'Last year\'s pattern',
  target: 'My own estimate',
  actual: 'Profit so far only (no projection)',
};
// Too early in the year for a pace to mean much.
export const EARLY_DAYS = 30;

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * actual: line 31 so far. inputs: { status, daysElapsed, daysInYear, recent,
 * prior }. target: the user's own full-year estimate or null.
 * Returns { methods: { key: { available, value, note } }, ... }.
 */
export function projectProfit({ actual, inputs, target = null }) {
  const a = Number(actual) || 0;
  const status = inputs?.status || 'current';
  const methods = {};
  const set = (key, available, value, note) => { methods[key] = { available, value: available ? r2(value) : null, note }; };
  if (status !== 'current') {
    const note = status === 'past' ? 'The year is over, so its actual profit is final.' : 'This year hasn\'t started.';
    for (const key of FORECAST_METHODS) set(key, key === 'actual' || key === 'target', key === 'target' && target != null ? Number(target) : a, note);
    if (target == null) methods.target = { available: false, value: null, note: 'Enter your own estimate to use it.' };
    return { status, methods, remainingDays: 0 };
  }
  const d = Math.max(1, inputs.daysElapsed);
  const n = inputs.daysInYear;
  const remaining = Math.max(0, n - d);
  const early = d < EARLY_DAYS;
  set('actual', true, a, 'No projection: what you\'ve made so far.');
  set('run_rate', true, a / d * n, `${a < 0 ? '−' : ''}$${Math.abs(r2(a / d)).toFixed(2)} a day for ${d} days, carried through ${n} days.${early ? ' It\'s early in the year, so this can swing a lot.' : ''}`);
  const rd = inputs.recent?.days || 0;
  if (rd > 0) set('recent', true, a + (inputs.recent.profit / rd) * remaining, `The last ${rd} days' pace for the ${remaining} days left, added to profit so far.${early ? ' It\'s early in the year, so this can swing a lot.' : ''}`);
  else set('recent', false, 0, 'No recent activity yet.');
  const share = inputs.prior?.shareByThen;
  if (share != null && share >= 0.05 && share <= 1) {
    set('seasonal', true, a / share, `By this date last year you had made ${(share * 100).toFixed(1)}% of that year's profit.`);
  } else {
    set('seasonal', false, 0, inputs.prior ? 'Last year\'s records don\'t show a usable pattern for this date.' : 'Needs last year\'s sales in ProfitTracker.');
  }
  if (target != null && target !== '' && Number.isFinite(Number(target))) set('target', true, Number(target), 'Your own full-year estimate.');
  else set('target', false, 0, 'Enter your own estimate to use it.');
  return { status, methods, remainingDays: remaining };
}

/**
 * The method to use: the saved choice when it's available, otherwise the
 * default (same pace for the current year, actual for any other).
 */
export function chooseForecast(projection, chosen) {
  const fallback = projection.status === 'current' ? 'run_rate' : 'actual';
  const key = chosen && projection.methods[chosen]?.available ? chosen : fallback;
  return { key, value: projection.methods[key].value, label: FORECAST_LABELS[key], usedFallback: Boolean(chosen && key !== chosen) };
}
