import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const catalog = require('../services/cardCatalog.js');
const { refreshFromCatalog, catalogFields } = require('../services/catalogCardFields.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());

const send = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const stored = (id) => harness.db.paymentMethod.find(pm => pm.id === id);
const storedRates = (id) => JSON.parse(stored(id).category_rates || '[]');

const goldCard = (overrides = {}) => ({
  id: 'us-test-gold', name: 'Test Gold Card', issuer: 'Test Bank', reward_type: 'points',
  rewards_label: 'Test Rewards points', base_rate: 1,
  categories: [{ label: 'Restaurants worldwide', rate: 4, cap: null }, { label: 'U.S. supermarkets', rate: 4, cap: null }],
  benefits: [], last_verified: '2026-10-01',
  ...overrides,
});
const cashCard = (overrides = {}) => ({
  id: 'us-test-cash', name: 'Test Cash Card', issuer: 'Test Bank', reward_type: 'cashback',
  rewards_label: 'Cash back', base_rate: 1.5, categories: [{ label: 'Amazon purchases', rate: 5, cap: null }],
  benefits: [], last_verified: '2026-10-01',
  ...overrides,
});

// Serve this list as the "synced" catalog. Each call gets a new synced_at so
// the cached index is rebuilt, the way a real monthly refresh would.
let tick = 0;
const setCatalog = (cards) => {
  tick += 1;
  const row = { id: catalog.SOURCE_ID, data: JSON.stringify(cards), card_count: cards.length, source_url: 'test', synced_at: new Date(Date.UTC(2026, 10, 1, 0, 0, tick)), last_verified: null };
  harness.db.cardCatalog.splice(0, harness.db.cardCatalog.length, row);
};

beforeEach(() => {
  harness.reset();
  catalog._resetForTests();
  setCatalog([goldCard(), cashCard()]);
});

const addGold = async (extra = {}) => (await send('POST', '/api/payment-methods', {
  name: 'Gold', type: 'Credit', catalog_card_id: 'us-test-gold', apply_catalog: true, point_value_cents: 1.5, ...extra,
})).body;

describe('adding a card from the catalog (apply_catalog)', () => {
  it('fills rewards and store rates from the catalog on the server', async () => {
    const card = await addGold();
    expect(card).toMatchObject({ reward_type: 'points', points_base_rate: 1, point_value_cents: 1.5, default_cashback_rate: 1.5, rewards_label: 'Test Rewards points', catalog_card_id: 'us-test-gold' });
    expect(card.category_rates).toEqual(expect.arrayContaining([
      { store: 'Dining', rate: 6, points: 4, source: 'catalog' },
      { store: 'Supermarket', rate: 6, points: 4, source: 'catalog' },
    ]));
    expect(card.catalog_applied).toBeUndefined(); // internal, not sent to the app
    expect(JSON.parse(stored(card.id).catalog_applied)).toEqual(catalogFields(goldCard()));
  });

  it("keeps the user's own store rates, and they win over the catalog's", async () => {
    const card = await addGold({ category_rates: [{ store: 'eBay', rate: 2 }, { store: 'Dining', rate: 10 }] });
    const dining = card.category_rates.filter(r => r.store === 'Dining');
    expect(dining).toHaveLength(1);
    expect(dining[0].source).toBeUndefined();
    expect(card.category_rates).toContainEqual(expect.objectContaining({ store: 'eBay', rate: 2 }));
  });

  it('rejects an unknown catalog card without writing anything', async () => {
    const before = harness.db.paymentMethod.length;
    const res = await send('POST', '/api/payment-methods', { name: 'X', type: 'Credit', catalog_card_id: 'us-nope', apply_catalog: true });
    expect(res.status).toBe(400);
    expect(harness.db.paymentMethod.length).toBe(before);
  });

  it('ignores catalog bookkeeping fields sent by the client', async () => {
    const res = await send('POST', '/api/payment-methods', { name: 'X', type: 'Credit', default_cashback_rate: 1, catalog_applied: '{"evil":true}', catalog_synced_at: 'not a date' });
    expect(res.status).toBe(200);
    expect(stored(res.body.id).catalog_applied).toBeNull();
  });
});

describe('re-linking a saved card to a different catalog card', () => {
  it('swaps the rewards to the new card and keeps point value, own rates and billing', async () => {
    const card = await addGold({ category_rates: [{ store: 'eBay', rate: 2 }] });
    await send('PUT', `/api/payment-methods/${card.id}`, { name: 'Gold', type: 'Credit', last4: '4242', due_day: 9 });
    const res = await send('PUT', `/api/payment-methods/${card.id}`, {
      name: 'Cash', type: 'Credit', catalog_card_id: 'us-test-cash', apply_catalog: true,
      category_rates: storedRates(card.id).filter(r => r.source !== 'catalog'),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Cash', catalog_card_id: 'us-test-cash', reward_type: 'cashback', default_cashback_rate: 1.5, points_base_rate: null, last4: '4242', due_day: 9 });
    expect(res.body.category_rates).toContainEqual({ store: 'Amazon', rate: 5, source: 'catalog' });
    expect(res.body.category_rates).toContainEqual(expect.objectContaining({ store: 'eBay', rate: 2 }));
    expect(res.body.category_rates.find(r => r.store === 'Dining')).toBeUndefined();
    // Now follows the new card.
    setCatalog([goldCard(), cashCard({ base_rate: 3 })]);
    const list = await send('GET', '/api/payment-methods');
    expect(list.body.find(m => m.id === card.id).default_cashback_rate).toBe(3);
  });
});

describe('auto-update when the catalog changes', () => {
  it('updates base and store rates on the next card load, keeping the point value', async () => {
    const card = await addGold();
    setCatalog([goldCard({ base_rate: 2, categories: [{ label: 'Restaurants worldwide', rate: 3, cap: null }, { label: 'U.S. gas stations', rate: 5, cap: null }] }), cashCard()]);
    const res = await send('GET', '/api/payment-methods');
    const updated = res.body.find(m => m.id === card.id);
    expect(updated).toMatchObject({ points_base_rate: 2, point_value_cents: 1.5, default_cashback_rate: 3 });
    expect(updated.catalog_synced_at).toBeTruthy();
    const rates = storedRates(card.id);
    expect(rates).toContainEqual({ store: 'Dining', rate: 4.5, points: 3, source: 'catalog' });
    expect(rates).toContainEqual({ store: 'Gas', rate: 7.5, points: 5, source: 'catalog' });
    expect(rates.find(r => r.store === 'Supermarket')).toBeUndefined(); // dropped by the issuer
  });

  it("never touches the user's own store rates or rates they edited", async () => {
    const card = await addGold({ category_rates: [{ store: 'eBay', rate: 2 }] });
    // The user edits the catalog Dining rate by hand (4x -> 6x).
    const rates = storedRates(card.id).map(r => (r.store === 'Dining' ? { ...r, points: 6 } : r));
    await send('PUT', `/api/payment-methods/${card.id}`, { name: 'Gold', type: 'Credit', category_rates: rates });
    setCatalog([goldCard({ categories: [{ label: 'Restaurants worldwide', rate: 3, cap: null }, { label: 'U.S. supermarkets', rate: 2, cap: null }] }), cashCard()]);
    await send('GET', '/api/payment-methods');
    const after = storedRates(card.id);
    expect(after.find(r => r.store === 'Dining')).toMatchObject({ points: 6 });
    expect(after.find(r => r.store === 'eBay')).toMatchObject({ points: expect.any(Number) });
    expect(after.find(r => r.store === 'Supermarket')).toMatchObject({ points: 2, source: 'catalog' });
  });

  it('leaves a card alone once the user changed its base rate by hand', async () => {
    const card = await addGold();
    await send('PUT', `/api/payment-methods/${card.id}`, { name: 'Gold', type: 'Credit', points_base_rate: 5 });
    setCatalog([goldCard({ base_rate: 2, categories: [] }), cashCard()]);
    await send('GET', '/api/payment-methods');
    expect(stored(card.id)).toMatchObject({ points_base_rate: 5, default_cashback_rate: 7.5 });
    expect(storedRates(card.id).find(r => r.store === 'Dining')).toMatchObject({ points: 4 });
    // ...and it records the new catalog version, so it doesn't retry every load.
    harness.calls.length = 0;
    await send('GET', '/api/payment-methods');
    expect(harness.calls.filter(c => c.model === 'paymentMethod' && c.op === 'updateMany')).toHaveLength(0);
  });

  it('does nothing when the catalog has not changed', async () => {
    await addGold();
    harness.calls.length = 0;
    await send('GET', '/api/payment-methods');
    expect(harness.calls.filter(c => c.model === 'paymentMethod' && c.op === 'updateMany')).toHaveLength(0);
  });

  it('updates cashback cards too', async () => {
    const card = (await send('POST', '/api/payment-methods', { name: 'Cash', type: 'Credit', catalog_card_id: 'us-test-cash', apply_catalog: true })).body;
    expect(card).toMatchObject({ reward_type: 'cashback', default_cashback_rate: 1.5 });
    setCatalog([goldCard(), cashCard({ base_rate: 2 })]);
    const res = await send('GET', '/api/payment-methods');
    expect(res.body.find(m => m.id === card.id).default_cashback_rate).toBe(2);
    expect(storedRates(card.id)).toContainEqual({ store: 'Amazon', rate: 5, source: 'catalog' });
  });

  it('never adds store rates to a card added with store rates turned off', async () => {
    const card = await addGold({ include_store_rates: false });
    expect(card.category_rates).toEqual([]);
    setCatalog([goldCard({ base_rate: 2 }), cashCard()]);
    await send('GET', '/api/payment-methods');
    expect(stored(card.id).points_base_rate).toBe(2);
    expect(storedRates(card.id)).toEqual([]);
  });

  it('leaves a card alone when it disappears from the catalog', async () => {
    const card = await addGold();
    setCatalog([cashCard()]);
    const res = await send('GET', '/api/payment-methods');
    expect(res.status).toBe(200);
    expect(stored(card.id).points_base_rate).toBe(1);
  });

  it("does not touch another user's cards", async () => {
    harness.db.paymentMethod.push({
      id: 'theirs', user_id: harness.ids.other, name: 'Their Gold', type: 'Credit', reward_type: 'points',
      points_base_rate: 1, point_value_cents: 1, default_cashback_rate: 1, category_rates: '[]',
      catalog_card_id: 'us-test-gold', catalog_applied: JSON.stringify(catalogFields(goldCard({ base_rate: 9 }))),
    });
    await send('GET', '/api/payment-methods');
    expect(stored('theirs').points_base_rate).toBe(1);
  });

  it('still loads cards when the catalog read fails', async () => {
    await addGold();
    harness.faults['cardCatalog.findUnique'] = true;
    const res = await send('GET', '/api/payment-methods');
    expect(res.status).toBe(200);
    expect(res.body.some(m => m.name === 'Gold')).toBe(true);
  });
});

describe('refreshFromCatalog', () => {
  it('starts tracking a linked card that has no record of what was applied, without changing it', () => {
    const out = refreshFromCatalog({ catalog_card_id: 'us-test-gold', reward_type: 'points', points_base_rate: 9 }, goldCard());
    expect(Object.keys(out).sort()).toEqual(['catalog_applied', 'catalog_synced_at']);
  });

  it('switches a card the issuer moved from points to cashback', () => {
    const method = {
      catalog_card_id: 'us-test-gold', reward_type: 'points', points_base_rate: 1, point_value_cents: 1, default_cashback_rate: 1,
      rewards_label: 'Test Rewards points', category_rates: '[]', catalog_applied: JSON.stringify(catalogFields(goldCard())),
    };
    const out = refreshFromCatalog(method, goldCard({ reward_type: 'cashback', base_rate: 2, rewards_label: 'Cash back', categories: [] }));
    expect(out).toMatchObject({ reward_type: 'cashback', default_cashback_rate: 2, points_base_rate: null, rewards_label: 'Cash back' });
  });
});
