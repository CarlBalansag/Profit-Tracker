import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
// Loaded after harness.cjs (whose top-level monkeypatch already swapped the
// cached ../prisma.js module), so these resolve to the same faked DB.
const requireApi = createRequire(import.meta.url);
const { createApiKey } = requireApi('../services/apiKeys.js');
const { apiKeyAuth } = requireApi('../middleware/apiKeyAuth.js');
const mcpRouter = requireApi('../routes/mcp.js');
const express = requireApi('express');

// Deliberately bypasses harness.app()'s blanket "req.user = the fixture user"
// middleware -- that stub exists so the OTHER test files don't need a real
// token, but it means it never actually exercises apiKeyAuth.js, the one
// piece of code standing between a leaked/guessed MCP token and someone
// else's financial data. This file is the one place that boundary gets
// tested for real: a real bearer token, hashed and looked up, resolving to
// a real (and only that) user.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/mcp', apiKeyAuth, mcpRouter);
  return app;
}

const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_B_INVENTORY = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001';
const USER_B_SALE = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const USER_B_EXPENSE = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000003';
const USER_B_CARD = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000004';
const USER_B_PLATFORM = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000005';

let server;
let baseUrl;
let tokenA;
let tokenB;

beforeAll(async () => {
  server = buildApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

beforeEach(async () => {
  harness.reset();
  // A second, fully independent user with their own card, purchase, sale, and
  // expense -- none of it reachable through user A's (harness.ids.user) token.
  harness.db.user.push({ id: USER_B, username: 'User B', email: 'userb@example.com', tutorial_seen: true, calendar_token: 'b-token', accounting_preferences: null });
  harness.db.paymentMethod.push({ id: USER_B_CARD, user_id: USER_B, name: 'User B Card', type: 'Credit', default_cashback_rate: 0, category_rates: '[]' });
  harness.db.platform.push({ id: USER_B_PLATFORM, user_id: USER_B, name: 'User B Platform', type: 'Cashout', fee_pct: 0 });
  harness.db.inventory.push({
    id: USER_B_INVENTORY, user_id: USER_B, product_name: 'User B Item', vendor_id: null, payment_method_id: USER_B_CARD,
    unit_purchase_cost: 50, qty_purchased: 1, qty_on_hand: 1, status: 'PURCHASED', purchase_date: new Date(), created_at: new Date(), tax_exempt: false,
  });
  harness.db.sales.push({
    id: USER_B_SALE, inventory_id: USER_B_INVENTORY, platform_id: USER_B_PLATFORM, buyer_id: null, quantity: 1, unit_price: 80,
    commission_fee: 0, sale_shipping: 0, sale_tax_collected: 0, taxable: true, customer_tax_exempt: false, status: 'SOLD',
    workflow_status: 'WAITING_FOR_PAYMENT', sale_date: new Date(), payout_date: null,
    paid_at: null, paid_amount: null, paid_reference: null, payout_account: null, payout_short_amount: null,
  });
  harness.db.expense.push({ id: USER_B_EXPENSE, user_id: USER_B, name: 'User B Expense', amount: 10, tax_version: 0, date: new Date(), category: null });

  tokenA = (await createApiKey(harness.ids.user, 'A')).token;
  tokenB = (await createApiKey(USER_B, 'B')).token;
});

let nextId = 1;
async function callTool(token, name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  if (response.status === 401) return { httpStatus: 401 };
  const payload = await response.json();
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { httpStatus: response.status, isError: result.isError || false, data };
}

describe('MCP bearer-token auth boundary', () => {
  it('rejects a request with no token, before it ever reaches a tool', async () => {
    const res = await callTool(null, 'list_sales', {});
    expect(res.httpStatus).toBe(401);
  });

  it('rejects a well-formed but never-issued token', async () => {
    const res = await callTool('selvora_mcp_' + 'a'.repeat(64), 'list_sales', {});
    expect(res.httpStatus).toBe(401);
  });
});

describe('MCP read tools never leak across users', () => {
  it("list_sales with user A's token never returns user B's sale", async () => {
    const res = await callTool(tokenA, 'list_sales', {});
    expect(res.data.some((s) => s.id === USER_B_SALE)).toBe(false);
  });

  it("list_inventory with user A's token never returns user B's item", async () => {
    const res = await callTool(tokenA, 'list_inventory', {});
    expect(res.data.some((i) => i.id === USER_B_INVENTORY)).toBe(false);
  });

  it("list_expenses with user A's token never returns user B's expense", async () => {
    const res = await callTool(tokenA, 'list_expenses', {});
    expect(res.data.some((e) => e.id === USER_B_EXPENSE)).toBe(false);
  });

  it("get_cashflow_summary with user A's token excludes user B's $80 sale from owed_to_me", async () => {
    const res = await callTool(tokenA, 'get_cashflow_summary', {});
    // Fixture sale for user A has no workflow_status set, so it's not realized
    // revenue either way -- the real assertion is that User B's $80 never shows up.
    expect(res.data.owed_to_me).not.toBeCloseTo(80, 2);
  });

  it("each token sees only its own user's data, confirmed symmetrically", async () => {
    const asA = await callTool(tokenA, 'list_sales', {});
    const asB = await callTool(tokenB, 'list_sales', {});
    expect(asA.data.map((s) => s.id)).not.toContain(USER_B_SALE);
    expect(asB.data.map((s) => s.id)).toEqual([USER_B_SALE]);
  });

  it("list_sales buyer (the sale's platform) never surfaces or matches user B's platform under user A's token", async () => {
    const all = await callTool(tokenA, 'list_sales', {});
    expect(all.data.some((s) => s.buyer === 'User B Platform')).toBe(false);
    const filtered = await callTool(tokenA, 'list_sales', { buyer: 'User B Platform' });
    expect(filtered.data).toEqual([]);
  });
});

describe('MCP write tools reject a foreign id instead of silently no-op-ing', () => {
  it("mark_sale_paid with user A's token cannot pay off user B's sale", async () => {
    const res = await callTool(tokenA, 'mark_sale_paid', {
      sale_ids: [USER_B_SALE], payout_date: '2026-10-08', payout_amount: 80,
    });
    expect(res.isError).toBe(true);
    const stillUnpaid = harness.db.sales.find((s) => s.id === USER_B_SALE);
    expect(stillUnpaid.paid_at).toBeNull();
  });

  it("add_purchase with user A's token never attaches to user B's card even by exact name", async () => {
    const res = await callTool(tokenA, 'add_purchase', {
      item: 'X', qty: 1, unit_cost: 1, store: 'Some Store', card_used: 'User B Card', purchase_date: '2026-10-08',
    });
    expect(res.isError).toBe(true);
  });

  it("add_expense with user A's token never attaches to user B's card even by exact name", async () => {
    const res = await callTool(tokenA, 'add_expense', {
      description: 'X', amount: 1, date: '2026-10-08', paid_from_account: 'User B Card',
    });
    expect(res.isError).toBe(true);
    expect(harness.db.expense.some((e) => e.description === 'X')).toBe(false);
  });
});

describe('get_unpaid_by_buyer never mixes buyers across users', () => {
  it("counts user B's unpaid sale only under user B's token", async () => {
    const asA = await callTool(tokenA, 'get_unpaid_by_buyer', {});
    const asB = await callTool(tokenB, 'get_unpaid_by_buyer', {});
    expect(asA.data.reduce((sum, b) => sum + b.owed, 0)).not.toBeCloseTo(80, 2);
    expect(asB.data.reduce((sum, b) => sum + b.owed, 0)).toBeCloseTo(80, 2);
  });
});
