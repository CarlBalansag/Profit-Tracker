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

const call = async (body) => {
  const response = await fetch(`${baseUrl}/api/sales/mark-paid-batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

// Second sale sharing the same inventory batch, in a payable workflow state,
// for the multi-sale/short-pay tests below. markPaidBatch's schema requires
// sale_ids to be UUIDs, so fixture ids must be UUID-shaped too.
const addSecondSale = (overrides = {}) => {
  const id = '99999999-9999-4999-8999-aaaaaaaaaaaa';
  harness.db.sales.push({
    id, inventory_id: harness.ids.inventory, platform_id: harness.ids.platform, buyer_id: null,
    quantity: 1, unit_price: 100, commission_fee: 0, sale_shipping: 0, sale_tax_collected: 0,
    taxable: true, customer_tax_exempt: false, status: 'SOLD', workflow_status: 'WAITING_FOR_PAYMENT',
    sale_date: new Date('2026-09-04T12:00:00Z'), payout_date: null,
    paid_at: null, paid_amount: null, paid_reference: null, payout_account: null, payout_short_amount: null,
    ...overrides,
  });
  return id;
};

describe('POST /api/sales/mark-paid-batch', () => {
  it('marks a single eligible sale paid in full', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    // revenue = unit_price*qty - commission - shipping = 150*2 - 15 - 12 = 273
    const result = await call({
      sale_ids: [harness.ids.sale], payout_date: '2026-09-30', payout_amount: 273,
      payout_account: 'Chase College', payout_reference: 'R&A Electronics RTP 9/30',
    });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(1);
    const [sale] = result.body;
    expect(sale.payout_account).toBe('Chase College');
    expect(sale.paid_reference).toBe('R&A Electronics RTP 9/30');
    expect(Number(sale.paid_amount)).toBeCloseTo(273, 2);
    expect(sale.payout_short_amount == null || Number(sale.payout_short_amount) === 0).toBe(true);
  });

  it('splits one deposit across several sales and reconciles exactly', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const secondId = addSecondSale();
    // expected: sale1 = 273, sale2 = 100, total 373. Pay the full amount.
    const result = await call({
      sale_ids: [harness.ids.sale, secondId], payout_date: '2026-09-30', payout_amount: 373,
    });
    expect(result.status).toBe(200);
    expect(result.body).toHaveLength(2);
    for (const sale of result.body) {
      expect(sale.payout_short_amount == null || Number(sale.payout_short_amount) === 0).toBe(true);
    }
  });

  it('records a proportional shortfall when the deposit is less than expected, summing exactly to the deposit', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT'; // expected 273
    const secondId = addSecondSale(); // expected 100
    // total expected 373, deposit only 353 -> 20 short overall
    const result = await call({ sale_ids: [harness.ids.sale, secondId], payout_date: '2026-09-30', payout_amount: 353 });
    expect(result.status).toBe(200);
    const paidTotal = result.body.reduce((sum, s) => sum + Number(s.paid_amount), 0);
    const shortTotal = result.body.reduce((sum, s) => sum + Number(s.payout_short_amount || 0), 0);
    expect(paidTotal).toBeCloseTo(353, 2);
    expect(shortTotal).toBeCloseTo(20, 2);
    // every sale with a shortfall is flagged partial, not silently marked fully paid
    expect(result.body.every(s => Number(s.payout_short_amount || 0) === 0 || Number(s.paid_amount) < 273)).toBe(true);
  });

  it('rejects the whole batch (no partial writes) when one sale id belongs to another user', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const foreignInventoryId = '99999999-9999-4999-8999-bbbbbbbbbbbb';
    harness.db.inventory.push({
      id: foreignInventoryId, user_id: harness.ids.other, product_name: 'Not yours',
      unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', purchase_date: new Date(),
    });
    const foreignSaleId = addSecondSale({ inventory_id: foreignInventoryId });
    const before = structuredClone(harness.db.sales);
    const result = await call({ sale_ids: [harness.ids.sale, foreignSaleId], payout_date: '2026-09-30', payout_amount: 373 });
    expect(result.status).toBe(404);
    expect(harness.db.sales).toEqual(before);
  });

  it('rejects a sale that is not in a mark_paid-eligible status, writing nothing', async () => {
    // No workflow_status set at all -> allowedActions only offers "set a status", not mark_paid.
    const before = structuredClone(harness.db.sales);
    const result = await call({ sale_ids: [harness.ids.sale], payout_date: '2026-09-30', payout_amount: 273 });
    expect(result.status).toBe(409);
    expect(harness.db.sales).toEqual(before);
  });

  it('404s when a sale id does not exist at all', async () => {
    const result = await call({ sale_ids: ['99999999-9999-4999-8999-cccccccccccc'], payout_date: '2026-09-30', payout_amount: 100 });
    expect(result.status).toBe(404);
  });

  it('rejects an empty sale_ids array', async () => {
    const result = await call({ sale_ids: [], payout_date: '2026-09-30', payout_amount: 100 });
    expect(result.status).toBe(400);
  });
});
