import { describe, expect, it } from 'vitest';
import { getExpenseInsights } from './expenseInsights';

describe('getExpenseInsights', () => {
  it('summarizes the current month without mixing in prior-month expenses', () => {
    const expenses = [
      { date: '2026-09-02T12:00:00Z', amount: 30, category: 'SHIPPING' },
      { date: '2026-09-08T12:00:00Z', amount: 70, category: 'SOFTWARE' },
      { date: '2026-08-15T12:00:00Z', amount: 50, category: 'SHIPPING' },
    ];
    const insights = getExpenseInsights(expenses, [], new Date('2026-09-11T12:00:00Z'));

    expect(insights.currentTotal).toBe(100);
    expect(insights.previousTotal).toBe(50);
    expect(insights.monthChange).toBe(1);
    expect(insights.largestCategory).toMatchObject({ category: 'SOFTWARE', amount: 70 });
  });

  it('normalizes active recurring expenses and excludes paused commitments', () => {
    const recurring = [
      { amount: 10, frequency: 'weekly', active: true },
      { amount: 24, frequency: 'biweekly', active: true },
      { amount: 50, frequency: 'monthly', active: false },
    ];
    const insights = getExpenseInsights([], recurring, new Date('2026-09-11T12:00:00Z'));

    expect(insights.recurringMonthly).toBeCloseTo((10 * 52 / 12) + (24 * 26 / 12));
  });
});
