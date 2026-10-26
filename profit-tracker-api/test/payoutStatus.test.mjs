import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { payoutStatus } = createRequire(import.meta.url)('../services/payoutStatus.js');

describe('payoutStatus', () => {
  it('is unpaid with no paid_at and no legacy paid status', () => {
    expect(payoutStatus({ status: 'SOLD', workflow_status: 'WAITING_FOR_PAYMENT' })).toBe('unpaid');
  });

  it('is paid when paid_at is set and there is no shortfall', () => {
    expect(payoutStatus({ paid_at: new Date(), payout_short_amount: null })).toBe('paid');
  });

  it('is paid when payout_short_amount is exactly zero', () => {
    expect(payoutStatus({ paid_at: new Date(), payout_short_amount: 0 })).toBe('paid');
  });

  it('is partial when paid_at is set and payout_short_amount is positive', () => {
    expect(payoutStatus({ paid_at: new Date(), payout_short_amount: 12.5 })).toBe('partial');
  });

  it('treats a legacy PAID/COMPLETED status with no paid_at as fully paid (pre-dates paid_at column)', () => {
    expect(payoutStatus({ status: 'PAID', paid_at: null })).toBe('paid');
    expect(payoutStatus({ workflow_status: 'COMPLETED', paid_at: null })).toBe('paid');
  });

  it('is unpaid for an in-progress workflow status that is not a legacy paid value', () => {
    expect(payoutStatus({ workflow_status: 'OUTBOUND', status: 'SHIPPED_OUT', paid_at: null })).toBe('unpaid');
  });
});
