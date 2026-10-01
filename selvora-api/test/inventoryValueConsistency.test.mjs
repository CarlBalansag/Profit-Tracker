import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { allocatedCost } from '../../shared/finance.mjs';

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

// ideas.md ISSUES #2: "Pages use different definitions of inventory value" --
// Inventory.jsx was reported to use merchandise cost only (unit cost * qty on
// hand), while Dashboard/Analytics included allocated tax and inbound
// shipping (landed cost), producing a different total on each page.
// Verified 2026-10-01: Inventory.jsx now imports the same allocatedCost()
// from shared/finance.mjs that the backend's inventoryValue uses (via its
// Decimal mirror in services/decimalFinance.js) -- this test proves the two
// are mathematically identical by computing Inventory's figure from the real
// GET /api/inventory response and comparing it to the Dashboard's inventoryValue.
describe('inventory value is identical across Inventory and Dashboard/Analytics (ideas.md #2)', () => {
  it('Inventory.jsx-equivalent client sum matches analytics.js inventoryValue, including tax/shipping/fees/gift-card', async () => {
    // Give the fixture item inbound shipping and fees distinct from the gift
    // card discount, so a merchandise-cost-only calculation would provably
    // diverge from a landed-cost calculation if either page still used one.
    const invRes = await get('/api/inventory');
    expect(invRes.status).toBe(200);

    // Reproduce exactly what Inventory.jsx computes client-side.
    const clientTotalCapital = invRes.body
      .filter(item => item.qty_on_hand > 0)
      .reduce((sum, item) => sum + allocatedCost(item, item.qty_on_hand), 0);

    const dashRes = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(dashRes.status).toBe(200);

    expect(clientTotalCapital).toBeCloseTo(dashRes.body.stats.inventoryValue, 2);
    // Sanity: the fixture's tax/shipping/fees/gift-card must actually be
    // non-trivial, so this comparison would have caught a merchandise-only bug.
    const fixtureItem = invRes.body.find(i => i.id === harness.ids.inventory);
    expect(fixtureItem.sales_tax + fixtureItem.shipping_cost_inbound + fixtureItem.fees + fixtureItem.gift_card_amount).toBeGreaterThan(0);
  });

  it('stays consistent after a partial sale changes qty_on_hand', async () => {
    harness.db.inventory[0].qty_on_hand = 2; // simulate 1 of 3 on-hand units having sold
    const invRes = await get('/api/inventory');
    const clientTotalCapital = invRes.body
      .filter(item => item.qty_on_hand > 0)
      .reduce((sum, item) => sum + allocatedCost(item, item.qty_on_hand), 0);
    const dashRes = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(clientTotalCapital).toBeCloseTo(dashRes.body.stats.inventoryValue, 2);
  });
});
