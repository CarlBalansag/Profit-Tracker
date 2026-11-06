import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey, decryptKey, maskKey } = require('../services/cashouts/crypto');
const { getAdapter, listAvailableCashouts } = require('../services/cashouts/registry');
const ebAdapter = require('../services/cashouts/eb');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');
const { verifySyncSecret, runScheduledSync } = require('../services/cashouts/syncScheduler');

let server;
let baseUrl;

// Sample fixture
const fixturePath = path.resolve(__dirname, 'fixtures/eb-deals.json');
const sampleFixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// Setup test encryption key
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_SYNC_SECRET = 'super-secret-sync-bearer-token-12345';

beforeAll(async () => {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.CASHOUT_SYNC_SECRET = TEST_SYNC_SECRET;
  process.env.CASHOUT_BETA_USER_IDS = `${harness.ids.user},beta-user-2`;

  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  harness.reset();
  dealsCache.clear();
  syncBlockedUntil.clear();
  vi.restoreAllMocks();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.CASHOUT_SYNC_SECRET = TEST_SYNC_SECRET;
  process.env.CASHOUT_BETA_USER_IDS = `${harness.ids.user},beta-user-2`;
});

afterAll(() => {
  server.close();
});

const request = async (method, path, body, headers = {}) => {
  const reqHeaders = {
    'Content-Type': 'application/json',
    ...headers,
  };
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: reqHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await response.json();
  } catch (e) {
    // ignore
  }
  return { status: response.status, body: json };
};

describe('Cashout Crypto & Key Storage', () => {
  it('encrypts and decrypts keys accurately (round trip)', () => {
    const rawKey = 'live_test_api_key_12345_very_secret';
    const encrypted = encryptKey(rawKey);

    expect(encrypted).not.toBe(rawKey);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptKey(encrypted);
    expect(decrypted).toBe(rawKey);
  });

  it('rejects tampered ciphertext, IV, or auth tag', () => {
    const rawKey = 'live_test_api_key_12345_very_secret';
    const encrypted = encryptKey(rawKey);
    const parts = encrypted.split(':');

    // Tamper ciphertext
    const tamperedCipher = `${parts[0]}:${parts[1]}:${parts[2].slice(0, -2)}aa`;
    expect(() => decryptKey(tamperedCipher)).toThrow(/Failed to decrypt/);

    // Tamper tag
    const tamperedTag = `${parts[0]}:00000000000000000000000000000000:${parts[2]}`;
    expect(() => decryptKey(tamperedTag)).toThrow(/Failed to decrypt/);

    // Malformed structure
    expect(() => decryptKey('not-a-valid-encrypted-payload')).toThrow();
  });

  it('fails safely with clear error when CASHOUT_KEY_ENCRYPTION_KEY is missing or invalid', () => {
    delete process.env.CASHOUT_KEY_ENCRYPTION_KEY;
    expect(() => encryptKey('some_key')).toThrow(/CASHOUT_KEY_ENCRYPTION_KEY is required/);
    expect(() => decryptKey('a:b:c')).toThrow(/CASHOUT_KEY_ENCRYPTION_KEY is required/);

    process.env.CASHOUT_KEY_ENCRYPTION_KEY = 'too-short';
    expect(() => encryptKey('some_key')).toThrow(/must be exactly 32 bytes/);
  });

  it('masks keys to last 4 characters safely', () => {
    expect(maskKey('live_abcdef1234567890')).toBe('7890');
    expect(maskKey('test_6IBOjleeahl3AJlUO5fbxCEOJkzjv4mhKTONvtGdmoA')).toBe('dmoA');
    expect(maskKey('')).toBe('****');
    expect(maskKey(null)).toBe('****');
  });
});

