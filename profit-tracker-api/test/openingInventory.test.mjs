// Stock not entered as purchases ("opening inventory"): one December 31 amount
// per tax year, carried forward until changed, added to Schedule C Part III.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { scheduleCBooks, untrackedInventory } = require('../services/scheduleCBooks');

const worksheet = { returns_and_allowances: { total: '0.00' }, total: '0.00', automatic: { total: '0.00' }, rows: [] };
const part3 = (books, n) => books.partIII.find((l) => l.line === n).amount;
const row = (year, amount) => ({ year, untracked_inventory_end: amount });
// One tracked purchase in 2026: 2 units at $10, one sold for $25.
const tracked = [{ id: 'B', product_name: 'Cable', purchase_date: '2026-02-20T12:00:00Z', unit_purchase_cost: 10, qty_purchased: 2, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, refunded_amount: 0, refunded_qty: 0, cashback_rate: 0, cashback_earned: 0,
  sales: [{ id: 's', quantity: 1, unit_price: 25, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0, status: 'SOLD', platform: { name: 'eBay' }, sale_date: '2026-03-01T12:00:00Z', paid_at: null, sale_tax_collected: 0 }] }];

describe('untrackedInventory (carry forward)', () => {
  it('is zero with nothing entered', () => {
    expect(untrackedInventory([], 2026)).toEqual({ start: '0.00', end: '0.00', startEntered: null, endEntered: null });
  });

  it('uses last December 31 as January 1, and carries it when this year has none', () => {
    expect(untrackedInventory([row(2025, '500')], 2026)).toEqual({ start: '500.00', end: '500.00', startEntered: '500.00', endEntered: null });
    // Two years later, still carried from 2025.
    expect(untrackedInventory([row(2025, '500')], 2027)).toEqual({ start: '500.00', end: '500.00', startEntered: null, endEntered: null });
  });

  it('takes this year\'s own amount, including an explicit zero, and ignores cleared years', () => {
    expect(untrackedInventory([row(2025, '500'), row(2026, '0')], 2026)).toMatchObject({ start: '500.00', end: '0.00', endEntered: '0.00' });
    expect(untrackedInventory([row(2025, '500'), row(2026, null)], 2026)).toMatchObject({ end: '500.00', endEntered: null });
    // Later years never leak into an earlier one.
    expect(untrackedInventory([row(2027, '90')], 2026)).toMatchObject({ start: '0.00', end: '0.00' });
  });
});

describe('Schedule C books with stock not in ProfitTracker', () => {
  it('adds it to beginning and ending inventory', () => {
    // Jan 1 $500, Dec 31 $200: $300 of it was sold. Tracked: $20 bought, $10 left.
    const books = scheduleCBooks({ inventories: tracked, year: 2026, worksheet, untracked: untrackedInventory([row(2025, '500'), row(2026, '200')], 2026) });
    expect([part3(books, '35'), part3(books, '36'), part3(books, '41'), part3(books, '42')]).toEqual(['500.00', '20.00', '210.00', '310.00']);
    expect(books.netProfit).toBe('-285.00'); // 25 - 310
    expect(books.untracked).toMatchObject({ start: '500.00', end: '200.00', trackedBeginning: '0.00' });
    expect(books.notes.join(' ')).toMatch(/Beginning inventory includes \$500\.00 of stock that isn't entered/);
    expect(books.notes.join(' ')).not.toMatch(/treated as still on hand/);
    const sum = Number(books.reconciliation.appProfitAfterExpenses) + books.reconciliation.differences.reduce((t, d) => t + Number(d.amount), 0);
    expect(sum).toBeCloseTo(Number(books.netProfit), 2);
  });

  it('treats carried stock as still on hand, and says so', () => {
    const books = scheduleCBooks({ inventories: tracked, year: 2026, worksheet, untracked: untrackedInventory([row(2025, '500')], 2026) });
    expect([part3(books, '35'), part3(books, '41'), part3(books, '42')]).toEqual(['500.00', '510.00', '10.00']);
    expect(books.notes.join(' ')).toMatch(/all \$500\.00 of it is treated as still on hand/);
  });

  it('points to the new field when there is no earlier history', () => {
    const books = scheduleCBooks({ inventories: tracked, year: 2026, worksheet });
    expect(books.notes.join(' ')).toMatch(/add what it cost you under "Stock not in ProfitTracker"/);
    expect(books.checks.negativeCogs).toBe(false);
  });

  it('flags cost of goods sold below zero', () => {
    // Dec 31 entered with nothing on Jan 1 and no matching purchase.
    const books = scheduleCBooks({ inventories: [], year: 2025, worksheet, untracked: untrackedInventory([row(2025, '500')], 2025) });
    expect(part3(books, '42')).toBe('-500.00');
    expect(books.checks.negativeCogs).toBe(true);
  });
});

describe('PUT /api/schedule-c/years/:year', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const put = async (year, body) => {
    const res = await fetch(`${base}/api/schedule-c/years/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const books = async (year) => (await (await fetch(`${base}/api/schedule-c?year=${year}`)).json()).books;

  it('saves, updates in place and clears one amount per year', async () => {
    expect((await put(2025, { untracked_inventory_end: '500' })).body).toMatchObject({ year: 2025, untracked_inventory_end: '500', home_office_sq_ft: null });
    await put(2025, { untracked_inventory_end: 450.25 });
    expect(harness.db.taxYearSetting).toHaveLength(1);
    expect(harness.db.taxYearSetting[0]).toMatchObject({ user_id: harness.ids.user, year: 2025, untracked_inventory_end: 450.25 });
    let b = await books(2026);
    expect(b.untracked).toMatchObject({ start: '450.25', startEntered: '450.25', end: '450.25', endEntered: null });
    expect(b.partIII.find((l) => l.line === '35').amount).toBe('450.25');
    await put(2025, { untracked_inventory_end: '' });
    expect(harness.db.taxYearSetting[0].untracked_inventory_end).toBeNull();
    b = await books(2026);
    expect(b.untracked.start).toBe('0.00');
  });

  it('rejects bad input and saves nothing', async () => {
    expect((await put(2025, {})).status).toBe(400);
    expect((await put(2025, { untracked_inventory_end: -1 })).status).toBe(400);
    expect((await put(2025, { untracked_inventory_end: '1.005' })).status).toBe(400);
    expect((await put(2025, { untracked_inventory_end: 5, user_id: harness.ids.other })).status).toBe(400);
    expect((await put('25', { untracked_inventory_end: 5 })).status).toBe(400);
    expect((await put('abcd', { untracked_inventory_end: 5 })).status).toBe(400);
    expect(harness.db.taxYearSetting).toHaveLength(0);
  });

  it('needs Schedule C turned on', async () => {
    harness.db.user[0].schedule_c_enabled = false;
    expect((await put(2025, { untracked_inventory_end: 5 })).status).toBe(403);
    expect(harness.db.taxYearSetting).toHaveLength(0);
  });

  it('never reads or changes another user\'s amounts', async () => {
    harness.db.taxYearSetting.push({ id: 'other-row', user_id: harness.ids.other, year: 2025, untracked_inventory_end: 9999 });
    expect((await books(2026)).untracked.start).toBe('0.00');
    await put(2025, { untracked_inventory_end: 10 });
    expect(harness.db.taxYearSetting.find((r) => r.id === 'other-row').untracked_inventory_end).toBe(9999);
    expect(harness.db.taxYearSetting.filter((r) => r.user_id === harness.ids.user)).toHaveLength(1);
  });
});
