import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import DueSoonBanner from './DueSoonBanner';

const mocks = vi.hoisted(() => ({ todos: undefined, cashFlow: undefined }));
vi.mock('../../hooks/useApi', () => ({
  useTodos: () => ({ data: mocks.todos }),
  useCashFlow: () => ({ data: mocks.cashFlow }),
}));

const todo = (cardId, date, over = {}) => ({ key: `card-due:${cardId}:${date}`, type: 'card_due', due_date: date, ...over });
const card = (id, date, over = {}) => ({ id, name: `Card ${id}`, last4: null, statementDue: date, statementBalance: 432.1, ...over });
const view = (todos, cards) => {
  mocks.todos = { items: todos };
  mocks.cashFlow = { cards };
  return render(<MemoryRouter><DueSoonBanner /></MemoryRouter>);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 24, 23, 30)); // late evening, local time
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Payment due soon banner', () => {
  it('names each card due within 3 days, soonest first, with its statement', () => {
    view(
      [todo('b', '2026-11-27'), todo('a', '2026-11-25'), todo('c', '2026-11-24')],
      [card('b', '2026-11-27'), card('a', '2026-11-25', { name: 'Chase Sapphire', last4: '1234', statementBalance: 1250.5 }), card('c', '2026-11-24')],
    );
    const items = within(screen.getByRole('region', { name: 'Payment due soon' })).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'Card c is due today (Nov 24), about $432.10',
      'Chase Sapphire ··1234 is due tomorrow (Nov 25), about $1,250.50',
      'Card b is due in 3 days (Nov 27), about $432.10',
    ]);
    expect(screen.getByRole('link', { name: 'Open To-Do' })).toHaveAttribute('href', '/todos');
  });

  it('is gone once the bill leaves To-Do (marked paid, snoozed or dismissed)', () => {
    const { container } = view([], [card('a', '2026-11-25')]);
    expect(container).toBeEmptyDOMElement();
  });

  it('skips a card with nothing on the statement, or a credit', () => {
    const { container } = view(
      [todo('a', '2026-11-25'), todo('b', '2026-11-25')],
      [card('a', '2026-11-25', { statementBalance: 0 }), card('b', '2026-11-25', { statementBalance: -20 })],
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('never shows the amount of a different statement', () => {
    const { container } = view([todo('a', '2026-11-25')], [card('a', '2026-12-25')]);
    expect(container).toBeEmptyDOMElement();
  });

  it('ignores overdue bills, other to-dos, and stale or far-off dates', () => {
    const { container } = view(
      [todo('a', '2026-11-25', { type: 'card_overdue' }), todo('b', '2026-11-23'), todo('c', '2026-11-28'), { key: 'sale:1', type: 'ship', due_date: '2026-11-25' }],
      [card('a', '2026-11-25'), card('b', '2026-11-23'), card('c', '2026-11-28')],
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows nothing while loading or when a request fails', () => {
    mocks.todos = undefined;
    mocks.cashFlow = undefined;
    const { container } = render(<MemoryRouter><DueSoonBanner /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
