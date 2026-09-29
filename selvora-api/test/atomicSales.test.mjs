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

  it('rejects foreign and unauthenticated sale deletion without changing records', async () => {
    harness.db.inventory[0].user_id = harness.ids.other;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(404);
    harness.db.inventory[0].user_id = harness.ids.user;
    const response = await fetch(`${baseUrl}/api/sales/${harness.ids.sale}`, { method: 'DELETE', headers: { 'X-QA-Unauthenticated': 'true' } });
    expect(response.status).toBe(401);
    expect(harness.db.sales).toHaveLength(1);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });

  it('deletes only the selected sale, restores its stock and preserves sibling records', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sibling', quantity: 1 });
    harness.db.inventory[0].qty_on_hand = 2;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 4, fees: 10, gift_card_amount: 50 });
    expect(harness.db.sales.map((sale) => sale.id)).toEqual(['sibling']);
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(404);
    expect(harness.db.inventory[0].qty_on_hand).toBe(4);
  });

  it('rolls back sale deletion if restoring stock fails and permits retry', async () => {
    harness.faults['inventory.update'] = true;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(500);
    expect(harness.db.sales).toHaveLength(1);
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
    harness.faults['inventory.update'] = false;
    expect((await request('DELETE', `/api/sales/${harness.ids.sale}`)).status).toBe(200);
    expect(harness.db.inventory[0].qty_on_hand).toBe(5);
  });
});
