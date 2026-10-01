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

// ideas.md ISSUES #1: "Dashboard and Transactions show different total cost"
// -- a purchase marked COMPLETED with no attached sale (qty_on_hand depleted
// without a Sales record, e.g. from a manual status edit) was reportedly
// excluded from the Dashboard's total cost while Transactions still counted
// it. Verified 2026-10-01: this no longer reproduces -- analytics.js sums
// every inventory row in the window unconditionally, with no status or
// sales-presence filter. This test locks that in as a regression guard.
describe('analytics totalCost counts every purchase regardless of status/sale (ideas.md #1)', () => {
  it('includes a COMPLETED purchase with no sale and zero qty_on_hand in totalCost and transactionCount', async () => {
    const before = await get('/api/analytics/dashboard?mode=All&date=All%20Time');

    harness.db.inventory.push({
      id: 'orphan-completed', user_id: harness.ids.user, product_name: 'Topps Chrome Value',
      vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
      unit_purchase_cost: 38.97, qty_purchased: 1, qty_on_hand: 0,
      sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0,
      cashback_earned: 0, status: 'COMPLETED', purchase_date: new Date('2026-09-05T12:00:00Z'), created_at: new Date(),
    });

    const after = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(after.body.stats.totalCost).toBeCloseTo(before.body.stats.totalCost + 38.97, 2);
    expect(after.body.stats.transactionCount).toBe(before.body.stats.transactionCount + 1);
  });

  it.each(['CANCELLED', 'RETURNED', 'DISPUTED', 'PURCHASED', 'LISTED', 'SOLD'])(
    'includes a %s-status purchase with no sale in totalCost too',
    async (status) => {
      const before = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
      harness.db.inventory.push({
        id: `status-${status}`, user_id: harness.ids.user, product_name: `Item ${status}`,
        vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
        unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: status === 'PURCHASED' || status === 'LISTED' ? 1 : 0,
        sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0,
        cashback_earned: 0, status, purchase_date: new Date('2026-09-05T12:00:00Z'), created_at: new Date(),
      });
      const after = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
      expect(after.body.stats.totalCost).toBeCloseTo(before.body.stats.totalCost + 10, 2);
    }
  );
});
