// A purchase can record which of the user's store accounts (Data Setup >
// Accounts) it was bought on. The account must be the user's own and belong to
// the purchase's store.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const { dealsCache } = require('../services/cashouts/service');
const ebAdapter = require('../services/cashouts/eb');

const STORE_ACCOUNT = '99999999-9999-4999-8999-999999999991';
const STORE_ACCOUNT_2 = '99999999-9999-4999-8999-999999999992';
const OTHER_STORE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const OTHER_STORE_ACCOUNT = '99999999-9999-4999-8999-999999999993';
const FOREIGN_ACCOUNT = '99999999-9999-4999-8999-999999999994';

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
  const { db, ids } = harness;
  db.platform.push({ id: OTHER_STORE, user_id: ids.user, name: 'Second Store', type: 'Vendor', fee_pct: 0 });
  db.account.push(
    { id: STORE_ACCOUNT, user_id: ids.user, platform_id: ids.vendor, name: 'Main', status: 'Active' },
    { id: STORE_ACCOUNT_2, user_id: ids.user, platform_id: ids.vendor, name: 'Business', status: 'Active' },
    { id: OTHER_STORE_ACCOUNT, user_id: ids.user, platform_id: OTHER_STORE, name: 'Second main', status: 'Active' },
    { id: FOREIGN_ACCOUNT, user_id: ids.other, platform_id: ids.foreign, name: 'Not yours', status: 'Active' },
  );
});

const send = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};
const newPurchase = (extra = {}) => ({
  product_name: 'Account test item', vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
  unit_purchase_cost: 10, qty_purchased: 1, purchase_date: '2026-11-18', ...extra,
});
const stored = (id) => harness.db.inventory.find((row) => row.id === id);
const existing = () => stored(harness.ids.inventory);

describe('GET /api/inventory store account', () => {
  const listed = async (id) => (await send('GET', '/api/inventory')).body.find((row) => row.id === id);

  it('includes the linked store account name, and only id and name', async () => {
    existing().account_id = STORE_ACCOUNT;
    const row = await listed(harness.ids.inventory);
    expect(row.account_id).toBe(STORE_ACCOUNT);
    expect(row.account).toEqual({ id: STORE_ACCOUNT, name: 'Main' });
  });

  it('returns a null account for a purchase without one', async () => {
    existing().account_id = null;
    expect((await listed(harness.ids.inventory)).account).toBeNull();
  });

  it("never returns another user's account, even if one were linked", async () => {
    existing().account_id = FOREIGN_ACCOUNT;
    const row = await listed(harness.ids.inventory);
    expect(row.account).toBeNull();
    expect(JSON.stringify(row)).not.toContain('Not yours');
  });

  it('follows a renamed account on the next read', async () => {
    existing().account_id = STORE_ACCOUNT_2;
    harness.db.account.find((a) => a.id === STORE_ACCOUNT_2).name = 'Business Prime';
    expect((await listed(harness.ids.inventory)).account.name).toBe('Business Prime');
  });
});

