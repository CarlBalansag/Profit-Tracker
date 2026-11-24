// The store account on reads: Store ROI's per-account rows
// (vendorBreakdown[].accounts) and the account on each "Owed to you" sale.
// Harness data: QA Store has one purchase of 5 for $520 (2 sold, $69.16 profit).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { splitToCents } = require('../services/storeAccounts');
const { Decimal } = require('../services/decimalFinance');

const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const BUSINESS = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const FOREIGN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  harness.reset();
  const { db, ids } = harness;
  db.account.push(
    { id: MAIN, user_id: ids.user, platform_id: ids.vendor, name: 'Main', email: 'main-login@example.invalid', username: 'main-login', status: 'Active' },
    { id: BUSINESS, user_id: ids.user, platform_id: ids.vendor, name: 'Business', email: 'biz-login@example.invalid', username: 'biz-login', status: 'Active' },
    { id: FOREIGN, user_id: ids.other, platform_id: ids.foreign, name: 'Not yours', email: 'private@example.invalid', status: 'Active' },
  );
});

let n = 0;
// A purchase with one sale of `sold` units; no card, tax, shipping or fees.
function buy({ account, cost = 10, qty = 1, sold = qty, price = 15, vendor = harness.ids.vendor, bought = '2026-09-01', soldOn = '2026-09-03', inv = {} }) {
  const { db } = harness;
  n += 1;
  const id = `split-inv-${n}`;
  db.inventory.push({
    ...db.inventory[0], id, product_name: id, vendor_id: vendor, account_id: account, payment_method_id: null,
    unit_purchase_cost: cost, qty_purchased: qty, qty_on_hand: qty - sold, sales_tax: 0, shipping_cost_inbound: 0,
    fees: 0, gift_card_amount: 0, cashback_earned: 0, purchase_date: new Date(`${bought}T12:00:00Z`), ...inv,
  });
  if (sold) {
    db.sales.push({
      ...db.sales[0], id: `split-sale-${n}`, inventory_id: id, quantity: sold, unit_price: price,
      commission_fee: 0, sale_shipping: 0, sale_tax_collected: 0, sale_date: new Date(`${soldOn}T12:00:00Z`),
    });
  }
  return id;
}

const get = async (path) => (await fetch(`${baseUrl}${path}`)).json();
const store = async (query = 'mode=All&date=All%20Time', name = 'QA Store') =>
  (await get(`/api/analytics/dashboard?${query}`)).vendorBreakdown.find((v) => v.name === name);
const account = (row, name) => row.accounts.find((a) => a.name === name);
const cents = (v) => Math.round(v * 100);

// Every figure the card shows, and those behind them, sums to the store's.
function expectAddsUp(row) {
  ['spend', 'soldCost', 'soldRevenue', 'profit'].forEach((field) => {
    expect(row.accounts.reduce((sum, a) => sum + cents(a[field]), 0), field).toBe(cents(row[field]));
  });
  ['unitsSold', 'units', 'purchases'].forEach((field) => {
    expect(row.accounts.reduce((sum, a) => sum + a[field], 0), field).toBe(row[field]);
  });
}

