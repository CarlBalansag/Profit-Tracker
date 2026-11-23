// The year-end Schedule C report: every line in one place, with the records
// behind them, in a form that can be finalized (stored unchanged), compared
// with the live numbers later, and handed to a tax preparer.
//
// The report holds no timestamps or ids that change on their own, so the same
// records always give the same hash: a different hash means the records (or
// the rules) changed.
const crypto = require('crypto');
const { MACRS_HALF_YEAR, HOME_OFFICE } = require('./scheduleCRecords');

// Schedule C (2025) Part II lines ProfitTracker fills.
const PART_II_LABELS = {
  8: 'Advertising',
  9: 'Car and truck expenses',
  10: 'Commissions and fees',
  13: 'Depreciation and section 179 expense deduction',
  17: 'Legal and professional services',
  18: 'Office expense',
  22: 'Supplies',
  '27b': 'Other expenses (from line 48)',
};
const lineOrder = (l) => parseFloat(l) + (/[a-z]$/.test(l) ? (l.charCodeAt(l.length - 1) - 96) / 100 : 0);
const cents = (v) => Math.round(Number(v || 0) * 100);
const money = (c) => (c / 100).toFixed(2);
const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const yearOf = (d) => new Date(d).getUTCFullYear();
const str = (v) => (v === null || v === undefined ? null : String(v));

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const shortHash = (value) => crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 12);

/** Rule versions a report depends on; a change shows up as "rules changed". */
function rulesInUse({ year, worksheet, mileageRates = {} }) {
  const rates = mileageRates[year];
  return {
    schedule_c_lines: `schedule-c-${worksheet?.mapping_year ?? 'unknown'}`,
    mileage: rates ? rates.map((r) => `${r.from}:${r.cents}`).join(',') : 'none',
    depreciation: `macrs-half-year-${shortHash(MACRS_HALF_YEAR)}`,
    home_office: `simplified-${HOME_OFFICE.perSquareFoot}x${HOME_OFFICE.maxSquareFeet}`,
  };
}
const RULE_LABELS = {
  schedule_c_lines: 'Schedule C line numbers',
  mileage: 'IRS mileage rates',
  depreciation: 'Depreciation tables',
  home_office: 'Simplified home office rate',
};
function compareRules(before = {}, after = {}) {
  return Object.keys({ ...before, ...after })
    .filter((k) => before[k] !== after[k])
    .map((k) => ({ key: k, label: RULE_LABELS[k] || k, before: before[k] ?? null, after: after[k] ?? null }));
}

/**
 * year; worksheet: expenseWorksheet(); books: scheduleCBooks() with records;
 * trips / assets: the user's rows; payments: TaxPayment rows for the year.
 */
