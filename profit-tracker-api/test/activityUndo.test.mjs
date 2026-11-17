import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { sameValue } = require('../services/activityLog');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

// A paid sale of 2 units from an on-hand purchase with 3 left in stock.
beforeEach(() => {
  harness.reset();
  Object.assign(harness.db.inventory[0], { receiving_status: 'ON_HAND' });
  Object.assign(harness.db.sales[0], { workflow_status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', status: 'PAID', restored_qty: 0, paid_at: new Date('2026-09-05T12:00:00Z') });
});
afterAll(() => server.close());

const request = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const inv = () => harness.db.inventory[0];
const sale = () => harness.db.sales[0];
const undo = (id) => request('POST', `/api/activity/${id}/undo`);
const entries = async () => (await request('GET', '/api/activity')).body.entries;

describe('activity log: refunds', () => {
  it('logs a purchase refund and undoes it exactly, then redoes it', async () => {
    const added = await request('POST', '/api/refunds', { inventory_id: harness.ids.inventory, amount: 40, quantity: 1, date: '2026-10-01', note: 'returned one' });
    expect(added.status).toBe(200);
    expect(added.body.activity_id).toBeTruthy();
    expect(inv().qty_on_hand).toBe(2);

    const [entry] = await entries();
    expect(entry).toMatchObject({ id: added.body.activity_id, kind: 'refund.add', record_type: 'purchase', undo_state: 'available' });
    expect(entry.detail).toMatchObject({ product_name: 'QA Multi-unit Sneaker', refund: { amount: '40.00', quantity: 1, note: 'returned one' } });

    const undone = await undo(entry.id);
    expect(undone.status).toBe(200);
    expect(harness.db.refund).toHaveLength(0);
    expect(inv()).toMatchObject({ qty_on_hand: 3, refunded_qty: 0, refunded_amount: 0 });
    expect(undone.body.undone.undo_state).toBe('undone');
    expect(undone.body.entry).toMatchObject({ kind: 'refund.remove', reverts_id: entry.id, undo_state: 'available' });

    // The undo is itself undoable: the refund comes back with the same values.
    expect((await undo(undone.body.entry.id)).status).toBe(200);
    expect(harness.db.refund).toHaveLength(1);
    expect(harness.db.refund[0]).toMatchObject({ amount: '40.00', quantity: 1, note: 'returned one' });
    expect(inv()).toMatchObject({ qty_on_hand: 2, refunded_qty: 1 });
  });

  it('logs a refund removal and undo records it again', async () => {
    const added = await request('POST', '/api/refunds', { sale_id: harness.ids.sale, amount: 25, quantity: 0, date: '2026-10-02' });
    const removed = await request('DELETE', `/api/refunds/${added.body.id}`);
    expect(removed.body).toMatchObject({ success: true });
    expect(removed.body.activity_id).toBeTruthy();
    expect(sale().refunded_amount).toBe(0);

    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect(sale().refunded_amount).toBe(25);
  });

  it('says so when the refund was already removed another way', async () => {
    const added = await request('POST', '/api/refunds', { inventory_id: harness.ids.inventory, amount: 10, date: '2026-10-01' });
    await request('DELETE', `/api/refunds/${added.body.id}`);
    const res = await undo(added.body.activity_id);
    // Removing it marked nothing undone; undoing the add now finds no refund.
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('This refund was already removed.');
  });

  it('marks refunds made by the AI assistant as such', async () => {
    const { recordRefund } = require('../services/refunds');
    await recordRefund(harness.ids.user, { inventory_id: harness.ids.inventory, amount: 5 }, { source: 'assistant' });
    expect((await entries())[0].source).toBe('assistant');
  });
});

describe('activity log: status actions', () => {
  it('returns the activity id with the updated record', async () => {
    const res = await request('POST', `/api/sales/${harness.ids.sale}/actions/report_dispute`, {});
    expect(res.status).toBe(200);
    expect(res.body.activity_id).toBeTruthy();
    const [entry] = await entries();
    expect(entry).toMatchObject({ kind: 'status', record_type: 'sale', record_id: harness.ids.sale });
    expect(entry.detail).toMatchObject({ action: 'report_dispute', from: 'PAID', to: 'DISPUTED', product_name: 'QA Multi-unit Sneaker' });
  });

  it('undoes Cancel Sale: status back to Paid and the restored units leave stock again', async () => {
    const cancelled = await request('POST', `/api/sales/${harness.ids.sale}/actions/cancel_sale`, {});
    expect(cancelled.status).toBe(200);
    expect(inv().qty_on_hand).toBe(5);
    expect(sale()).toMatchObject({ workflow_status: 'CANCELLED', restored_qty: 2 });

    const res = await undo(cancelled.body.activity_id);
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(3);
    expect(sale()).toMatchObject({ workflow_status: 'PAID', status: 'PAID', restored_qty: 0, cancelled_at: null });
    expect(res.body.entry.detail).toMatchObject({ undo: true, from: 'CANCELLED', to: 'PAID', stock: { delta: -2 } });

    // And the undo can be undone: cancelled again, units back in stock.
    expect((await undo(res.body.entry.id)).status).toBe(200);
    expect(sale().workflow_status).toBe('CANCELLED');
    expect(inv().qty_on_hand).toBe(5);
  });

  it('refuses when the units it put back in stock were sold again, and changes nothing', async () => {
    const cancelled = await request('POST', `/api/sales/${harness.ids.sale}/actions/cancel_sale`, {});
    inv().qty_on_hand = 1; // 4 of the 5 sold since
    const before = structuredClone(harness.db);

    const res = await undo(cancelled.body.activity_id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("The 2 units this put back in stock have since been sold or used, so it can't be undone.");
    expect(harness.db.sales).toEqual(before.sales);
    expect(harness.db.inventory).toEqual(before.inventory);
    expect(harness.db.activityLog).toEqual(before.activityLog);
  });

  it('refuses when the sale changed after the action', async () => {
    const res1 = await request('POST', `/api/sales/${harness.ids.sale}/actions/report_return`, {});
    sale().workflow_status = 'RETURNED';
    const res = await undo(res1.body.activity_id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This sale changed after this action, so it can't be undone safely.");
  });

  it('restores dates and money fields when undoing Mark Paid', async () => {
    Object.assign(sale(), { workflow_status: 'WAITING_FOR_PAYMENT', status: 'SOLD', paid_at: null, paid_amount: null });
    const paid = await request('POST', `/api/sales/${harness.ids.sale}/actions/mark_paid`, { paid_at: '2026-10-10', paid_amount: 270 });
    expect(paid.status).toBe(200);
    expect(sale().workflow_status).toBe('PAID');

    expect((await undo(paid.body.activity_id)).status).toBe(200);
    expect(sale()).toMatchObject({ workflow_status: 'WAITING_FOR_PAYMENT', paid_at: null, paid_amount: null });
  });

  it('undoes a purchase quantity adjustment', async () => {
    const res = await request('POST', `/api/inventory/${harness.ids.inventory}/actions/restore_inventory`, { qty_on_hand: 5 });
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(5);
    expect((await undo(res.body.activity_id)).status).toBe(200);
    expect(inv().qty_on_hand).toBe(3);
  });
});

describe('activity log: rules', () => {
  const addRefund = () => request('POST', '/api/refunds', { inventory_id: harness.ids.inventory, amount: 10, date: '2026-10-01' });

  it('refuses a second undo of the same entry', async () => {
    const added = await addRefund();
    expect((await undo(added.body.activity_id)).status).toBe(200);
    const again = await undo(added.body.activity_id);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('This was already undone.');
  });

  it('keeps entries older than 30 days but no longer undoes them', async () => {
    const added = await addRefund();
    harness.db.activityLog[0].created_at = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    expect((await entries())[0].undo_state).toBe('expired');
    const res = await undo(added.body.activity_id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Only the last 30 days can be undone.');
    expect(harness.db.refund).toHaveLength(1);
  });

  it("never shows or undoes another user's activity", async () => {
    harness.db.activityLog.push({ id: 'foreign-entry', user_id: harness.ids.other, kind: 'refund.add', record_type: 'purchase', record_id: 'x', detail: {}, source: 'web', created_at: new Date() });
    expect(await entries()).toEqual([]);
    expect((await undo('foreign-entry')).status).toBe(404);
  });

  it('pages newest first with next_before', async () => {
    for (let i = 0; i < 3; i++) {
      await addRefund();
      harness.db.activityLog.at(-1).created_at = new Date(Date.UTC(2026, 10, 10 + i));
    }
    const first = await request('GET', '/api/activity?limit=2');
    expect(first.body.entries.map((e) => new Date(e.created_at).getUTCDate())).toEqual([12, 11]);
    expect(first.body.next_before).toBeTruthy();
    const second = await request('GET', `/api/activity?limit=2&before=${encodeURIComponent(first.body.next_before)}`);
    expect(second.body.entries.map((e) => new Date(e.created_at).getUTCDate())).toEqual([10]);
    expect(second.body.next_before).toBeNull();
  });

  it('rolls the refund back if the activity entry cannot be written', async () => {
    harness.faults['activityLog.create'] = true;
    expect((await addRefund()).status).toBe(500);
    expect(harness.db.refund).toHaveLength(0);
    expect(inv().qty_on_hand).toBe(3);
  });

  it('compares stored values the way the database returns them', () => {
    expect(sameValue('10', 10)).toBe(true);
    expect(sameValue('10.50', 10.5)).toBe(true);
    expect(sameValue(new Date('2026-10-10T00:00:00Z'), '2026-10-10T00:00:00.000Z')).toBe(true);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue(null, 0)).toBe(false);
    expect(sameValue('PAID', 'CANCELLED')).toBe(false);
    expect(sameValue({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe('activity log: edits and adds (part 2)', () => {
  const put = (path, body) => request('PUT', path, body);
  const sale2 = () => harness.db.sales.find((s) => s.id !== harness.ids.sale);

  it('undoes a recorded sale: the sale goes and its units come back', async () => {
    const res = await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 2, unit_price: 120, sale_date: '2026-10-05' });
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(1);
    const [entry] = await entries();
    expect(entry).toMatchObject({ id: res.body.activity_id, kind: 'change', record_type: 'sale', record_id: res.body.id });
    expect(entry.detail).toMatchObject({ action: 'create', product_name: 'QA Multi-unit Sneaker' });

    expect((await undo(entry.id)).status).toBe(200);
    expect(harness.db.sales).toHaveLength(1);
    expect(inv().qty_on_hand).toBe(3);

    // Redo puts the very same sale back.
    const [redoEntry] = await entries();
    expect((await undo(redoEntry.id)).status).toBe(200);
    expect(sale2()).toMatchObject({ id: res.body.id, quantity: 2, unit_price: 120 });
    expect(inv().qty_on_hand).toBe(1);
  });

  it('undoes a sale edit, including the stock it moved', async () => {
    const res = await put(`/api/sales/${harness.ids.sale}`, { quantity: 3, unit_price: 175 });
    expect(res.status).toBe(200);
    expect(inv().qty_on_hand).toBe(2);
    const [entry] = await entries();
    expect(entry.detail.rows.map((r) => `${r.model}:${r.op}`)).toEqual(['inventory:update', 'sales:update']);
    expect(entry.detail.rows[1].fields.unit_price).toEqual({ before: 150, after: 175 });

    expect((await undo(res.body.activity_id)).status).toBe(200);
    expect(sale()).toMatchObject({ quantity: 2, unit_price: 150 });
    expect(inv().qty_on_hand).toBe(3);
  });

  it('refuses to undo an edit that was edited again since, and changes nothing', async () => {
    const first = await put(`/api/sales/${harness.ids.sale}`, { unit_price: 175 });
    await put(`/api/sales/${harness.ids.sale}`, { unit_price: 180 });
    const res = await undo(first.body.activity_id);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("This sale changed after this, so it can't be undone safely.");
    expect(sale().unit_price).toBe(180);
  });

  it('logs nothing when a save changes nothing', async () => {
    const res = await put(`/api/sales/${harness.ids.sale}`, { unit_price: 150 });
    expect(res.status).toBe(200);
    expect(res.body.activity_id).toBeNull();
    expect(await entries()).toEqual([]);
  });

  it('undoes an added purchase together with the sale recorded with it', async () => {
    const res = await request('POST', '/api/inventory', { product_name: 'Drill Kit', unit_purchase_cost: 99, qty_purchased: 2, sale_price: 150, qty_sold: 1 });
    expect(res.status).toBe(200);
    const [entry] = await entries();
    expect(entry).toMatchObject({ record_type: 'purchase', record_id: res.body.id });
    expect(entry.detail.product_name).toBe('Drill Kit');
    expect(entry.detail.rows.map((r) => `${r.model}:${r.op}`)).toEqual(['inventory:create', 'sales:create']);

    expect((await undo(entry.id)).status).toBe(200);
    expect(harness.db.inventory.find((i) => i.id === res.body.id)).toBeUndefined();
    expect(harness.db.sales.filter((s) => s.inventory_id === res.body.id)).toHaveLength(0);
  });

  it('will not remove an added purchase that has sales recorded since', async () => {
    const res = await request('POST', '/api/inventory', { product_name: 'Drill Kit', unit_purchase_cost: 99, qty_purchased: 2 });
    await request('POST', '/api/sales', { inventory_id: res.body.id, quantity: 1, unit_price: 150 });
    const undone = await undo(res.body.activity_id);
    expect(undone.status).toBe(409);
    // Its stock changed with that sale, which is caught first.
    expect(harness.db.inventory.find((i) => i.id === res.body.id)).toBeTruthy();
  });

  it('will not remove an added sale that has a refund recorded since', async () => {
    const res = await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 120 });
    harness.db.refund.push({ id: 'r-x', user_id: harness.ids.user, sale_id: res.body.id, amount: 5, quantity: 0, date: new Date(), created_at: new Date() });
    const undone = await undo(res.body.activity_id);
    expect(undone.status).toBe(409);
    expect(undone.body.error).toBe("This sale has refunds recorded since, so it can't be removed. Remove those first.");
  });

  it('undoes a detail-window save of the purchase and its sales in one go', async () => {
    const res = await put(`/api/inventory/${harness.ids.inventory}/transaction`, {
      inventory: { product_name: 'Renamed Sneaker', unit_purchase_cost: 110 },
      sales: [{ id: harness.ids.sale, unit_price: 160 }],
      newSale: { quantity: 1, unit_price: 140 },
    });
    expect(res.status).toBe(200);
    expect(harness.db.sales).toHaveLength(2);
    const [entry] = await entries();
    expect(entry.detail.rows.map((r) => `${r.model}:${r.op}`).sort()).toEqual(['inventory:update', 'sales:create', 'sales:update']);

    expect((await undo(res.body.activity_id)).status).toBe(200);
    expect(inv()).toMatchObject({ product_name: 'QA Multi-unit Sneaker', unit_purchase_cost: 100, qty_on_hand: 3 });
    expect(harness.db.sales).toHaveLength(1);
    expect(sale().unit_price).toBe(150);
  });

  it('undoes a purchase edit from the inline editor', async () => {
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { product_name: 'New Name', qty_purchased: 6 });
    expect(res.status).toBe(200);
    expect(inv()).toMatchObject({ product_name: 'New Name', qty_purchased: 6, qty_on_hand: 4 });
    expect((await undo(res.body.activity_id)).status).toBe(200);
    expect(inv()).toMatchObject({ product_name: 'QA Multi-unit Sneaker', qty_purchased: 5, qty_on_hand: 3 });
  });

  it('undoes an added expense and an expense edit (bumping its tax version)', async () => {
    const added = await request('POST', '/api/expenses', { name: 'Tape', amount: 12, date: '2026-10-01' });
    expect(added.status).toBe(200);
    expect((await entries())[0]).toMatchObject({ record_type: 'expense', detail: { action: 'create', product_name: 'Tape' } });
    expect((await undo(added.body.activity_id)).status).toBe(200);
    expect(harness.db.expense.find((e) => e.id === added.body.id)).toBeUndefined();

    const expense = harness.db.expense[0];
    const edited = await put(`/api/expenses/${expense.id}`, { amount: 30 });
    expect(edited.status).toBe(200);
    const version = expense.tax_version;
    expect((await undo(edited.body.activity_id)).status).toBe(200);
    expect(harness.db.expense[0].amount).toBe(25);
    expect(harness.db.expense[0].tax_version).toBe(version + 1);
  });

  it('rolls the whole save back if its activity entry cannot be written', async () => {
    harness.faults['activityLog.create'] = true;
    expect((await request('POST', '/api/sales', { inventory_id: harness.ids.inventory, quantity: 1, unit_price: 120 })).status).toBe(500);
    expect(harness.db.sales).toHaveLength(1);
    expect(inv().qty_on_hand).toBe(3);
  });
});
