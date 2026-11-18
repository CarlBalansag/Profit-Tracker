// AI assistant: its writes land in the Activity log (undoable), list/undo
// activity tools, full refunds, and return windows.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { ids } = harness;

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  harness.reset();
  Object.assign(harness.db.inventory[0], { receiving_status: 'ON_HAND' });
  Object.assign(harness.db.sales[0], { workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'AWAITING_SHIPMENT', restored_qty: 0 });
});

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
const activity = () => harness.db.activityLog;
const today = () => new Date().toISOString().slice(0, 10);
const daysFromNow = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T12:00:00.000Z`); };

describe("the assistant's writes are in the Activity log", () => {
  it('add_purchase is logged as the assistant and can be undone', async () => {
    const res = await callTool('add_purchase', { item: 'Switch 2', qty: 2, unit_cost: 449, store: 'Target', card_used: 'QA Credit Card', purchase_date: '2026-11-10' });
    expect(res.isError).toBe(false);
    expect(res.data.activity_id).toEqual(expect.any(String));
    const entry = activity().find((e) => e.id === res.data.activity_id);
    expect(entry).toMatchObject({ kind: 'change', record_type: 'purchase', record_id: res.data.id, source: 'assistant' });

    const undo = await callTool('undo_activity', { activity_id: res.data.activity_id, confirm: true });
    expect(undo.isError).toBe(false);
    expect(undo.data.undone).toMatchObject({ id: res.data.activity_id, undo: 'undone' });
    expect(undo.data.undo_entry).toMatchObject({ is_undo: true, source: 'assistant' });
    expect(harness.db.inventory.find((i) => i.id === res.data.id)).toBeUndefined();
  });

  it('update_sale, update_purchase, add_sale, add_expense and update_shipment each log one entry', async () => {
    const before = activity().length;
    const u1 = await callTool('update_sale', { sale_id: ids.sale, price: 175 });
    const u2 = await callTool('update_purchase', { purchase_id: ids.inventory, order_number: 'ORD-9' });
    const a1 = await callTool('add_sale', { inventory_id: ids.inventory, qty: 1, sale_price: 160, sale_date: '2026-11-12', platform: 'QA Marketplace' });
    const a2 = await callTool('add_expense', { description: 'Tape', amount: 12.5, date: '2026-11-12', paid_from_account: 'QA Credit Card' });
    const u3 = await callTool('update_shipment', { item_id: ids.sale, tracking_number: '1Z999AA10123456784' });
    for (const r of [u1, u2, a1, a2, u3]) {
      expect(r.isError).toBe(false);
      expect(r.data.activity_id).toEqual(expect.any(String));
    }
    expect(activity().length).toBe(before + 5);
    expect(activity().slice(before).every((e) => e.source === 'assistant')).toBe(true);
    expect(activity().slice(before).map((e) => e.record_type)).toEqual(['sale', 'purchase', 'sale', 'expense', 'sale']);
  });

  it('undoing an assistant edit puts the old value back', async () => {
    const res = await callTool('update_sale', { sale_id: ids.sale, price: 199 });
    expect(harness.db.sales[0].unit_price).toBe(199);
    await callTool('undo_activity', { activity_id: res.data.activity_id, confirm: true });
    expect(Number(harness.db.sales[0].unit_price)).toBe(150);
  });

  it('a no-op edit logs nothing', async () => {
    const before = activity().length;
    const res = await callTool('update_purchase', { purchase_id: ids.inventory, notes: '' });
    expect(res.data.activity_id).toBeNull();
    expect(activity().length).toBe(before);
  });

  it('a failed write logs nothing', async () => {
    const before = activity().length;
    const res = await callTool('add_sale', { inventory_id: ids.inventory, qty: 99, sale_price: 1, sale_date: '2026-11-12', platform: 'QA Marketplace' });
    expect(res.isError).toBe(true);
    expect(activity().length).toBe(before);
  });
});

describe('list_activity and undo_activity', () => {
  it('lists website and assistant entries newest first, with undo state', async () => {
    await callTool('add_expense', { description: 'Labels', amount: 20, date: '2026-11-12', paid_from_account: 'QA Credit Card' });
    const { data } = await callTool('list_activity', { limit: 5 });
    expect(data.entries[0]).toMatchObject({ kind: 'change', record_type: 'expense', item: 'Labels', action: 'create', source: 'assistant', undo: 'available' });
  });

  it('refuses a second undo and only undoes the user\'s own entries', async () => {
    const res = await callTool('add_expense', { description: 'Box', amount: 5, date: '2026-11-12', paid_from_account: 'QA Credit Card' });
    expect((await callTool('undo_activity', { activity_id: res.data.activity_id, confirm: true })).isError).toBe(false);
    const again = await callTool('undo_activity', { activity_id: res.data.activity_id, confirm: true });
    expect(again.isError).toBe(true);
    expect(again.data).toMatch(/already undone/);

    harness.db.activityLog.push({ id: '99999999-9999-4999-8999-999999999999', user_id: ids.other, kind: 'change', record_type: 'expense', record_id: 'x', detail: { rows: [] }, source: 'web', created_at: new Date(), undone_at: null });
    const theirs = await callTool('undo_activity', { activity_id: '99999999-9999-4999-8999-999999999999', confirm: true });
    expect(theirs.isError).toBe(true);
    expect(theirs.data).toMatch(/not found/i);
  });

  it('requires confirm', async () => {
    const res = await callTool('undo_activity', { activity_id: '99999999-9999-4999-8999-999999999999' });
    expect(res.isError).toBe(true);
  });
});

describe('add_refund full_refund', () => {
  it('refunds every unit still in stock at price plus its tax share, sending them back', async () => {
    // Fixture purchase: 5 units at $100 with $40 tax, 3 still on hand.
    const res = await callTool('add_refund', { purchase_id: ids.inventory, full_refund: true, date: today() });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ amount: 324, units_returned: 3 }); // 3 x (100 + 40/5)
    expect(harness.db.inventory[0].qty_on_hand).toBe(0);
  });

  it('keep_items refunds the money but moves no stock', async () => {
    const res = await callTool('add_refund', { purchase_id: ids.inventory, full_refund: true, keep_items: true, date: today() });
    expect(res.data).toMatchObject({ amount: 324, units_returned: 0 });
    expect(harness.db.inventory[0].qty_on_hand).toBe(3);
  });

  it('refunds a sale at the price the buyer paid for the units they still hold', async () => {
    const res = await callTool('add_refund', { sale_id: ids.sale, full_refund: true, date: today() });
    expect(res.data).toMatchObject({ amount: 300, units_returned: 2 }); // 2 x 150
  });

  it('rejects mixed input and nothing-left cases without writing', async () => {
    const before = harness.db.refund.length;
    expect((await callTool('add_refund', { purchase_id: ids.inventory, full_refund: true, amount: 5, date: today() })).data).toMatch(/leave out amount/);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, keep_items: true, amount: 5, date: today() })).data).toMatch(/only goes with full_refund/);
    expect((await callTool('add_refund', { purchase_id: ids.inventory, date: today() })).data).toMatch(/amount is required/);
    harness.db.inventory[0].qty_on_hand = 0;
    expect((await callTool('add_refund', { purchase_id: ids.inventory, full_refund: true, date: today() })).data).toMatch(/No units of this purchase/);
    expect(harness.db.refund.length).toBe(before);
  });
});

describe('list_inventory return windows', () => {
  it('shows return_by_date and days left, and finds windows closing soon, soonest first', async () => {
    harness.db.inventory[0].return_by_date = daysFromNow(5);
    harness.db.inventory.push(
      { ...harness.db.inventory[0], id: 'soon', product_name: 'Soon', return_by_date: daysFromNow(1), qty_on_hand: 1 },
      { ...harness.db.inventory[0], id: 'later', product_name: 'Later', return_by_date: daysFromNow(30), qty_on_hand: 1 },
      { ...harness.db.inventory[0], id: 'closed', product_name: 'Closed', return_by_date: daysFromNow(-2), qty_on_hand: 1 },
      { ...harness.db.inventory[0], id: 'sold', product_name: 'Sold out', return_by_date: daysFromNow(2), qty_on_hand: 0 },
    );
    const all = (await callTool('list_inventory', { limit: 100 })).data.items;
    expect(all.find((i) => i.id === ids.inventory)).toMatchObject({ return_days_left: 5 });
    expect(all.find((i) => i.id === 'closed').return_days_left).toBe(-2);
    expect(all.find((i) => i.id === 'sold').return_days_left).toBeNull();

    const soon = (await callTool('list_inventory', { return_closing_within_days: 7 })).data.items;
    expect(soon.map((i) => i.id)).toEqual(['soon', ids.inventory]);
  });
});
