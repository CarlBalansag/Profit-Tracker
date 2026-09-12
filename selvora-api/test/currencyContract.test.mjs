import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const finance = await createRequire(import.meta.url)('../services/finance.js');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());
const read = async path => { const result = await fetch(`${base}/api/${path}`, { headers: { 'X-Currency-Format': 'decimal' } }); expect(result.status).toBe(200); return result.json(); };
describe('currency calculation and response contract', () => {
  it('returns normalized monetary/rate strings while retaining integer quantities and legacy numeric compatibility', async () => {
    const record = (await read('inventory'))[0];
    expect(record.unit_purchase_cost).toBe('100.00');
    expect(record.qty_purchased).toBe(5);
    expect(record.payment_method.default_cashback_rate).toBe('2.000000');
    const legacy = await (await fetch(`${base}/api/inventory`)).json();
    expect(legacy[0].unit_purchase_cost).toBe(100);
  });
  it('prefers additive decimal fields and keeps unit-goal targets as counts', async () => {
    harness.db.inventory[0].unit_purchase_cost = 1.234567;
    harness.db.inventory[0].unit_purchase_cost_decimal = '1.23';
    expect((await read('inventory'))[0].unit_purchase_cost).toBe('1.23');
    harness.db.goal.push({ id: 'goal', user_id: harness.ids.user, metric: 'unitsSold', target_7d: 3 });
    expect((await read('goals'))[0].target_7d).toBe(3);
  });
  it('reconciles three split sales, cashback, inventory, trends, receipts and card reports to exact cents', async () => {
    Object.assign(harness.db.inventory[0], { unit_purchase_cost: 3.33, qty_purchased: 3, qty_on_hand: 0, fees: 0.01, sales_tax: 0, shipping_cost_inbound: 0, gift_card_amount: 0 });
    const template = harness.db.sales[0];
    harness.db.sales.splice(0, harness.db.sales.length, ...[1, 2, 3].map(day => ({ ...template, id: `split-${day}`, quantity: 1, unit_price: 4, commission_fee: 0, sale_shipping: 0, sale_date: new Date(`2026-09-0${day}T12:00:00Z`) })));
    const analytics = await read('analytics/dashboard?mode=All&date=All%20Time');
    expect(analytics.stats).toMatchObject({ totalCost: '10.00', soldCost: '10.00', totalRevenue: '12.00', inventoryValue: '0.00', profit: '2.20' });
    const sorted = analytics.cashFlowTransactions.sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted.map(row => row.cost)).toEqual(['3.33', '3.34', '3.33']);
    expect(sorted.map(row => row.cashback)).toEqual(['0.07', '0.06', '0.07']);
    expect(analytics.trend[0].netProfit).toBe('2.20');
    const card = (await read('creditcard/dashboard?month=2026-09')).cards[0];
    expect(card.totalSpend).toBe('10.00');
    expect(card.cashbackEarned).toBe('0.20');
    expect(finance.sumMoney(...card.items.map(item => item.cost))).toBe(10);
  });
  it('reconciles partial allocations and cancellation without mutating input order', () => {
    const record = { unit_purchase_cost: 3.33, fees: 0.01, qty_purchased: 3, qty_on_hand: 1,
      sales: [{ id: 'b', sale_date: '2026-09-02', quantity: 1, unit_price: 4 }, { id: 'a', sale_date: '2026-09-01', quantity: 1, unit_price: 4 }] };
    expect(finance.saleEconomics(record, record.sales[0]).cost).toBe(3.34);
    expect(finance.sumMoney(finance.realizedSummary(record, record.sales).cost, finance.allocatedCost(record, 1))).toBe(10);
    record.sales[0].status = 'CANCELLED';
    expect(finance.realizedSummary(record, record.sales).cost).toBe(3.33);
    expect(record.sales[0].id).toBe('b');
  });
  it('avoids accumulated tenths and fails explicitly outside the supported exact numeric contract range', () => {
    expect(finance.sumMoney(...Array(100).fill(0.01))).toBe(1);
    expect(() => finance.sumMoney('999999999999.99', '0.01')).toThrow('range');
  });
});
