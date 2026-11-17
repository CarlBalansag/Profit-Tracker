// AI assistant (MCP) card tools: points vs cashback, the card list, re-linking.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const catalog = require('../services/cardCatalog.js');
const { ids } = harness;

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => { harness.reset(); catalog._resetForTests(); });

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
const stored = (name) => harness.db.paymentMethod.find((m) => m.name === name);
const writeLogs = (tool) => harness.db.mcpWriteLog.filter((l) => l.tool === tool);

describe('search_card_list', () => {
  it('finds cards by words in any order, with card_id, rewards and reselling perks', async () => {
    const { data } = await callTool('search_card_list', { query: 'preferred sapphire' });
    const csp = data.find((c) => c.card_id === 'us-chase-sapphire-preferred');
    expect(csp).toMatchObject({ rewards: 'points', program: expect.stringMatching(/Ultimate Rewards/), annual_fee: 95 });
    expect(csp.earns).toMatch(/1x everything else/);
    // From card-corrections.json, and only reselling perks.
    expect(csp.perks).toEqual(expect.arrayContaining(['Purchase Protection', 'Extended Warranty Protection']));
    expect(csp.perks).not.toContain('Baggage Delay Insurance');
  });

  it('understands "amex" and filters by reward type', async () => {
    const { data } = await callTool('search_card_list', { query: 'amex business plus' });
    expect(data[0]).toMatchObject({ card_id: 'us-amex-blue-business-plus', rewards: 'points' });
    expect(data[0].earns).toMatch(/2x everything else \(up to \$50,000 a year, then 1x\)/);
    const cash = await callTool('search_card_list', { query: 'amex', reward_type: 'cashback' });
    expect(cash.data.length).toBeGreaterThan(0);
    expect(cash.data.every((c) => c.rewards === 'cashback')).toBe(true);
  });
});

describe('add_payment_method', () => {
  it('adds a card from the card list: points, store rates, kept current, named after the card', async () => {
    const res = await callTool('add_payment_method', { type: 'Credit', card_id: 'us-amex-gold', point_value_cents: 1.5, last4: '1005' });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({
      name: 'American Express Gold Card', type: 'Credit', last4: '1005', rates_kept_current: true,
      card_list_match: 'American Express® Gold Card', cashback_rate: 1.5,
      rewards: { type: 'points', points_per_dollar: 1, point_value_cents: 1.5, program: 'Membership Rewards points', effective_rate_pct: 1.5 },
    });
    expect(res.data.rewards.earns).toBe('1x Membership Rewards points at 1.5¢ each (≈1.5% back)');
    expect(res.data.store_rates).toContainEqual({ store: 'Dining', earns: '4x (≈6%)' });
    expect(stored('American Express Gold Card')).toMatchObject({ catalog_card_id: 'us-amex-gold', rework_prompt_state: 'switched' });
    expect(stored('American Express Gold Card').catalog_applied).toBeTruthy();
    expect(writeLogs('add_payment_method')).toHaveLength(1);
  });

  it('adds a points card by hand', async () => {
    const res = await callTool('add_payment_method', { name: 'My BBP', type: 'Credit', reward_type: 'points', points_per_dollar: 2, point_value_cents: 2, program: 'MR points' });
    expect(res.data.rewards).toMatchObject({ type: 'points', points_per_dollar: 2, point_value_cents: 2, effective_rate_pct: 4 });
    expect(res.data.rates_kept_current).toBe(false);
  });

  it('a debit card with no rate earns nothing', async () => {
    const res = await callTool('add_payment_method', { name: 'Checking', type: 'Debit' });
    expect(res.data.rewards).toEqual({ type: 'cashback', earns: 'no rewards', effective_rate_pct: 0 });
  });

  it('rejects mixed or unknown reward input without writing anything', async () => {
    const before = harness.db.paymentMethod.length;
    for (const args of [
      { name: 'A', type: 'Credit', card_id: 'us-amex-gold', cashback_rate: 2 },
      { name: 'B', type: 'Credit', reward_type: 'points', cashback_rate: 2 },
      { name: 'C', type: 'Credit', reward_type: 'cashback', points_per_dollar: 2 },
      { name: 'D', type: 'Credit', card_id: 'us-not-a-card' },
      { type: 'Credit' },
      { name: 'E', type: 'Credit', reward_type: 'points', points_per_dollar: 1, point_value_cents: 0 },
    ]) {
      const res = await callTool('add_payment_method', args);
      expect(res.isError).toBe(true);
    }
    expect((await callTool('add_payment_method', { name: 'D', type: 'Credit', card_id: 'us-not-a-card' })).data).toMatch(/search_card_list/);
    expect(harness.db.paymentMethod).toHaveLength(before);
    expect(writeLogs('add_payment_method')).toHaveLength(0);
  });
});

