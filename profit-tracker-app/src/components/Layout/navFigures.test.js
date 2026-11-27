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
      waiting_payments: [{ total: 1344, overdue_total: 0 }, { total: 230, overdue_total: 230 }],
    });
    // Late work says "late" in words, not only in red.
    expect(f['/todos']).toEqual({ text: '1 late', count: 5, problem: true });
    expect(f['/shipping']).toEqual({ text: '1 late', problem: true });
    expect(f['/cashflow']).toEqual({ text: '$230 late', problem: true });
    expect(f['/creditcard']).toEqual({ text: '1 due' });
    expect(f['/inventory']).toEqual({ text: '1 aging' });
    expect(f['/cashout'].text).toBe('1 open');
    expect(f['/expenses']).toEqual({ text: '1 coming' });
    expect(f['/goals']).toBeUndefined();
  });

  it('is empty with no data, and says overdue bills', () => {
    expect(navFigures(undefined)).toEqual({});
    expect(navFigures({ items: [{ type: 'card_overdue' }, { type: 'card_due' }] })['/creditcard']).toEqual({ text: '1 overdue', problem: true });
  });
});
