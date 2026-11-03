// Follow-up to restoredSaleStock.test.mjs: once a cancel/void/mark_returned
// action has put a sale's units back (restored_qty), editing that sale's
// quantity or refunding it must not put those units back a second time.
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

beforeEach(() => {
  harness.reset();
  Object.assign(harness.db.sales[0], {
    workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'WAITING_FOR_PAYMENT',
    cancelled_at: null, voided_at: null, returned_at: null, restored_qty: 0,
  });
});
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
const editSale = (body) => send('PUT', `/api/sales/${harness.ids.sale}`, body);
const refund = (quantity) => send('POST', '/api/refunds', { sale_id: harness.ids.sale, amount: '10.00', quantity, date: '2026-09-05' });
// Every status write now refuses reopening a restored sale
// (restoredSaleReopen.test.mjs); a row reopened before that rule can still be
// realized again, so set that state directly.
const reopen = async () => {
  Object.assign(harness.db.sales[0], { workflow_status: 'PAID', status: 'SOLD' });
};
const onHand = () => harness.db.inventory[0].qty_on_hand;

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const { result } = await response.json();
  return { isError: result.isError || false, text: result.content?.[0]?.text };
}

describe('PUT /api/sales/:id quantity after a status action restored units', () => {
  it('refuses lowering a cancelled sale below the units already restored', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    expect(onHand()).toBe(5);
    const res = await editSale({ quantity: 1 });
    expect(res.status).toBe(400);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].quantity).toBe(2);
  });

  it('allows lowering a partly returned sale down to the units restored', async () => {
    Object.assign(harness.db.sales[0], { workflow_status: 'RETURN_IN_PROGRESS' });
    expect((await act('mark_returned', { quantity: 1 })).status).toBe(200);
    expect(onHand()).toBe(4);
    expect((await editSale({ quantity: 1 })).status).toBe(200);
    expect(onHand()).toBe(5);
    expect((await editSale({ quantity: 0 })).status).toBe(400);
    expect(onHand()).toBe(5);
  });

  it('an unchanged quantity save after a cancel leaves stock alone', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    expect((await editSale({ quantity: 2, unit_price: 140 })).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('active sales still move stock by the quantity change', async () => {
    expect((await editSale({ quantity: 1 })).status).toBe(200);
    expect(onHand()).toBe(4);
    expect((await editSale({ quantity: 4 })).status).toBe(200);
    expect(onHand()).toBe(1);
  });
});

describe('MCP update_sale qty after a status action restored units', () => {
  it('refuses lowering a voided sale below the units already restored', async () => {
    expect((await act('void_sale')).status).toBe(200);
    const res = await callTool('update_sale', { sale_id: harness.ids.sale, qty: 1 });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/below 2/);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].quantity).toBe(2);
  });

  it('active sales still move stock by the qty change', async () => {
    expect((await callTool('update_sale', { sale_id: harness.ids.sale, qty: 1 })).isError).toBe(false);
    expect(onHand()).toBe(4);
  });
});

describe('POST /api/refunds on a sale after a status action restored units', () => {
  it('refuses returning units a cancel already restored, even after the sale is reopened', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    await reopen();
    const res = await refund(1);
    expect(res.status).toBe(400);
    expect(onHand()).toBe(5);
    expect(harness.db.sales[0].refunded_qty).toBe(0);
    expect(harness.db.refund).toHaveLength(0);
    // A money-only refund still works.
    expect((await refund(0)).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('allows returning only the units a partial return left out', async () => {
    Object.assign(harness.db.sales[0], { workflow_status: 'RETURN_IN_PROGRESS' });
    expect((await act('mark_returned', { quantity: 1 })).status).toBe(200);
    await reopen();
    expect((await refund(2)).status).toBe(400);
    expect((await refund(1)).status).toBe(200);
    expect(onHand()).toBe(5);
  });

  it('active sales can still return all their units', async () => {
    expect((await refund(2)).status).toBe(200);
    expect(onHand()).toBe(5);
  });
});