describe('POST /api/inventory with a store account', () => {
  it('saves the account when it belongs to the store', async () => {
    const res = await send('POST', '/api/inventory', newPurchase({ account_id: STORE_ACCOUNT }));
    expect(res.status).toBe(200);
    expect(stored(res.body.id).account_id).toBe(STORE_ACCOUNT);
  });

  it.each([undefined, '', null])('saves no account when account_id is %s', async (accountId) => {
    const res = await send('POST', '/api/inventory', newPurchase({ account_id: accountId }));
    expect(res.status).toBe(200);
    expect(stored(res.body.id).account_id).toBeNull();
  });

  it('rejects an account from a different store and saves nothing', async () => {
    const before = harness.db.inventory.length;
    const res = await send('POST', '/api/inventory', newPurchase({ account_id: OTHER_STORE_ACCOUNT }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/different store/);
    expect(harness.db.inventory).toHaveLength(before);
  });

  it('rejects an account with no store picked', async () => {
    const res = await send('POST', '/api/inventory', newPurchase({ vendor_id: '', account_id: STORE_ACCOUNT }));
    expect(res.status).toBe(400);
  });

  it("rejects another user's account without revealing it", async () => {
    const before = harness.db.inventory.length;
    const res = await send('POST', '/api/inventory', newPurchase({ account_id: FOREIGN_ACCOUNT }));
    expect(res.status).toBe(404);
    expect(res.body.error).not.toMatch(/Not yours/);
    expect(harness.db.inventory).toHaveLength(before);
  });

  it('rejects a malformed account id', async () => {
    expect((await send('POST', '/api/inventory', newPurchase({ account_id: 'nope' }))).status).toBe(400);
  });

  it('returns account_id in the purchase list', async () => {
    await send('PUT', `/api/inventory/${harness.ids.inventory}`, { account_id: STORE_ACCOUNT });
    const list = await send('GET', '/api/inventory');
    expect(list.status).toBe(200);
    const rows = Array.isArray(list.body) ? list.body : list.body.items || list.body.data;
    expect(rows.find((row) => row.id === harness.ids.inventory).account_id).toBe(STORE_ACCOUNT);
  });
});

describe('PUT /api/inventory/:id with a store account', () => {
  const put = (body) => send('PUT', `/api/inventory/${harness.ids.inventory}`, body);

  it('sets, keeps when omitted, switches and clears the account', async () => {
    expect((await put({ account_id: STORE_ACCOUNT })).status).toBe(200);
    expect(existing().account_id).toBe(STORE_ACCOUNT);
    expect((await put({ product_name: 'Renamed' })).status).toBe(200);
    expect(existing().account_id).toBe(STORE_ACCOUNT);
    expect((await put({ account_id: STORE_ACCOUNT_2 })).status).toBe(200);
    expect(existing().account_id).toBe(STORE_ACCOUNT_2);
    expect((await put({ account_id: '' })).status).toBe(200);
    expect(existing().account_id).toBeNull();
    expect((await put({ account_id: '' })).status).toBe(200);
    expect(existing().account_id).toBeNull();
  });

  it('clears the account when only the store changes', async () => {
    await put({ account_id: STORE_ACCOUNT });
    expect((await put({ vendor_id: OTHER_STORE })).status).toBe(200);
    expect(existing()).toMatchObject({ vendor_id: OTHER_STORE, account_id: null });
  });

  it('keeps the account when the same store is sent again', async () => {
    await put({ account_id: STORE_ACCOUNT });
    expect((await put({ vendor_id: harness.ids.vendor })).status).toBe(200);
    expect(existing().account_id).toBe(STORE_ACCOUNT);
  });

  it('accepts a store change together with an account of the new store', async () => {
    expect((await put({ vendor_id: OTHER_STORE, account_id: OTHER_STORE_ACCOUNT })).status).toBe(200);
    expect(existing()).toMatchObject({ vendor_id: OTHER_STORE, account_id: OTHER_STORE_ACCOUNT });
  });

  it('rejects a mismatched account and leaves the purchase unchanged', async () => {
    await put({ account_id: STORE_ACCOUNT });
    const before = structuredClone(existing());
    const res = await put({ account_id: OTHER_STORE_ACCOUNT, product_name: 'Should not save' });
    expect(res.status).toBe(400);
    expect(existing()).toEqual(before);
  });

  it("rejects another user's account", async () => {
    expect((await put({ account_id: FOREIGN_ACCOUNT })).status).toBe(404);
    expect(existing().account_id ?? null).toBeNull();
  });
});

describe('PUT /api/inventory/:id/transaction (edit modal) with a store account', () => {
  const salesOf = () => harness.db.sales
    .filter((s) => s.inventory_id === harness.ids.inventory)
    .map((s) => ({ id: s.id, unit_price: s.unit_price, quantity: s.quantity }));
  const save = (inventory) => send('PUT', `/api/inventory/${harness.ids.inventory}/transaction`, { inventory, sales: salesOf() });

  it('saves, clears on store change, and rejects a mismatch without writing', async () => {
    expect((await save({ vendor_id: harness.ids.vendor, account_id: STORE_ACCOUNT })).status).toBe(200);
    expect(existing().account_id).toBe(STORE_ACCOUNT);

    const before = structuredClone(existing());
    const bad = await save({ vendor_id: harness.ids.vendor, account_id: OTHER_STORE_ACCOUNT, product_name: 'Nope' });
    expect(bad.status).toBe(400);
    expect(existing()).toEqual(before);

    expect((await save({ vendor_id: OTHER_STORE })).status).toBe(200);
    expect(existing()).toMatchObject({ vendor_id: OTHER_STORE, account_id: null });

    expect((await save({ vendor_id: OTHER_STORE, account_id: null })).status).toBe(200);
    expect(existing().account_id).toBeNull();
  });
});

describe('cashout Log Purchase with a store account', () => {
  const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const seed = () => {
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = KEY;
    dealsCache.clear();
    harness.db.platform.push({ id: 'cashout-platform-1', user_id: harness.ids.user, name: 'EB', type: 'Cashout', fee_pct: 0, workflow_preset: 'CASHOUT' });
    harness.db.cashoutConnection.push({
      id: 'conn-1', user_id: harness.ids.user, provider: 'eb', display_name: 'EB', encrypted_key: encryptKey('live_test_key_1234'),
      key_last4: '1234', status: 'active', platform_id: 'cashout-platform-1', last_synced_at: new Date(), last_error: null,
      created_at: new Date(), updated_at: new Date(),
    });
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }] }]);
  };
  const body = (extra) => ({
    deal_id: '2000', item_id: '101', deal_name: 'PS5 Pro', item_name: 'PS5 Pro', quantity: 1,
    tracking_codes: ['1Z999AA10123456784'], vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
    unit_cost: 400, tax_exempt: false, sales_tax: 0, unit_payout: 480, purchase_date: '2026-11-18', ...extra,
  });

  it('saves the account on the purchase it records', async () => {
    seed();
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'c-1', item_id: 101, quantity: 1, created_at: 1732924800 });
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    const res = await send('POST', '/api/cashouts/connections/conn-1/log-purchase', body({ account_id: STORE_ACCOUNT }));
    expect(res.status).toBe(201);
    expect(stored(res.body.inventory.id).account_id).toBe(STORE_ACCOUNT);
  });

  it('rejects an account from another store before committing with EB', async () => {
    seed();
    const commit = vi.spyOn(ebAdapter, 'createCommit');
    const before = harness.db.inventory.length;
    const res = await send('POST', '/api/cashouts/connections/conn-1/log-purchase', body({ account_id: OTHER_STORE_ACCOUNT }));
    expect(res.status).toBe(400);
    expect(commit).not.toHaveBeenCalled();
    expect(harness.db.inventory).toHaveLength(before);
  });
});
