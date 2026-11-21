// Phase 6: projecting the year's profit (inputs built on the API, methods in
// shared/tax/forecast.mjs), the reserve ledger, and the overview using both.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { projectProfit, chooseForecast, buildTaxOverview } from '../../shared/tax/index.mjs';

const require = createRequire(import.meta.url);
const { profitEvents, forecastInputs, dayOfYear } = require('../services/taxForecast');

const sale = (id, price, date, extra = {}) => ({ id, quantity: 1, unit_price: price, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform: { name: 'eBay' }, sale_date: date, paid_at: null, sale_tax_collected: 0, ...extra });
// 4 units at $10 each.
const inv = (sales, extra = {}) => ({ id: 'A', product_name: 'Cable', purchase_date: '2025-01-05T12:00:00Z', unit_purchase_cost: 10, qty_purchased: 4, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0, sales, ...extra });

describe('profit events and forecast inputs', () => {
  const worksheet = { rows: [
    { status: 'reviewed', eligible: '5.00', tax_details: { paid_date: '2026-03-10' } },
    { status: 'automatic', eligible: '2.50', tax_details: { paid_date: '2026-03-01' } },
    { status: 'pending', eligible: '0.00', tax_details: { paid_date: '2026-03-02' } },
    { status: 'reviewed', eligible: '9.00', tax_details: { paid_date: '2025-12-30' } },
  ] };

  it('dates each sale\'s profit and each deductible expense, skipping other years and cancelled sales', () => {
    const events = profitEvents({ year: 2026, worksheet, inventories: [inv([
      sale('a', 30, '2026-03-01T12:00:00Z'), sale('b', 25, '2025-06-01T12:00:00Z'),
      sale('c', 40, '2026-04-01T12:00:00Z', { status: 'CANCELLED' }), sale('d', 22, '2026-09-15T12:00:00Z', { quantity: 2, refunded_qty: 1 }),
    ])] });
    expect(events).toEqual([
      { date: '2026-03-01', amount: 20 }, // 30 - 10
      { date: '2026-09-15', amount: 34 }, // 44 - 10 (one unit came back)
      { date: '2026-03-10', amount: -5 },
      { date: '2026-03-01', amount: -2.5 },
    ]);
  });

  it('measures the year so far, the last 90 days and last year\'s share by the same date', () => {
    const events = [{ date: '2026-02-01', amount: 100 }, { date: '2026-09-01', amount: 50 }, { date: '2026-11-20', amount: 30 }, { date: '2026-12-01', amount: 999 }];
    const prior = [{ date: '2025-03-01', amount: 300 }, { date: '2025-11-30', amount: 100 }, { date: '2025-12-20', amount: 100 }];
    const f = forecastInputs({ year: 2026, today: new Date('2026-11-21T15:00:00Z'), events, priorEvents: prior, priorNetProfit: '480.00' });
    expect(f).toMatchObject({ status: 'current', asOf: '2026-11-21', daysElapsed: 325, daysInYear: 365 });
    // Aug 24 - Nov 21: the Sep 1 and Nov 20 sales (Dec 1 is in the future).
    expect(f.recent).toEqual({ days: 90, profit: 80 });
    // $300 of last year's $500 had been made by Nov 21.
    expect(f.prior).toEqual({ netProfit: '480.00', eventTotal: 500, shareByThen: 0.6 });
    expect(f.monthly[1].profit).toBe(100);
    expect(f.monthly[11].profit).toBe(999);
  });

  it('handles past, future and very early years', () => {
    expect(forecastInputs({ year: 2025, today: new Date('2026-11-21T12:00:00Z') })).toMatchObject({ status: 'past', asOf: '2025-12-31', daysElapsed: 365 });
    expect(forecastInputs({ year: 2027, today: new Date('2026-11-21T12:00:00Z') })).toMatchObject({ status: 'future', asOf: null, daysElapsed: 0 });
    const jan = forecastInputs({ year: 2026, today: new Date('2026-01-10T12:00:00Z'), events: [{ date: '2026-01-02', amount: 40 }] });
    expect(jan.recent).toEqual({ days: 10, profit: 40 });
    expect(dayOfYear(new Date('2024-12-31T23:00:00Z'))).toBe(366);
  });
});

