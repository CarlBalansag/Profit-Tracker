import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server; let base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());
const write = async (body, authenticated = true) => {
  const response = await fetch(`${base}/api/inventory/${harness.ids.inventory}/transaction`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-QA-Unauthenticated': String(!authenticated) }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
describe('atomic expanded transaction edits', () => {
  it('creates an inline sale atomically while preserving the purchase batch and existing sales', async () => {
    const body = { inventory: { qty_purchased: 5 }, sales: [], newSale: { quantity: 3, unit_price: '160.01' } };
    expect((await write(body)).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 0, status: 'PURCHASED' });
    expect(harness.db.sales).toHaveLength(2);
    expect(harness.db.sales[1]).toMatchObject({ quantity: 3, unit_price_decimal: '160.01' });
    expect((await write(body)).status).toBe(400);
    expect(harness.db.sales).toHaveLength(2);
  });
  it('preserves all purchase data if an inline new sale fails, then permits retry', async () => {
    const original = structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales });
    harness.faults['sales.create'] = true;
    const body = { inventory: { unit_purchase_cost: 200 }, sales: [], newSale: { quantity: 1, unit_price: 300 } };
    expect((await write(body)).status).toBe(500);
    expect({ inventory: harness.db.inventory, sales: harness.db.sales }).toEqual(original);
    harness.faults['sales.create'] = false;
    expect((await write(body)).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
  });
  it('updates purchase and multiple sales together and reconciles combined quantity edits', async () => {
    const second = randomUUID();
    harness.db.sales.push({ ...harness.db.sales[0], id: second, quantity: 1 });
    harness.db.inventory[0].qty_on_hand = 2;
    const body = { inventory: { qty_purchased: 2, unit_purchase_cost: '100.01', fees: 0 }, sales: [{ id: harness.ids.sale, quantity: 1, unit_price: '160.01', payout_date: null }, { id: second, quantity: 1, status: 'PAID' }] };
    expect((await write(body)).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 2, qty_on_hand: 0, unit_purchase_cost_decimal: '100.01', fees: 0, gift_card_amount: 50 });
    expect(harness.db.sales[0]).toMatchObject({ quantity: 1, unit_price_decimal: '160.01', sale_shipping: 12 });
    expect(harness.db.sales[1].status).toBe('PAID');
    expect((await write(body)).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(0);
  });
  it('rolls back every record on a later sale failure and permits retry', async () => {
    const original = structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales });
    harness.faults['sales.updateMany'] = true;
    const body = { inventory: { unit_purchase_cost: 200 }, sales: [{ id: harness.ids.sale, unit_price: 300 }] };
    expect((await write(body)).status).toBe(500);
    expect({ inventory: harness.db.inventory, sales: harness.db.sales }).toEqual(original);
    harness.faults['sales.updateMany'] = false;
    expect((await write(body)).status).toBe(200);
  });
  it.each([
    { inventory: { fees: 200 }, sales: [{ id: harness.ids.sale, quantity: 99 }] },
    { inventory: { fees: 200 }, sales: [{ id: harness.ids.sale, unit_price: '0.001' }] },
    { inventory: {}, sales: [{ id: harness.ids.sale }, { id: harness.ids.sale }] },
    { inventory: { qty_on_hand: 99 }, sales: [] },
  ])('rejects invalid combined edits without writes: %j', async body => {
    const original = structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales });
    expect((await write(body)).status).toBe(400);
    expect({ inventory: harness.db.inventory, sales: harness.db.sales }).toEqual(original);
  });
  it('rejects foreign related IDs, unrelated sales and unauthenticated requests without writes', async () => {
    const original = structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales });
    expect((await write({ inventory: { vendor_id: harness.ids.foreign }, sales: [] })).status).toBe(404);
    expect((await write({ inventory: {}, sales: [{ id: randomUUID(), unit_price: 200 }] })).status).toBe(404);
    expect((await write({ inventory: {}, sales: [{ id: harness.ids.sale, platform_id: harness.ids.foreign }] })).status).toBe(404);
    expect((await write({ inventory: {}, sales: [] }, false)).status).toBe(401);
    expect({ inventory: harness.db.inventory, sales: harness.db.sales }).toEqual(original);
  });
  it('preserves an unchanged transaction including empty optional fields', async () => {
    const original = structuredClone(harness.db.sales[0]);
    expect((await write({ inventory: {}, sales: [{ id: harness.ids.sale, payout_date: null }] })).status).toBe(200);
    expect(harness.db.sales[0]).toEqual(original);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 3, status: 'PURCHASED', fees: 10, gift_card_amount: 50 });
  });
});
