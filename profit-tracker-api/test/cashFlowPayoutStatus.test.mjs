import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const harness = createRequire(import.meta.url)('../../qa/harness.cjs');
let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => harness.reset());

const dashboard = async () => {
  const response = await fetch(`${baseUrl}/api/analytics/dashboard`);
  return response.json();
};

// Regression coverage for the bug the user originally reported: every sale
// showed "Pending" on the Cash Flow page because cashFlowTransactions.status
// only ever read the legacy `status` column, never workflow_status -- so a
// sale marked paid through the mark_paid action (which only ever touches
// workflow_status) still looked unpaid here.
describe('cashFlowTransactions payout_status (routes/analytics.js)', () => {
  it('is unpaid for a freshly-sold item with no payment recorded', async () => {
    const { cashFlowTransactions } = await dashboard();
    expect(cashFlowTransactions[0].payout_status).toBe('unpaid');
  });

  it('is paid once workflow_status is PAID even though the legacy status column was never touched', async () => {
    harness.db.sales[0].workflow_status = 'PAID';
    harness.db.sales[0].paid_at = new Date('2026-09-10T12:00:00Z');
    // legacy `status` deliberately left at 'SOLD', exactly as mark_paid leaves it.
    const { cashFlowTransactions } = await dashboard();
    expect(cashFlowTransactions[0].status).toBe('PAID');
    expect(cashFlowTransactions[0].payout_status).toBe('paid');
  });

  it('is partial and carries payout_short_amount when a deposit was short', async () => {
    harness.db.sales[0].workflow_status = 'PAID';
    harness.db.sales[0].paid_at = new Date('2026-09-10T12:00:00Z');
    harness.db.sales[0].payout_short_amount = 23.5;
    const { cashFlowTransactions } = await dashboard();
    expect(cashFlowTransactions[0].payout_status).toBe('partial');
    expect(cashFlowTransactions[0].payout_short_amount).toBeCloseTo(23.5, 2);
  });

  it('carries payout_account through to the response', async () => {
    harness.db.sales[0].payout_account = 'Chase College';
    const { cashFlowTransactions } = await dashboard();
    expect(cashFlowTransactions[0].payout_account).toBe('Chase College');
  });
});
