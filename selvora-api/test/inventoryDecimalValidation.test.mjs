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

const post = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

const put = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};

describe('currency migration Task 4: inventory purchase decimal validation', () => {
  it('accepts a valid 2-decimal purchase cost on create', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Decimal Item',
      vendor_id: harness.ids.vendor,
      unit_purchase_cost: '249.99',
      qty_purchased: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.unit_purchase_cost).toBe(249.99);
  });

  it('stores a per-transaction cashback rate and amount override on create', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Cashback Override',
      vendor_id: harness.ids.vendor,
      payment_method_id: harness.ids.card,
      unit_purchase_cost: '100.00',
      qty_purchased: 1,
      cashback_rate: '5',
      cashback_earned: '7.00',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cashback_rate: 5, cashback_earned: 7 });
  });

  it('rejects a purchase cost with more than 2 decimal places on create', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Bad Item',
      vendor_id: harness.ids.vendor,
      unit_purchase_cost: '10.999',
      qty_purchased: 1,
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed and non-finite money input on create', async () => {
    for (const value of ['abc', 'Infinity', 'NaN', '1e5']) {
      const res = await post('/api/inventory', {
        product_name: 'QA Bad Item',
        vendor_id: harness.ids.vendor,
        unit_purchase_cost: value,
        qty_purchased: 1,
      });
      expect(res.status).toBe(400);
    }
  });

  it('rejects a negative fees value on create', async () => {
    const res = await post('/api/inventory', {
      product_name: 'QA Bad Item',
      vendor_id: harness.ids.vendor,
      unit_purchase_cost: '10.00',
      fees: '-5.00',
      qty_purchased: 1,
    });
    expect(res.status).toBe(400);
  });

  it('rounds a noisy float cashback_earned to 2 decimal places on update, fixing the drift found in the Task 3 audit', async () => {
    // 5.4158 is the kind of raw float a client-side cost * rate / 100
    // calculation produces (see shared/finance.mjs) -- not a clean 2dp input.
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { cashback_earned: 5.415800000000001 });
    expect(res.status).toBe(200);
    expect(harness.db.inventory[0].cashback_earned).toBe(5.42);
  });

  it('still rejects a negative cashback_earned even though precision is rounded rather than rejected', async () => {
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { cashback_earned: -5 });
    expect(res.status).toBe(400);
    expect(harness.db.inventory[0].cashback_earned).toBe(10.4);
  });

  it('rejects an over-precision unit_purchase_cost on update -- a direct user input, unlike cashback_earned', async () => {
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { unit_purchase_cost: '99.999' });
    expect(res.status).toBe(400);
    expect(harness.db.inventory[0].unit_purchase_cost).toBe(100);
  });

  it('leaves other inventory money fields untouched when only cashback_earned changes', async () => {
    const res = await put(`/api/inventory/${harness.ids.inventory}`, { cashback_earned: '11.00' });
    expect(res.status).toBe(200);
    expect(harness.db.inventory[0]).toMatchObject({
      cashback_earned: 11,
      unit_purchase_cost: 100,
      sales_tax: 40,
      shipping_cost_inbound: 20,
      fees: 10,
      gift_card_amount: 50,
    });
  });
});
