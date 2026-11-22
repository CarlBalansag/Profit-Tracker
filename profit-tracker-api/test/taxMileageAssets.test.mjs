// Phase 8b: mileage log (line 9), equipment (lines 13 and 22) and the
// simplified home office (line 30) in the Schedule C books.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { MILEAGE_RATES, buildTaxOverview, discoverDeductions } from '../../shared/tax/index.mjs';

const require = createRequire(import.meta.url);
const { scheduleCBooks } = require('../services/scheduleCBooks');
const { mileageForYear, assetDeduction, assetsForYear, homeOfficeForYear } = require('../services/scheduleCRecords');
const { profitEvents } = require('../services/taxForecast');

const ws = (total) => ({ returns_and_allowances: { total: '0.00' }, total, automatic: { total: '0.00' }, rows: [] });
const line = (b, n) => b.lines.find((l) => l.line === n).amount;
// 2 units at $500 in 2026, one sold for $10,000: gross profit $9,500.
const stock = [{ id: 'B', product_name: 'Console', purchase_date: '2026-01-10T12:00:00Z', unit_purchase_cost: 500, qty_purchased: 2, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0,
  sales: [{ id: 's', quantity: 1, unit_price: 10000, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform: { name: 'eBay' }, sale_date: '2026-03-01T12:00:00Z', paid_at: null, sale_tax_collected: 0 }] }];
const trips = [
  { id: 't1', date: '2026-03-10T12:00:00Z', miles: '100', destination: 'Target', purpose: 'Buy stock' },
  { id: 't2', date: '2026-08-01T12:00:00Z', miles: '50.5', destination: 'Post office', purpose: 'Ship orders', parking_tolls: '4.25' },
  { id: 't3', date: '2025-12-30T12:00:00Z', miles: '10', destination: 'Walmart', purpose: 'Buy stock' },
];
const assets = [
  { id: 'a1', name: 'Label printer', placed_in_service: '2025-05-01T12:00:00Z', cost: '1000', business_percent: 100, method: 'macrs', recovery_years: 5 },
  { id: 'a2', name: 'Shelving', placed_in_service: '2026-02-01T12:00:00Z', cost: '300', business_percent: 80, method: 'de_minimis' },
  { id: 'a3', name: 'Laptop', placed_in_service: '2026-06-01T12:00:00Z', cost: '2000', business_percent: 75, method: 'section_179' },
  { id: 'a4', name: 'Camera', placed_in_service: '2024-03-01T12:00:00Z', cost: '700', business_percent: 100, method: 'macrs', recovery_years: 7, disposed_date: '2026-05-01T12:00:00Z' },
];
const records = (over = {}) => ({ trips, assets, mileageRates: MILEAGE_RATES, setting: { year: 2026, home_office_sq_ft: 200, home_office_months: 6, home_total_sq_ft: 1500 }, wages: 0, ...over });

describe('mileage log (line 9)', () => {
  it('uses each trip date\'s rate and adds parking and tolls', () => {
    const m = mileageForYear(trips, 2026, MILEAGE_RATES);
    // 100 x 72.5¢ before July 1, 50.5 x 76¢ after.
    expect(m).toMatchObject({ trips: 2, miles: '150.5', mileageAmount: '110.88', parkingTolls: '4.25', total: '115.13', rateMissing: false });
    expect(m.byRate).toEqual([{ cents: 72.5, miles: '100.0', amount: '72.50' }, { cents: 76, miles: '50.5', amount: '38.38' }]);
    expect(mileageForYear(trips, 2025, MILEAGE_RATES)).toMatchObject({ trips: 1, total: '7.00' });
  });

  it('says so instead of guessing when the year has no rate', () => {
    const m = mileageForYear([{ id: 'x', date: '2027-02-01T12:00:00Z', miles: '10', parking_tolls: '2' }], 2027, MILEAGE_RATES);
    expect(m).toMatchObject({ rateMissing: true, mileageAmount: '0.00', total: '2.00' });
  });
});