describe('list_payment_methods', () => {
  it('describes each card, filters credit vs debit, and only shows the user\'s own cards', async () => {
    await callTool('add_payment_method', { type: 'Credit', card_id: 'us-amex-gold' });
    await callTool('add_payment_method', { name: 'Checking', type: 'Debit', cashback_rate: 1 });
    harness.db.paymentMethod.push({ id: 'theirs', user_id: ids.other, name: 'Not mine', type: 'Credit', default_cashback_rate: 9 });
    const all = (await callTool('list_payment_methods')).data;
    expect(all.map((m) => m.name)).toEqual(['American Express Gold Card', 'Checking', 'QA Credit Card']);
    expect(all.find((m) => m.name === 'American Express Gold Card').perks.length).toBeGreaterThan(0);
    const debit = (await callTool('list_payment_methods', { type: 'Debit' })).data;
    expect(debit.map((m) => m.name)).toEqual(['Checking']);
  });
});

describe('update_payment_method', () => {
  it('changing the point value re-prices the card and its store rates and keeps it current', async () => {
    await callTool('add_payment_method', { type: 'Credit', card_id: 'us-amex-gold' });
    const res = await callTool('update_payment_method', { payment_method: 'american express gold card', point_value_cents: 2 });
    expect(res.data.rewards).toMatchObject({ point_value_cents: 2, effective_rate_pct: 2 });
    expect(res.data.store_rates).toContainEqual({ store: 'Dining', earns: '4x (≈8%)' });
    expect(res.data.rates_kept_current).toBe(true);
    expect(harness.db.changeLog.some((c) => c.field === 'point_value_cents' && String(c.new_value) === '2')).toBe(true);
  });

  it("re-links to a different card, keeping last4 and the user's own store rates", async () => {
    await callTool('add_payment_method', { name: 'My Sapphire', type: 'Credit', card_id: 'us-chase-sapphire-reserve', last4: '4242' });
    const card = stored('My Sapphire');
    card.category_rates = JSON.stringify([...JSON.parse(card.category_rates), { store: 'eBay', rate: 2, points: 2 }]);
    const res = await callTool('update_payment_method', { payment_method: 'My Sapphire', card_id: 'us-chase-sapphire-preferred', new_name: 'My Sapphire Preferred' });
    expect(res.isError).toBe(false);
    expect(res.data).toMatchObject({ name: 'My Sapphire Preferred', last4: '4242', card_list_match: 'Chase Sapphire Preferred® Card' });
    const stores = res.data.store_rates.map((r) => r.store);
    expect(stores).toEqual(expect.arrayContaining(['eBay', 'Gas', 'Dining']));
  });

  it('switches a cashback card to points by hand', async () => {
    const res = await callTool('update_payment_method', { payment_method: 'QA Credit Card', reward_type: 'points', points_per_dollar: 3, point_value_cents: 1 });
    expect(res.data.rewards).toMatchObject({ type: 'points', points_per_dollar: 3, effective_rate_pct: 3 });
  });

  it('rejects unknown cards, name clashes, empty changes and other users\' cards', async () => {
    harness.db.paymentMethod.push({ id: 'theirs', user_id: ids.other, name: 'Not mine', type: 'Credit', default_cashback_rate: 9 });
    await callTool('add_payment_method', { name: 'Second', type: 'Credit' });
    expect((await callTool('update_payment_method', { payment_method: 'Nope', last4: '1111' })).data).toMatch(/No payment method named/);
    expect((await callTool('update_payment_method', { payment_method: 'Second', new_name: 'qa credit card' })).data).toMatch(/already exists/);
    expect((await callTool('update_payment_method', { payment_method: 'Second' })).data).toMatch(/Nothing to change/);
    expect((await callTool('update_payment_method', { payment_method: 'Not mine', last4: '1111' })).isError).toBe(true);
    expect(harness.db.paymentMethod.find((m) => m.id === 'theirs').last4).toBeUndefined();
    expect(writeLogs('update_payment_method')).toHaveLength(0);
  });
});

describe('get_card_net_to_pay', () => {
  it('reports points earned for a points card', async () => {
    await callTool('update_payment_method', { payment_method: 'QA Credit Card', reward_type: 'points', points_per_dollar: 2, point_value_cents: 1 });
    const { data } = await callTool('get_card_net_to_pay', { month: '2026-09' });
    const row = data.find((r) => r.card === 'QA Credit Card');
    expect(row.rewards_type).toBe('points');
    expect(row.points_earned).toBe(Math.round(row.rewards_earned * 100));
  });
});
