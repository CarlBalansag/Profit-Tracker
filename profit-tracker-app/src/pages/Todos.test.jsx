import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Todos from './Todos';
import TodoSummary from '../components/Dashboard/TodoSummary';
import { addDays, localToday } from '../utils/returnWindow';

let todos;
let queryState;
const mutate = vi.fn();

vi.mock('../hooks/useApi', () => ({
  useTodos: () => ({ data: todos, isLoading: false, isError: queryState.isError, refetch: vi.fn(), isRefetching: false }),
  useTodoState: () => ({ mutate, isPending: false }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const entry = (fields) => ({
  key: `ship:${Math.random()}`, type: 'ship', group: 'sales', urgency: 'soon', title: 'Ship it', detail: 'PS5 · sold on eBay 4 days ago',
  due_date: null, amount: null, link: { kind: 'transaction', inventoryId: 'inv-1', saleId: 'sale-1' }, actions: ['snooze', 'dismiss'], ...fields,
});

const response = (items, hidden = []) => ({ today: localToday(), items, counts: { total: items.length }, hidden: hidden.length, hidden_items: hidden });

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname} {JSON.stringify(location.state)}</p>;
}

const mount = (element = <Todos />) => render(
  <MemoryRouter initialEntries={['/todos']}>
    <Routes>
      <Route path="/todos" element={element} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  queryState = { isError: false };
  mutate.mockReset();
});
afterEach(cleanup);

describe('To-Do page', () => {
  it('shows an all-caught-up message when nothing needs the user', () => {
    todos = response([]);
    mount();
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
  });

  it('shows a retry screen when the list fails to load', () => {
    todos = undefined;
    queryState.isError = true;
    mount();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });

  it('sorts items into urgency sections, most urgent first', () => {
    todos = response([
      entry({ key: 'dispute:1', type: 'open_dispute', urgency: 'today', title: 'Open dispute' }),
      entry({ key: 'card-due:c:2026-11-10', type: 'card_overdue', group: 'cards', urgency: 'overdue', title: 'Amex was due 2 days ago' }),
      entry({ key: 'aging:1', type: 'aging_stock', group: 'purchases', urgency: 'info', title: 'Sitting 40 days, not listed' }),
    ]);
    mount();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual(['Overdue 1', 'Today 1', 'For your info 1']);
    expect(within(screen.getByRole('region', { name: 'Overdue' })).getByText('Amex was due 2 days ago')).toBeInTheDocument();
  });

  it('filters by group, showing only groups that have items', () => {
    todos = response([
      entry({ key: 'ship:1' }),
      entry({ key: 'send-tracking:1', type: 'send_tracking', group: 'cashout', title: 'Send tracking' }),
    ]);
    mount();
    const chips = within(screen.getByRole('group', { name: 'Show' })).getAllByRole('button').map((b) => b.textContent);
    expect(chips).toEqual(['All 2', 'Cash-outs 1', 'Sales 1']);
    fireEvent.click(screen.getByRole('button', { name: 'Cash-outs 1' }));
    expect(screen.getByText('Send tracking')).toBeInTheDocument();
    expect(screen.queryByText('Ship it')).not.toBeInTheDocument();
  });

  it('folds three or more of one kind into an expandable row', () => {
    todos = response(['A', 'B', 'C'].map((name) => entry({ key: `ship:${name}`, detail: `${name} · sold on eBay` })));
    mount();
    const fold = screen.getByRole('button', { name: /Ship it \(3\)/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /^Open / })).not.toBeInTheDocument();
    fireEvent.click(fold);
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(3);
  });

  it('opens a purchase or sale in the Transactions window', () => {
    todos = response([entry({ key: 'ship:1' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Open Ship it/ }));
    expect(screen.getByTestId('where').textContent).toBe('/transactions {"openTransaction":{"inventoryId":"inv-1","saleId":"sale-1"}}');
  });

  it('opens a page link with its state', () => {
    todos = response([entry({ key: 'card-setup:1', type: 'card_setup', group: 'cards', title: 'Finish card setup: Amex', link: { kind: 'page', to: '/settings', state: { tab: 'datasetup' } } })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /^Open Finish card setup/ }));
    expect(screen.getByTestId('where').textContent).toBe('/settings {"tab":"datasetup"}');
  });

  it('marks a card bill paid for its cycle', () => {
    const key = 'card-due:card-1:2026-11-25';
    todos = response([entry({ key, type: 'card_due', group: 'cards', title: 'Pay Amex', actions: ['mark_paid', 'snooze', 'dismiss'] })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    expect(mutate).toHaveBeenCalledWith({ key, action: 'done', until: undefined }, expect.any(Object));
  });

  it('snoozes or dismisses from the Later options', () => {
    todos = response([entry({ key: 'ship:1' })]);
    mount();
    const later = screen.getByRole('button', { name: /Later/ });
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
    fireEvent.click(later);
    expect(later).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '3 days' }));
    expect(mutate).toHaveBeenLastCalledWith({ key: 'ship:1', action: 'snooze', until: addDays(localToday(), 3) }, expect.any(Object));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(mutate).toHaveBeenLastCalledWith({ key: 'ship:1', action: 'dismiss', until: undefined }, expect.any(Object));
  });

  it('only offers dismiss on items that cannot be snoozed', () => {
    todos = response([entry({ key: 'recurring:1:2026-11-23', type: 'recurring_expense', group: 'bookkeeping', title: 'Coming up: Pirate Ship', actions: ['dismiss'] })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Hide/ }));
    expect(screen.queryByRole('button', { name: 'Tomorrow' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('lists snoozed and dismissed items and brings one back', () => {
    todos = response([], [entry({ key: 'dispute:9', title: 'Open dispute', state: 'snoozed', until: '2026-12-01' })]);
    mount();
    fireEvent.click(screen.getByRole('button', { name: /Snoozed and dismissed \(1\)/ }));
    expect(screen.getByText(/Snoozed until/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Bring back/ }));
    expect(mutate).toHaveBeenCalledWith({ key: 'dispute:9', action: 'restore' }, expect.any(Object));
  });
});

describe('Dashboard Needs attention card', () => {
  it('renders nothing when the list is empty', () => {
    todos = response([]);
    const { container } = mount(<TodoSummary />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the three most urgent items and links to the full list', () => {
    todos = response([1, 2, 3, 4].map((n) => entry({ key: `ship:${n}`, title: `Item ${n}`, urgency: n === 1 ? 'overdue' : 'soon' })));
    todos.counts.urgent = 1;
    mount(<TodoSummary />);
    const card = screen.getByRole('region', { name: 'Needs attention' });
    expect(within(card).getByText('4 · 1 urgent')).toBeInTheDocument();
    expect(within(card).getAllByRole('listitem')).toHaveLength(3);
    expect(within(card).getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/todos');
    fireEvent.click(within(card).getByText('Item 1'));
    expect(screen.getByTestId('where').textContent).toContain('/transactions');
  });
});
