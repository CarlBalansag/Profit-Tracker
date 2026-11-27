import { describe, expect, it } from 'vitest';
import { navFigures as raw } from './navFigures';

// The shown parts (the hint is checked separately).
const navFigures = (...args) => Object.fromEntries(Object.entries(raw(...args)).map(([k, v]) => {
  const shown = { ...v };
  delete shown.hint;
  return [k, shown];
}));

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
    expect(f['/expenses']).toEqual({ text: '1 due soon', count: 1 });
    expect(f['/goals']).toBeUndefined();
  });

  it('is empty with no data, and says overdue bills', () => {
    expect(navFigures(undefined)).toEqual({});
    expect(navFigures({ items: [{ type: 'card_overdue' }, { type: 'card_due' }] })['/creditcard']).toEqual({ text: '1 late', count: 1, problem: true });
  });
});

describe('navFigures hints', () => {
  it('every figure says what it counts', () => {
    const f = raw({ counts: { total: 2 }, items: [{ type: 'aging_stock', urgency: 'info' }, { type: 'ship', urgency: 'soon' }] });
    for (const figure of Object.values(f)) expect(figure.hint).toMatch(/\w/);
    expect(f['/inventory'].hint).toBe('On hand 30+ days and not listed');
  });
});
