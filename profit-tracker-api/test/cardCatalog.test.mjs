import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const catalog = require('../services/cardCatalog.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => { harness.reset(); catalog._resetForTests(); });
afterAll(() => server.close());

const rawCard = (i, overrides = {}) => ({
  id: `us-card-${i}`, name: `Card ${i}`, country: 'us', issuer: 'Test Bank', status: 'active',
  annual_fee: { amount: 0 },
  rewards: { rate_type: 'cashback_percent', currency_label: 'Cash back', base_rate: { points_per_dollar: 1.5 }, categories: [] },
  benefits: [], last_verified: '2026-10-01',
  ...overrides,
});
const fakeFetch = (body, { ok = true, status = 200 } = {}) => async () => ({ ok, status, json: async () => body });
const manyCards = (n) => Array.from({ length: n }, (_, i) => rawCard(i));

describe('normalizeCard', () => {
  it('maps points, miles and cashback cards to the app\'s reward types', () => {
    const points = catalog.normalizeCard(rawCard(1, { rewards: { rate_type: 'points_multiplier', currency_label: 'Membership Rewards points', base_rate: { points_per_dollar: 1 }, categories: [{ label: 'U.S. supermarkets', points_per_dollar: 4, cap: { amount: 25000, period: 'calendar_year' } }] } }));
    expect(points).toMatchObject({ reward_type: 'points', base_rate: 1, rewards_label: 'Membership Rewards points' });
    expect(points.categories).toEqual([{ label: 'U.S. supermarkets', rate: 4, cap: { amount: 25000, period: 'calendar_year' } }]);
    expect(catalog.normalizeCard(rawCard(2, { rewards: { rate_type: 'miles_multiplier', base_rate: { points_per_dollar: 2 } } })).reward_type).toBe('points');
    expect(catalog.normalizeCard(rawCard(3)).reward_type).toBe('cashback');
    expect(catalog.normalizeCard(rawCard(4, { rewards: { currency: 'none', base_rate: { points_per_dollar: null } } }))).toMatchObject({ reward_type: 'none', base_rate: 0 });
  });

  it('treats a "points" card that earns nothing as a no-rewards card', () => {
    const empty = { rate_type: 'points_multiplier', currency_label: 'No rewards program', base_rate: { points_per_dollar: 0 }, categories: [] };
    expect(catalog.normalizeCard(rawCard(1, { rewards: empty })).reward_type).toBe('none');
    const zeroBase = { rate_type: 'points_multiplier', currency_label: 'Points', base_rate: { points_per_dollar: 0 }, categories: [] };
    expect(catalog.normalizeCard(rawCard(2, { rewards: zeroBase })).reward_type).toBe('none');
    // A store card with 0 base but a bonus category still earns.
    const storeOnly = { rate_type: 'cashback_percent', currency_label: 'Cash back', base_rate: { points_per_dollar: 0 }, categories: [{ label: 'Best Buy purchases', points_per_dollar: 5 }] };
    expect(catalog.normalizeCard(rawCard(3, { rewards: storeOnly })).reward_type).toBe('cashback');
  });

  it('drops non-US, discontinued and nameless records, and bad category rows', () => {
    expect(catalog.normalizeCard(rawCard(1, { country: 'ca' }))).toBeNull();
    expect(catalog.normalizeCard(rawCard(1, { status: 'discontinued' }))).toBeNull();
    expect(catalog.normalizeCard(rawCard(1, { name: '' }))).toBeNull();
    const card = catalog.normalizeCard(rawCard(1, { rewards: { rate_type: 'cashback_percent', base_rate: { points_per_dollar: 1 }, categories: [{ label: 'Gas', points_per_dollar: 'x' }, { label: '', points_per_dollar: 3 }, { label: 'Dining', points_per_dollar: 3 }] } }));
    expect(card.categories).toEqual([{ label: 'Dining', rate: 3, cap: null }]);
  });

  it('only keeps https official links', () => {
    expect(catalog.normalizeCard(rawCard(1, { official_url: 'javascript:alert(1)' })).official_url).toBeNull();
    expect(catalog.normalizeCard(rawCard(1, { official_url: 'https://bank.example/card' })).official_url).toBe('https://bank.example/card');
  });
});

describe('syncCatalog', () => {
  it('stores a fresh download in one upsert', async () => {
    const result = await catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch(manyCards(150)) });
    expect(result.card_count).toBe(150);
    const row = harness.db.cardCatalog.find(r => r.id === catalog.SOURCE_ID);
    expect(row.card_count).toBe(150);
    expect(JSON.parse(row.data)).toHaveLength(150);
  });

  it('refuses a download with too few cards and keeps the old copy', async () => {
    await catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch(manyCards(150)) });
    await expect(catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch(manyCards(3)) })).rejects.toThrow(/only 3/);
    await expect(catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch({}, { ok: false, status: 503 }) })).rejects.toThrow(/503/);
    await expect(catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch({ not: 'a list' }) })).rejects.toThrow(/not a list/);
    expect(harness.db.cardCatalog[0].card_count).toBe(150);
  });
});