describe('equipment (lines 13 and 22)', () => {
  it('deducts each method the right way, by year', () => {
    const amount = (a, y) => assetDeduction(a, y).amount.toFixed(2);
    // MACRS 5-year, half-year convention: 20%, then 32%.
    expect([amount(assets[0], 2025), amount(assets[0], 2026), amount(assets[0], 2030), amount(assets[0], 2031)]).toEqual(['200.00', '320.00', '57.60', '0.00']);
    // Business share only, in the year it's put to use, then nothing.
    expect([amount(assets[1], 2026), amount(assets[1], 2027)]).toEqual(['240.00', '0.00']);
    expect([amount(assets[2], 2026), amount(assets[2], 2027)]).toEqual(['1500.00', '0.00']);
    // 7-year, third year 17.49%, halved in the year it went; none after.
    expect([amount(assets[3], 2026), amount(assets[3], 2027)]).toEqual(['61.22', '0.00']);
    // Bought and gone the same year: no depreciation.
    expect(amount({ ...assets[0], placed_in_service: '2026-02-01', disposed_date: '2026-09-01' }, 2026)).toBe('0.00');
    // Not yet in use.
    expect(amount(assets[2], 2025)).toBe('0.00');
  });

  it('limits Section 179 to business income plus wages, and reports the rest', () => {
    expect(assetsForYear(assets, 2026, { incomeLimit: 1000 })).toMatchObject({ section179: '1000.00', section179Carryover: '500.00', depreciation: '381.22', line13: '1381.22', deMinimis: '240.00' });
    expect(assetsForYear(assets, 2026, { incomeLimit: -50 })).toMatchObject({ section179: '0.00', section179Carryover: '1500.00' });
  });

  it('flags the mid-quarter convention when over 40% went into use in October to December', () => {
    expect(assetsForYear([{ ...assets[0], placed_in_service: '2026-11-01' }], 2026).midQuarter).toBe(true);
    expect(assetsForYear(assets, 2026).midQuarter).toBe(false);
  });
});

describe('simplified home office (line 30)', () => {
  it('is $5 a square foot up to 300, for the months used, capped at profit', () => {
    expect(homeOfficeForYear({ home_office_sq_ft: 200, home_office_months: 6 }, 9000)).toMatchObject({ total: '500.00', limited: false });
    expect(homeOfficeForYear({ home_office_sq_ft: 450 }, 9000)).toMatchObject({ squareFeetUsed: 300, months: 12, total: '1500.00' });
    expect(homeOfficeForYear({ home_office_sq_ft: 300 }, 400)).toMatchObject({ beforeLimit: '1500.00', total: '400.00', limited: true });
    expect(homeOfficeForYear({ home_office_sq_ft: 300 }, -10)).toMatchObject({ total: '0.00', limited: true });
    expect(homeOfficeForYear(null, 9000)).toMatchObject({ claimed: false, total: '0.00' });
  });
});

