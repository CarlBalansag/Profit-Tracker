import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { derivedExpenseLines } = require('../services/derivedExpenses.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => harness.reset());
afterAll(() => server.close());

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};
const get = (path) => request('GET', path);
const sum = (lines) => Math.round(lines.reduce((total, line) => total + line.amount, 0) * 100) / 100;
const byCategory = (lines, category) => lines.filter((line) => line.category === category);

describe('GET /api/expenses/derived', () => {
  it('returns one read-only line per non-zero purchase and sale cost, labeled with the product', async () => {
    const res = await get('/api/expenses/derived');
    expect(res.status).toBe(200);
    // Fixture: tax 40, inbound shipping 20, fees 10 on the purchase; label 12, commission 15 on the sale.
    expect(res.body.map((line) => [line.name, line.category, line.amount, line.source])).toEqual([
      ['QA Multi-unit Sneaker · Platform fee', 'SALE_PLATFORM_FEE', 15, 'sale'],
      ['QA Multi-unit Sneaker · Shipping label', 'SHIPPING_LABEL', 12, 'sale'],
      ['QA Multi-unit Sneaker · Purchase fee', 'PURCHASE_FEE', 10, 'purchase'],
      ['QA Multi-unit Sneaker · Inbound shipping', 'INBOUND_SHIPPING', 20, 'purchase'],
      ['QA Multi-unit Sneaker · Sales tax', 'PURCHASE_TAX', 40, 'purchase'],
    ]);
    for (const line of res.body) {
      expect(line.readonly).toBe(true);
      expect(line.inventory_id).toBe(harness.ids.inventory);
    }
    const purchaseLine = res.body.find((line) => line.source === 'purchase');
    expect(new Date(purchaseLine.date).toISOString()).toBe('2026-09-01T12:00:00.000Z');
    expect(purchaseLine.payment_method).toMatchObject({ id: harness.ids.card, name: 'QA Credit Card' });
    const saleLine = res.body.find((line) => line.source === 'sale');
    expect(saleLine.sale_id).toBe(harness.ids.sale);
    expect(new Date(saleLine.date).toISOString()).toBe('2026-09-03T12:00:00.000Z');
  });

  it('hides gift cards and zero-amount costs', async () => {
    Object.assign(harness.db.inventory[0], { sales_tax: 0, fees: 0 });
    harness.db.sales[0].commission_fee = 0;
    const res = await get('/api/expenses/derived');
    expect(res.body.map((line) => line.category).sort()).toEqual(['INBOUND_SHIPPING', 'SHIPPING_LABEL']);
    expect(res.body.some((line) => /gift/i.test(line.name))).toBe(false);
  });

  it.each(['CANCELLED', 'RETURNED', 'DISPUTED'])('excludes %s sales (either status column) but keeps the purchase lines', async (status) => {
    harness.db.sales[0].status = status;
    let res = await get('/api/expenses/derived');
    expect(res.body.filter((line) => line.source === 'sale')).toEqual([]);
    expect(res.body.filter((line) => line.source === 'purchase')).toHaveLength(3);

    harness.db.sales[0].status = 'SOLD';
    harness.db.sales[0].workflow_status = status;
    res = await get('/api/expenses/derived');
    expect(res.body.filter((line) => line.source === 'sale')).toEqual([]);
  });

  it('lists multiple partial sales of one batch separately, each with its own full sale costs', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', quantity: 1, sale_shipping: 7.35, commission_fee: 0.1, sale_date: new Date('2026-09-10T12:00:00Z') });
    const res = await get('/api/expenses/derived');
    expect(sum(byCategory(res.body, 'SHIPPING_LABEL'))).toBe(19.35);
    expect(sum(byCategory(res.body, 'SALE_PLATFORM_FEE'))).toBe(15.1);
    // Purchase costs are listed once per batch, not once per sale.
    expect(byCategory(res.body, 'PURCHASE_TAX')).toHaveLength(1);
    expect(res.body[0].date).toBe('2026-09-10T12:00:00.000Z');
  });

  it('reflects edits and deletes on the next read without any stored copy', async () => {
    const before = harness.db.expense.length;
    harness.db.inventory[0].sales_tax = 12.34;
    let res = await get('/api/expenses/derived');
    expect(byCategory(res.body, 'PURCHASE_TAX')[0].amount).toBe(12.34);

    const deleted = await request('DELETE', `/api/inventory/${harness.ids.inventory}`);
    expect(deleted.status).toBe(200);
    res = await get('/api/expenses/derived');
    expect(res.body).toEqual([]);
    expect(harness.db.expense.length).toBe(before);
  });

  it('never returns another user\'s purchases or sales', async () => {
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: harness.ids.other, product_name: 'Private item' });
    harness.db.sales.push({ ...harness.db.sales[0], id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inventory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    const res = await get('/api/expenses/derived');
    expect(res.body.some((line) => line.name.startsWith('Private item'))).toBe(false);
    expect(res.body).toHaveLength(5);
  });

  it('requires authentication', async () => {
    const response = await fetch(`${baseUrl}/api/expenses/derived`, { headers: { 'x-qa-unauthenticated': 'true' } });
    expect(response.status).toBe(401);
  });

  it('does not add computed lines to GET /api/expenses, Schedule C, or the stored expense table', async () => {
    const manual = await get('/api/expenses');
    expect(manual.body.map((expense) => expense.name)).toEqual(['QA Storage']);
    harness.db.user[0].schedule_c_enabled = true;
    const scheduleC = await get('/api/schedule-c?year=2026');
    expect(scheduleC.body.rows.map((row) => row.name)).toEqual(['QA Storage']);
  });

  it('agrees with the Dashboard totals the same costs already feed', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', quantity: 1, sale_shipping: 3.3, commission_fee: 4.4 });
    harness.db.sales.push({ ...harness.db.sales[0], id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', quantity: 1, status: 'CANCELLED', sale_shipping: 99, commission_fee: 99 });
    const lines = (await get('/api/expenses/derived')).body;
    const { stats } = (await get('/api/analytics/dashboard?mode=All&date=All%20Time')).body;
    expect(sum(byCategory(lines, 'SHIPPING_LABEL'))).toBe(stats.saleShipping);
    expect(sum(byCategory(lines, 'SALE_PLATFORM_FEE'))).toBe(stats.commissionFees);
    expect(sum(byCategory(lines, 'PURCHASE_TAX'))).toBe(stats.totalTax);
    // Purchase spend = item cost + every purchase line - gift card.
    const inv = harness.db.inventory[0];
    const purchaseLines = sum(lines.filter((line) => line.source === 'purchase'));
    expect(inv.unit_purchase_cost * inv.qty_purchased + purchaseLines - inv.gift_card_amount).toBe(stats.totalCost);
  });
});

describe('derivedExpenseLines (pure)', () => {
  it('prefers exact Decimal columns and rounds to cents', () => {
    const lines = derivedExpenseLines([{
      id: 'inv', product_name: 'Thing', purchase_date: '2026-01-01', sales_tax: 0.30000000000000004, sales_tax_decimal: { toNumber: () => 0.3 },
      shipping_cost_inbound: 1.005, fees: 0, sales: [],
    }]);
    expect(lines.map((line) => line.amount)).toEqual([1.01, 0.3]);
    expect(lines.every((line) => !('sales_tax_decimal' in line))).toBe(true);
  });

  it('falls back to a placeholder name and handles empty input', () => {
    expect(derivedExpenseLines([])).toEqual([]);
    expect(derivedExpenseLines([{ id: 'x', purchase_date: '2026-01-01', fees: 5 }])[0].name).toBe('Untitled item · Purchase fee');
  });
});
