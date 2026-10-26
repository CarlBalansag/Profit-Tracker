import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const buyerId = '99999999-9999-4999-8999-999999999999';
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  harness.reset();
  harness.db.buyer.push({ id: buyerId, user_id: harness.ids.user, name: 'Blake' });
});

const post = async (body) => {
  const response = await fetch(`${baseUrl}/api/inventory`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

// The combined purchase+immediate-sale creation path (AddTransaction.jsx's
// POST /api/inventory with sale_price set) never threaded buyer_id through to
// the nested sale -- there was no way to record "who paid for this" on the
// very first screen a sale is recorded from.
describe('immediate sale buyer_id (POST /api/inventory with sale_price)', () => {
  it('attaches an owned buyer to the created sale', async () => {
    const created = await post({
      product_name: 'Immediate sale item', unit_purchase_cost: 10, qty_purchased: 1,
      sale_price: 25, qty_sold: 1, marketplace_platform_id: harness.ids.platform, sale_tab: 'marketplace',
      buyer_id: buyerId,
    });
    expect(created.status).toBe(200);
    const sale = harness.db.sales.find(s => s.inventory_id === created.body.id);
    expect(sale.buyer_id).toBe(buyerId);
  });

  it('still creates the sale with no buyer at all', async () => {
    const created = await post({
      product_name: 'No buyer', unit_purchase_cost: 10, qty_purchased: 1,
      sale_price: 25, qty_sold: 1, marketplace_platform_id: harness.ids.platform, sale_tab: 'marketplace',
    });
    expect(created.status).toBe(200);
    const sale = harness.db.sales.find(s => s.inventory_id === created.body.id);
    expect(sale.buyer_id).toBeNull();
  });

  it('rejects a foreign buyer before creating anything', async () => {
    harness.db.buyer[0].user_id = harness.ids.other;
    const beforeInv = structuredClone(harness.db.inventory);
    const beforeSales = structuredClone(harness.db.sales);
    const created = await post({
      product_name: 'Should not be created', unit_purchase_cost: 10, qty_purchased: 1,
      sale_price: 25, qty_sold: 1, marketplace_platform_id: harness.ids.platform, sale_tab: 'marketplace',
      buyer_id: buyerId,
    });
    expect(created.status).toBe(404);
    expect(harness.db.inventory).toEqual(beforeInv);
    expect(harness.db.sales).toEqual(beforeSales);
  });
});