describe('getCatalog', () => {
  it('serves the bundled snapshot when nothing is cached', async () => {
    const result = await catalog.getCatalog(harness.prisma, { refresh: false });
    expect(result.source).toBe('bundled');
    expect(result.cards.length).toBeGreaterThan(catalog.MIN_CARDS);
    expect(result.cards.find(c => c.id === 'us-amex-gold')).toMatchObject({ reward_type: 'points', rewards_label: 'Membership Rewards points' });
  });

  it('serves the cached copy once a sync has run', async () => {
    await catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch(manyCards(120)) });
    const result = await catalog.getCatalog(harness.prisma, { refresh: false });
    expect(result.source).toBe('synced');
    expect(result.cards).toHaveLength(120);
  });

  it('refreshes in the background only when the copy is a month old', async () => {
    const prev = process.env.CARD_CATALOG_SYNC;
    delete process.env.CARD_CATALOG_SYNC;
    try {
      let calls = 0;
      const fetchImpl = async (...args) => { calls += 1; return fakeFetch(manyCards(130))(...args); };
      await catalog.syncCatalog(harness.prisma, { fetchImpl: fakeFetch(manyCards(120)), now: new Date('2026-10-01T00:00:00Z') });
      await catalog.getCatalog(harness.prisma, { fetchImpl, now: new Date('2026-10-20T00:00:00Z') });
      expect(calls).toBe(0);
      await catalog.getCatalog(harness.prisma, { fetchImpl, now: new Date('2026-11-05T00:00:00Z') });
      await catalog.refreshInBackground(harness.prisma, { fetchImpl }); // wait for the in-flight refresh
      expect(calls).toBe(1);
      expect(harness.db.cardCatalog[0].card_count).toBe(130);
    } finally {
      if (prev !== undefined) process.env.CARD_CATALOG_SYNC = prev;
    }
  });

  it('falls back to the bundled copy when the cache is unreadable', async () => {
    harness.db.cardCatalog.push({ id: catalog.SOURCE_ID, data: '{broken', card_count: 1, source_url: 'x', synced_at: new Date() });
    const result = await catalog.getCatalog(harness.prisma, { refresh: false });
    expect(result.source).toBe('bundled');
  });
});

describe('GET /api/card-catalog', () => {
  it('returns the catalog with attribution', async () => {
    const res = await fetch(`${baseUrl}/api/card-catalog`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.attribution).toMatchObject({ name: 'OpenCard DB', license: 'CC BY 4.0' });
    expect(body.cards.length).toBeGreaterThan(100);
  });

  it('requires a signed-in user', async () => {
    const res = await fetch(`${baseUrl}/api/card-catalog`, { headers: { 'x-qa-unauthenticated': 'true' } });
    expect(res.status).toBe(401);
  });
});
