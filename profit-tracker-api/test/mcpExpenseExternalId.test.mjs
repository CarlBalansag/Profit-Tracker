import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { normalizeExpenseCategory } = require('../services/expenseCategories.js');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
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
  if (payload.error) return { rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { isError: result.isError || false, data };
}
const api = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

const base = { description: 'Proxy plan', amount: 30, date: '2026-10-05', paid_from_account: 'QA Credit Card' };
const expense = (id) => harness.db.expense.find((e) => e.id === id);

describe('add_expense: notes, external_id and categories', () => {
  it('stores notes and external_id, maps "Proxies" to PROXY, and logs one Activity entry', async () => {
    const { isError, data } = await callTool('add_expense', { ...base, category: 'Proxies', notes: 'Monthly', external_id: ' cp-1 ' });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ already_recorded: false, category: 'PROXY', notes: 'Monthly', external_id: 'cp-1', paid_from_account: 'QA Credit Card' });
    expect(data.activity_id).toBeTruthy();
    expect(expense(data.id)).toMatchObject({ category: 'PROXY', notes: 'Monthly', external_id: 'cp-1' });
    expect(harness.db.activityLog).toHaveLength(1);
  });

  it('returns the existing expense instead of adding a second one with the same external_id', async () => {
    const first = await callTool('add_expense', { ...base, external_id: 'cp-2' });
    const before = harness.db.expense.length;
    const again = await callTool('add_expense', { ...base, amount: 99, external_id: 'cp-2' });
    expect(again.isError).toBe(false);
    expect(again.data).toMatchObject({ id: first.data.id, already_recorded: true, amount: 30, activity_id: null });
    expect(harness.db.expense).toHaveLength(before);
    expect(harness.db.activityLog).toHaveLength(1);
  });

  it('only dedupes within one user, and never dedupes expenses without an id', async () => {
    harness.db.expense.push({ id: 'dddddddd-0000-4000-8000-000000000001', user_id: harness.ids.other, name: 'Theirs', amount: 5, date: new Date(), external_id: 'cp-3', tax_version: 0 });
    expect((await callTool('add_expense', { ...base, external_id: 'cp-3' })).data.already_recorded).toBe(false);
    const a = await callTool('add_expense', base);
    const b = await callTool('add_expense', base);
    expect(a.data.id).not.toBe(b.data.id);
    expect(a.data.external_id).toBeNull();
  });

  it('keeps unknown categories as typed and rejects a bad date', async () => {
    expect((await callTool('add_expense', { ...base, category: 'Storage' })).data.category).toBe('Storage');
    expect((await callTool('add_expense', { ...base, date: '10/05/2026' })).isError).toBe(true);
  });

  it('list_expenses returns notes and external_id', async () => {
    await callTool('add_expense', { ...base, notes: 'n', external_id: 'cp-4' });
    const { data } = await callTool('list_expenses', {});
    expect(data.find((e) => e.external_id === 'cp-4')).toMatchObject({ notes: 'n', description: 'Proxy plan' });
  });
});

