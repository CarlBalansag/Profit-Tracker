import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const ebAdapter = require('../services/cashouts/eb');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

let server;
let baseUrl;

beforeAll(async () => {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  harness.reset();
  dealsCache.clear();
  syncBlockedUntil.clear();
  vi.restoreAllMocks();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

afterEach(() => {
  delete process.env.CASHOUT_KEY_ENCRYPTION_KEY;
});

let nextId = 1;
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
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { httpStatus: response.status, isError: result.isError || false, data };
}

function addConnection(overrides = {}) {
  const conn = {
    id: 'conn-1',
    user_id: harness.ids.user,
    provider: 'eb',
    display_name: 'EB Primary',
    encrypted_key: encryptKey('live_test_key_1234'),
    key_last4: '1234',
    status: 'active',
    platform_id: null,
    last_synced_at: new Date(Date.now() - 120000),
    last_error: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  harness.db.cashoutConnection.push(conn);
  return conn;
}

const futureIso = (days) => new Date(Date.now() + days * 86400000).toISOString();

describe('MCP cashout tools', () => {
  it('list_cashout_deals returns nothing and no error when no cashout is connected', async () => {
    const { data } = await callTool('list_cashout_deals', {});
    expect(data).toEqual({ deals: [], total: 0, truncated: false });
  });

  it('list_cashout_deals returns live deals with raw numbers for the AI to do its own math', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      {
        id: '5213', provider: 'eb', name: 'PS5 Pro', imageUrl: null, retail: 899.99, payout: 1140,
        expiresAt: futureIso(24), featured: true, notes: 'Use Code: SAVE10\nDeliver To: Delaware Only',
        status: 'active', avgRemainingPercentage: 96,
        items: [{ id: '10001', name: 'PS5 Pro', condition: 'new', upcs: ['711719024538'], vendorLimit: 100, remainingPercentage: 96, purchaseLinks: [{ name: 'Amazon', url: 'https://www.amazon.com/dp/1' }] }],
      },
    ]);

    const { data } = await callTool('list_cashout_deals', {});
    expect(data.total).toBe(1);
    const [deal] = data.deals;
    expect(deal.id).toBe('5213');
    expect(deal.cashout).toBe('EB Primary');
    expect(deal.payout).toBe(1140);
    expect(deal.retail).toBe(899.99);
    expect(deal.spread_vs_retail).toEqual({ amount: 240.01, pct: 26.67 });
    expect(deal.vendor_limit_total).toBe(100);
    expect(deal.coupon_code).toBe('SAVE10');
    expect(deal.delivery_restriction).toBe('Delaware Only');
    expect(deal.items[0].item_id).toBe('10001');
    expect(deal.items[0].stores).toEqual([{ name: 'Amazon', url: 'https://www.amazon.com/dp/1' }]);
    expect(deal.currency).toBe('USD');
  });

  it('parses a dropship address into structured fields, and says null means unspecified, not "ship anywhere"', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '1', provider: 'eb', name: 'No Address Deal', payout: 10, retail: 8, notes: 'Deal Extended', items: [] },
      {
        id: '2', provider: 'eb', name: 'Addressed Deal', payout: 10, retail: 8,
        notes: 'Dropship To:\nCSG LLC\n202 Carson Dr\nBear, DE 19701', items: [],
      },
    ]);

    const { data } = await callTool('list_cashout_deals', {});
    const noAddress = data.deals.find((d) => d.id === '1');
    const addressed = data.deals.find((d) => d.id === '2');

    expect(noAddress.ship_to_address).toBeNull();
    expect(addressed.ship_to_address).toEqual({
      parsed: true, name: 'CSG LLC', line1: '202 Carson Dr', line2: null,
      city: 'Bear', state: 'DE', zip: '19701', raw: 'CSG LLC\n202 Carson Dr\nBear, DE 19701',
    });
  });

  it('list_cashout_deals filters by category, store, cashout and search', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '1', provider: 'eb', name: 'Above Deal', payout: 110, retail: 100, items: [{ id: 'i1', purchaseLinks: [{ name: 'Amazon', url: 'https://a' }] }] },
      { id: '2', provider: 'eb', name: 'Below Deal', payout: 90, retail: 100, items: [{ id: 'i2', purchaseLinks: [{ name: 'Target', url: 'https://t' }] }] },
    ]);

    expect((await callTool('list_cashout_deals', { category: 'above_retail' })).data.deals.map((d) => d.id)).toEqual(['1']);
    expect((await callTool('list_cashout_deals', { category: 'close_to_retail' })).data.deals.map((d) => d.id)).toEqual(['2']);
    expect((await callTool('list_cashout_deals', { store: 'amazon' })).data.deals.map((d) => d.id)).toEqual(['1']);
    expect((await callTool('list_cashout_deals', { cashout: 'primary' })).data.total).toBe(2);
    expect((await callTool('list_cashout_deals', { cashout: 'nope' })).data.total).toBe(0);
    expect((await callTool('list_cashout_deals', { search: 'below' })).data.deals.map((d) => d.id)).toEqual(['2']);
  });

  it('list_cashout_deals hides expired deals unless include_expired is set', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '1', provider: 'eb', name: 'Expired', payout: 10, retail: 8, expiresAt: futureIso(-1), items: [] },
    ]);

    expect((await callTool('list_cashout_deals', {})).data.total).toBe(0);
    const { data } = await callTool('list_cashout_deals', { include_expired: true });
    expect(data.total).toBe(1);
    expect(data.deals[0].is_expired).toBe(true);
  });

  it('get_cashout_deal returns found: false for a deal that is no longer listed', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);
    const { data } = await callTool('get_cashout_deal', { id: 'gone' });
    expect(data).toEqual({ found: false, reason: expect.stringContaining('no longer listed') });
  });

  it('get_cashout_deal forces a fresh fetch and reports fresh: false when the cooldown blocks it', async () => {
    const conn = addConnection({ last_synced_at: new Date() }); // just synced -- cooldown active
    const fetchSpy = vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '42', provider: 'eb', name: 'Still Here', payout: 20, retail: 15, items: [] },
    ]);
    // Seed the cache so the cooldown fallback has something to search.
    dealsCache.set(conn.id, { deals: [{ id: '42', provider: 'eb', name: 'Still Here', payout: 20, retail: 15, items: [] }], fetchedAt: Date.now(), error: null });

    const { data } = await callTool('get_cashout_deal', { id: '42' });
    expect(data.found).toBe(true);
    expect(data.fresh).toBe(false);
    expect(data.deal.name).toBe('Still Here');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('get_cashout_opportunity_summary aggregates across deals and labels the estimate as an estimate', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([
      { id: '1', provider: 'eb', name: 'Big Spread', payout: 1140, retail: 899.99, items: [{ id: 'i1', vendorLimit: 100, purchaseLinks: [] }] },
      { id: '2', provider: 'eb', name: 'Small Spread', payout: 100, retail: 95, items: [{ id: 'i2', vendorLimit: 10, purchaseLinks: [] }] },
      { id: '3', provider: 'eb', name: 'Loss', payout: 35, retail: 40, items: [{ id: 'i3', vendorLimit: 5, purchaseLinks: [] }] },
    ]);

    const { data } = await callTool('get_cashout_opportunity_summary', {});
    expect(data.live_deal_count).toBe(3);
    expect(data.above_retail_count).toBe(2);
    expect(data.best_margin.deal_id).toBe('1');
    expect(data.estimated_opportunity_at_full_limit).toBe(
      Math.round((240.01 * 100 + 5 * 10 + -5 * 5) * 100) / 100
    );
    expect(data.by_cashout).toEqual([{ cashout: 'EB Primary', deal_count: 3, status: 'active' }]);
  });

  it('list_cashout_connections lists status without leaking the stored key', async () => {
    addConnection({ last_error: 'ElectronicsBuyer rate limit exceeded.' });
    const { data } = await callTool('list_cashout_connections', {});
    expect(data).toEqual([{
      id: 'conn-1', provider: 'eb', display_name: 'EB Primary', status: 'active',
      last_synced_at: expect.any(String), last_error: 'ElectronicsBuyer rate limit exceeded.',
    }]);
    expect(JSON.stringify(data)).not.toContain('encrypted');
  });

  it('sync_cashout_deals refreshes and reports a cooldown without retrying it', async () => {
    const conn = addConnection({ last_synced_at: new Date() });
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);
    const { data } = await callTool('sync_cashout_deals', {});
    expect(data.results).toEqual([{ cashout: 'EB Primary', synced: false, cooldown_seconds_remaining: expect.any(Number), error: expect.stringContaining('cooldown') }]);
  });

  it('sync_cashout_deals filters to one named cashout and errors on no match', async () => {
    addConnection();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);
    const match = await callTool('sync_cashout_deals', { cashout: 'primary' });
    expect(match.data.results).toHaveLength(1);
    const noMatch = await callTool('sync_cashout_deals', { cashout: 'nothing-like-this' });
    expect(noMatch.isError).toBe(true);
  });
});
