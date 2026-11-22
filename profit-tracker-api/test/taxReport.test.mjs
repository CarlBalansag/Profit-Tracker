// Phase 9: the year-end Schedule C report, finalizing a year, revisions with
// reasons, and comparing finalized numbers with the live ones.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { MILEAGE_RATES } from '../../shared/tax/index.mjs';

const require = createRequire(import.meta.url);
const { scheduleCBooks } = require('../services/scheduleCBooks');
const { buildReport, reportHash, compareReports, rulesInUse, compareRules } = require('../services/scheduleCReport');

const stock = [{ id: 'B', product_name: 'Console', purchase_date: '2026-01-10T12:00:00Z', unit_purchase_cost: 500, qty_purchased: 2, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0,
  sales: [{ id: 's', quantity: 1, unit_price: 10000, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform: { name: 'eBay' }, sale_date: '2026-03-01T12:00:00Z', paid_at: null, sale_tax_collected: 0 }] }];
// A worksheet with supplies (line 22), selling fees (line 10) and software (27b).
const worksheet = {
  year: 2026, mapping_year: 2025, planning: true, pending: 1, documentation_gaps: 2, total: '450.00', automatic: { total: '0.00' }, returns_and_allowances: { total: '0.00' }, rows: [],
  groups: [
    { id: 'SUPPLIES', label: 'Supplies', line2025: '22', total: '100.00', count: 1 },
    { id: 'FEES', label: 'Fees', line2025: '10', total: '300.00', count: 2 },
    { id: 'SOFTWARE', label: 'Software subscriptions', line2025: '27b', detail: 'Software subscriptions', total: '50.00', count: 1 },
    { id: 'OTHER', label: 'Other', line2025: '27b', detail: 'Other business expenses', total: '0.00', count: 0 },
  ],
  lines: [{ line: '22', total: '100.00' }, { line: '10', total: '300.00' }, { line: '27b', total: '50.00' }],
};
const trips = [{ id: 't1', date: '2026-03-10T12:00:00Z', miles: '100', destination: 'Target', purpose: 'Buy stock' }];
const assets = [
  { id: 'a1', name: 'Shelving', placed_in_service: '2026-02-01T12:00:00Z', cost: '300', business_percent: 80, method: 'de_minimis' },
  { id: 'a2', name: 'Old camera', placed_in_service: '2020-01-01T12:00:00Z', cost: '700', business_percent: 100, method: 'macrs', recovery_years: 5, disposed_date: '2024-01-01T12:00:00Z' },
];
const make = (over = {}) => {
  const books = scheduleCBooks({ inventories: stock, year: 2026, worksheet, records: { trips, assets, mileageRates: MILEAGE_RATES, setting: { home_office_sq_ft: 100 }, wages: 0 } });
  return buildReport({ year: 2026, worksheet, books, trips, assets, payments: [{ jurisdiction: 'US', period: 'Q1', amount: 500, paid_date: '2026-04-15T12:00:00Z', reference: null }], ...over });
};