describe('projectProfit', () => {
  const inputs = { status: 'current', daysElapsed: 325, daysInYear: 365, recent: { days: 90, profit: 4500 }, prior: { shareByThen: 0.8 } };
  it('projects with each method and explains it', () => {
    const p = projectProfit({ actual: 10000, inputs, target: 15000 });
    expect(Object.fromEntries(Object.entries(p.methods).map(([k, m]) => [k, m.value]))).toEqual({ actual: 10000, run_rate: 11230.77, recent: 12000, seasonal: 12500, target: 15000 });
    expect(p.methods.run_rate.note).toMatch(/^\$30\.77 a day for 325 days/);
    expect(chooseForecast(p, 'recent')).toMatchObject({ key: 'recent', value: 12000 });
  });

  it('falls back when a method has nothing to go on, and warns early in the year', () => {
    const p = projectProfit({ actual: -300, inputs: { ...inputs, daysElapsed: 10, recent: { days: 10, profit: 0 }, prior: null } });
    expect(p.methods.seasonal.available).toBe(false);
    expect(p.methods.target.available).toBe(false);
    expect(p.methods.run_rate.note).toMatch(/^−\$30\.00 a day.*early in the year/);
    expect(chooseForecast(p, 'seasonal')).toMatchObject({ key: 'run_rate', usedFallback: true });
    // A tiny share last year would blow the projection up, so it isn't used.
    expect(projectProfit({ actual: 10, inputs: { ...inputs, prior: { shareByThen: 0.01 } } }).methods.seasonal.available).toBe(false);
  });

  it('uses actual profit once the year is over', () => {
    const p = projectProfit({ actual: 5000, inputs: { status: 'past', daysElapsed: 365, daysInYear: 365 } });
    expect(chooseForecast(p, null)).toMatchObject({ key: 'actual', value: 5000 });
    expect(chooseForecast(p, 'run_rate')).toMatchObject({ key: 'actual', usedFallback: true });
  });
});

describe('buildTaxOverview with a projection and a reserve', () => {
  const profile = { filing_status: 'single', state: 'TX', non_business_income: '0', forecast_method: 'target', profit_target: '50000' };
  const forecast = { status: 'current', daysElapsed: 325, daysInYear: 365, recent: { days: 90, profit: 0 }, prior: null };

  it('estimates on the projected profit and counts the reserve toward what to set aside', () => {
    const o = buildTaxOverview({ profile, year: 2026, businessProfit: 30000, today: '2026-11-21', forecast, reserveBalance: '3000', payments: [{ jurisdiction: 'US', period: 'Q2', amount: '2000' }] });
    expect([o.actualProfit, o.businessProfit, o.forecastChoice.key]).toEqual([30000, 50000, 'target']);
    expect(o.impact.additionalTaxFromBusiness).toBe(9732.07); // same as the $50,000 walk-through
    expect([o.covered, o.stillToSetAside, o.coverage]).toEqual([5000, 4732.07, 0.514]);
  });

  it('keeps using profit so far without projection inputs', () => {
    const o = buildTaxOverview({ profile, year: 2026, businessProfit: 30000, today: '2026-11-21' });
    expect([o.businessProfit, o.forecastChoice.key, o.coverage]).toEqual([30000, 'actual', 0]);
  });
});