describe('Store ROI account split', () => {
  it('lists each account with the store\'s own figures, best first and "No account" last', async () => {
    buy({ account: MAIN, cost: 100, qty: 2, sold: 1, price: 130 });
    buy({ account: BUSINESS, cost: 50, qty: 3, sold: 3, price: 70 });
    const row = await store();
    // The harness purchase ($69.16 profit) has no account: last despite the most profit.
    expect(row.accounts.map((a) => a.name)).toEqual(['Business', 'Main', 'No account']);
    expect(account(row, 'Business')).toEqual({
      id: BUSINESS, name: 'Business', spend: 150, units: 3, purchases: 1, avgCostPerUnit: 50,
      soldCost: 150, soldRevenue: 210, profit: 60, unitsSold: 3, roi: 40,
    });
    expect(account(row, 'Main')).toMatchObject({ spend: 200, unitsSold: 1, profit: 30, roi: 30, avgCostPerUnit: 100 });
    expect(account(row, 'No account')).toMatchObject({ id: null, spend: 520, unitsSold: 2, profit: 69.16 });
    expectAddsUp(row);
  });

  it('leaves the store\'s own row exactly as it was', async () => {
    buy({ account: MAIN, cost: 100, qty: 2, sold: 1, price: 130 });
    buy({ account: BUSINESS, cost: 50, qty: 3, sold: 3, price: 70 });
    const { accounts, ...split } = await store();
    harness.db.inventory.forEach((inv) => { inv.account_id = null; });
    const { accounts: none, ...plain } = await store();
    expect(accounts).toHaveLength(3);
    expect(none).toEqual([]);
    expect(split).toEqual(plain);
  });

  it('has no split for one account, even alongside purchases with none', async () => {
    buy({ account: MAIN });
    expect((await store()).accounts).toEqual([]);
    harness.db.inventory[0].account_id = MAIN;
    expect((await store()).accounts).toEqual([]);
  });

  it('has no split for a store whose purchases have no account', async () => {
    buy({ account: null });
    expect((await store()).accounts).toEqual([]);
  });

  it('keeps a losing account red beside a winning one', async () => {
    buy({ account: MAIN, cost: 100, price: 60 });
    buy({ account: BUSINESS, cost: 100, price: 150 });
    const row = await store();
    expect(account(row, 'Main')).toMatchObject({ profit: -40, roi: -40 });
    expect(account(row, 'Business')).toMatchObject({ profit: 50, roi: 50 });
    expectAddsUp(row);
  });

  it('gives no ROI to an account that spent nothing, like a store would', async () => {
    buy({ account: MAIN, cost: 0, price: 20 });
    buy({ account: BUSINESS, cost: 10, price: 20 });
    const row = await store();
    expect(account(row, 'Main')).toMatchObject({ spend: 0, avgCostPerUnit: 0, profit: 20, roi: null });
    expectAddsUp(row);
  });

  it('lists an account with spend but nothing sold, so spend still adds up', async () => {
    buy({ account: MAIN, cost: 30, qty: 2, sold: 0 });
    buy({ account: BUSINESS });
    const row = await store();
    expect(account(row, 'Main')).toMatchObject({ spend: 60, unitsSold: 0, profit: 0, roi: null });
    expectAddsUp(row);
  });

  it('adds up to the cent when the exact parts round the same way', async () => {
    // Three thirds of a $10.00 batch each sold alone: 3.333… cost a piece.
    [MAIN, BUSINESS, null].forEach((acct) => buy({ account: acct, cost: 3.33, qty: 3, sold: 1, price: 4.005, inv: { sales_tax: 0.01 } }));
    const row = await store();
    expect(row.accounts).toHaveLength(3);
    expectAddsUp(row);
  });

  it('nets a store refund and a buyer refund into the right account', async () => {
    const id = buy({ account: MAIN, cost: 100, qty: 2, sold: 1, price: 150, inv: { refunded_amount: 20 } });
    harness.db.sales.find((s) => s.inventory_id === id).refunded_amount = 10;
    buy({ account: BUSINESS, cost: 100, price: 150 });
    const row = await store();
    expect(account(row, 'Main')).toMatchObject({ spend: 180, profit: 50 });
    expect(account(row, 'Business')).toMatchObject({ spend: 100, profit: 50 });
    expectAddsUp(row);
  });

  it('leaves a cancelled sale out of its account', async () => {
    const id = buy({ account: MAIN });
    harness.db.sales.find((s) => s.inventory_id === id).status = 'CANCELLED';
    buy({ account: BUSINESS });
    const row = await store();
    expect(account(row, 'Main')).toMatchObject({ unitsSold: 0, profit: 0, spend: 10 });
    expectAddsUp(row);
  });

  it('counts only the accounts used in the period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    buy({ account: MAIN, bought: today, soldOn: today });
    buy({ account: BUSINESS, bought: '2020-01-01', soldOn: '2020-01-02' });
    expect((await store('mode=All&date=7%20Days')).accounts).toEqual([]);
    // Bought long ago but sold this week: it made money in the period.
    buy({ account: BUSINESS, cost: 5, price: 9, bought: '2020-01-01', soldOn: today });
    const row = await store('mode=All&date=7%20Days');
    expect(account(row, 'Business')).toMatchObject({ spend: 0, unitsSold: 1, profit: 4, roi: 80 });
    expect(account(row, 'Main')).toMatchObject({ spend: 10, unitsSold: 1 });
    expectAddsUp(row);
  });

  it('follows the Cashout / Marketplace filter', async () => {
    buy({ account: MAIN, cost: 10, qty: 4, sold: 1 });
    buy({ account: BUSINESS });
    const row = await store('mode=Marketplace&date=All%20Time');
    expect(account(row, 'Main')).toMatchObject({ spend: 10, units: 1 }); // cost of the unit that sold
    expectAddsUp(row);
    expect(await store('mode=Cashout&date=All%20Time')).toBeUndefined();
  });

  it('splits each store on its own', async () => {
    const other = { id: 'second-store', user_id: harness.ids.user, name: 'Second Store', type: 'Vendor', fee_pct: 0 };
    harness.db.platform.push(other);
    buy({ account: MAIN });
    buy({ account: BUSINESS });
    buy({ account: null, vendor: other.id });
    expect((await store()).accounts).toHaveLength(3);
    expect((await store(undefined, 'Second Store')).accounts).toEqual([]);
  });

  it('never names another user\'s account: its purchases count as no account', async () => {
    buy({ account: MAIN });
    buy({ account: BUSINESS });
    buy({ account: FOREIGN, price: 99 });
    const body = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = body.vendorBreakdown.find((v) => v.name === 'QA Store');
    expect(row.accounts.map((a) => a.name)).toEqual(['Business', 'Main', 'No account']);
    expectAddsUp(row);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('Not yours');
    expect(raw).not.toContain('login'); // no account email or username anywhere
  });
});

