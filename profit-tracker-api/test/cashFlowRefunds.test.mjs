import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

const refund = (body) => fetch(`${base}/api/refunds`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const dashboard = async () => (await fetch(`${base}/api/analytics/dashboard?mode=All&date=All%20Time`)).json();

describe('Cash Flow data: refunds', () => {
  it('reports zero refunds when there are none', async () => {
    const { stats, cashFlowTransactions } = await dashboard();
    expect(stats).toMatchObject({ storeRefunds: 0, buyerRefunds: 0 });
    expect(cashFlowTransactions[0]).toMatchObject({ refunded: 0, refunded_units: 0 });
  });

  it('reports the amounts already taken out of spending and revenue', async () => {
    await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1 });
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 });
    const { stats, cashFlowTransactions } = await dashboard();
    expect(stats).toMatchObject({ storeRefunds: 104, buyerRefunds: 150, totalCost: 416, totalRevenue: 123 });
    expect(cashFlowTransactions[0]).toMatchObject({ refunded: 150, refunded_units: 1, revenue: 123 });
  });

  it('leaves a cancelled sale\'s refund out, like every other total', async () => {
    await refund({ sale_id: ids.sale, amount: 50 });
    harness.db.sales[0].status = 'CANCELLED';
    expect((await dashboard()).stats.buyerRefunds).toBe(0);
  });
});
