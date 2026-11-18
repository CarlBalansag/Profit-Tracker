import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { resolveRewardFields } = require('../services/cardRewards.js');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
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

describe('resolveRewardFields', () => {
  it('derives dollar rates from points multipliers and the point value', () => {
    const out = resolveRewardFields({
      reward_type: 'points', points_base_rate: 1, point_value_cents: 1.5,
      category_rates: [{ store: 'Dining', rate: 0, points: 4 }],
    });
    expect(out.default_cashback_rate).toBe(1.5);
    expect(out.category_rates).toEqual([{ store: 'Dining', points: 4, rate: 6 }]);
  });

  it('defaults a points card to 1 cent per point', () => {
    const out = resolveRewardFields({ reward_type: 'points', points_base_rate: 2 });
    expect(out.point_value_cents).toBe(1);
    expect(out.default_cashback_rate).toBe(2);
  });

  it('re-derives every stored rate when only the point value changes', () => {
    const existing = {
      reward_type: 'points', points_base_rate: 1, point_value_cents: 1, default_cashback_rate: 1,
      category_rates: JSON.stringify([{ store: 'Grocery', points: 4, rate: 4 }]),
    };
    const out = resolveRewardFields({ point_value_cents: 2 }, existing);
    expect(out.default_cashback_rate).toBe(2);
    expect(out.category_rates[0]).toMatchObject({ points: 4, rate: 8 });
  });

  it('keeps totals the same when a cashback card becomes points at 1 cent', () => {
    const existing = {
      reward_type: 'cashback', default_cashback_rate: 1.5,
      category_rates: JSON.stringify([{ store: 'Amazon', rate: 5 }]),
    };
    const out = resolveRewardFields({ reward_type: 'points' }, existing);
    expect(out.default_cashback_rate).toBe(1.5);
    expect(out.points_base_rate).toBe(1.5);
    expect(out.category_rates[0]).toMatchObject({ store: 'Amazon', rate: 5, points: 5 });
  });

  it('switching back to cashback keeps dollar rates and drops multipliers', () => {
    const existing = {
      reward_type: 'points', points_base_rate: 1, point_value_cents: 2, default_cashback_rate: 2,
      category_rates: JSON.stringify([{ store: 'Dining', points: 4, rate: 8 }]),
    };
    const out = resolveRewardFields({ reward_type: 'cashback', default_cashback_rate: 2 }, existing);
    expect(out).toMatchObject({ reward_type: 'cashback', points_base_rate: null, point_value_cents: null, default_cashback_rate: 2 });
    expect(out.category_rates).toEqual([{ store: 'Dining', rate: 8 }]);
  });

  it('rejects an unknown reward type and a zero point value', () => {
    expect(() => resolveRewardFields({ reward_type: 'miles' })).toThrow(/reward_type/);
    expect(() => resolveRewardFields({ reward_type: 'points', points_base_rate: 1, point_value_cents: 0 })).toThrow(/point_value_cents/);
  });
});

