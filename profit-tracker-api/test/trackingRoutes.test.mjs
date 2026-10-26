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

const request = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST' });
  return { status: response.status, body: await response.json(), retryAfter: response.headers.get('retry-after') };
};

describe('POST /api/inventory/:id/track', () => {
  it('returns 400 when the item has no tracking number', async () => {
    const created = await harness.prisma.inventory.create({
      data: { user_id: harness.ids.user, product_name: 'No tracking yet', vendor_id: harness.ids.vendor, unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1 },
    });
    const res = await request(`/api/inventory/${created.id}/track`);
    expect(res.status).toBe(400);
  });

  it('checks the carrier and persists tracking_info on the item', async () => {
    const res = await request(`/api/inventory/${harness.ids.inventory}/track`);
    expect(res.status).toBe(200);
    // No carrier credentials are configured in the test environment, so this
    // is a real end-to-end pass through refreshTracking's not_configured path
    // rather than a mocked shortcut. The fixture's tracking_number is USPS-formatted.
    expect(res.body.tracking_info).toMatchObject({ carrier: 'USPS', trackable: false, reason: 'not_configured' });
    expect(res.body.rate_limit).toMatchObject({ remaining: 9 });
    expect(harness.db.inventory.find(i => i.id === harness.ids.inventory).tracking_info).toMatchObject({ reason: 'not_configured' });
  });
});

describe('POST /api/sales/:id/track', () => {
  it('returns 400 when the sale has no tracking number', async () => {
    const res = await request(`/api/sales/${harness.ids.sale}/track`);
    expect(res.status).toBe(400);
  });

  it('checks the carrier and persists tracking_info on the sale', async () => {
    harness.db.sales.find(s => s.id === harness.ids.sale).tracking_number = '999999999999';
    const res = await request(`/api/sales/${harness.ids.sale}/track`);
    expect(res.status).toBe(200);
    expect(res.body.tracking_info).toMatchObject({ carrier: 'FedEx', trackable: false, reason: 'not_configured' });
  });
});

describe('tracking check rate limit', () => {
  it('shares one 10-per-hour bucket across inventory and sales checks for the same user', async () => {
    const first = await request(`/api/inventory/${harness.ids.inventory}/track`);
    expect(first.body.rate_limit.remaining).toBe(9);

    harness.db.sales.find(s => s.id === harness.ids.sale).tracking_number = '999999999999';
    const second = await request(`/api/sales/${harness.ids.sale}/track`);
    expect(second.body.rate_limit.remaining).toBe(8);
  });

  it('rejects the 11th check within the hour with 429 and a retry time', async () => {
    for (let i = 0; i < 10; i++) {
      const res = await request(`/api/inventory/${harness.ids.inventory}/track`);
      expect(res.status).toBe(200);
    }
    const eleventh = await request(`/api/inventory/${harness.ids.inventory}/track`);
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(Number(eleventh.retryAfter)).toBeGreaterThan(0);
  });
});
