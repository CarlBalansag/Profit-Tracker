import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { allocatedCost, heldSaleQuantity, roundCents } from '../../shared/finance.mjs';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { Decimal } = require('../services/money');
const { ids } = harness;

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
afterAll(() => server.close());

const json = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
const stats = async (query = 'mode=All&date=All%20Time') => (await json('GET', `/api/analytics/dashboard?${query}`)).body.stats;

// The same sums Inventory.jsx and Transactions.jsx do from GET /api/inventory.
const inventoryCard = (items) => roundCents(items.filter(i => i.qty_on_hand > 0).reduce((sum, i) => sum + allocatedCost(i, i.qty_on_hand), 0));
const transactionsCard = (items) => roundCents(items.reduce((sum, i) => {
  const onHandRow = i.qty_on_hand > 0 || !i.sales?.length
    ? allocatedCost(i, i.qty_on_hand > 0 ? i.qty_on_hand : i.qty_purchased - (i.refunded_qty || 0))
    : 0;
  return sum + onHandRow + (i.sales || []).reduce((rows, sale) => rows + allocatedCost(i, heldSaleQuantity(sale)), 0);
}, 0));

describe('Analytics reads the same exact money columns as every other page', () => {
  // A legacy row: the Float kept more precision than the 2dp Decimal mirror
  // that GET /api/inventory reports. Bought 3, so the drift adds up to a cent.
  const driftFixture = () => {
    const row = harness.db.inventory[0];
    Object.assign(row, { unit_purchase_cost: 12.3449, unit_purchase_cost_decimal: 12.34, qty_purchased: 3, qty_on_hand: 3, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0 });
    harness.db.sales.length = 0;
  };

  it('uses the Decimal mirror for inventory value and total cost', async () => {
    driftFixture();
    const dashboard = await stats();
    const items = (await json('GET', '/api/inventory')).body;
    expect(dashboard.inventoryValue).toBe(37.02);
    expect(inventoryCard(items)).toBe(dashboard.inventoryValue);
    expect(dashboard.totalCost).toBe(37.02);
  });

  it('applies to the all-inventory query used under a date or channel filter too', async () => {
    driftFixture();
    expect((await stats('mode=Marketplace&date=All%20Time')).inventoryValue).toBe(37.02);
    expect((await stats('mode=All&date=7%20Days')).inventoryValue).toBe(37.02);
  });

  it('uses the Decimal mirror for sale revenue and the cash-flow commission', async () => {
    const sale = harness.db.sales[0];
    Object.assign(sale, { unit_price: 150.0049, unit_price_decimal: 150, commission_fee: 15.004, commission_fee_decimal: 15 });
    const body = (await json('GET', '/api/analytics/dashboard?mode=All&date=All%20Time')).body;
    expect(body.stats.totalRevenue).toBe(273); // 2 x 150 - 15 fee - 12 label, on exact values
    expect(body.cashFlowTransactions[0].commission).toBe(15);
  });

  it('falls back to the Float on a row that has no mirror yet', async () => {
    expect((await stats()).inventoryValue).toBe(312); // fixture has no _decimal columns: 3 of 5 x $104
  });
});

describe('Transactions Total Cost matches Analytics purchase spend', () => {
  beforeEach(() => {
    Object.assign(harness.db.sales[0], { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT', restored_qty: 0 });
  });

  const expectBothMatch = async () => {
    const items = (await json('GET', '/api/inventory')).body;
    const dashboard = await stats();
    expect(transactionsCard(items)).toBe(dashboard.totalCost);
    return dashboard;
  };

  it('holds for a partly sold purchase', async () => {
    expect((await expectBothMatch()).totalCost).toBe(520);
  });

  it('does not count a cancelled sale twice once its units are back in stock', async () => {
    const before = await stats();
    const done = await json('POST', `/api/sales/${ids.sale}/actions/cancel_sale`, {});
    expect(done.status).toBe(200);
    const items = (await json('GET', '/api/inventory')).body;
    expect(items[0].qty_on_hand).toBe(5);
    expect(items[0].sales[0].restored_qty).toBe(2);
    const after = await expectBothMatch();
    expect(after.totalCost).toBe(before.totalCost);
    expect(after.inventoryValue).toBe(520);
  });

  it('keeps the cost on the sale row when a status edit leaves the units out of stock', async () => {
    const done = await json('PUT', `/api/sales/${ids.sale}`, { status: 'CANCELLED' });
    expect(done.status).toBe(200);
    const items = (await json('GET', '/api/inventory')).body;
    expect(items[0].qty_on_hand).toBe(3);
    await expectBothMatch();
  });

  it('holds for a partial return with units still out of stock', async () => {
    harness.db.sales[0].workflow_status = 'RETURN_IN_PROGRESS';
    expect((await json('POST', `/api/sales/${ids.sale}/actions/mark_returned`, { quantity: 1 })).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(4);
    await expectBothMatch();
  });

  it('holds after a buyer return and a store refund', async () => {
    const buyer = await json('POST', '/api/refunds', { sale_id: ids.sale, amount: 150, quantity: 1 });
    expect(buyer.status).toBe(200);
    const store = await json('POST', '/api/refunds', { inventory_id: ids.inventory, amount: 104, quantity: 1 });
    expect(store.status).toBe(200);
    await expectBothMatch();
  });

  it('holds when a sale is deleted after being cancelled', async () => {
    await json('POST', `/api/sales/${ids.sale}/actions/cancel_sale`, {});
    expect((await json('DELETE', `/api/sales/${ids.sale}`)).status).toBe(200);
    const items = (await json('GET', '/api/inventory')).body;
    expect(items[0].qty_on_hand).toBe(5);
    await expectBothMatch();
  });
});

describe('roundCents rounds like the API', () => {
  const apiRound = (value) => new Decimal(value).toDecimalPlaces(2).toNumber();

  it('rounds half a cent the same way, in both directions', () => {
    for (const value of ['10.005', '1.005', '1.015', '504.945', '3374.215', '0.125', '-10.005', '-1.005', '2.675']) {
      expect(roundCents(Number(value))).toBe(apiRound(value));
    }
  });

  it('is not thrown off by float noise from a long sum', () => {
    // 0.1 added 3 times is 0.30000000000000004; a half-cent total can land just under.
    const halves = Array.from({ length: 7 }, () => 10.005).reduce((sum, value) => sum + value, 0);
    expect(roundCents(halves)).toBe(70.04); // exact value 70.035
    expect(roundCents(1.00499)).toBe(1); // a real sub-half stays down
  });

  it('agrees with exact decimal summing on fractional allocations', () => {
    const rows = [[100.01, 3, 1], [20.01, 2, 1], [7.03, 7, 3], [1999.99, 6, 5], [0.05, 2, 1]];
    let float = 0;
    let exact = new Decimal(0);
    for (const [batch, kept, qty] of rows) {
      float += batch * qty / kept;
      exact = exact.plus(new Decimal(batch).times(qty).div(kept));
    }
    expect(roundCents(float)).toBe(exact.toDecimalPlaces(2).toNumber());
  });

  it('handles empty and zero input without a negative zero', () => {
    expect(roundCents(undefined)).toBe(0);
    expect(Object.is(roundCents(-0.001), 0)).toBe(true);
  });
});
