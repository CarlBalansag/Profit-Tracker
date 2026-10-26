import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => harness.reset());
afterAll(() => server.close());

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
};

// ideas.md ISSUES #7: "Payment Methods always shows zero spend" -- the
// frontend used to hardcode totalSpend/availableSpend to 0 regardless of
// actual purchases. This verifies the backend now returns a real,
// Card-Tracker-consistent total_spend per payment method.
describe('GET /api/payment-methods: lifetime spend aggregation (ideas.md #7)', () => {
  it('sums batchCost across every purchase on a card, matching Card Tracker\'s formula', async () => {
    // Fixture card (ids.card) already has one inventory purchase on it:
    // 100*5 (unit cost * qty) + 40 tax + 20 inbound shipping + 10 fees - 50 gift card = 520.
    const res = await get('/api/payment-methods');
    expect(res.status).toBe(200);
    const card = res.body.find(c => c.id === harness.ids.card);
    expect(card.total_spend).toBe(520);
    expect(card.credit_limit).toBe(5000);
  });

  it('reports zero spend for a card with no purchases, not undefined', async () => {
    harness.db.paymentMethod.push({
      id: 'unused-card', user_id: harness.ids.user, name: 'Unused Card', type: 'Credit',
      default_cashback_rate: 1, category_rates: '[]', credit_limit: null,
    });
    const res = await get('/api/payment-methods');
    const card = res.body.find(c => c.id === 'unused-card');
    expect(card.total_spend).toBe(0);
    expect(card.credit_limit).toBe(null);
  });

  it('sums spend across multiple purchases on the same card', async () => {
    harness.db.inventory.push({
      id: 'second-purchase', user_id: harness.ids.user, product_name: 'Second item',
      vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
      unit_purchase_cost: 50, qty_purchased: 1, qty_on_hand: 1,
      sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0,
      cashback_earned: 0, status: 'PURCHASED', purchase_date: new Date('2026-09-05T12:00:00Z'), created_at: new Date(),
    });
    const res = await get('/api/payment-methods');
    const card = res.body.find(c => c.id === harness.ids.card);
    expect(card.total_spend).toBe(570); // 520 fixture + 50 new purchase
  });

  it('never attributes another user\'s purchases to this user\'s card totals', async () => {
    // A purchase on a foreign user's own card must not leak into this user's total,
    // and this user's GET must not even be able to see a foreign card.
    harness.db.paymentMethod.push({
      id: 'foreign-card', user_id: harness.ids.other, name: 'Foreign Card', type: 'Credit',
      default_cashback_rate: 1, category_rates: '[]',
    });
    harness.db.inventory.push({
      id: 'foreign-purchase', user_id: harness.ids.other, product_name: 'Foreign item',
      vendor_id: harness.ids.vendor, payment_method_id: 'foreign-card',
      unit_purchase_cost: 999, qty_purchased: 1, qty_on_hand: 1,
      sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0,
      cashback_earned: 0, status: 'PURCHASED', purchase_date: new Date('2026-09-05T12:00:00Z'), created_at: new Date(),
    });
    const res = await get('/api/payment-methods');
    expect(res.body.some(c => c.id === 'foreign-card')).toBe(false);
    const card = res.body.find(c => c.id === harness.ids.card);
    expect(card.total_spend).toBe(520);
  });
});
