import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());

let nextId = 1;
// Stateless Streamable HTTP: no prior "initialize" call is required (see
// node_modules/@modelcontextprotocol/sdk .../webStandardStreamableHttp.js
// validateSession -- session validation, including the _initialized gate, is
// entirely skipped when sessionIdGenerator is undefined), so a tools/call can
// be the very first and only message of a request.
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { httpStatus: response.status, rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  // Error results carry a plain human-readable message, not JSON (see
  // routes/mcp.js errorResult) -- only successful results are JSON.
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { httpStatus: response.status, isError: result.isError || false, data };
}

describe('MCP read tools', () => {
  it('list_sales returns the fixture sale with exact numbers and YYYY-MM-DD dates', async () => {
    const { data } = await callTool('list_sales', {});
    expect(data).toHaveLength(1);
    const [sale] = data;
    expect(sale.item).toBe('QA Multi-unit Sneaker');
    expect(sale.sale_date).toBe('2026-09-03');
    expect(typeof sale.net).toBe('number');
    expect(sale.payout_status).toBe('unpaid');
  });

  it('list_sales filters by payout_status', async () => {
    harness.db.sales[0].paid_at = new Date('2026-09-10T12:00:00Z');
    const paid = await callTool('list_sales', { payout_status: 'paid' });
    expect(paid.data).toHaveLength(1);
    const unpaid = await callTool('list_sales', { payout_status: 'unpaid' });
    expect(unpaid.data).toHaveLength(0);
  });

  it('list_sales filters by buyer name, case-insensitively', async () => {
    harness.db.buyer.push({ id: 'buyer-1', user_id: harness.ids.user, name: 'Windy City' });
    harness.db.sales[0].buyer_id = 'buyer-1';
    const match = await callTool('list_sales', { buyer: 'windy' });
    expect(match.data).toHaveLength(1);
    const noMatch = await callTool('list_sales', { buyer: 'tradepost' });
    expect(noMatch.data).toHaveLength(0);
  });

  it('list_inventory reports total cost and days held', async () => {
    const { data } = await callTool('list_inventory', {});
    expect(data).toHaveLength(1);
    expect(data[0].store).toBe('QA Store');
    expect(data[0].total_cost).toBeCloseTo(100 * 5 + 40 + 20 + 10 - 50, 2);
  });

  it('list_expenses respects the category filter', async () => {
    const match = await callTool('list_expenses', { category: 'Storage' });
    expect(match.data).toHaveLength(1);
    const noMatch = await callTool('list_expenses', { category: 'Shipping' });
    expect(noMatch.data).toHaveLength(0);
  });

  it('get_cashflow_summary reports owed_to_me for an unpaid sale and groups by buyer', async () => {
    harness.db.buyer.push({ id: 'buyer-1', user_id: harness.ids.user, name: 'Blake' });
    harness.db.sales[0].buyer_id = 'buyer-1';
    const { data } = await callTool('get_cashflow_summary', {});
    expect(data.owed_to_me).toBeCloseTo(150 * 2 - 15 - 12, 2);
    expect(data.by_buyer).toEqual([{ buyer: 'Blake', revenue: expect.any(Number), owed: expect.any(Number) }]);
  });

  it('get_cashflow_summary computes owed_to_personal_account from a personal-flagged payment method, net of reimbursements', async () => {
    harness.db.paymentMethod[0].is_personal = true;
    harness.db.expense.push({
      id: 'reimb-1', user_id: harness.ids.user, name: 'Owner payback', amount: 50, tax_version: 0,
      date: new Date(), category: 'Owner Reimbursement',
    });
    const { data } = await callTool('get_cashflow_summary', {});
    // personal spend = inventory batchCost (520) via the personal card; minus the $50 reimbursement.
    expect(data.owed_to_personal_account).toBeCloseTo(520 - 50, 2);
  });

  it('get_unpaid_by_buyer only includes buyers with an outstanding balance', async () => {
    harness.db.buyer.push({ id: 'buyer-1', user_id: harness.ids.user, name: 'Blake' });
    harness.db.sales[0].buyer_id = 'buyer-1';
    harness.db.sales[0].paid_at = new Date();
    const { data } = await callTool('get_unpaid_by_buyer', {});
    expect(data).toEqual([]);
  });
});

