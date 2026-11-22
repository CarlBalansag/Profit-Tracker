// Schedule C deductions that come from the user's own logs rather than from
// purchases, sales or expenses:
// - line 9: business miles at the IRS standard mileage rate for each trip's
//   date, plus business parking and tolls;
// - line 13: depreciation and Section 179 for equipment (Form 4562);
// - line 22: equipment deducted in full under the de minimis safe harbor;
// - line 30: the simplified home office method ($5 a square foot, up to 300).
//
// Simplifications, shown to the user as limitations rather than guessed:
// - depreciation uses MACRS (200% declining balance) with the half-year
//   convention; when the mid-quarter convention applies it is flagged, not
//   calculated; bonus depreciation isn't offered;
// - Section 179 is limited to business income plus wages, and anything over
//   that is reported as a carryover (prior years' carryovers aren't tracked);
// - selling or scrapping equipment stops its depreciation (half a year in the
//   year it goes), but any gain or recapture isn't calculated.
const { Decimal, decimal } = require('./decimalFinance');

const ZERO = new Decimal(0);
const money = (d) => decimal(d).toDecimalPlaces(2).toFixed(2);
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const yearOf = (d) => new Date(d).getUTCFullYear();

// IRS Pub 946, Table A-1: 3-, 5- and 7-year property, half-year convention.
const MACRS_HALF_YEAR = {
  5: [20.00, 32.00, 19.20, 11.52, 11.52, 5.76],
  7: [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
};
const MID_QUARTER_SHARE = 0.4;
const HOME_OFFICE = { perSquareFoot: 5, maxSquareFeet: 300 };

/** The cents-per-mile rate for a date, from rates like { 2026: [{ from, cents }] }. */
function mileageRate(rates, date) {
  const day = iso(date);
  const list = rates?.[yearOf(date)] || [];
  let found = null;
  for (const r of list) if (r.from <= day) found = r;
  return found ? found.cents : null;
}

/** Line 9 from the mileage log for `year`. */
function mileageForYear(trips = [], year, rates) {
  const inYear = trips.filter((t) => yearOf(t.date) === year);
  let miles = ZERO; let mileage = ZERO; let parking = ZERO;
  const unrated = [];
  const byRate = new Map();
  for (const t of inYear) {
    const m = decimal(t.miles);
    miles = miles.plus(m);
    parking = parking.plus(decimal(t.parking_tolls || 0));
    const cents = mileageRate(rates, t.date);
    if (cents === null) { unrated.push(t.id); continue; }
    mileage = mileage.plus(m.times(cents).div(100));
    byRate.set(cents, (byRate.get(cents) || ZERO).plus(m));
  }
  mileage = mileage.toDecimalPlaces(2);
  const total = mileage.plus(parking);
  return {
    trips: inYear.length, miles: miles.toDecimalPlaces(1).toFixed(1),
    mileageAmount: money(mileage), parkingTolls: money(parking), total: money(total),
    byRate: [...byRate].map(([cents, m]) => ({ cents, miles: m.toDecimalPlaces(1).toFixed(1), amount: money(m.times(cents).div(100)) })).sort((a, b) => a.cents - b.cents),
    rateMissing: unrated.length > 0,
    _total: total,
  };
}

/** One asset's deduction for `year`: { kind: 'de_minimis'|'section_179'|'macrs', amount }. */
function assetDeduction(asset, year) {
  const placed = yearOf(asset.placed_in_service);
  const basis = decimal(asset.cost).times(Number(asset.business_percent) || 0).div(100);
  const disposedYear = asset.disposed_date ? yearOf(asset.disposed_date) : null;
  const none = { kind: asset.method, amount: ZERO, basis };
  if (year < placed || (disposedYear !== null && disposedYear < year)) return none;
  if (asset.method === 'de_minimis' || asset.method === 'section_179') {
    return year === placed ? { kind: asset.method, amount: basis.toDecimalPlaces(2), basis } : none;
  }
  const table = MACRS_HALF_YEAR[asset.recovery_years] || MACRS_HALF_YEAR[7];
  const k = year - placed;
  if (k >= table.length) return none;
  // Gone in the year it was bought: no depreciation. Gone later: half a year.
  if (disposedYear === year && k === 0) return none;
  let amount = basis.times(table[k]).div(100);
  if (disposedYear === year) amount = amount.div(2);
  return { kind: 'macrs', amount: amount.toDecimalPlaces(2), basis };
}

/**
 * Lines 13 and 22 from the equipment list. incomeLimit: business income
 * before Section 179 plus wages (Section 179 can't exceed it).
 */
function assetsForYear(assets = [], year, { incomeLimit = null } = {}) {
  let macrs = ZERO; let s179 = ZERO; let deMinimis = ZERO;
  const rows = [];
  let placedBasis = ZERO; let placedQ4 = ZERO;
  for (const a of assets) {
    const d = assetDeduction(a, year);
    if (d.kind === 'macrs') macrs = macrs.plus(d.amount);
    else if (d.kind === 'section_179') s179 = s179.plus(d.amount);
    else deMinimis = deMinimis.plus(d.amount);
    if (a.method === 'macrs' && yearOf(a.placed_in_service) === year) {
      placedBasis = placedBasis.plus(d.basis);
      if (new Date(a.placed_in_service).getUTCMonth() >= 9) placedQ4 = placedQ4.plus(d.basis);
    }
    rows.push({ id: a.id, name: a.name, method: a.method, amount: money(d.amount) });
  }
  const limit = incomeLimit === null ? null : Decimal.max(ZERO, decimal(incomeLimit));
  const s179Allowed = limit === null ? s179 : Decimal.min(s179, limit);
  const carryover = s179.minus(s179Allowed);
  const line13 = macrs.plus(s179Allowed);
  return {
    count: assets.length,
    depreciation: money(macrs), section179: money(s179Allowed), section179Claimed: money(s179), section179Carryover: money(carryover),
    deMinimis: money(deMinimis), line13: money(line13), rows,
    midQuarter: placedBasis.greaterThan(0) && placedQ4.div(placedBasis).greaterThan(MID_QUARTER_SHARE),
    _line13: line13, _line22: deMinimis, _section179: s179,
  };
}

/** Line 30 by the simplified method, limited to line 29 (never below zero). */
function homeOfficeForYear(setting, tentativeProfit) {
  const sqft = setting?.home_office_sq_ft ?? null;
  if (!sqft) return { claimed: false, total: '0.00', _total: ZERO };
  const months = Math.min(12, Math.max(1, setting.home_office_months ?? 12));
  const used = Math.min(sqft, HOME_OFFICE.maxSquareFeet);
  const full = new Decimal(HOME_OFFICE.perSquareFoot).times(used).times(months).div(12).toDecimalPlaces(2);
  const limit = Decimal.max(ZERO, decimal(tentativeProfit));
  const allowed = Decimal.min(full, limit);
  return {
    claimed: true, squareFeet: sqft, squareFeetUsed: used, months, homeSquareFeet: setting.home_total_sq_ft ?? null,
    beforeLimit: money(full), total: money(allowed), limited: allowed.lessThan(full),
    _total: allowed,
  };
}

/** Schedule C Part IV from the log and the year's settings. */
function vehicleInfo(setting, mileage) {
  return {
    inService: setting?.vehicle_in_service ? iso(setting.vehicle_in_service) : null,
    businessMiles: mileage.miles,
    commutingMiles: setting?.vehicle_commuting_miles == null ? null : decimal(setting.vehicle_commuting_miles).toFixed(1),
    otherMiles: setting?.vehicle_other_miles == null ? null : decimal(setting.vehicle_other_miles).toFixed(1),
  };
}

const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));

module.exports = { mileageRate, mileageForYear, assetDeduction, assetsForYear, homeOfficeForYear, vehicleInfo, strip, MACRS_HALF_YEAR, HOME_OFFICE };
