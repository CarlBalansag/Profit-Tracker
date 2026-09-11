import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
let server; let baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
beforeEach(() => harness.reset());
afterAll(() => server.close());
const update = async (body) => {
  const response = await fetch(`${baseUrl}/api/inventory/${harness.ids.inventory}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

describe('inventory quantity invariant', () => {
  it('rejects a purchase quantity below sold units without changing stock', async () => {
    const response = await update({ qty_purchased: 1 });
    expect(response.status).toBe(400);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 3 });
  });
  it('recalculates on-hand quantity when purchased quantity changes', async () => {
    const response = await update({ qty_purchased: 7 });
    expect(response.status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 7, qty_on_hand: 5 });
  });
});
