import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('atomic sale mutations', () => {
  it('rejects foreign and unauthenticated sale deletion without changing records', async () => {
    harness.db.inventory[0].user_id = harness.ids.other;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(404);
    harness.db.inventory[0].user_id = harness.ids.user;
    const response = await fetch(`${baseUrl}/api/sales/${harness.ids.sale}`, { method: 'DELETE', headers: { 'X-QA-Unauthenticated': 'true' } });
    expect(response.status).toBe(401);
    expect(harness.db.sales).toHaveLength(1); expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });
  it('deletes only the selected sale, restores its stock and preserves sibling records', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sibling', quantity: 1 });
    harness.db.inventory[0].qty_on_hand = 2;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 4, fees: 10, gift_card_amount: 50 });
    expect(harness.db.sales.map(sale => sale.id)).toEqual(['sibling']);
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(404);
    expect(harness.db.inventory[0].qty_on_hand).toBe(4);
  });
  it('rolls back sale deletion if restoring stock fails and permits retry', async () => {
    harness.faults['inventory.update'] = true;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(500);
    expect(harness.db.sales).toHaveLength(1); expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    harness.faults['inventory.update'] = false;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });
  it('preserves purchase and all linked sales when deleting the purchase fails', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'other-sale', quantity: 1 });
    harness.faults['inventory.delete'] = true;
    expect((await request('DELETE', `/api/inventory/${harness.ids.inventory}`)).status).toBe(500);
    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.sales).toHaveLength(2);
    harness.faults['inventory.delete'] = false;
    expect((await request('DELETE', `/api/inventory/${harness.ids.inventory}`)).status).toBe(200);
    expect(harness.db.inventory).toHaveLength(0);
    expect(harness.db.sales).toHaveLength(0);
  });
  it('rejects a stale concurrent edit rather than applying its stock delta twice', async () => {
    const originalRead = harness.prisma.sales.findUnique;
    let reads = 0; let release;
    const bothRead = new Promise(resolve => { release = resolve; });
    harness.prisma.sales.findUnique = async args => {
      const result = await originalRead(args);
      if (args.include?.inventory) {
        if (++reads === 2) release();
        await bothRead;
      }
      return result;
    };
    let responses;
    try {
    responses = await Promise.all([
      request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 3 }),
      request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 3 }),
    ]);
    } finally { harness.prisma.sales.findUnique = originalRead; }
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    expect(harness.db.sales[0].quantity).toBe(3);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
    expect(harness.db.sales[0].quantity + harness.db.inventory[0].qty_on_hand).toBe(5);
  });
  it('rolls back the stock claim when sale creation fails', async () => {
    harness.faults['sales.create'] = true;
    const response = await request('POST', '/api/sales', {
      inventory_id: harness.ids.inventory,
      quantity: 1,
      unit_price: 150,
    });

    expect(response.status).toBe(500);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    expect(harness.db.sales).toHaveLength(1);
  });

  it('rolls back a claimed sale edit when stock update fails and permits retry', async () => {
    harness.faults['inventory.updateMany'] = true;
    expect((await request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 3, unit_price: 160 })).status).toBe(500);
    expect(harness.db.sales[0].quantity).toBe(2);
    expect(harness.db.sales[0].unit_price).toBe(150);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    harness.faults['inventory.updateMany'] = false;
    expect((await request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 3, unit_price: 160 })).status).toBe(200);
    expect(harness.db.sales[0].quantity).toBe(3);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
    expect((await request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 3 })).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(2);
  });

  it('preserves omitted fields when independent status and price edits overlap', async () => {
    const responses = await Promise.all([
      request('PUT', `/api/sales/${harness.ids.sale}`, { status: 'PAID' }),
      request('PUT', `/api/sales/${harness.ids.sale}`, { unit_price: 160 }),
    ]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(harness.db.sales[0]).toMatchObject({ status: 'PAID', unit_price: 160, quantity: 2, sale_shipping: 12 });
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });

  it('rejects an oversized quantity edit without changing the sale', async () => {
    const response = await request('PUT', `/api/sales/${harness.ids.sale}`, { quantity: 99 });

    expect(response.status).toBe(400);
    expect(harness.db.sales[0].quantity).toBe(2);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });

  it('allows only one concurrent claim for a single unit of stock', async () => {
    harness.db.inventory[0].qty_on_hand = 1;
    const payload = { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 150 };
    const responses = await Promise.all([
      request('POST', '/api/sales', payload),
      request('POST', '/api/sales', payload),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([200, 400]);
    expect(harness.db.inventory[0].qty_on_hand).toBe(0);
    expect(harness.db.sales).toHaveLength(2);
  });
});