describe('POST/PUT /api/payment-methods with points', () => {
  it('creates a points card, storing multipliers and derived dollar rates', async () => {
    const res = await send('POST', '/api/payment-methods', {
      name: 'Amex Gold', type: 'Credit', reward_type: 'points', points_base_rate: 1, point_value_cents: 1,
      rewards_label: 'Membership Rewards points', catalog_card_id: 'us-amex-gold',
      category_rates: [{ store: 'Dining', rate: 0, points: 4 }],
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reward_type: 'points', points_base_rate: 1, point_value_cents: 1, rewards_label: 'Membership Rewards points', rework_prompt_state: 'switched' });
    expect(res.body.default_cashback_rate).toBe(1);
    expect(res.body.category_rates).toEqual([{ store: 'Dining', rate: 4, points: 4 }]);
  });

  it('a plain cashback create behaves exactly as before', async () => {
    const res = await send('POST', '/api/payment-methods', { name: 'Debit', type: 'Debit', default_cashback_rate: 1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ reward_type: 'cashback', default_cashback_rate: 1, points_base_rate: null, rework_prompt_state: null });
  });

  it('rejects an invalid point value without writing anything', async () => {
    const before = harness.db.paymentMethod.length;
    const res = await send('POST', '/api/payment-methods', { name: 'Bad', type: 'Credit', reward_type: 'points', points_base_rate: 1, point_value_cents: -1 });
    expect(res.status).toBe(400);
    expect(harness.db.paymentMethod.length).toBe(before);
  });

  it('changing only the point value on edit re-prices stored store rates', async () => {
    const created = await send('POST', '/api/payment-methods', {
      name: 'Gold', type: 'Credit', reward_type: 'points', points_base_rate: 1,
      category_rates: [{ store: 'Grocery', rate: 0, points: 4 }],
    });
    const res = await send('PUT', `/api/payment-methods/${created.body.id}`, { name: 'Gold', type: 'Credit', point_value_cents: 1.5 });
    expect(res.status).toBe(200);
    expect(res.body.default_cashback_rate).toBe(1.5);
    expect(res.body.category_rates[0]).toMatchObject({ points: 4, rate: 6 });
  });

  it('an edit that omits reward fields leaves a points card a points card', async () => {
    const created = await send('POST', '/api/payment-methods', { name: 'Gold', type: 'Credit', reward_type: 'points', points_base_rate: 3, point_value_cents: 2 });
    const res = await send('PUT', `/api/payment-methods/${created.body.id}`, { name: 'Gold renamed', type: 'Credit', last4: '1234' });
    expect(res.body).toMatchObject({ name: 'Gold renamed', reward_type: 'points', points_base_rate: 3, point_value_cents: 2, default_cashback_rate: 6 });
  });

  it("can't edit another user's card", async () => {
    harness.db.paymentMethod.push({ id: 'foreign-card', user_id: harness.ids.other, name: 'Theirs', type: 'Credit', default_cashback_rate: 1, category_rates: '[]' });
    const res = await send('PUT', '/api/payment-methods/foreign-card', { name: 'Mine now', type: 'Credit', reward_type: 'points', points_base_rate: 5 });
    expect(res.status).toBe(404);
    expect(stored('foreign-card')).toMatchObject({ name: 'Theirs', default_cashback_rate: 1 });
  });
});

describe('PATCH /api/payment-methods/:id/rework-prompt', () => {
  it('records "kept" without touching the card\'s rates', async () => {
    const res = await send('PATCH', `/api/payment-methods/${harness.ids.card}/rework-prompt`, { state: 'kept' });
    expect(res.status).toBe(200);
    expect(stored(harness.ids.card)).toMatchObject({ rework_prompt_state: 'kept', default_cashback_rate: 2 });
  });

  it('rejects unknown states and other users\' cards', async () => {
    expect((await send('PATCH', `/api/payment-methods/${harness.ids.card}/rework-prompt`, { state: 'maybe' })).status).toBe(400);
    harness.db.paymentMethod.push({ id: 'foreign-card', user_id: harness.ids.other, name: 'Theirs', type: 'Credit', default_cashback_rate: 1 });
    expect((await send('PATCH', '/api/payment-methods/foreign-card/rework-prompt', { state: 'kept' })).status).toBe(404);
    expect(stored('foreign-card').rework_prompt_state).toBeUndefined();
  });
});

describe('Credit Card dashboard with a points card', () => {
  it('values points purchases in dollars and reports the reward type', async () => {
    // Make the fixture card a 2x points card at 1.5 cents => 3% in dollars.
    await send('PUT', `/api/payment-methods/${harness.ids.card}`, { name: 'QA Credit Card', type: 'Credit', reward_type: 'points', points_base_rate: 2, point_value_cents: 1.5 });
    harness.db.inventory.push({
      id: 'points-purchase', user_id: harness.ids.user, product_name: 'Points item', vendor_id: harness.ids.vendor,
      payment_method_id: harness.ids.card, unit_purchase_cost: 100, qty_purchased: 1, qty_on_hand: 1,
      sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, cashback_earned: 0,
      status: 'PURCHASED', purchase_date: new Date('2026-10-05T12:00:00Z'), created_at: new Date(),
    });
    const res = await send('GET', '/api/creditcard/dashboard?month=2026-10');
    const card = res.body.cards.find(c => c.id === harness.ids.card);
    expect(card).toMatchObject({ rewardType: 'points', pointValueCents: 1.5 });
    expect(card.cashbackEarned).toBe(3);
  });
});