describe('Cashout Connection CRUD & Tenant Isolation', () => {
  beforeEach(() => {
    // Mock ebAdapter.testKey to succeed by default for valid keys
    vi.spyOn(ebAdapter, 'testKey').mockImplementation(async (key) => {
      if (key === 'invalid-key') throw new Error('ElectronicsBuyer rejected the API key');
      return { success: true };
    });
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue(sampleFixture.data.map(d => ({
      id: String(d.id),
      provider: 'eb',
      name: d.name,
      retail: d.retail,
      payout: d.payout,
      profitMargin: d.profit_margin,
      productLinks: d.product_links,
      categoryId: d.category_id,
      expiresAt: new Date(d.expires_at * 1000).toISOString(),
      startsAt: null,
      featured: d.featured,
      notes: d.notes,
      status: d.status,
      onSaleNow: d.on_sale_now,
      createdAt: new Date(d.created_at * 1000).toISOString(),
      items: d.items.map(i => ({
        id: String(i.id),
        name: i.name,
        condition: i.condition,
        upcs: i.upcs,
        vendorLimit: i.vendor_limit,
        remainingPercentage: i.remaining_percentage,
      })),
    })));
  });

  it('adds a connection and never returns the raw key or ciphertext in response', async () => {
    const rawKey = 'live_secret_key_abcdef9876';
    const res = await request('POST', '/api/cashouts/connections', {
      provider: 'eb',
      display_name: 'My EB Store',
      api_key: rawKey,
    });

    expect(res.status).toBe(201);
    expect(res.body.displayName).toBe('My EB Store');
    expect(res.body.keyLast4).toBe('9876');
    expect(res.body.provider).toBe('eb');
    expect(res.body.status).toBe('active');
    expect(res.body.encrypted_key).toBeUndefined();
    expect(res.body.apiKey).toBeUndefined();
    expect(res.body.rawKey).toBeUndefined();

    // Verify key was stored encrypted in DB
    const connInDb = harness.db.cashoutConnection.find(c => c.id === res.body.id);
    expect(connInDb).toBeDefined();
    expect(connInDb.encrypted_key).not.toBe(rawKey);
    expect(decryptKey(connInDb.encrypted_key)).toBe(rawKey);
  });

  it('failed add saves nothing when testKey fails', async () => {
    const countBefore = harness.db.cashoutConnection.length;

    const res = await request('POST', '/api/cashouts/connections', {
      provider: 'eb',
      display_name: 'Bad Key Store',
      api_key: 'invalid-key',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('ElectronicsBuyer rejected');
    expect(harness.db.cashoutConnection.length).toBe(countBefore);
  });

  it('User A cannot read, test, update, or delete User B connection (tenant isolation)', async () => {
    // Create connection belonging to User B (ids.other)
    const otherConn = {
      id: 'other-conn-id-9999',
      user_id: harness.ids.other,
      provider: 'eb',
      display_name: 'Other user secret connection',
      encrypted_key: encryptKey('live_other_key_1111'),
      key_last4: '1111',
      status: 'active',
      created_at: new Date(),
      updated_at: new Date(),
    };
    harness.db.cashoutConnection.push(otherConn);

    // User A calls GET /api/cashouts/connections
    const listRes = await request('GET', '/api/cashouts/connections');
    expect(listRes.status).toBe(200);
    expect(listRes.body.some(c => c.id === otherConn.id)).toBe(false);

    // User A tries to test User B's connection
    const testRes = await request('POST', `/api/cashouts/connections/${otherConn.id}/test`);
    expect(testRes.status).toBe(404);

    // User A tries to update User B's connection
    const updateRes = await request('PATCH', `/api/cashouts/connections/${otherConn.id}`, {
      display_name: 'Hacked connection',
    });
    expect(updateRes.status).toBe(404);

    // User A tries to delete User B's connection
    const deleteRes = await request('DELETE', `/api/cashouts/connections/${otherConn.id}`);
    expect(deleteRes.status).toBe(404);

    // User B's connection is untouched
    expect(harness.db.cashoutConnection.some(c => c.id === otherConn.id)).toBe(true);
  });

  it('deleting a connection succeeds and re-adding it works', async () => {
    const addRes = await request('POST', '/api/cashouts/connections', {
      provider: 'eb',
      display_name: 'Temporary Connection',
      api_key: 'live_temp_key_4444',
    });
    expect(addRes.status).toBe(201);
    const connId = addRes.body.id;

    // Delete
    const delRes = await request('DELETE', `/api/cashouts/connections/${connId}`);
    expect(delRes.status).toBe(200);
    expect(harness.db.cashoutConnection.some(c => c.id === connId)).toBe(false);

    // Re-add
    const reAddRes = await request('POST', '/api/cashouts/connections', {
      provider: 'eb',
      display_name: 'Temporary Connection 2',
      api_key: 'live_temp_key_4444',
    });
    expect(reAddRes.status).toBe(201);
    expect(reAddRes.body.keyLast4).toBe('4444');
  });

  it('blocks users not in CASHOUT_BETA_USER_IDS from adding or using non-public cashouts', async () => {
    // Set beta list to exclude harness.ids.user
    process.env.CASHOUT_BETA_USER_IDS = 'someone-else-id';

    // Providers list should be empty
    const providersRes = await request('GET', '/api/cashouts/providers');
    expect(providersRes.status).toBe(200);
    expect(providersRes.body).toHaveLength(0);

    // Attempt to add EB connection should be 403 Forbidden
    const addRes = await request('POST', '/api/cashouts/connections', {
      provider: 'eb',
      display_name: 'Forbidden EB',
      api_key: 'live_secret_key_1234',
    });
    expect(addRes.status).toBe(403);
    expect(addRes.body.error).toContain('restricted');
  });
});

describe('Live deals list', () => {
  let userConn;

  beforeEach(() => {
    vi.spyOn(ebAdapter, 'testKey').mockResolvedValue({ success: true });
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      {
        id: '5232',
        provider: 'eb',
        name: 'Airpod 5 ANC',
        retail: 119.0,
        payout: 119.0,
        profitMargin: 0.0,
        productLinks: [],
        items: [{ id: '10356', name: 'AirPods 5 ANC', upcs: ['195951378978'] }],
      },
      {
        id: '5230',
        provider: 'eb',
        name: 'Fire TV Stick 4K Select',
        retail: 14.99,
        payout: 16.0,
        profitMargin: 6.74,
        productLinks: [],
        items: [{ id: '10353', name: 'Fire TV Stick 4K Select', upcs: ['840268958794'] }],
      },
      {
        id: '9999',
        provider: 'eb',
        name: 'Obscure Item With No Inventory Match',
        retail: 50.0,
        payout: 45.0,
        profitMargin: -10.0,
        productLinks: [],
        items: [{ id: '99991', name: 'Obscure Item', upcs: [] }],
      },
    ]);

    userConn = {
      id: 'test-conn-user-1',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Test EB',
      encrypted_key: encryptKey('live_user_key_5555'),
      key_last4: '5555',
      status: 'active',
      platform_id: null,
      last_synced_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };
    harness.db.cashoutConnection.push(userConn);

    // Same name as a live deal, so any leftover matching would show up here.
    harness.db.inventory.push({
      id: 'inv-airpods-id',
      user_id: harness.ids.user,
      product_name: 'Airpod 5 ANC',
      vendor_id: harness.ids.vendor,
      unit_purchase_cost: 90,
      qty_purchased: 2,
      qty_on_hand: 2,
      status: 'PURCHASED',
      purchase_date: new Date('2026-10-01T00:00:00Z'),
      created_at: new Date(),
    });
  });

  it('returns the provider deals as they are, with payouts and no inventory or profit data', async () => {
    const res = await request('GET', '/api/cashouts/deals');
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1);

    const deals = res.body.results[0].deals;
    expect(deals.map(d => d.id)).toEqual(['5232', '5230', '9999']);
    expect(deals.find(d => d.id === '5230').payout).toBe(16);
    for (const deal of deals) {
      expect(deal).not.toHaveProperty('match');
      expect(deal).not.toHaveProperty('financials');
    }
  });

  it('never reads inventory or saved item matches to list deals', async () => {
    const inventory = vi.spyOn(harness.prisma.inventory, 'findMany');
    const matches = vi.spyOn(harness.prisma.cashoutItemMatch, 'findMany');

    const res = await request('GET', '/api/cashouts/deals');

    expect(res.status).toBe(200);
    expect(inventory).not.toHaveBeenCalled();
    expect(matches).not.toHaveBeenCalled();
  });

  it('has no item match routes', async () => {
    const created = await request('POST', '/api/cashouts/matches', {
      provider: 'eb',
      external_deal_id: '5232',
      deal_item_name: 'AirPods 5 ANC',
    });
    expect(created.status).toBe(404);
    expect((await request('DELETE', '/api/cashouts/matches?provider=eb&external_deal_id=5232')).status).toBe(404);
    expect(harness.db.cashoutItemMatch).toHaveLength(0);
  });
});

