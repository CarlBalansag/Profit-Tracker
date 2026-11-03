import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
const shared = await import('../../shared/finance.mjs');
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

const request = async (method, path, body) => {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: body ? JSON.stringify(body) : undefined });
  return response.json();
};
const get = (path) => request('GET', `/api/${path}`);
const refund = async (body) => {
  const res = await fetch(`${base}/api/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  expect(res.status).toBe(200);
};
let rpc = 1;
const tool = async (name, args) => JSON.parse((await request('POST', '/mcp', { jsonrpc: '2.0', id: rpc++, method: 'tools/call', params: { name, arguments: args } })).result.content[0].text);
const stats = async () => (await get('analytics/dashboard?mode=All&date=All%20Time')).stats;
const card = async (month) => (await get(`creditcard/dashboard?month=${month}`)).cards.find(c => c.id === ids.card);
const near = (a, b) => expect(Math.round(a * 100)).toBe(Math.round(b * 100));

// Fixture: 5 units bought 2026-09-01 on "QA Credit Card" (2% cashback) for $520 all-in
// (5 x $100 + $40 tax + $20 shipping + $10 fees - $50 gift card); 3 on hand.
// Sale 2026-09-03: 2 units x $150, $15 fee, $12 label.

describe('refunds: every screen agrees', () => {
  it('baseline before any refund', async () => {
    expect(await stats()).toMatchObject({ totalCost: 520, soldCost: 208, totalRevenue: 273, inventoryValue: 312 });
  });

  it('a store return lowers cost everywhere, but the card shows it as a credit in the refund month', async () => {
    await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1, date: '2026-10-05' });
    // Batch now $416 over the 4 units kept = $104 each.
    const s = await stats();
    expect(s).toMatchObject({ totalCost: 416, soldCost: 208, totalRevenue: 273, inventoryValue: 208 });
    near(s.totalCashback, 8.32);
    // Cost is conserved: what's still in stock + what was sold = what the batch cost after refunds.
    expect(s.inventoryValue + s.soldCost).toBe(s.totalCost);

    const sept = await card('2026-09');
    expect(sept).toMatchObject({ totalSpend: 520, cashbackEarned: 10.4, pendingCount: 2 });
    const oct = await card('2026-10');
    expect(oct).toMatchObject({ totalSpend: -104, cashbackEarned: -2.08, txnCount: 1 });
    expect(oct.items).toEqual([expect.objectContaining({ kind: 'refund', product: 'QA Multi-unit Sneaker · Refund', cost: -104, cashback: -2.08 })]);
    // Lifetime spend on the card nets the refund out, matching the two months together.
    const methods = await get('payment-methods');
    expect(methods.find(m => m.id === ids.card).total_spend).toBe(sept.totalSpend + oct.totalSpend);
    // The receipt still shows what was charged.
    const receipts = await get('receipts');
    expect([...receipts.withReceipts, ...receipts.withoutReceipts].find(r => r.itemType === 'inventory').amount).toBe(520);
  });

  it('a buyer return comes off revenue and puts the unit back in stock at cost', async () => {
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1, date: '2026-09-20' });
    const s = await stats();
    // Revenue 300 - 15 fee - 12 label - 150 refund; one unit kept by the buyer.
    expect(s).toMatchObject({ totalCost: 520, soldCost: 104, totalRevenue: 123, inventoryValue: 416, unitsSold: 1 });
    expect(s.inventoryValue + s.soldCost).toBe(s.totalCost);
    // Fees and the label stay as costs on the Expenses tab.
    const lines = await get('expenses/derived');
    expect(lines.filter(l => l.source === 'sale').map(l => l.amount).sort()).toEqual([12, 15]);
    // The card isn't affected by a refund to a buyer.
    expect((await card('2026-09')).totalSpend).toBe(520);
  });

  it('a partial refund where the buyer keeps the item only lowers revenue', async () => {
    await refund({ sale_id: ids.sale, amount: 50 });
    expect(await stats()).toMatchObject({ totalCost: 520, soldCost: 208, totalRevenue: 223, inventoryValue: 312, unitsSold: 2 });
  });

  it('both kinds together, and the AI assistant, the shared browser formulas and the Dashboard all agree', async () => {
    await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1, date: '2026-10-05' });
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1, date: '2026-09-20' });
    const s = await stats();
    expect(s).toMatchObject({ totalCost: 416, soldCost: 104, totalRevenue: 123, inventoryValue: 312, unitsSold: 1 });
    expect(s.inventoryValue + s.soldCost).toBe(s.totalCost);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);

    // The browser's formulas (shared/finance.mjs) on the same records.
    const inv = (await get('inventory')).find(i => i.id === ids.inventory);
    const summary = shared.realizedSummary(inv, inv.sales);
    near(summary.cost, s.soldCost);
    near(summary.revenue, s.totalRevenue);
    near(summary.netProfit, s.profit);
    near(shared.allocatedCost(inv, inv.qty_on_hand), s.inventoryValue);

    // The AI assistant's profit tool.
    const profit = await tool('get_item_profit', { purchase_id: ids.inventory });
    expect(profit).toMatchObject({ units_bought: 4, units_sold: 1, units_on_hand: 3, revenue: 300, fees: 15, shipping: 12, refunds_to_buyers: 150, cost_of_units_sold: 104, total_cost: 416 });
    near(profit.net_profit, s.profit);
  });

  it('deleting the refunds puts every total back', async () => {
    const before = await stats();
    await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1, date: '2026-10-05' });
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 });
    for (const r of [...harness.db.refund]) {
      const res = await fetch(`${base}/api/refunds/${r.id}`, { method: 'DELETE' });
      expect(res.status).toBe(200);
    }
    expect(await stats()).toEqual(before);
    expect((await card('2026-10')).totalSpend).toBe(0);
  });

  it('a snapshot cashback amount shrinks in proportion to a store refund', async () => {
    Object.assign(harness.db.inventory[0], { cashback_rate: 5, cashback_earned: 26 }); // 5% of $520
    await refund({ inventory_id: ids.inventory, amount: 52 });
    near((await stats()).totalCashback, 23.4); // 26 x 468/520
  });

  it('a refunded sale that is later cancelled drops out of every total, refund included', async () => {
    await refund({ sale_id: ids.sale, amount: 50 });
    harness.db.sales[0].status = 'CANCELLED';
    expect(await stats()).toMatchObject({ soldCost: 0, totalRevenue: 0, unitsSold: 0 });
  });
});