describe('update_expense', () => {
  it('changes only the fields passed, logs it, and undo puts them back', async () => {
    const { data: added } = await callTool('add_expense', { ...base, notes: 'old' });
    const { isError, data } = await callTool('update_expense', { expense_id: added.id, amount: 35, notes: 'new', external_id: 'cp-9', category: 'software' });
    expect(isError).toBe(false);
    expect(data).toMatchObject({ amount: 35, notes: 'new', external_id: 'cp-9', category: 'SOFTWARE', description: 'Proxy plan', paid_from_account: 'QA Credit Card' });
    expect(data.activity_id).toBeTruthy();
    const undo = await callTool('undo_activity', { activity_id: data.activity_id, confirm: true });
    expect(undo.isError).toBe(false);
    expect(expense(added.id)).toMatchObject({ amount: 30, notes: 'old', external_id: null, category: null });
  });

  it('clears notes, category and external_id with an empty string', async () => {
    const { data: added } = await callTool('add_expense', { ...base, notes: 'x', category: 'PROXY', external_id: 'cp-5' });
    const { data } = await callTool('update_expense', { expense_id: added.id, notes: '', category: '', external_id: '' });
    expect(data).toMatchObject({ notes: null, category: null, external_id: null });
  });

  it('refuses an external_id another expense holds, and changes nothing', async () => {
    await callTool('add_expense', { ...base, external_id: 'cp-6' });
    const { data: second } = await callTool('add_expense', { ...base, amount: 10 });
    const res = await callTool('update_expense', { expense_id: second.id, external_id: 'cp-6', amount: 11 });
    expect(res.isError).toBe(true);
    expect(res.data).toContain('already recorded');
    expect(expense(second.id)).toMatchObject({ amount: 10, external_id: null });
    // Re-saving its own id is fine.
    const { data: own } = await callTool('add_expense', { ...base, external_id: 'cp-7' });
    expect((await callTool('update_expense', { expense_id: own.id, external_id: 'cp-7' })).isError).toBe(false);
  });

  it('cannot touch another user\'s expense, and resets a tax review when the amount changes', async () => {
    harness.db.expense.push({ id: 'dddddddd-0000-4000-8000-000000000002', user_id: harness.ids.other, name: 'Theirs', amount: 5, date: new Date(), tax_version: 0 });
    expect((await callTool('update_expense', { expense_id: 'dddddddd-0000-4000-8000-000000000002', amount: 1 })).data).toContain('not found');
    const { data: added } = await callTool('add_expense', base);
    expense(added.id).tax_details = { reviewed: true, tax_category: 'OTHER' };
    await callTool('update_expense', { expense_id: added.id, amount: 31 });
    expect(expense(added.id).tax_details).toMatchObject({ reviewed: false, tax_category: 'OTHER' });
  });

  it('is a no-op with nothing to change', async () => {
    const { data: added } = await callTool('add_expense', base);
    const { isError, data } = await callTool('update_expense', { expense_id: added.id });
    expect(isError).toBe(false);
    expect(data.activity_id).toBeNull();
  });
});

describe('website expense routes and external_id', () => {
  it('POST stores it and refuses a second expense with the same id (409)', async () => {
    const card = harness.ids.card;
    const first = await api('POST', '/api/expenses', { name: 'A', amount: 10, date: '2026-10-01', payment_method_id: card, external_id: 'web-1', category: 'PROXY' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ external_id: 'web-1', category: 'PROXY' });
    const dupe = await api('POST', '/api/expenses', { name: 'B', amount: 10, date: '2026-10-01', external_id: 'web-1' });
    expect(dupe.status).toBe(409);
    expect(dupe.body.existing_id).toBe(first.body.id);
  });

  it('PUT sets, refuses a taken id, and clears it', async () => {
    const a = await api('POST', '/api/expenses', { name: 'A', amount: 10, date: '2026-10-01', external_id: 'web-2' });
    const b = await api('POST', '/api/expenses', { name: 'B', amount: 10, date: '2026-10-01' });
    expect((await api('PUT', `/api/expenses/${b.body.id}`, { external_id: 'web-2' })).status).toBe(409);
    expect((await api('PUT', `/api/expenses/${a.body.id}`, { external_id: 'web-2', notes: 'same id is fine' })).status).toBe(200);
    const cleared = await api('PUT', `/api/expenses/${a.body.id}`, { external_id: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.external_id).toBeNull();
    expect((await api('PUT', `/api/expenses/${a.body.id}`, { external_id: 'x'.repeat(201) })).status).toBe(400);
  });
});

describe('normalizeExpenseCategory', () => {
  it('maps codes, labels and aliases, and keeps other text', () => {
    expect(normalizeExpenseCategory('proxy')).toBe('PROXY');
    expect(normalizeExpenseCategory('Proxy Services')).toBe('PROXY');
    expect(normalizeExpenseCategory('Software / Tools')).toBe('SOFTWARE');
    expect(normalizeExpenseCategory('shipping_supplies')).toBe('SHIPPING_SUPPLIES');
    expect(normalizeExpenseCategory('  Storage ')).toBe('Storage');
    expect(normalizeExpenseCategory('')).toBeNull();
    expect(normalizeExpenseCategory(undefined)).toBeUndefined();
  });
});
