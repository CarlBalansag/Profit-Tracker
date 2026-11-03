import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, base;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

const request = async (method, path, body, headers = {}) => {
  const response = await fetch(`${base}/api/${path}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: await response.json() };
};
const refund = (body) => request('POST', 'refunds', body);
const inv = () => harness.db.inventory[0];
const sale = () => harness.db.sales[0];
const snapshot = () => structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales, refund: harness.db.refund });
// Fixture: 5 units @ $100 + $40 tax + $20 shipping + $10 fees - $50 gift card = $520, 3 on hand.
// One sale of 2 units @ $150, $15 commission, $12 label.

describe('purchase refunds (money back from the store)', () => {
  it('records a price adjustment without touching stock', async () => {
    const res = await refund({ inventory_id: ids.inventory, amount: 52, date: '2026-10-05', note: 'Price match' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ inventory_id: ids.inventory, amount: 52, quantity: 0, note: 'Price match' });
    expect(res.body.sale_id ?? null).toBe(null);
    expect(inv()).toMatchObject({ refunded_amount: 52, refunded_qty: 0, qty_on_hand: 3 });
  });

  it('records a return: units leave stock and the refund lowers the cost', async () => {
    const res = await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1 });
    expect(res.status).toBe(200);
    expect(inv()).toMatchObject({ refunded_amount: 104, refunded_qty: 1, qty_on_hand: 2 });
  });

  it('refuses to send back more units than are in stock (sold units stay sold)', async () => {
    const before = snapshot();
    const res = await refund({ inventory_id: ids.inventory, amount: 10, quantity: 4 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only 3 units are in stock/);
    expect(snapshot()).toEqual(before);
  });

  it('refuses refunds adding up to more than the purchase cost', async () => {
    expect((await refund({ inventory_id: ids.inventory, amount: 500 })).status).toBe(200);
    const before = snapshot();
    const res = await refund({ inventory_id: ids.inventory, amount: 20.01 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than the purchase cost \(\$520\.00; \$500\.00 already refunded\)/);
    expect(snapshot()).toEqual(before);
  });

  it('allows units back with a $0 refund (e.g. store credit lost), but not an empty refund', async () => {
    expect((await refund({ inventory_id: ids.inventory, amount: 0, quantity: 1 })).status).toBe(200);
    expect(inv()).toMatchObject({ refunded_amount: 0, refunded_qty: 1, qty_on_hand: 2 });
    const empty = await refund({ inventory_id: ids.inventory, amount: 0, quantity: 0 });
    expect(empty.status).toBe(400);
  });
});

describe('sale refunds (money back to a buyer)', () => {
  it('records a partial refund where the buyer keeps the item', async () => {
    const res = await refund({ sale_id: ids.sale, amount: 50, note: 'Box damaged' });
    expect(res.status).toBe(200);
    expect(sale()).toMatchObject({ refunded_amount: 50, refunded_qty: 0 });
    expect(inv().qty_on_hand).toBe(3);
  });

  it('records a return: units go back into stock', async () => {
    expect((await refund({ sale_id: ids.sale, amount: 150, quantity: 1 })).status).toBe(200);
    expect(sale()).toMatchObject({ refunded_amount: 150, refunded_qty: 1, quantity: 2 });
    expect(inv().qty_on_hand).toBe(4);
  });

  it('limits returned units to what the buyer still has', async () => {
    expect((await refund({ sale_id: ids.sale, amount: 1, quantity: 1 })).status).toBe(200);
    const before = snapshot();
    const res = await refund({ sale_id: ids.sale, amount: 1, quantity: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Only 1 unit of this sale/);
    expect(snapshot()).toEqual(before);
  });

  it('limits refunds to the sale price', async () => {
    const res = await refund({ sale_id: ids.sale, amount: 300.01 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/more than the sale price \(\$300\.00/);
  });

  it.each(['CANCELLED', 'RETURNED', 'DISPUTED'])('rejects refunds on a %s sale (it is already out of every total)', async (status) => {
    sale().status = status;
    const before = snapshot();
    const res = await refund({ sale_id: ids.sale, amount: 10, quantity: 1 });
    expect(res.status).toBe(409);
    expect(snapshot()).toEqual(before);
  });
});

describe('refund requests: validation and ownership', () => {
  it('needs exactly one of purchase or sale', async () => {
    expect((await refund({ amount: 5 })).status).toBe(400);
    expect((await refund({ inventory_id: ids.inventory, sale_id: ids.sale, amount: 5 })).status).toBe(400);
  });

  it('rejects negative or malformed amounts and units', async () => {
    expect((await refund({ inventory_id: ids.inventory, amount: -5 })).status).toBe(400);
    expect((await refund({ inventory_id: ids.inventory, amount: 'abc' })).status).toBe(400);
    expect((await refund({ inventory_id: ids.inventory, amount: 5, quantity: -1 })).status).toBe(400);
    expect((await refund({ inventory_id: ids.inventory, amount: 5, quantity: 1.5 })).status).toBe(400);
    expect(harness.db.refund).toEqual([]);
  });

  it('never touches another user\'s purchase or sale', async () => {
    harness.db.inventory.push({ ...structuredClone(inv()), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: ids.other });
    harness.db.sales.push({ ...structuredClone(sale()), id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inventory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
    expect((await refund({ inventory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', amount: 5 })).status).toBe(404);
    expect((await refund({ sale_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', amount: 5 })).status).toBe(404);
    expect(harness.db.refund).toEqual([]);
  });

  it('requires sign-in', async () => {
    expect((await request('POST', 'refunds', { inventory_id: ids.inventory, amount: 5 }, { 'X-QA-Unauthenticated': 'true' })).status).toBe(401);
    expect((await request('GET', `refunds?inventory_id=${ids.inventory}`, undefined, { 'X-QA-Unauthenticated': 'true' })).status).toBe(401);
  });

  it('lists a purchase\'s or a sale\'s refunds, newest first, only for the owner', async () => {
    await refund({ inventory_id: ids.inventory, amount: 5, date: '2026-09-10' });
    await refund({ inventory_id: ids.inventory, amount: 6, date: '2026-09-20' });
    await refund({ sale_id: ids.sale, amount: 7 });
    harness.db.refund.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ids.other, inventory_id: ids.inventory, amount: 99, quantity: 0, date: new Date() });
    const list = (await request('GET', `refunds?inventory_id=${ids.inventory}`)).body;
    expect(list.map(r => r.amount)).toEqual([6, 5]);
    expect((await request('GET', `refunds?sale_id=${ids.sale}`)).body.map(r => r.amount)).toEqual([7]);
    expect((await request('GET', 'refunds')).status).toBe(400);
  });
});

describe('deleting a refund undoes it exactly', () => {
  it('purchase refund: totals and stock go back to where they were', async () => {
    const before = snapshot();
    const created = (await refund({ inventory_id: ids.inventory, amount: 104, quantity: 1 })).body;
    expect((await request('DELETE', `refunds/${created.id}`)).status).toBe(200);
    expect(snapshot()).toEqual(before);
    expect((await request('DELETE', `refunds/${created.id}`)).status).toBe(404);
  });

  it('sale refund: totals and stock go back', async () => {
    const before = snapshot();
    const created = (await refund({ sale_id: ids.sale, amount: 150, quantity: 1 })).body;
    expect((await request('DELETE', `refunds/${created.id}`)).status).toBe(200);
    expect(snapshot()).toEqual(before);
  });

  it('refuses when the returned units were sold again, changing nothing', async () => {
    const created = (await refund({ sale_id: ids.sale, amount: 150, quantity: 1 })).body;
    inv().qty_on_hand = 0; // everything, including the returned unit, sold since
    const before = snapshot();
    const res = await request('DELETE', `refunds/${created.id}`);
    expect(res.status).toBe(409);
    expect(snapshot()).toEqual(before);
  });

  it('refuses on a sale that has since been cancelled', async () => {
    const created = (await refund({ sale_id: ids.sale, amount: 10 })).body;
    sale().status = 'CANCELLED';
    expect((await request('DELETE', `refunds/${created.id}`)).status).toBe(409);
    expect(harness.db.refund).toHaveLength(1);
  });

  it('cannot delete another user\'s refund', async () => {
    harness.db.refund.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ids.other, inventory_id: ids.inventory, amount: 5, quantity: 0, date: new Date() });
    expect((await request('DELETE', 'refunds/dddddddd-dddd-4ddd-8ddd-dddddddddddd')).status).toBe(404);
    expect(harness.db.refund).toHaveLength(1);
  });

  it('refunds are removed with their purchase', async () => {
    await refund({ inventory_id: ids.inventory, amount: 5 });
    await refund({ sale_id: ids.sale, amount: 5 });
    expect((await request('DELETE', `inventory/${ids.inventory}`)).status).toBe(200);
    expect(harness.db.refund).toEqual([]);
  });
});

describe('repeated and simultaneous refunds', () => {
  it('two refunds at once cannot both take the same units', async () => {
    const results = await Promise.all([
      refund({ inventory_id: ids.inventory, amount: 10, quantity: 2 }),
      refund({ inventory_id: ids.inventory, amount: 10, quantity: 2 }),
    ]);
    // The loser is turned away either by the stock check (400) or the write guard (409).
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    expect(results.some(r => r.status === 400 || r.status === 409)).toBe(true);
    expect(inv()).toMatchObject({ qty_on_hand: 1, refunded_qty: 2, refunded_amount: 10 });
    expect(harness.db.refund).toHaveLength(1);
  });

  it('running totals always equal the sum of the refund rows', async () => {
    for (const amount of [1.1, 2.2, 3.3]) await refund({ inventory_id: ids.inventory, amount, quantity: 1 });
    const rows = harness.db.refund.filter(r => r.inventory_id === ids.inventory);
    expect(inv().refunded_amount).toBe(6.6);
    expect(inv().refunded_qty).toBe(rows.reduce((s, r) => s + r.quantity, 0));
    expect(inv().qty_on_hand).toBe(0);
  });
});

describe('stock rules elsewhere respect refunds', () => {
  it('a sale cannot be edited below the units its buyer returned', async () => {
    await refund({ sale_id: ids.sale, amount: 300, quantity: 2 });
    const res = await request('PUT', `sales/${ids.sale}`, { quantity: 1 });
    expect(res.status).toBe(400);
    expect(sale().quantity).toBe(2);
  });

  it('deleting a sale brings back only the units the buyer kept', async () => {
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 }); // on hand 3 -> 4
    expect((await request('DELETE', `sales/${ids.sale}`)).status).toBe(200);
    expect(inv().qty_on_hand).toBe(5); // all 5 units back, not 6
    expect(harness.db.refund).toEqual([]);
  });

  it('cancelling a sale after a partial return restores only the kept units', async () => {
    Object.assign(sale(), { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT', cancelled_at: null, voided_at: null });
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 }); // 3 -> 4
    const res = await request('POST', `sales/${ids.sale}/actions/cancel_sale`, {});
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(5);
  });

  it('editing the purchase quantity accounts for store returns and buyer returns', async () => {
    await refund({ inventory_id: ids.inventory, amount: 0, quantity: 1 }); // 3 -> 2 on hand, 1 sent back
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 });         // 2 -> 3 on hand
    // Out of stock now: 1 kept by the buyer + 1 returned to the store = 2.
    expect((await request('PUT', `inventory/${ids.inventory}`, { qty_purchased: 1 })).status).toBe(400);
    expect((await request('PUT', `inventory/${ids.inventory}`, { qty_purchased: 6 })).status).toBe(200);
    expect(inv()).toMatchObject({ qty_purchased: 6, qty_on_hand: 4 });
  });

  it('the edit window keeps stock right after refunds when saving unchanged', async () => {
    await refund({ inventory_id: ids.inventory, amount: 0, quantity: 1 });
    await refund({ sale_id: ids.sale, amount: 150, quantity: 1 });
    const before = inv().qty_on_hand;
    const res = await request('PUT', `inventory/${ids.inventory}/transaction`, { inventory: {}, sales: [{ id: ids.sale, quantity: 2 }] });
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(before);
    const tooLow = await request('PUT', `inventory/${ids.inventory}/transaction`, { inventory: {}, sales: [{ id: ids.sale, quantity: 1 }], newSale: undefined });
    expect([200, 400]).toContain(tooLow.status);
    if (tooLow.status === 200) expect(inv().qty_on_hand).toBe(before + 1);
  });
});
