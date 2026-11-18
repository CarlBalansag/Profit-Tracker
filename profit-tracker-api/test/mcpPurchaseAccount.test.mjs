// AI assistant (MCP): which saved store account (Data Setup > Accounts) a
// purchase was made on.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const { dealsCache } = require('../services/cashouts/service');
const ebAdapter = require('../services/cashouts/eb');
const { ids } = harness;

const AMAZON = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const MAIN = '99999999-9999-4999-8999-999999999991';
const BIZ = '99999999-9999-4999-8999-999999999992';
const QA_STORE_LOGIN = '99999999-9999-4999-8999-999999999993';
const FOREIGN = '99999999-9999-4999-8999-999999999994';
const TWIN = '99999999-9999-4999-8999-999999999995';

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
  vi.restoreAllMocks();
  const { db } = harness;
  db.platform.push({ id: AMAZON, user_id: ids.user, name: 'Amazon', type: 'Vendor', fee_pct: 0 });
  db.account.push(
    { id: MAIN, user_id: ids.user, platform_id: AMAZON, name: 'Main', email: 'main@example.com', username: null, status: 'Active' },
    { id: BIZ, user_id: ids.user, platform_id: AMAZON, name: 'Business', email: null, username: 'biz-acct', status: 'Review' },
    { id: QA_STORE_LOGIN, user_id: ids.user, platform_id: ids.vendor, name: 'Store login', status: 'Active' },
    { id: FOREIGN, user_id: ids.other, platform_id: ids.foreign, name: 'Main', status: 'Active' },
  );
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
const purchase = (id) => harness.db.inventory.find((row) => row.id === id);
const base = { item: 'Echo Dot', qty: 1, unit_cost: 25, store: 'Amazon', card_used: 'QA Credit Card', purchase_date: '2026-11-18' };

describe('list_store_accounts', () => {
  it("lists the user's own store logins, sorted, without other users' accounts", async () => {
    const res = await callTool('list_store_accounts');
    expect(res.isError).toBe(false);
    expect(res.data).toEqual([
      { id: BIZ, store: 'Amazon', name: 'Business', username: 'biz-acct', email: null, status: 'Review' },
      { id: MAIN, store: 'Amazon', name: 'Main', username: null, email: 'main@example.com', status: 'Active' },
      { id: QA_STORE_LOGIN, store: 'QA Store', name: 'Store login', username: null, email: null, status: 'Active' },
    ]);
  });

  it('filters by store, and says so when the store does not exist', async () => {
    expect((await callTool('list_store_accounts', { store: 'amazon' })).data.map((a) => a.id)).toEqual([BIZ, MAIN]);
    const missing = await callTool('list_store_accounts', { store: 'Target' });
    expect(missing.isError).toBe(true);
    expect(missing.data).toMatch(/No store named "Target"/);
  });
});

describe('add_purchase with an account', () => {
  it.each([['Main', MAIN], ['main@example.com', MAIN], ['BIZ-ACCT', BIZ], [BIZ, BIZ]])('finds the account by "%s"', async (account, expected) => {
    const res = await callTool('add_purchase', { ...base, account });
    expect(res.isError).toBe(false);
    expect(purchase(res.data.id).account_id).toBe(expected);
    expect(res.data.account).toBe(expected === MAIN ? 'Main' : 'Business');
  });

  it('works as before without an account, or with an empty one', async () => {
    for (const extra of [{}, { account: '' }, { account: '  ' }]) {
      const res = await callTool('add_purchase', { ...base, ...extra });
      expect(res.isError).toBe(false);
      expect(purchase(res.data.id).account_id ?? null).toBeNull();
      expect(res.data.account).toBeNull();
    }
  });

  it('rejects an unknown account, naming the real ones, and saves nothing', async () => {
    const before = harness.db.inventory.length;
    const res = await callTool('add_purchase', { ...base, account: 'Side' });
    expect(res.isError).toBe(true);
    expect(res.data).toBe('No Amazon account matching "Side". Its accounts: Main (main@example.com), Business (biz-acct)');
    expect(harness.db.inventory).toHaveLength(before);
  });

  it("does not match another store's account or another user's account", async () => {
    const otherStore = await callTool('add_purchase', { ...base, account: 'Store login' });
    expect(otherStore.isError).toBe(true);
    const foreign = await callTool('add_purchase', { ...base, store: 'QA Store', account: FOREIGN });
    expect(foreign.isError).toBe(true);
    expect(foreign.data).not.toMatch(/example|Other user/);
  });

  it('refuses an account for a new store without creating the store', async () => {
    const stores = harness.db.platform.length;
    const res = await callTool('add_purchase', { ...base, store: 'Brand New Shop', account: 'Main' });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/No store named "Brand New Shop"/);
    expect(harness.db.platform).toHaveLength(stores);
  });

  it('says when the store has no saved accounts', async () => {
    harness.db.platform.push({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', user_id: ids.user, name: 'Target', type: 'Vendor', fee_pct: 0 });
    const res = await callTool('add_purchase', { ...base, store: 'Target', account: 'Main' });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/Target has no saved accounts/);
  });

  it('asks for the id when a name matches two accounts', async () => {
    harness.db.account.push({ id: TWIN, user_id: ids.user, platform_id: AMAZON, name: 'Main', status: 'Active' });
    const res = await callTool('add_purchase', { ...base, account: 'main' });
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/matches more than one Amazon account.*list_store_accounts/);
    expect((await callTool('add_purchase', { ...base, account: TWIN })).isError).toBe(false);
  });

  it('shows the account in list_inventory and records it in the write log', async () => {
    const res = await callTool('add_purchase', { ...base, account: 'Business' });
    const listed = (await callTool('list_inventory')).data.items.find((i) => i.id === res.data.id);
    expect(listed).toMatchObject({ store: 'Amazon', account: 'Business' });
    expect(harness.db.mcpWriteLog.filter((l) => l.tool === 'add_purchase').at(-1).payload.account).toBe('Business');
  });
});