describe('buildReport', () => {
  it('puts every Part II line together, and they add up to line 28', () => {
    const r = make();
    const amount = (n) => r.part2.find((l) => l.line === n).amount;
    // Supplies 100 + de minimis shelving 240; mileage 100 x 72.5¢.
    expect([amount('9'), amount('10'), amount('13'), amount('22'), amount('27b')]).toEqual(['72.50', '300.00', '0.00', '340.00', '50.00']);
    expect(r.part2.map((l) => l.line)).toEqual(['8', '9', '10', '13', '17', '18', '22', '27b']);
    expect(r.part2_total).toBe(r.part1.find((l) => l.line === '28').amount);
    expect(r.part5).toEqual([{ label: 'Software subscriptions', amount: '50.00' }]);
    expect(r.home_office).toMatchObject({ square_feet: 100, amount: '500.00' });
    expect(r.mileage.log).toEqual([{ date: '2026-03-10', miles: '100.0', destination: 'Target', purpose: 'Buy stock', parking_tolls: null }]);
    // Gone before the year: not listed.
    expect(r.equipment.items.map((a) => a.name)).toEqual(['Shelving']);
    expect(r.payments).toEqual([{ jurisdiction: 'US', period: 'Q1', amount: '500.00', paid_date: '2026-04-15', reference: null }]);
    expect(r.expenses).toEqual({ pending: 1, missing_receipts: 2 });
  });

  it('gives the same hash for the same records, and a different one when they change', () => {
    expect(reportHash(make())).toBe(reportHash(make()));
    expect(reportHash(make({ payments: [] }))).not.toBe(reportHash(make()));
  });

  it('lists only the lines whose amounts changed', () => {
    const before = make();
    const after = make({ trips: [] });
    // The trip list changed but the books didn't: same lines.
    expect(compareReports(before, after)).toEqual([]);
    const fewer = structuredClone(before);
    fewer.part2.find((l) => l.line === '9').amount = '0.00';
    expect(compareReports(before, fewer)).toEqual([{ part: 'II', line: '9', label: 'Car and truck expenses', before: '72.50', after: '0.00' }]);
  });

  it('records the rule versions, and says which changed', () => {
    const now = rulesInUse({ year: 2026, worksheet, mileageRates: MILEAGE_RATES });
    expect(now).toMatchObject({ schedule_c_lines: 'schedule-c-2025', mileage: '2026-01-01:72.5,2026-07-01:76', home_office: 'simplified-5x300' });
    expect(compareRules(now, { ...now, mileage: '2026-01-01:72.5' })).toEqual([{ key: 'mileage', label: 'IRS mileage rates', before: now.mileage, after: '2026-01-01:72.5' }]);
    expect(rulesInUse({ year: 2030, worksheet, mileageRates: MILEAGE_RATES }).mileage).toBe('none');
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
  const line = (r, n) => r.report.part1.find((l) => l.line === n).amount;

  it('finalizes, notices later changes, and keeps each revision unchanged', async () => {
    let live = (await call('GET', '/api/schedule-c/years/2026/report')).body;
    expect(live).toMatchObject({ finalized: null, changed: null, changes: [], rulesChanged: [] });
    expect(live.hash).toMatch(/^[0-9a-f]{64}$/);
    const first = await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0 });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ revision: 1, reason: null, hash: live.hash, net_profit: line(live, '31') });

    live = (await call('GET', '/api/schedule-c/years/2026/report')).body;
    expect(live).toMatchObject({ changed: false, changes: [], finalized: { revision: 1 } });
    // Nothing changed: a revision needs a reason, and then is refused.
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1 })).status).toBe(400);
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1, reason: 'Again' })).body.error).toMatch(/Nothing has changed since revision 1/);

    // A trip changes lines 9, 28, 29 and 31.
    await call('POST', '/api/schedule-c/mileage', { date: '2026-03-10', miles: '10', destination: 'Post office', purpose: 'Ship orders' });
    live = (await call('GET', '/api/schedule-c/years/2026/report')).body;
    expect(live.changed).toBe(true);
    expect(live.changes.map((c) => `${c.part}:${c.line}`)).toEqual(expect.arrayContaining(['I:28', 'I:29', 'I:31', 'II:9']));
    expect(live.changes.find((c) => c.line === '9')).toMatchObject({ before: '0.00', after: '7.25' });

    // A stale tab can't revise over a newer revision.
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0, reason: 'x' })).status).toBe(409);
    const second = await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1, reason: 'Added a mileage trip' });
    expect(second.body).toMatchObject({ revision: 2, reason: 'Added a mileage trip' });
    expect((await call('GET', '/api/schedule-c/years/2026/report')).body).toMatchObject({ finalized: { revision: 2 }, changed: false, changes: [] });
    // Revision 3 needs revision 2 as the one seen.
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1, reason: 'Stale' })).status).toBe(409);

    const list = (await call('GET', '/api/schedule-c/years/2026/snapshots')).body.snapshots;
    expect(list.map((s) => s.revision)).toEqual([2, 1]);
    const old = (await call('GET', `/api/schedule-c/snapshots/${first.body.id}`)).body;
    expect(old.report.part2.find((l) => l.line === '9').amount).toBe('0.00');
    expect(harness.db.taxReportSnapshot).toHaveLength(2);
  });

  it('refuses bad input, other people\'s reports, and when Schedule C is off', async () => {
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', {})).status).toBe(400);
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0, user_id: harness.ids.other })).status).toBe(400);
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0, reason: 'x'.repeat(301) })).status).toBe(400);
    expect((await call('GET', '/api/schedule-c/years/26/report')).status).toBe(400);
    harness.db.taxReportSnapshot.push({ id: 'theirs', user_id: harness.ids.other, year: 2026, revision: 1, report: { secret: 1 }, rules: {}, input_hash: 'x', created_at: new Date() });
    expect((await call('GET', '/api/schedule-c/snapshots/theirs')).status).toBe(404);
    expect((await call('GET', '/api/schedule-c/years/2026/snapshots')).body.snapshots).toEqual([]);
    // Their revision 1 doesn't count as ours.
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 0 })).status).toBe(201);
    harness.db.user[0].schedule_c_enabled = false;
    expect((await call('GET', '/api/schedule-c/years/2026/report')).status).toBe(403);
    expect((await call('POST', '/api/schedule-c/years/2026/finalize', { expected_revision: 1, reason: 'x' })).status).toBe(403);
  });
});
