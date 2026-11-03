// A sale whose units a cancel/void/mark_returned action put back in stock
// (restored_qty > 0) can't be reopened: every path that writes a sale's status
// refuses a move to a status that counts as a sale. Moving between the
// excluded statuses, and re-sending the current value, still work.
//
// Fixture: 5 bought, 3 on hand, one 2-unit sale.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { reopensRestoredSale } = require('../services/statusTransitions.js');

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
const sale = () => harness.db.sales[0];
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

describe('reopensRestoredSale', () => {
  const restored = { restored_qty: 2, workflow_status: 'CANCELLED', status: 'CANCELLED' };

  it('refuses only a changed status that counts as a sale', () => {
    expect(reopensRestoredSale(restored, { workflow_status: 'PAID' })).toBe(true);
    expect(reopensRestoredSale(restored, { workflow_status: 'RETURN_IN_PROGRESS' })).toBe(true);
    expect(reopensRestoredSale(restored, { status: 'SOLD' })).toBe(true);
    expect(reopensRestoredSale(restored, { workflow_status: 'RETURNED', status: 'DISPUTED' })).toBe(false);
    expect(reopensRestoredSale(restored, { workflow_status: 'CANCELLED' })).toBe(false);
    expect(reopensRestoredSale(restored, {})).toBe(false);
  });

  it('leaves a sale with nothing restored alone, including legacy-cancelled ones', () => {
    expect(reopensRestoredSale({ ...restored, restored_qty: 0 }, { workflow_status: 'PAID', status: 'SOLD' })).toBe(false);
    expect(reopensRestoredSale({ workflow_status: 'CANCELLED', status: 'CANCELLED' }, { status: 'SOLD' })).toBe(false);
  });

  it('accepts re-sending a stale legacy value the sale already has', () => {
    // Backfilled rows can be CANCELLED in workflow_status but SOLD in the legacy column.
    expect(reopensRestoredSale({ ...restored, status: 'SOLD' }, { status: 'SOLD' })).toBe(false);
  });
});

describe('correct_status action', () => {
  it('refuses reopening a cancelled sale and changes nothing', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const res = await act('correct_status', { workflow_status: 'PAID' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/can't be reopened/);
    expect(sale().workflow_status).toBe('CANCELLED');
    expect(onHand()).toBe(5);
  });

  it('refuses reopening a partly returned sale', async () => {
    Object.assign(sale(), { workflow_status: 'RETURN_IN_PROGRESS' });
    expect((await act('mark_returned', { quantity: 1 })).status).toBe(200);
    expect((await act('correct_status', { workflow_status: 'RETURN_IN_PROGRESS' })).status).toBe(409);
    expect(sale().workflow_status).toBe('RETURNED');
  });

  it('still moves between excluded statuses', async () => {
    expect((await act('void_sale')).status).toBe(200);
    expect((await act('correct_status', { workflow_status: 'DISPUTED' })).status).toBe(200);
    expect((await act('correct_status', { workflow_status: 'RETURNED' })).status).toBe(200);
    expect(sale().workflow_status).toBe('RETURNED');
    expect(onHand()).toBe(5);
  });

  it('still corrects an active sale, and a cancelled sale with nothing restored', async () => {
    expect((await act('correct_status', { workflow_status: 'PAID' })).status).toBe(200);
    Object.assign(sale(), { workflow_status: 'CANCELLED', status: 'CANCELLED', restored_qty: 0 });
    expect((await act('correct_status', { workflow_status: 'PAID' })).status).toBe(200);
  });

  it('sends restored_qty with the purchase list, so status pickers can narrow their options', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const res = await send('GET', '/api/inventory');
    const listed = res.body.find((inv) => inv.id === harness.ids.inventory).sales[0];
    expect(listed.restored_qty).toBe(2);
  });
});

describe('legacy status writes', () => {
  it('PUT /api/sales/:id refuses setting a restored sale back to SOLD', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const res = await send('PUT', `/api/sales/${harness.ids.sale}`, { status: 'SOLD' });
    expect(res.status).toBe(409);
    expect(sale().status).toBe('CANCELLED');
    // Other edits that re-send the current status still save.
    expect((await send('PUT', `/api/sales/${harness.ids.sale}`, { status: 'CANCELLED', unit_price: 140 })).status).toBe(200);
    expect(sale().unit_price).toBe(140);
  });

  it('the transaction edit window refuses it too, and saves nothing', async () => {
    expect((await act('cancel_sale')).status).toBe(200);
    const write = (status) => send('PUT', `/api/inventory/${harness.ids.inventory}/transaction`, {
      inventory: { qty_purchased: 5, product_name: 'Renamed' },
      sales: [{ id: harness.ids.sale, quantity: 2, status }],
    });
    expect((await write('SOLD')).status).toBe(409);
    expect(harness.db.inventory[0].product_name).toBe('QA Multi-unit Sneaker');
    expect(sale().status).toBe('CANCELLED');
    expect((await write('CANCELLED')).status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({ product_name: 'Renamed', qty_on_hand: 5 });
  });
});

describe('MCP update_shipment', () => {
  it('refuses reopening a voided sale', async () => {
    expect((await act('void_sale')).status).toBe(200);
    const res = await callTool('update_shipment', { item_id: harness.ids.sale, status: 'PAID' });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/can't be reopened/);
    expect(sale().workflow_status).toBe('CANCELLED');
  });

  it('still moves a voided sale to another excluded status', async () => {
    expect((await act('void_sale')).status).toBe(200);
    expect((await callTool('update_shipment', { item_id: harness.ids.sale, status: 'DISPUTED' })).isError).toBe(false);
    expect(sale().workflow_status).toBe('DISPUTED');
  });
});
