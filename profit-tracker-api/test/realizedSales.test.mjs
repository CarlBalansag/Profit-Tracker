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

const dashboard = async () => {
  const response = await fetch(`${baseUrl}/api/analytics/dashboard?mode=All&date=All%20Time`);
  return { status: response.status, body: await response.json() };
};

describe('realized sale financial metrics', () => {
  it('deducts outbound shipping from dashboard profit', async () => {
    const before = await dashboard();
    harness.db.sales[0].sale_shipping += 100;
    const after = await dashboard();
    expect(before.status).toBe(200);
    expect(after.body.stats.profit).toBeCloseTo(before.body.stats.profit - 100);
  });

  it('excludes cancelled sales from revenue, profit, and units sold', async () => {
    harness.db.sales[0].status = 'CANCELLED';
    const response = await dashboard();
    expect(response.status).toBe(200);
    expect(response.body.stats).toMatchObject({ totalRevenue: 0, profit: 0, unitsSold: 0, salesCount: 0 });
  });

  it('returns all realized sales for Cash Flow while keeping the dashboard list capped', async () => {
    for (let index = 0; index < 11; index += 1) {
      harness.db.sales.push({
        ...harness.db.sales[0],
        id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      });
    }
    const response = await dashboard();
    expect(response.body.recentTransactions).toHaveLength(10);
    expect(response.body.cashFlowTransactions).toHaveLength(12);
  });
});
