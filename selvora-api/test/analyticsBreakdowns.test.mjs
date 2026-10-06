// New Analytics breakdowns: platformBreakdown (payout/commission/profit/
// payout-latency/exception-rate per sales channel), vendorBreakdown (spend
// per sourcing vendor), categoryBreakdown (profitability per product
// category). All three are built from the SAME mode/date-filtered
// inventory/sales arrays every other stat on this endpoint already uses, so
// these tests exist mainly to confirm that filter-respecting behavior
// explicitly, not just the grouping math.
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

const byName = (rows, name) => rows.find(r => r.name === name);

describe('GET /api/analytics/dashboard platformBreakdown', () => {
  it('groups the default sale under its marketplace platform with correct revenue, cost, commission, and profit', async () => {
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = byName(res.body.platformBreakdown, 'QA Marketplace');
    expect(row).toBeDefined();
    expect(row.type).toBe('Marketplace');
    expect(row.revenue).toBeCloseTo(273, 2);   // (150*2) - 15 commission - 12 shipping
    expect(row.cost).toBeCloseTo(208, 2);      // batchCost 520 * 2/5 allocated
    expect(row.commission).toBeCloseTo(15, 2);
    expect(row.profit).toBeCloseTo(69.16, 2);  // revenue - cost + cashback(4.16)
    expect(row.unitsSold).toBe(2);
    expect(row.salesCount).toBe(1);
    expect(row.avgPayoutDays).toBeNull(); // no paid_at on the default sale
  });

  it('buckets a sale with no platform under Direct', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-direct', platform_id: null });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = byName(res.body.platformBreakdown, 'Direct');
    expect(row).toBeDefined();
    expect(row.salesCount).toBe(1);
  });

  it('counts a cancelled sale as an exception without adding it to revenue', async () => {
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-cancelled', status: 'CANCELLED' });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = byName(res.body.platformBreakdown, 'QA Marketplace');
    expect(row.revenue).toBeCloseTo(273, 2); // unchanged -- only the realized sale counts
    expect(row.salesCount).toBe(1);
    expect(row.cancelledCount).toBe(1);
    expect(row.exceptionRatePct).toBeCloseTo(50, 2); // 1 exception of 2 total attempts
  });

  it('computes avgPayoutDays from paid_at minus sale_date', async () => {
    harness.db.sales[0].paid_at = new Date('2026-09-08T12:00:00Z'); // 5 days after sale_date
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = byName(res.body.platformBreakdown, 'QA Marketplace');
    expect(row.avgPayoutDays).toBeCloseTo(5, 1);
  });

  it('respects the Cashout/Marketplace mode filter', async () => {
    const cashoutPlatform = { id: 'cashout-1', user_id: harness.ids.user, name: 'QA Cashout', type: 'Cashout', fee_pct: 0 };
    harness.db.platform.push(cashoutPlatform);
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-cashout', platform_id: cashoutPlatform.id });

    const marketplaceOnly = await get('/api/analytics/dashboard?mode=Marketplace&date=All%20Time');
    expect(byName(marketplaceOnly.body.platformBreakdown, 'QA Marketplace')).toBeDefined();
    expect(byName(marketplaceOnly.body.platformBreakdown, 'QA Cashout')).toBeUndefined();

    const cashoutOnly = await get('/api/analytics/dashboard?mode=Cashout&date=All%20Time');
    expect(byName(cashoutOnly.body.platformBreakdown, 'QA Cashout')).toBeDefined();
    expect(byName(cashoutOnly.body.platformBreakdown, 'QA Marketplace')).toBeUndefined();
  });

  it('respects the date filter', async () => {
    harness.db.sales[0].sale_date = new Date('2020-01-01T12:00:00Z'); // long before any window
    const res = await get('/api/analytics/dashboard?mode=All&date=30%20Days');
    expect(res.body.platformBreakdown).toEqual([]);
  });
});

describe('GET /api/analytics/dashboard vendorBreakdown', () => {
  it('uses full purchase cost in All mode', async () => {
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = byName(res.body.vendorBreakdown, 'QA Store');
    expect(row.spend).toBeCloseTo(520, 2); // full batchCost, not just the sold allocation
    expect(row.purchases).toBe(1);
    expect(row.units).toBe(5); // qty_purchased
  });

  it('uses only the sold-allocated cost when scoped to a sales channel', async () => {
    const res = await get('/api/analytics/dashboard?mode=Marketplace&date=All%20Time');
    const row = byName(res.body.vendorBreakdown, 'QA Store');
    expect(row.spend).toBeCloseTo(208, 2); // allocated cost of the 2 sold units only
    expect(row.units).toBe(2);
  });

  it('labels a purchase with no vendor as No Vendor', async () => {
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'inv-no-vendor', vendor_id: null });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(byName(res.body.vendorBreakdown, 'No Vendor')).toBeDefined();
  });
});

describe('GET /api/analytics/dashboard breakdown totals stay consistent with the existing summary stats', () => {
  it('sums platformBreakdown.revenue and categoryBreakdown.revenue to stats.totalRevenue across multiple platforms', async () => {
    const platform2 = { id: 'platform-2', user_id: harness.ids.user, name: 'QA Platform 2', type: 'Marketplace', fee_pct: 10 };
    harness.db.platform.push(platform2);
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'inv-2', vendor_id: null, category: 'Electronics' });
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-2', inventory_id: 'inv-2', platform_id: platform2.id });

    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const platformTotal = res.body.platformBreakdown.reduce((sum, p) => sum + p.revenue, 0);
    const categoryTotal = res.body.categoryBreakdown.reduce((sum, c) => sum + c.revenue, 0);
    expect(platformTotal).toBeCloseTo(res.body.stats.totalRevenue, 2);
    expect(categoryTotal).toBeCloseTo(res.body.stats.totalRevenue, 2);
    expect(res.body.platformBreakdown).toHaveLength(2);
    expect(res.body.categoryBreakdown).toHaveLength(2);
  });

  it('sums vendorBreakdown.spend to stats.totalCost in All mode', async () => {
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'inv-2', vendor_id: null });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const vendorTotal = res.body.vendorBreakdown.reduce((sum, v) => sum + v.spend, 0);
    expect(vendorTotal).toBeCloseTo(res.body.stats.totalCost, 2);
  });
});

describe('GET /api/analytics/dashboard categoryBreakdown', () => {
  it('groups the default sale under its inventory category', async () => {
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const row = res.body.categoryBreakdown.find(c => c.category === 'Shoes');
    expect(row).toBeDefined();
    expect(row.revenue).toBeCloseTo(273, 2);
    expect(row.profit).toBeCloseTo(69.16, 2);
    expect(row.unitsSold).toBe(2);
  });

  it('falls back to Uncategorized when the purchase has no category', async () => {
    harness.db.inventory.push({ ...harness.db.inventory[0], id: 'inv-no-category', category: null });
    harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-no-category', inventory_id: 'inv-no-category' });
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(res.body.categoryBreakdown.find(c => c.category === 'Uncategorized')).toBeDefined();
  });
});