describe('MCP write tools', () => {
  it('mark_sale_paid pays an eligible sale and records payout_account', async () => {
    harness.db.sales[0].workflow_status = 'WAITING_FOR_PAYMENT';
    const { data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale], payout_date: '2026-09-30', payout_amount: 273, payout_account: 'Chase College',
    });
    expect(data[0].payout_status).toBe('paid');
    expect(data[0].payout_account).toBe('Chase College');
    expect(harness.db.mcpWriteLog).toHaveLength(1);
    expect(harness.db.mcpWriteLog[0].tool).toBe('mark_sale_paid');
  });

  it('mark_sale_paid returns a tool error (not a crash) for an ineligible sale, and logs nothing', async () => {
    const { isError, data } = await callTool('mark_sale_paid', {
      sale_ids: [harness.ids.sale], payout_date: '2026-09-30', payout_amount: 273,
    });
    expect(isError).toBe(true);
    expect(harness.db.mcpWriteLog).toHaveLength(0);
  });

  it('add_purchase creates a new vendor automatically and logs the write', async () => {
    const { data } = await callTool('add_purchase', {
      item: 'Jordan 1s', qty: 2, unit_cost: 80, store: 'POINTS4DAYS', card_used: 'QA Credit Card', purchase_date: '2026-10-01',
    });
    expect(data.item).toBe('Jordan 1s');
    expect(data.store).toBe('POINTS4DAYS');
    expect(harness.db.platform.some(p => p.name === 'POINTS4DAYS')).toBe(true);
    expect(harness.db.inventory.some(i => i.product_name === 'Jordan 1s' && i.qty_purchased === 2)).toBe(true);
    expect(harness.db.mcpWriteLog).toHaveLength(1);
  });

  it('add_purchase reuses an existing vendor instead of creating a duplicate (case-insensitive)', async () => {
    await callTool('add_purchase', { item: 'X', qty: 1, unit_cost: 1, store: 'qa store', card_used: 'QA Credit Card', purchase_date: '2026-10-01' });
    expect(harness.db.platform.filter(p => p.name.toLowerCase() === 'qa store')).toHaveLength(1);
  });

  it('add_purchase returns a tool error (never auto-creates) for an unknown card', async () => {
    const { isError, data } = await callTool('add_purchase', {
      item: 'X', qty: 1, unit_cost: 1, store: 'POINTS4DAYS', card_used: 'Does Not Exist', purchase_date: '2026-10-01',
    });
    expect(isError).toBe(true);
    expect(harness.db.mcpWriteLog).toHaveLength(0);
    expect(harness.db.paymentMethod.some(m => m.name === 'Does Not Exist')).toBe(false);
  });

  it('add_expense logs an expense against an existing account', async () => {
    const { data } = await callTool('add_expense', {
      description: 'Shipping labels', amount: 12.5, date: '2026-10-01', category: 'Shipping', paid_from_account: 'QA Credit Card',
    });
    expect(data.description).toBe('Shipping labels');
    expect(data.paid_from_account).toBe('QA Credit Card');
    expect(harness.db.expense.some(e => e.name === 'Shipping labels')).toBe(true);
    expect(harness.db.mcpWriteLog).toHaveLength(1);
  });

  it('add_expense returns a tool error for an unknown account and writes nothing', async () => {
    const before = harness.db.expense.length;
    const { isError } = await callTool('add_expense', {
      description: 'Shipping labels', amount: 12.5, date: '2026-10-01', paid_from_account: 'Nonexistent Card',
    });
    expect(isError).toBe(true);
    expect(harness.db.expense).toHaveLength(before);
    expect(harness.db.mcpWriteLog).toHaveLength(0);
  });
});

describe('MCP protocol basics', () => {
  it('rejects a request without the required Accept header', async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_sales', arguments: {} } }),
    });
    expect(response.status).toBe(406);
  });

  it('GET and DELETE are not supported in stateless mode', async () => {
    const get = await fetch(`${baseUrl}/mcp`);
    expect(get.status).toBe(405);
    const del = await fetch(`${baseUrl}/mcp`, { method: 'DELETE' });
    expect(del.status).toBe(405);
  });
});
