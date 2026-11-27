import { describe, expect, it } from 'vitest';
import { navFigures } from './navFigures';

describe('navFigures', () => {
  it('turns the to-do list into one figure per page, only where there is something to say', () => {
    const f = navFigures({
      counts: { total: 5 },
      items: [
        { type: 'ship', urgency: 'overdue' },
        { type: 'send_tracking', group: 'cashout', urgency: 'soon' },
        { type: 'card_due', urgency: 'soon' },
        { type: 'aging_stock', urgency: 'info' },
        { type: 'recurring_expense', urgency: 'info' },
      ],
    }, { summary: { owedTotal: 4232.92, lateCount: 3 } });
    // Late work says "late" in words, not only in red.
    // 1 overdue to-do + Cash Flow's 3 late payouts.
    expect(f['/todos']).toEqual({ text: '4 late', count: 4, problem: true });
    expect(f['/shipping']).toEqual({ text: '1 late', count: 1, problem: true });
    // Same summary as the Cash Flow page: 3 late payments.
    expect(f['/cashflow']).toEqual({ text: '3 late', count: 3, problem: true });
    expect(navFigures({}, { summary: { owedTotal: 4232.92, lateCount: 0 } })['/cashflow']).toEqual({ text: '$4.2k owed' });
    expect(navFigures({})['/cashflow']).toBeUndefined();
    expect(f['/creditcard']).toEqual({ text: '1 due', count: 1 });
    expect(f['/inventory']).toEqual({ text: '1 aging', count: 1 });
    expect(f['/cashout'].text).toBe('1 open');
    expect(f['/expenses']).toEqual({ text: '1 coming', count: 1 });
    expect(f['/goals']).toBeUndefined();
  });

  it('is empty with no data, and says overdue bills', () => {
    expect(navFigures(undefined)).toEqual({});
    expect(navFigures({ items: [{ type: 'card_overdue' }, { type: 'card_due' }] })['/creditcard']).toEqual({ text: '1 overdue', count: 1, problem: true });
  });
});
