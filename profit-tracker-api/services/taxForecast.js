// What the projections on the tax estimate need, computed on the server so
// the browser gets a few numbers instead of every sale:
// - profit "events" by date: each realized sale's price less what its units
//   cost (the same unit cost as Schedule C Part III), and each deductible
//   expense on its paid date;
// - the pace over the last 90 days, the share of last year's profit earned by
//   the same date, and profit by month.
// The year's actual profit always comes from Schedule C line 31; these only
// shape the projection of the rest of the year. Refunds to buyers aren't dated
// events here, so they only enter through line 31.
const { decimal } = require('./decimalFinance');
const { batchFactsForForecast, isCancelledPurchase, unitsOut } = require('./scheduleCBooks');
const { mileageRate } = require('./scheduleCRecords');

const DAY = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const yearOf = (d) => new Date(d).getUTCFullYear();
const daysInYear = (y) => ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365);
const dayOfYear = (date) => Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY) + 1;
const round = (n) => Math.round(n * 100) / 100;

/** [{ date: 'YYYY-MM-DD', amount }] for one tax year. */
function profitEvents({ inventories = [], year, worksheet, trips = [], mileageRates = {} }) {
  const events = [];
  for (const raw of inventories) {
    if (isCancelledPurchase(raw)) continue;
    const b = batchFactsForForecast(raw);
    for (const sale of b.sales) {
      if (yearOf(sale.sale_date) !== year) continue;
      const price = decimal(sale.unit_price || 0).times(Number(sale.quantity) || 0);
      events.push({ date: iso(sale.sale_date), amount: price.minus(b.unit.times(unitsOut(sale))).toNumber() });
    }
  }
  for (const row of worksheet?.rows || []) {
    if (!['reviewed', 'automatic'].includes(row.status)) continue;
    const date = row.tax_details?.paid_date;
    if (!date || Number(date.slice(0, 4)) !== year) continue;
    const eligible = Number(row.eligible) || 0;
    if (eligible) events.push({ date: date.slice(0, 10), amount: -eligible });
  }
  // Business trips on their dates (line 9).
  for (const t of trips) {
    if (yearOf(t.date) !== year) continue;
    const cents = mileageRate(mileageRates, t.date);
    const amount = (cents === null ? 0 : Number(t.miles) * cents / 100) + (Number(t.parking_tolls) || 0);
    if (amount) events.push({ date: iso(t.date), amount: -amount });
  }
  return events;
}

/**
 * year, today (Date), events for the year, and last year's events and line 31
 * (or null). Returns the inputs shared/tax/forecast.mjs projects from.
 */
function forecastInputs({ year, today = new Date(), events = [], priorEvents = null, priorNetProfit = null }) {
  const thisYear = today.getUTCFullYear();
  const status = year < thisYear ? 'past' : year > thisYear ? 'future' : 'current';
  const total = daysInYear(year);
  const elapsed = status === 'past' ? total : status === 'future' ? 0 : dayOfYear(today);
  const asOf = status === 'current' ? iso(today) : status === 'past' ? `${year}-12-31` : null;
  const recentDays = Math.min(90, elapsed);
  const from = asOf ? iso(new Date(Date.parse(`${asOf}T00:00:00Z`) - (recentDays - 1) * DAY)) : null;
  const recentProfit = asOf ? events.filter((e) => e.date >= from && e.date <= asOf).reduce((s, e) => s + e.amount, 0) : 0;
  const monthly = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, profit: 0 }));
  for (const e of events) monthly[Number(e.date.slice(5, 7)) - 1].profit += e.amount;

  let prior = null;
  if (priorEvents && priorEvents.length) {
    const priorTotal = priorEvents.reduce((s, e) => s + e.amount, 0);
    // Same month and day last year (Feb 29 counts as Feb 28).
    const cutoff = asOf ? `${year - 1}-${asOf.slice(5) === '02-29' ? '02-28' : asOf.slice(5)}` : null;
    const byThen = cutoff ? priorEvents.filter((e) => e.date <= cutoff).reduce((s, e) => s + e.amount, 0) : 0;
    prior = { netProfit: priorNetProfit, eventTotal: round(priorTotal), shareByThen: priorTotal > 0 ? round(byThen / priorTotal * 10000) / 10000 : null };
  }
  return {
    status, asOf, daysElapsed: elapsed, daysInYear: total,
    recent: { days: recentDays, profit: round(recentProfit) },
    monthly: monthly.map((m) => ({ ...m, profit: round(m.profit) })),
    prior,
  };
}

module.exports = { profitEvents, forecastInputs, daysInYear, dayOfYear };
