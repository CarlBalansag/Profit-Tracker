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
  harness.db.buyer.push({ id: buyerId, user_id: harness.ids.user, name: 'Owned buyer' });
});
const write = async (method, path, body) => {
  const response = await fetch(`${baseUrl}/api/sales${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
describe('sale buyer ownership', () => {
  it('accepts an owned buyer on sale create/update and preserves it on partial edits', async () => {
    const created = await write('POST', '', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 100, buyer_id: buyerId });
    expect(created.status).toBe(200);
    expect(created.body.buyer_id).toBe(buyerId);
    expect((await write('PUT', `/${harness.ids.sale}`, { buyer_id: buyerId })).body.buyer_id).toBe(buyerId);
    expect((await write('PUT', `/${harness.ids.sale}`, { status: 'PAID' })).body.buyer_id).toBe(buyerId);
  });
  it.each(['foreign', 'missing'])('rejects %s buyers before changing sales or stock', async kind => {
    if (kind === 'foreign') harness.db.buyer[0].user_id = harness.ids.other;
    const id = kind === 'foreign' ? buyerId : harness.ids.foreign;
    const original = structuredClone({ sales: harness.db.sales, inventory: harness.db.inventory });
    expect((await write('POST', '', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 100, buyer_id: id })).status).toBe(404);
    expect((await write('PUT', `/${harness.ids.sale}`, { buyer_id: id, quantity: 3 })).status).toBe(404);
    expect(harness.db.sales).toEqual(original.sales);
    expect(harness.db.inventory).toEqual(original.inventory);
  });
  it('clears a buyer deliberately without changing quantity', async () => {
    harness.db.sales[0].buyer_id = buyerId;
    expect((await write('PUT', `/${harness.ids.sale}`, { buyer_id: '' })).body.buyer_id).toBeNull();
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });
});
