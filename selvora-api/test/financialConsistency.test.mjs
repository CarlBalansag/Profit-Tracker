import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());
const read = async path => {
  const response = await fetch(`${baseUrl}/api/${path}`);
  expect(response.status).toBe(200);
  return response.json();
};
describe('financial reporting consistency', () => {
  it('agrees on partial-sale cost/revenue/cashback and inventory value across reports', async () => {
    const analytics = await read('analytics/dashboard?mode=All&date=All%20Time');
    const credit = await read('creditcard/dashboard?month=2026-09');
    const receipts = await read('receipts');
    expect(analytics.stats).toMatchObject({ totalCost: 520, soldCost: 208, totalRevenue: 273, inventoryValue: 312 });
    expect(analytics.stats.profit).toBeCloseTo(69.16);
    expect(analytics.cashFlowTransactions[0]).toMatchObject({ cost: 208, revenue: 273, cashback: 4.16 });
    const card = credit.cards[0];
    expect(card.totalSpend).toBe(520);
    expect(card.items.find(item => item.saleId)).toMatchObject({ cost: 208, revenue: 273, cashback: 4.16, netPnl: 65 });
    expect(card.items.find(item => !item.saleId).cost).toBe(312);
    expect([...receipts.withReceipts, ...receipts.withoutReceipts].find(item => item.itemType === 'inventory').amount).toBe(520);
  });
  it('uses stored vendor overrides identically and does not change data on repeated reads', async () => {
    harness.db.paymentMethod[0].category_rates = JSON.stringify([{ store: 'QA Store', rate: 5 }]);
    const original = structuredClone(harness.db.inventory);
    for (let attempt = 0; attempt < 2; attempt++) {
      const analytics = await read('analytics/dashboard');
      const credit = await read('creditcard/dashboard?month=2026-09');
      expect(analytics.stats.profit).toBeCloseTo(75.4);
      expect(credit.cards[0].items.find(item => item.saleId).cashback).toBeCloseTo(10.4);
    }
    expect(harness.db.inventory).toEqual(original);
  });
  it('adds multiple purchases and split sales with omitted optional costs', async () => {
    const inventory = { ...harness.db.inventory[0], id: 'second', qty_purchased: 2, qty_on_hand: 0,
      unit_purchase_cost: 10, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0 };
    harness.db.inventory.push(inventory);
    for (let index = 0; index < 2; index++) harness.db.sales.push({ ...harness.db.sales[0], id: `split-${index}`,
      inventory_id: inventory.id, quantity: 1, unit_price: 20, commission_fee: 0, sale_shipping: 0 });
    const analytics = await read('analytics/dashboard');
    expect(analytics.stats).toMatchObject({ totalCost: 540, soldCost: 228, totalRevenue: 313, inventoryValue: 312 });
    expect(analytics.stats.profit).toBeCloseTo(89.56);
    expect((await read('creditcard/dashboard?month=2026-09')).cards[0].totalSpend).toBe(540);
  });
  it('returns zero totals for empty data', async () => {
    harness.db.sales.splice(0);
    harness.db.inventory.splice(0);
    const analytics = await read('analytics/dashboard');
    expect(analytics.stats).toMatchObject({ soldCost: 0, totalCost: 0, totalRevenue: 0, profit: 0, inventoryValue: 0 });
    expect((await read('creditcard/dashboard?month=2026-09')).cards[0].items).toEqual([]);
  });
});