function buildReport({ year, worksheet, books, trips = [], assets = [], payments = [] }) {
  // Part II: expense lines from the worksheet plus the logs (lines 9, 13, 22).
  const part2Cents = {};
  for (const l of worksheet.lines || []) part2Cents[l.line] = (part2Cents[l.line] || 0) + cents(l.total);
  for (const l of books.records?.lines || []) part2Cents[l.line] = (part2Cents[l.line] || 0) + cents(l.amount);
  const part2 = Object.keys(PART_II_LABELS).sort((a, b) => lineOrder(a) - lineOrder(b))
    .map((line) => ({ line, label: PART_II_LABELS[line], amount: money(part2Cents[line] || 0) }));
  const part5 = (worksheet.groups || []).filter((g) => g.line2025 === '27b' && cents(g.total) !== 0)
    .map((g) => ({ label: g.detail || g.label, amount: money(cents(g.total)) }));

  const assetAmounts = new Map((books.records?.assets?.rows || []).map((r) => [r.id, r.amount]));
  const equipment = assets
    .filter((a) => yearOf(a.placed_in_service) <= year && !(a.disposed_date && yearOf(a.disposed_date) < year))
    .sort((a, b) => String(day(a.placed_in_service)).localeCompare(String(day(b.placed_in_service))) || String(a.name).localeCompare(String(b.name)))
    .map((a) => ({
      name: a.name, placed_in_service: day(a.placed_in_service), cost: money(cents(a.cost)), business_percent: Number(a.business_percent),
      method: a.method, recovery_years: a.recovery_years ?? null, disposed_date: day(a.disposed_date), this_year: assetAmounts.get(a.id) ?? '0.00',
    }));
  const log = trips.filter((t) => yearOf(t.date) === year)
    .sort((a, b) => String(day(a.date)).localeCompare(String(day(b.date))) || String(a.destination).localeCompare(String(b.destination)))
    .map((t) => ({ date: day(t.date), miles: Number(t.miles).toFixed(1), destination: t.destination, purpose: t.purpose, parking_tolls: t.parking_tolls == null ? null : money(cents(t.parking_tolls)) }));
  const rec = books.records || {};

  return {
    year,
    form_lines_year: worksheet.mapping_year,
    planning: Boolean(worksheet.planning),
    basis: books.basis,
    part1: books.lines.map((l) => ({ line: l.line, label: l.label, amount: l.amount })),
    part2,
    part2_total: money(part2.reduce((s, l) => s + cents(l.amount), 0)),
    part3: books.partIII.map((l) => ({ line: l.line, label: l.label, ...(l.value !== undefined ? { value: l.value } : { amount: l.amount }) })),
    part4: log.length ? rec.vehicle || null : null,
    part5,
    home_office: rec.homeOffice?.claimed ? {
      square_feet: rec.homeOffice.squareFeet, square_feet_used: rec.homeOffice.squareFeetUsed, months: rec.homeOffice.months,
      home_square_feet: rec.homeOffice.homeSquareFeet, before_limit: rec.homeOffice.beforeLimit, amount: rec.homeOffice.total,
    } : null,
    mileage: rec.mileage ? { trips: rec.mileage.trips, miles: rec.mileage.miles, by_rate: rec.mileage.byRate, parking_tolls: rec.mileage.parkingTolls, total: rec.mileage.total, log } : null,
    equipment: { items: equipment, depreciation: rec.assets?.depreciation ?? '0.00', section_179: rec.assets?.section179 ?? '0.00', section_179_carryover: rec.assets?.section179Carryover ?? '0.00', de_minimis: rec.assets?.deMinimis ?? '0.00' },
    form_1099k: { forms: (books.form1099K?.forms || []).map((f) => ({ payer_name: f.payer_name, platform_name: f.platform_name, gross_amount: f.gross_amount, transaction_count: f.transaction_count })), comparison: books.form1099K?.comparison || [], total: books.form1099K?.total ?? '0.00' },
    sales: { count: books.sales.count, by_platform: books.sales.byPlatform.map((p) => ({ platform: p.platform, gross: p.gross, count: p.count })) },
    expenses: { pending: worksheet.pending, missing_receipts: worksheet.documentation_gaps },
    payments: payments.map((p) => ({ jurisdiction: p.jurisdiction, period: p.period, amount: money(cents(p.amount)), paid_date: day(p.paid_date), reference: str(p.reference) })),
    reconciliation: books.reconciliation,
    year_end_cutoff: { count: books.yearEndCutoff.sales.length, total: books.yearEndCutoff.total },
    notes: books.notes,
  };
}

const reportHash = (report) => crypto.createHash('sha256').update(stableStringify(report)).digest('hex');

/** Line amounts that differ between two reports (Parts I, II and III). */
function compareReports(before, after) {
  const rows = (r) => {
    const out = new Map();
    for (const [part, list] of [['I', r?.part1], ['II', r?.part2], ['III', r?.part3]]) {
      for (const l of list || []) if (l.amount !== undefined) out.set(`${part}:${l.line}`, { part, line: l.line, label: l.label, amount: l.amount });
    }
    return out;
  };
  const a = rows(before); const b = rows(after);
  const changes = [];
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    const x = a.get(key); const y = b.get(key);
    if (x?.amount === y?.amount) continue;
    changes.push({ part: (x || y).part, line: (x || y).line, label: (y || x).label, before: x?.amount ?? null, after: y?.amount ?? null });
  }
  return changes;
}

module.exports = { buildReport, reportHash, compareReports, rulesInUse, compareRules, PART_II_LABELS, stableStringify };