describe('update_purchase with an account', () => {
  const amazonPurchase = async (account) => (await callTool('add_purchase', { ...base, ...(account ? { account } : {}) })).data.id;

  it('sets, switches and clears the account, logging each change', async () => {
    const id = await amazonPurchase();
    expect((await callTool('update_purchase', { purchase_id: id, account: 'Main' })).data.account).toBe('Main');
    expect(purchase(id).account_id).toBe(MAIN);
    expect((await callTool('update_purchase', { purchase_id: id, account: 'biz-acct' })).data.account).toBe('Business');
    expect(purchase(id).account_id).toBe(BIZ);
    expect((await callTool('update_purchase', { purchase_id: id, account: '' })).data.account).toBeNull();
    expect(purchase(id).account_id).toBeNull();
    const logged = harness.db.changeLog.filter((c) => c.record_id === id && c.field === 'account_id');
    expect(logged.map((c) => c.new_value ?? c.newValue ?? null)).toHaveLength(3);
  });

  it('keeps the account on unrelated edits', async () => {
    const id = await amazonPurchase('Main');
    expect((await callTool('update_purchase', { purchase_id: id, unit_cost: 30 })).data.account).toBe('Main');
    expect(purchase(id).account_id).toBe(MAIN);
  });

  it('clears an old-store account when only the store changes', async () => {
    const id = await amazonPurchase('Main');
    const res = await callTool('update_purchase', { purchase_id: id, store: 'QA Store' });
    expect(res.data.account).toBeNull();
    expect(purchase(id)).toMatchObject({ vendor_id: ids.vendor, account_id: null });
  });

  it('accepts a store change together with an account at the new store', async () => {
    const id = await amazonPurchase('Main');
    const res = await callTool('update_purchase', { purchase_id: id, store: 'QA Store', account: 'Store login' });
    expect(res.isError).toBe(false);
    expect(purchase(id)).toMatchObject({ vendor_id: ids.vendor, account_id: QA_STORE_LOGIN });
  });

  it('rejects an account from another store and changes nothing, even a store it would have created', async () => {
    const id = await amazonPurchase('Main');
    const before = structuredClone(purchase(id));
    const stores = harness.db.platform.length;
    const wrong = await callTool('update_purchase', { purchase_id: id, account: 'Store login', unit_cost: 99 });
    expect(wrong.isError).toBe(true);
    const newStore = await callTool('update_purchase', { purchase_id: id, store: 'Brand New Shop', account: 'Main' });
    expect(newStore.isError).toBe(true);
    expect(purchase(id)).toEqual(before);
    expect(harness.db.platform).toHaveLength(stores);
  });

  it('can be undone from the Activity log', async () => {
    const id = await amazonPurchase();
    const res = await callTool('update_purchase', { purchase_id: id, account: 'Main' });
    expect(res.data.activity_id).toBeTruthy();
    const undo = await callTool('undo_activity', { activity_id: res.data.activity_id, confirm: true });
    expect(undo.isError).toBe(false);
    expect(purchase(id).account_id ?? null).toBeNull();
  });
});

describe('log_cashout_purchase with an account', () => {
  const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  beforeEach(() => {
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = KEY;
    dealsCache.clear();
    harness.db.platform.push({ id: 'cashout-platform-1', user_id: ids.user, name: 'EB', type: 'Cashout', fee_pct: 0, workflow_preset: 'CASHOUT' });
    harness.db.cashoutConnection.push({
      id: 'conn-1', user_id: ids.user, provider: 'eb', display_name: 'EB', encrypted_key: encryptKey('live_test_key_1234'),
      key_last4: '1234', status: 'active', platform_id: 'cashout-platform-1', last_synced_at: new Date(), last_error: null,
      created_at: new Date(), updated_at: new Date(),
    });
    harness.db.apiKey.push({ id: 'qa-api-key', user_id: ids.user, allow_cashout_writes: true });
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }] }]);
  });
  const args = (extra) => ({
    deal_id: '2000', item_id: '101', deal_name: 'PS5 Pro', quantity: 1, tracking_codes: ['1Z999AA10123456784'],
    store: 'Amazon', payment_method: 'QA Credit Card', unit_cost: 400, unit_payout: 480, purchase_date: '2026-11-18', ...extra,
  });

  it('records the account on the purchase', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'c-1', item_id: 101, quantity: 1, created_at: 1732924800 });
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    const res = await callTool('log_cashout_purchase', args({ account: 'Main' }));
    expect(res.isError).toBe(false);
    expect(res.data.account).toBe('Main');
    expect(purchase(res.data.purchase_id).account_id).toBe(MAIN);
  });

  it('rejects a wrong account before committing with EB', async () => {
    const commit = vi.spyOn(ebAdapter, 'createCommit');
    const res = await callTool('log_cashout_purchase', args({ account: 'Nope' }));
    expect(res.isError).toBe(true);
    expect(res.data).toMatch(/No Amazon account matching "Nope"/);
    expect(commit).not.toHaveBeenCalled();
  });
});
