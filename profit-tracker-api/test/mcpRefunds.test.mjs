import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
const { ids } = harness;
let server, baseUrl;
beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); baseUrl = `http://127.0.0.1:${server.address().port}`; });
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { isError: true, data: payload.error.message };
  const text = payload.result.content?.[0]?.text;
  return { isError: payload.result.isError || false, data: text && !payload.result.isError ? JSON.parse(text) : text };
}
const inv = () => harness.db.inventory[0];
const sale = () => harness.db.sales[0];
const stats = async () => (await (await fetch(`${baseUrl}/api/analytics/dashboard?mode=All&date=All%20Time`)).json()).stats;
const snapshot = () => structuredClone({ inventory: harness.db.inventory, sales: harness.db.sales, refund: harness.db.refund });

describe('AI assistant: refunds', () => {
  it('add_refund records a store return and the totals follow', async () => {
    const res = await callTool('add_refund', { purchase_id: ids.inventory, amount: 104, units_returned: 1, date: '2026-10-05', note: 'Returned one' });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ purchase_id: ids.inventory, sale_id: null, amount: 104, units_returned: 1, date: '2026-10-05', note: 'Returned one' });
    expect(inv()).toMatchObject({ refunded_amount: 104, refunded_qty: 1, qty_on_hand: 2 });
    expect(await stats()).toMatchObject({ totalCost: 416, inventoryValue: 208 });
  });

  it('add_refund records a buyer refund where the item stays put', async () => {
    const res = await callTool('add_refund', { sale_id: ids.sale, amount: 50, date: '2026-09-20' });
    expect(res.data).toMatchObject({ sale_id: ids.sale, amount: 50, units_returned: 0 });
    expect(inv().qty_on_hand).toBe(3);
    expect((await stats()).totalRevenue).toBe(223);
  });

  it('applies the same rules as the app', async () => {
    const before = snapshot();
    const tooMany = await callTool('add_refund', { purchase_id: ids.inventory, amount: 10, units_returned: 4, date: '2026-10-05' });
    expect(tooMany).toMatchObject({ isError: true });
    expect(tooMany.data).toMatch(/Only 3 units are in stock/);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, amount: 521, date: '2026-10-05' })).data).toMatch(/more than the purchase cost/);
    expect((await callTool('add_refund', { amount: 5, date: '2026-10-05' })).isError).toBe(true);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, sale_id: ids.sale, amount: 5, date: '2026-10-05' })).isError).toBe(true);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, amount: 0, date: '2026-10-05' })).isError).toBe(true);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, amount: 5, date: 'next week' })).isError).toBe(true);
    sale().status = 'CANCELLED';
    const cancelled = await callTool('add_refund', { sale_id: ids.sale, amount: 5, date: '2026-10-05' });
    expect(cancelled.data).toMatch(/refunds can.t be changed/);
    sale().status = before.sales[0].status;
    expect(snapshot()).toEqual(before);
  });

  it('list_refunds shows a record\'s refunds, newest first, and only the user\'s own', async () => {
    await callTool('add_refund', { purchase_id: ids.inventory, amount: 5, date: '2026-09-10' });
    await callTool('add_refund', { purchase_id: ids.inventory, amount: 6, date: '2026-09-20' });
    harness.db.refund.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ids.other, inventory_id: ids.inventory, amount: 99, quantity: 0, date: new Date() });
    const res = await callTool('list_refunds', { purchase_id: ids.inventory });
    expect(res.data.map(r => r.amount)).toEqual([6, 5]);
    expect((await callTool('list_refunds', {})).isError).toBe(true);
  });

  it('delete_refund needs confirm:true and undoes the refund exactly', async () => {
    const before = snapshot();
    const created = (await callTool('add_refund', { purchase_id: ids.inventory, amount: 104, units_returned: 1, date: '2026-10-05' })).data;
    expect((await callTool('delete_refund', { refund_id: created.id })).isError).toBe(true);
    expect(harness.db.refund).toHaveLength(1);
    const res = await callTool('delete_refund', { refund_id: created.id, confirm: true });
    expect(res.data).toMatchObject({ deleted: true, id: created.id, amount: 104 });
    expect(snapshot()).toEqual(before);
    expect((await callTool('delete_refund', { refund_id: created.id, confirm: true })).data).toMatch(/Refund not found/);
  });

  it('never touches another user\'s records', async () => {
    harness.db.inventory.push({ ...structuredClone(inv()), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', user_id: ids.other });
    harness.db.refund.push({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', user_id: ids.other, inventory_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', amount: 5, quantity: 0, date: new Date() });
    expect((await callTool('add_refund', { purchase_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', amount: 5, date: '2026-10-05' })).isError).toBe(true);
    expect((await callTool('delete_refund', { refund_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', confirm: true })).isError).toBe(true);
    expect(harness.db.refund).toHaveLength(1);
  });

  it('logs writes like the other assistant tools', async () => {
    await callTool('add_refund', { sale_id: ids.sale, amount: 5, date: '2026-10-05' });
    expect(harness.db.mcpWriteLog.some(l => l.tool === 'add_refund' || l.tool_name === 'add_refund')).toBe(true);
  });
});