describe('tax reserve routes', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const send = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };

  it('records money set aside and taken back, with a running balance', async () => {
    expect((await send('GET', '/api/tax/reserves/2026')).body).toEqual({ entries: [], setAside: '0.00', released: '0.00', balance: '0.00' });
    await send('POST', '/api/tax/reserves/2026', { kind: 'set_aside', amount: '500', date: '2026-04-01', note: 'Q1 savings' });
    const after = await send('POST', '/api/tax/reserves/2026', { kind: 'released', amount: '120.50', date: '2026-05-01' });
    expect(after.status).toBe(201);
    expect(after.body).toMatchObject({ setAside: '500.00', released: '120.50', balance: '379.50' });
    expect(after.body.entries.map((e) => [e.kind, e.date, e.note])).toEqual([['released', '2026-05-01', null], ['set_aside', '2026-04-01', 'Q1 savings']]);
    // Other years are separate.
    expect((await send('GET', '/api/tax/reserves/2025')).body.balance).toBe('0.00');
  });

  it('refuses taking back more than was set aside, and bad input', async () => {
    await send('POST', '/api/tax/reserves/2026', { kind: 'set_aside', amount: '100', date: '2026-04-01' });
    const over = await send('POST', '/api/tax/reserves/2026', { kind: 'released', amount: '100.01', date: '2026-04-02' });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/more than the \$100\.00 set aside for 2026/);
    for (const bad of [{ kind: 'paid', amount: '1', date: '2026-04-01' }, { kind: 'set_aside', amount: '0', date: '2026-04-01' }, { kind: 'set_aside', amount: '-5', date: '2026-04-01' },
      { kind: 'set_aside', amount: '1', date: '2026-02-30' }, { kind: 'set_aside', amount: '1', date: 'soon' }, { kind: 'set_aside', amount: '1.001', date: '2026-04-01' }, { kind: 'set_aside', amount: '1', date: '2026-04-01', user_id: 'x' }]) {
      expect((await send('POST', '/api/tax/reserves/2026', bad)).status).toBe(400);
    }
    expect(harness.db.taxReserveEntry).toHaveLength(1);
  });

  it('deletes entries, but not one that would leave more taken back than put in', async () => {
    const set = (await send('POST', '/api/tax/reserves/2026', { kind: 'set_aside', amount: '100', date: '2026-04-01' })).body.entries[0];
    const back = (await send('POST', '/api/tax/reserves/2026', { kind: 'released', amount: '60', date: '2026-04-02' })).body.entries[0];
    const blocked = await send('DELETE', `/api/tax/reserves/entry/${set.id}`);
    expect(blocked.status).toBe(400);
    expect((await send('DELETE', `/api/tax/reserves/entry/${back.id}`)).body.balance).toBe('100.00');
    expect((await send('DELETE', `/api/tax/reserves/entry/${set.id}`)).body.balance).toBe('0.00');
    expect((await send('DELETE', `/api/tax/reserves/entry/${set.id}`)).status).toBe(404);
  });

  it('keeps each user\'s ledger private and needs Schedule C on', async () => {
    harness.db.taxReserveEntry.push({ id: 'theirs', user_id: harness.ids.other, year: 2026, kind: 'set_aside', amount: 999, date: new Date('2026-01-01'), created_at: new Date() });
    expect((await send('GET', '/api/tax/reserves/2026')).body.balance).toBe('0.00');
    expect((await send('DELETE', '/api/tax/reserves/entry/theirs')).status).toBe(404);
    expect(harness.db.taxReserveEntry).toHaveLength(1);
    harness.db.user[0].schedule_c_enabled = false;
    expect((await send('GET', '/api/tax/reserves/2026')).status).toBe(403);
    expect((await send('POST', '/api/tax/reserves/2026', { kind: 'set_aside', amount: '1', date: '2026-01-01' })).status).toBe(403);
  });

  it('saves the projection choice with the tax profile, and the worksheet sends projection inputs', async () => {
    const saved = await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', forecast_method: 'target', profit_target: '42000' });
    expect(saved.body.profile).toMatchObject({ forecast_method: 'target', profit_target: 42000 });
    expect((await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', forecast_method: 'guess' })).status).toBe(400);
    const books = (await (await fetch(`${base}/api/schedule-c?year=2026`)).json()).books;
    expect(books.forecast).toMatchObject({ daysInYear: 365 });
    expect(books.forecast.monthly).toHaveLength(12);
    // The fixture's only sale (Sep 3, 2026): 2 x $150, less 2 units at
    // $101.92 ($520 batch less $10.40 of card rewards, over 5 units), less the
    // sale's $15 fee and $12 label.
    expect(books.forecast.monthly[8].profit).toBe(69.16);
  });
});