describe('Schedule C books with the logs', () => {
  it('puts them on lines 9, 13, 22, 28, 29, 30 and 31, and the reconciliation still adds up', () => {
    const b = scheduleCBooks({ inventories: stock, year: 2026, worksheet: ws('1000.00'), records: records() });
    expect(b.records.lines).toEqual([
      { line: '9', label: 'Car and truck expenses', amount: '115.13' },
      { line: '13', label: 'Depreciation and Section 179', amount: '1881.22' },
      { line: '22', label: 'Equipment deducted in full (de minimis)', amount: '240.00' },
    ]);
    // 1,000 + 115.13 + 1,881.22 + 240
    expect([line(b, '28'), line(b, '29'), line(b, '30'), line(b, '31')]).toEqual(['3236.35', '6263.65', '500.00', '5763.65']);
    expect(b.records.yearly).toBe('2621.22'); // equipment and home office, not mileage
    expect(b.records.vehicle).toMatchObject({ businessMiles: '150.5' });
    const rec = b.reconciliation;
    expect(rec.differences.find((d) => d.key === 'records').amount).toBe('-2736.35');
    const sum = Number(rec.appProfitAfterExpenses) + rec.differences.reduce((t, d) => t + Number(d.amount), 0);
    expect(sum).toBeCloseTo(Number(b.netProfit), 2);
  });

  it('applies the Section 179 and home office limits at a low profit, and says why', () => {
    const b = scheduleCBooks({ inventories: stock, year: 2026, worksheet: ws('9000.00'), records: records() });
    // Before Section 179: 9,500 - 9,000 - 115.13 - 381.22 - 240 = -236.35, so none of it.
    expect(b.records.assets).toMatchObject({ section179: '0.00', section179Carryover: '1500.00' });
    expect(line(b, '30')).toBe('0.00');
    expect(b.notes.join(' ')).toMatch(/\$1500\.00 of it can't be deducted this year/);
    expect(b.notes.join(' ')).toMatch(/home office deduction is limited/);
    // Wages count toward the Section 179 limit.
    const w = scheduleCBooks({ inventories: stock, year: 2026, worksheet: ws('9000.00'), records: records({ wages: '1000' }) });
    expect(w.records.assets).toMatchObject({ section179: '763.65', section179Carryover: '736.35' });
  });

  it('warns about deducting gas as well as the mileage rate', () => {
    const worksheet = { ...ws('40.00'), rows: [{ source: 'manual', status: 'reviewed', name: 'Shell gas' }] };
    const b = scheduleCBooks({ inventories: stock, year: 2026, worksheet, records: records() });
    expect(b.notes.join(' ')).toMatch(/also deducting an expense that looks like gas \(Shell gas\)/);
  });

  it('changes nothing without records', () => {
    const b = scheduleCBooks({ inventories: stock, year: 2026, worksheet: ws('1000.00') });
    expect([line(b, '28'), line(b, '30'), line(b, '31')]).toEqual(['1000.00', '0.00', '8500.00']);
    expect(b.reconciliation.differences.some((d) => d.key === 'records')).toBe(false);
  });
});

describe('projections', () => {
  it('counts trips on their dates', () => {
    const events = profitEvents({ inventories: [], year: 2026, worksheet: ws('0'), trips, mileageRates: MILEAGE_RATES });
    expect(events).toEqual([{ date: '2026-03-10', amount: -72.5 }, { date: '2026-08-01', amount: -42.63 }]);
  });

  it('takes equipment and home office off once instead of scaling them with the pace', () => {
    const forecast = { status: 'current', daysElapsed: 100, daysInYear: 365, recent: { days: 90, profit: 900 }, prior: null, yearlyDeductions: '500.00' };
    const o = buildTaxOverview({ profile: { reserve_mode: 'flat' }, year: 2026, businessProfit: 1000, today: '2026-04-10', forecast });
    // (1,000 + 500) / 100 days x 365, less 500 once.
    expect(o.projection.methods.run_rate.value).toBe(4975);
    expect(o.projection.methods.actual.value).toBe(1000);
  });
});

describe('deduction checks', () => {
  it('stop suggesting what the logs already have, and point to the log otherwise', () => {
    const ids = (recorded) => discoverDeductions({ year: 2026, saleCount: 3, profit: 100, recorded }).map((d) => d.id);
    expect(ids({})).toEqual(expect.arrayContaining(['mileage', 'home_office', 'equipment']));
    expect(ids({ mileage: true, homeOffice: true, equipment: true })).toEqual(['supplies', 'phone_internet', 'retirement', 'health']);
    expect(discoverDeductions({ year: 2026, saleCount: 3 }).find((d) => d.id === 'mileage').logOn).toBe('Driving for the business');
  });
});

describe('API', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const trip = { date: '2026-03-10', miles: '12.5', destination: 'Post office', purpose: 'Ship orders' };
  const asset = { name: 'Label printer', placed_in_service: '2026-03-01', cost: '150', business_percent: 100, method: 'de_minimis' };

  it('adds, edits, lists by year and deletes trips', async () => {
    let r = await call('POST', '/api/schedule-c/mileage', trip);
    expect(r.status).toBe(201);
    expect(r.body.trips).toEqual([expect.objectContaining({ date: '2026-03-10', miles: '12.5', parking_tolls: null })]);
    await call('POST', '/api/schedule-c/mileage', { ...trip, date: '2025-06-01' });
    expect((await call('GET', '/api/schedule-c/mileage?year=2026')).body.trips).toHaveLength(1);
    const id = r.body.trips[0].id;
    r = await call('PUT', `/api/schedule-c/mileage/${id}`, { ...trip, miles: '20', parking_tolls: '3.50' });
    expect(r.body.trips[0]).toMatchObject({ miles: '20', parking_tolls: '3.5' });
    const books = (await call('GET', '/api/schedule-c?year=2026')).body.books;
    // 20 x 72.5¢ + 3.50
    expect(books.records.lines[0].amount).toBe('18.00');
    expect((await call('DELETE', `/api/schedule-c/mileage/${id}`)).body.trips).toEqual([]);
  });

  it('refuses bad trips, other people\'s trips, and when Schedule C is off', async () => {
    expect((await call('POST', '/api/schedule-c/mileage', { ...trip, miles: '0' })).status).toBe(400);
    expect((await call('POST', '/api/schedule-c/mileage', { ...trip, destination: ' ' })).status).toBe(400);
    expect((await call('POST', '/api/schedule-c/mileage', { ...trip, user_id: harness.ids.other })).status).toBe(400);
    harness.db.taxMileageTrip.push({ id: 'theirs', user_id: harness.ids.other, date: new Date('2026-03-01T12:00:00Z'), miles: 5, destination: 'x', purpose: 'y' });
    expect((await call('PUT', '/api/schedule-c/mileage/theirs', trip)).status).toBe(404);
    expect((await call('DELETE', '/api/schedule-c/mileage/theirs')).status).toBe(404);
    expect(harness.db.taxMileageTrip).toHaveLength(1);
    harness.db.user[0].schedule_c_enabled = false;
    expect((await call('POST', '/api/schedule-c/mileage', trip)).status).toBe(403);
    expect((await call('GET', '/api/schedule-c/assets')).status).toBe(403);
  });

  it('adds, edits and deletes equipment, with this year\'s deduction', async () => {
    let r = await call('POST', '/api/schedule-c/assets?year=2026', asset);
    expect(r.status).toBe(201);
    expect(r.body.assets[0]).toMatchObject({ name: 'Label printer', method: 'de_minimis', recovery_years: null, this_year: '150.00' });
    const id = r.body.assets[0].id;
    r = await call('PUT', `/api/schedule-c/assets/${id}?year=2027`, { ...asset, cost: '3000', method: 'macrs', recovery_years: 5 });
    expect(r.body.assets[0]).toMatchObject({ method: 'macrs', recovery_years: 5, this_year: '960.00' });
    expect((await call('DELETE', `/api/schedule-c/assets/${id}`)).body.assets).toEqual([]);
  });

  it('refuses equipment the rules don\'t allow', async () => {
    const bad = async (over) => (await call('POST', '/api/schedule-c/assets', { ...asset, ...over }));
    expect((await bad({ cost: '2600' })).body.error || '').not.toBe(undefined);
    expect((await bad({ cost: '2600' })).status).toBe(400);
    expect((await bad({ method: 'section_179', business_percent: 50 })).status).toBe(400);
    expect((await bad({ method: 'macrs' })).status).toBe(400);
    expect((await bad({ disposed_date: '2026-01-01' })).status).toBe(400);
    expect((await bad({ business_percent: 0 })).status).toBe(400);
    harness.db.taxAsset.push({ id: 'theirs', user_id: harness.ids.other, name: 'x', placed_in_service: new Date(), cost: 5, business_percent: 100, method: 'de_minimis' });
    expect((await call('DELETE', '/api/schedule-c/assets/theirs')).status).toBe(404);
    expect(harness.db.taxAsset).toHaveLength(1);
  });

  it('saves home office and vehicle details without clearing other year settings', async () => {
    await call('PUT', '/api/schedule-c/years/2026', { untracked_inventory_end: '300' });
    const r = await call('PUT', '/api/schedule-c/years/2026', { home_office_sq_ft: '120', home_office_months: 12, home_total_sq_ft: '1000', vehicle_in_service: '2024-05-01', vehicle_commuting_miles: '0', vehicle_other_miles: '4000.5' });
    expect(r.body).toMatchObject({ untracked_inventory_end: '300', home_office_sq_ft: 120, vehicle_in_service: '2024-05-01', vehicle_other_miles: '4000.5' });
    expect((await call('PUT', '/api/schedule-c/years/2026', { home_office_sq_ft: 1200, home_total_sq_ft: 1000 })).status).toBe(400);
    expect((await call('PUT', '/api/schedule-c/years/2026', { home_office_months: 13 })).status).toBe(400);
    const books = (await call('GET', '/api/schedule-c?year=2026')).body.books;
    expect(books.records.homeOffice).toMatchObject({ claimed: true, squareFeet: 120, beforeLimit: '600.00' });
    expect(books.records.vehicle).toMatchObject({ inService: '2024-05-01', otherMiles: '4000.5' });
    await call('PUT', '/api/schedule-c/years/2026', { home_office_sq_ft: '' });
    expect((await call('GET', '/api/schedule-c?year=2026')).body.books.records.homeOffice.claimed).toBe(false);
  });
});
