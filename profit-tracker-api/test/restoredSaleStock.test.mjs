// A cancel_sale/void_sale/mark_returned action puts a sale's units back in
// stock and records them in restored_qty. Deleting that sale, or recounting
// stock from its sales (the transaction edit window, a qty_purchased edit),
// must not restore or count those units a second time.
//
// Fixture: 5 bought, 3 on hand, one 2-unit sale.
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

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const act = (action, body) => send('POST', `/api/sales/${harness.ids.sale}/actions/${action}`, body);
const deleteSale = () => send('DELETE', `/api/sales/${harness.ids.sale}`);
const editWindow = (body) => send('PUT', `/api/inventory/${harness.ids.inventory}/transaction`, body);
const onHand = () => harness.db.inventory[0].qty_on_hand;

const seedSale = (overrides = {}) => Object.assign(harness.db.sales[0], {
  workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT',
  cancelled_at: null, voided_at: null, returned_at: null, restored_qty: 0,
  ...overrides,
});

describe('deleting a sale whose units a status action already restored', () => {
  beforeEach(() => seedSale());

  it('still restores an active sale\'s units', async () => {
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('cancel then delete restores the units once', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].restored_qty).toBe(2);
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
    expect(harness.db.sales).toHaveLength(0);
  });

  it('void then delete restores the units once', async () => {
    expect((await act('void_sale')).status).toBe(200);
    expect(onHand()).toBe(5);
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('partial mark_returned then delete restores only the units not yet returned', async () => {
    seedSale({ workflow_status: 'RETURN_IN_PROGRESS' });
    expect((await act('mark_returned', { quantity: 1 })).status).toBe(200);
    expect(onHand()).toBe(4);
    expect(harness.db.sales[0].restored_qty).toBe(1);
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('a buyer refund then cancel then delete never exceeds the units bought', async () => {
    expect((await send('POST', '/api/refunds', { sale_id: harness.ids.sale, amount: '150.00', quantity: 1, date: '2026-09-05' })).status).toBe(200);
    expect(onHand()).toBe(4);
    expect((await act('cancel_sale')).status).toBe(200);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].restored_qty).toBe(1);
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('cancelling again a sale reopened before reopening was refused restores nothing more', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    // correct_status now refuses this (restoredSaleReopen.test.mjs); a row
    // reopened earlier can still be in this state.
    Object.assign(harness.db.sales[0], { workflow_status: 'PAID', status: 'SOLD' });
    expect((await act('cancel_sale')).status).toBe(200);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].restored_qty).toBe(2);
    expect((await deleteSale()).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('refuses a delete computed from a stale restored_qty', async () => {
    const stale = { ...harness.db.sales[0] };
    expect((await act('cancel_sale')).status).toBe(200);
    // Same guard the route uses: the row it read no longer matches.
    const removed = await harness.prisma.sales.deleteMany({ where: { id: stale.id, restored_qty: stale.restored_qty } });
    expect(removed.count).toBe(0);
  });
});

describe('recounting stock after a sale\'s units were restored', () => {
  beforeEach(() => seedSale());

  const sale = () => ({ id: harness.ids.sale, quantity: harness.db.sales[0].quantity });

  it('edit-window save after a cancel keeps the restored units on hand', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const saved = await editWindow({ inventory: { qty_purchased: 5 }, sales: [sale()] });
    expect(saved.status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('edit-window save after a cancel with a purchase quantity change', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    expect((await editWindow({ inventory: { qty_purchased: 7 }, sales: [sale()] })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 7, qty_on_hand: 7 });
    // Nothing is held by the cancelled sale, so the purchase can shrink below its quantity.
    expect((await editWindow({ inventory: { qty_purchased: 1 }, sales: [sale()] })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 1, qty_on_hand: 1 });
  });

  it('edit-window rejects a sale quantity below the units already restored', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const res = await editWindow({ inventory: { qty_purchased: 5 }, sales: [{ id: harness.ids.sale, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].quantity).toBe(2);
  });

  it('edit-window save after a partial return counts only the unit still out', async () => {
    seedSale({ workflow_status: 'RETURN_IN_PROGRESS' });
    expect((await act('mark_returned', { quantity: 1 })).status).toBe(200);
    expect((await editWindow({ inventory: { qty_purchased: 5 }, sales: [sale()] })).status).toBe(200);
    expect(onHand()).toBe(4);
  });

  it('qty_purchased edit after a void keeps the restored units on hand', async () => {
    expect((await act('void_sale')).status).toBe(200);
    expect((await send('PUT', `/api/inventory/${harness.ids.inventory}`, { qty_purchased: 6 })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 6, qty_on_hand: 6 });
  });

  it('qty_purchased edit still counts an active sale as sold', async () => {
    expect((await send('PUT', `/api/inventory/${harness.ids.inventory}`, { qty_purchased: 6 })).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ qty_purchased: 6, qty_on_hand: 4 });
    expect((await send('PUT', `/api/inventory/${harness.ids.inventory}`, { qty_purchased: 1 })).status).toBe(400);
  });
});
