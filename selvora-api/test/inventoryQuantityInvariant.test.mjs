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
  it('rejects a stale purchased-quantity edit if a sale claims stock after its read', async () => {
    const originalRead = harness.prisma.inventory.findUnique;
    let readDone; let resume;
    const read = new Promise(resolve => { readDone = resolve; });
    const paused = new Promise(resolve => { resume = resolve; });
    harness.prisma.inventory.findUnique = async args => {
      const result = await originalRead(args);
      if (args.include?.sales?.select) { readDone(); await paused; }
      return result;
    };
    let pending;
    try {
      pending = update({ qty_purchased: 7 });
      await read;
      const sale = await fetch(`${baseUrl}/api/sales`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inventory_id: harness.ids.inventory, quantity: 1, unit_price: 150 }) });
      expect(sale.status).toBe(200);
      resume();
      expect((await pending).status).toBe(409);
    } finally { resume(); harness.prisma.inventory.findUnique = originalRead; }
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 2 });
    expect(harness.db.sales.reduce((n, sale) => n + sale.quantity, 0)).toBe(3);
    expect((await update({ qty_purchased: 7 })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 7, qty_on_hand: 4 });
  });
  it('preserves money and stock on failed quantity edits, then permits retry and repeated updates', async () => {
    harness.faults['inventory.updateMany'] = true;
    expect((await update({ qty_purchased: 7, fees: 20 })).status).toBe(500);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 5, qty_on_hand: 3, fees: 10 });
    harness.faults['inventory.updateMany'] = false;
    expect((await update({ qty_purchased: 7, fees: 20 })).status).toBe(200);
    expect((await update({ qty_purchased: 7 })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 7, qty_on_hand: 5, fees: 20 });
  });
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
