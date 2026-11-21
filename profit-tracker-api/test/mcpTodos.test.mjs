import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

// get_todos: the To-Do list over MCP, read-only.
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const { result } = await response.json();
  const text = result.content?.[0]?.text;
  return { isError: result.isError || false, data: text && !result.isError ? JSON.parse(text) : text };
}

const TODAY = new Date().toISOString().slice(0, 10);
const day = (offset) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86400000);
let seq = 0;
function addLateSale(fields = {}) {
  const inv = harness.db.inventory[0];
  const sale = {
    id: `${String(++seq).padStart(8, '0')}-0000-4000-8000-0000000000ab`,
    inventory_id: inv.id, platform_id: harness.db.platform[0]?.id || null,
    quantity: 1, unit_price: 150, commission_fee: 0, sale_shipping: 0,
    sale_date: day(-12), workflow_status: 'WAITING_FOR_PAYMENT', workflow_type: 'STANDARD_MARKETPLACE',
    workflow_status_changed_at: day(-12), paid_at: null, voided_at: null, cancelled_at: null, ...fields,
  };
  harness.db.sales.push(sale);
  return sale;
}

beforeEach(() => {
  harness.reset();
  harness.db.sales = [];
  // The user's zone: "today" for the AI follows it.
  harness.db.notificationSettings.push({ user_id: harness.ids.user, timezone: 'UTC' });
});

describe('get_todos', () => {
  it('returns the To-Do list with money owed and the week so far', async () => {
    const sale = addLateSale();
    const { isError, data } = await callTool('get_todos');
    expect(isError).toBe(false);
    expect(data.today).toBe(TODAY);
    const late = data.items.find((entry) => entry.key === `payout:${sale.id}`);
    expect(late).toMatchObject({ type: 'payout_late', group: 'sales', amount: 150 });
    expect(Object.keys(late).sort()).toEqual(['amount', 'detail', 'due_date', 'group', 'key', 'link', 'title', 'type', 'urgency']);
    expect(data.waiting_payments).toEqual([expect.objectContaining({ total: 150, sales: 1 })]);
    expect(data.cleared_week).toMatchObject({ payouts: 0, sales_moved: 0 });
    expect(data.hidden_items).toBeUndefined();
  });

  it('filters by group and can include what the user hid', async () => {
    const sale = addLateSale();
    harness.db.todoState.push({ id: 'st-1', user_id: harness.ids.user, key: `payout:${sale.id}`, state: 'waiting', until: null, updated_at: new Date() });
    const { data } = await callTool('get_todos', { group: 'sales', include_hidden: true });
    expect(data.items.every((entry) => entry.group === 'sales')).toBe(true);
    expect(data.items.find((entry) => entry.key === `payout:${sale.id}`)).toBeUndefined();
    expect(data.hidden_count).toBe(1);
    expect(data.hidden_items).toEqual([expect.objectContaining({ key: `payout:${sale.id}`, hidden_as: 'waiting', hidden_until: null })]);
  });

  it('writes nothing', async () => {
    addLateSale();
    const before = JSON.stringify(harness.db.todoState);
    harness.calls.length = 0;
    await callTool('get_todos');
    expect(harness.calls.filter((c) => /create|update|upsert|delete/i.test(c.action || c.op || c[1] || ''))).toEqual([]);
    expect(JSON.stringify(harness.db.todoState)).toBe(before);
  });

  it('refuses a group that does not exist', async () => {
    const { isError } = await callTool('get_todos', { group: 'nonsense' });
    expect(isError).toBe(true);
  });
});