describe('splitToCents', () => {
  const d = (values) => values.map((v) => new Decimal(v));
  const sums = (parts, total) => splitToCents(d(parts), total).reduce((s, v) => s + Math.round(v * 100), 0);

  it('leaves parts alone when their rounding already adds up', () => {
    expect(splitToCents(d(['1.25', '-3.5', '0']), -2.25)).toEqual([1.25, -3.5, 0]);
  });
  it('moves the spare cent to the part rounding changed most', () => {
    expect(splitToCents(d(['0.004', '0.0049']), 0.01)).toEqual([0, 0.01]);
    expect(splitToCents(d(['0.005', '0.005']), 0.01)).toEqual([0, 0.01]);
  });
  it('adds up for losses too', () => {
    expect(sums(['-0.005', '-0.005', '-0.005'], -0.02)).toBe(-2);
    expect(sums(['3.333333', '3.333333', '3.333334'], 10)).toBe(1000);
  });
});

describe('Owed to you', () => {
  const owedItem = async (id) => (await get('/api/analytics/cashflow')).owed.flatMap((g) => g.items).find((i) => i.product === id);

  it('names the store account each owed item was bought on, and nothing else about it', async () => {
    const id = buy({ account: BUSINESS });
    expect((await owedItem(id)).account).toBe('Business');
    const raw = JSON.stringify(await get('/api/analytics/cashflow'));
    expect(raw).not.toContain('login');
    expect(raw).not.toContain(BUSINESS);
  });

  it('is null without an account, or with one that is not the user\'s', async () => {
    expect((await owedItem('QA Multi-unit Sneaker')).account).toBeNull();
    expect((await owedItem(buy({ account: FOREIGN }))).account).toBeNull();
  });
});