describe('Cache, Snapshots & History', () => {
  let userConn;

  beforeEach(() => {
    userConn = {
      id: 'conn-cache-test-1',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Cache Test EB',
      encrypted_key: encryptKey('live_key_9999'),
      key_last4: '9999',
      status: 'active',
      platform_id: null,
      last_synced_at: new Date(Date.now() - 120000), // 2 min ago
      created_at: new Date(),
      updated_at: new Date(),
    };
    harness.db.cashoutConnection.push(userConn);
  });

  it('serves cached deals within 60s and only hits adapter on expiry or forceRefresh', async () => {
    const fetchSpy = vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '100', name: 'Item 1', payout: 50, retail: 50, status: 'active', items: [] },
    ]);

    // First call: hits adapter
    await request('GET', '/api/cashouts/deals');
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call within 60s: hits cache
    await request('GET', '/api/cashouts/deals');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('creates snapshots only when price or status changes, not on repeated identical syncs', async () => {
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '200', name: 'Dynamic Price Item', payout: 100, retail: 120, status: 'active', items: [] },
    ]);

    // First fetch: creates snapshot
    await request('GET', '/api/cashouts/deals');
    const snapshots1 = harness.db.cashoutDealSnapshot.filter(s => s.external_deal_id === '200');
    expect(snapshots1).toHaveLength(1);
    expect(Number(snapshots1[0].payout)).toBe(100);

    // Second fetch with identical data: NO duplicate snapshot
    dealsCache.clear(); // clear memory cache to simulate re-fetch
    await request('GET', '/api/cashouts/deals');
    const snapshots2 = harness.db.cashoutDealSnapshot.filter(s => s.external_deal_id === '200');
    expect(snapshots2).toHaveLength(1);

    // Third fetch with changed price ($110): creates 2nd snapshot
    dealsCache.clear();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '200', name: 'Dynamic Price Item', payout: 110, retail: 120, status: 'active', items: [] },
    ]);
    await request('GET', '/api/cashouts/deals');
    const snapshots3 = harness.db.cashoutDealSnapshot.filter(s => s.external_deal_id === '200');
    expect(snapshots3).toHaveLength(2);
    expect(Number(snapshots3[1].payout)).toBe(110);
  });

  it('Sync now enforces 60-second cooldown per connection', async () => {
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);

    // Connection synced 10s ago
    userConn.last_synced_at = new Date(Date.now() - 10000);

    const res = await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
    expect(res.status).toBe(429);
    expect(res.body.cooldown).toBe(true);
    expect(res.body.remainingSeconds).toBeGreaterThan(0);
    expect(res.body.remainingSeconds).toBeLessThanOrEqual(50);
  });

  describe('when the provider is failing', () => {
    const outage = () => { throw new Error('ElectronicsBuyer returned HTTP 503.'); };
    const expireCache = () => {
      dealsCache.get(userConn.id).fetchedAt = Date.now() - 120000;
      userConn.last_synced_at = new Date(Date.now() - 120000);
    };

    beforeEach(async () => {
      userConn.last_synced_at = null;
      vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '1', provider: 'eb', name: 'Thing', payout: 10, retail: null, items: [] }]);
      await request('GET', '/api/cashouts/deals');
      expireCache();
    });

    it('reports Sync now as failed, not successful', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      const res = await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('Failed to refresh: ElectronicsBuyer returned HTTP 503. Showing last known data.');
    });

    it('saves the reason but keeps a temporary failure Active', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      const saved = harness.db.cashoutConnection.find(c => c.id === userConn.id);
      expect(saved.last_error).toContain('HTTP 503');
      expect(saved.status).toBe('active');
    });

    it('clears the saved reason once a refresh works again', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);

      vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);
      syncBlockedUntil.clear();
      const res = await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);

      expect(res.status).toBe(200);
      expect(harness.db.cashoutConnection.find(c => c.id === userConn.id).last_error).toBeNull();
    });

    it('applies the cooldown to failed attempts too', async () => {
      const fetchDeals = vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      const second = await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      expect(second.status).toBe(429);
      expect(fetchDeals).toHaveBeenCalledTimes(1);
    });

    it('waits as long as the provider asks when rate limited', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(() => {
        const err = new Error('ElectronicsBuyer rate limit exceeded. Retry after 300s.');
        err.rateLimited = true;
        err.retryAfter = 300;
        throw err;
      });
      await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      const second = await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      expect(second.status).toBe(429);
      expect(second.body.remainingSeconds).toBeGreaterThan(290);
    });

    it('shows last known deals on page refresh without asking the provider again', async () => {
      const fetchDeals = vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      await request('GET', '/api/cashouts/deals');
      expect(fetchDeals).toHaveBeenCalledTimes(1);

      const res = await request('GET', '/api/cashouts/deals');
      expect(fetchDeals).toHaveBeenCalledTimes(1);
      expect(res.body.results[0].isStale).toBe(true);
      expect(res.body.results[0].deals).toHaveLength(1);
      expect(res.body.results[0].warning).toContain('HTTP 503');
    });

    it('counts a failed refresh as failed in the background sync', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(outage);
      const res = await request('POST', '/internal/cashouts/sync', undefined, {
        'Authorization': `Bearer ${TEST_SYNC_SECRET}`,
      });
      expect(res.body).toMatchObject({ failed: 1, synced: 0 });
    });

    it('still marks a rejected key as needing attention', async () => {
      vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(() => {
        const err = new Error('ElectronicsBuyer API key is invalid or revoked.');
        err.keyRejected = true;
        throw err;
      });
      await request('POST', `/api/cashouts/connections/${userConn.id}/sync`);
      expect(harness.db.cashoutConnection.find(c => c.id === userConn.id).status).toBe('attention_needed');
    });
  });
});

describe('Background Scheduler & /internal/cashouts/sync', () => {
  beforeEach(() => {
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '300', name: 'Sync Item', payout: 25, retail: 30, status: 'active', items: [] },
    ]);
  });

  it('rejects missing or invalid Authorization bearer token', async () => {
    // Missing header
    const resNoAuth = await request('POST', '/internal/cashouts/sync');
    expect(resNoAuth.status).toBe(401);

    // Wrong token
    const resBadToken = await request('POST', '/internal/cashouts/sync', undefined, {
      'Authorization': 'Bearer wrong-token',
    });
    expect(resBadToken.status).toBe(401);
  });

  it('stays disabled if CASHOUT_SYNC_SECRET is not set', async () => {
    delete process.env.CASHOUT_SYNC_SECRET;
    const res = await request('POST', '/internal/cashouts/sync', undefined, {
      'Authorization': `Bearer ${TEST_SYNC_SECRET}`,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('not configured');
  });

  it('executes background sync and returns summary counts only with valid bearer token', async () => {
    // Add two connections: one stale, one recent
    harness.db.cashoutConnection.push({
      id: 'conn-stale',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Stale EB',
      encrypted_key: encryptKey('live_key_stale'),
      key_last4: '1111',
      status: 'active',
      last_synced_at: new Date(Date.now() - 300000), // 5 min ago
      created_at: new Date(),
      updated_at: new Date(),
    });

    harness.db.cashoutConnection.push({
      id: 'conn-recent',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Recent EB',
      encrypted_key: encryptKey('live_key_recent'),
      key_last4: '2222',
      status: 'active',
      last_synced_at: new Date(Date.now() - 10000), // 10s ago -> should skip
      created_at: new Date(),
      updated_at: new Date(),
    });

    const res = await request('POST', '/internal/cashouts/sync', undefined, {
      'Authorization': `Bearer ${TEST_SYNC_SECRET}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.synced).toBe(1);
    expect(res.body.skipped).toBe(1);
    expect(res.body.failed).toBe(0);
    expect(res.body.durationMs).toBeDefined();
    // Verify no keys or deal payloads in the response
    expect(res.body.deals).toBeUndefined();
    expect(res.body.keys).toBeUndefined();
  });

  it('one failing connection does not abort the rest', async () => {
    // Add 2 stale connections
    harness.db.cashoutConnection.push({
      id: 'conn-fail-1',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Failing EB',
      encrypted_key: encryptKey('live_bad_key'),
      key_last4: '0000',
      status: 'active',
      last_synced_at: new Date(Date.now() - 300000),
      created_at: new Date(),
      updated_at: new Date(),
    });

    harness.db.cashoutConnection.push({
      id: 'conn-good-2',
      user_id: harness.ids.user,
      provider: 'eb',
      display_name: 'Good EB',
      encrypted_key: encryptKey('live_good_key'),
      key_last4: '9999',
      status: 'active',
      last_synced_at: new Date(Date.now() - 300000),
      created_at: new Date(),
      updated_at: new Date(),
    });

    vi.spyOn(ebAdapter, 'fetchDeals').mockImplementation(async (key) => {
      if (key === 'live_bad_key') throw new Error('Simulated upstream failure');
      return [];
    });

    const res = await request('POST', '/internal/cashouts/sync', undefined, {
      'Authorization': `Bearer ${TEST_SYNC_SECRET}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.failed).toBe(1);
    expect(res.body.synced).toBe(1);
  });

  it('server starts normally and other routes work when new environment variables are completely missing', async () => {
    delete process.env.CASHOUT_KEY_ENCRYPTION_KEY;
    delete process.env.CASHOUT_SYNC_SECRET;
    delete process.env.CASHOUT_BETA_USER_IDS;

    // Health check works
    const healthRes = await request('GET', '/auth/me');
    expect(healthRes.status).toBe(200);

    // Cashout providers returns empty list cleanly without throwing
    const providersRes = await request('GET', '/api/cashouts/providers');
    expect(providersRes.status).toBe(200);
    expect(providersRes.body).toHaveLength(0);

    // Sync route returns 401 without crashing
    const syncRes = await request('POST', '/internal/cashouts/sync');
    expect(syncRes.status).toBe(401);
  });
});
