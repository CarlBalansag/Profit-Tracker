import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CreditCard from './CreditCard';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const mocks = vi.hoisted(() => ({ dashboard: null, flow: null, paid: null, methods: null, mutateAsync: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useApi', () => ({
  useCreditCard: () => ({ data: mocks.dashboard, isLoading: false }),
  useCashFlow: () => ({ data: mocks.flow }),
  usePaymentMethods: () => ({ data: mocks.methods }),
  usePaidBills: () => ({ data: mocks.paid }),
  useCardFaces: () => ({ data: { cards: [] } }),
  usePlatforms: () => ({ data: [{ id: 'v', type: 'Vendor', name: 'Best Buy' }] }),
  useTodos: () => ({}),
  useTodoState: () => ({ mutateAsync: mocks.mutateAsync, isPending: false }),
  apiFetch: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const card = (id, name, over = {}) => ({
  id, name, last4: '1234', rewardType: 'cashback', totalSpend: 100, cashbackEarned: 4, totalLosses: 0, cashbackToRedeem: 0, cashbackToKeep: 4,
  uncoveredLoss: 0, amountToPay: 100, txnCount: 1, statement_close_day: 4, due_day: 1, credit_limit: 1000, min_payment_pct: 2,
  items: [{ id: `i-${id}`, saleId: null, product: `Item on ${name}`, cost: 100, cashback: 4, status: 'PURCHASED', revenue: null, netPnl: null, lossAmount: 0, lossToRedeem: 0, cashbackRate: 4 }],
  ...over,
});
const dueDate = () => {
  const now = new Date();
  const d = now.getDate() === 1 ? now : new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const method = (id, rates = []) => ({ id, type: 'Credit', name: id, reward_type: 'cashback', default_cashback_rate: 1, category_rates: rates });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.mutateAsync.mockResolvedValue({});
  mocks.dashboard = { month: '2026-11', summary: { totalAmountToPay: 200, totalCashbackToKeep: 8 }, cards: [card('a', 'Alpha'), card('b', 'Beta', { amountToPay: 55.5, due_day: null })] };
  mocks.flow = { cards: [{ id: 'a', balance: 250, statementBalance: 200, statementOpen: true, statementDue: dueDate() }] };
  mocks.methods = [method('a'), method('b', [{ store: 'Best Buy', rate: 5 }])];
  mocks.paid = { bills: [] };
});
afterEach(cleanup);

const open = () => render(<MemoryRouter><CreditCard /></MemoryRouter>);
const view = (name) => fireEvent.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name }));

describe('Credit Card views', () => {
  it('opens on the wallet and remembers another view and sort', () => {
    const first = open();
    expect(screen.getByRole('list', { name: 'Your cards' })).toBeInTheDocument();
    view('Rows');
    fireEvent.change(screen.getByLabelText(/Sort/), { target: { value: 'name' } });
    first.unmount();
    open();
    expect(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'Rows' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText(/Sort/)).toHaveValue('name');
  });
  it('reorders the wallet from the keyboard and keeps the order', () => {
    const first = open();
    fireEvent.keyDown(screen.getByRole('button', { name: /^Alpha/ }), { key: 'ArrowDown', altKey: true });
    first.unmount();
    expect(JSON.parse(localStorage.getItem('credit_card_page')).order).toEqual(['b', 'a']);
  });
  it('shows the chosen card\'s purchases', () => {
    open();
    expect(screen.getByRole('region', { name: 'Purchases on Alpha' })).toBeInTheDocument();
    view('Rows');
    fireEvent.click(screen.getByRole('button', { name: /Beta/, expanded: false }));
    const panel = screen.getByRole('region', { name: 'Purchases on Beta' });
    expect(within(panel).getByText('Item on Beta')).toBeInTheDocument();
  });
  it('opens a tile in a dialog that closes with Escape', () => {
    open();
    view('Tiles');
    fireEvent.click(screen.getByRole('button', { name: /View details.*Beta/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Net to pay · ', { exact: false })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('finds the best card for a store, and clears', () => {
    open();
    view('Rows');
    const input = screen.getByLabelText('Best card for a store');
    fireEvent.change(input, { target: { value: 'best buy' } });
    expect(screen.getByRole('status')).toHaveTextContent('Beta earns the most at best buy: 5%');
    expect(screen.getAllByRole('button', { expanded: false })[0]).toHaveTextContent('Beta');
    fireEvent.change(input, { target: { value: 'Nowhere' } });
    expect(screen.getByRole('status')).toHaveTextContent('Every card earns the same at Nowhere: 1%');
    fireEvent.click(screen.getByRole('button', { name: 'Clear the store' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('paying a bill', () => {
  const details = () => { view('Rows'); fireEvent.click(screen.getByRole('button', { name: /Alpha/, expanded: false })); };
  it('marks it paid with the to-do list\'s own key, with Undo', async () => {
    open();
    details();
    expect(screen.getAllByText(/Pay next/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Mark paid/ }));
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ key: `card-due:a:${dueDate()}`, action: 'done' });
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Marked paid.', expect.anything()));
    mocks.toast.success.mock.calls[0][1].action.onClick();
    expect(mocks.mutateAsync).toHaveBeenLastCalledWith({ key: `card-due:a:${dueDate()}`, action: 'restore' });
  });
  it('says so when the save fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('offline'));
    open();
    details();
    fireEvent.click(screen.getByRole('button', { name: /Mark paid/ }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Could not save: offline'));
  });
  it('shows a paid bill as paid and takes it off the balance', () => {
    mocks.paid = { bills: [{ card_id: 'a', due_date: dueDate() }] };
    open();
    details();
    expect(screen.queryByText(/Pay next/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Not paid yet/ })).toBeInTheDocument();
    expect(screen.getByText('Balance').nextSibling).toHaveTextContent('$50.00');
  });
  it('calls a balance below zero a credit', () => {
    mocks.flow = { cards: [{ id: 'a', balance: -42.5, statementBalance: 0, statementOpen: true, statementDue: dueDate() }] };
    open();
    details();
    expect(screen.getByText('Balance').nextSibling).toHaveTextContent('$42.50 credit');
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
  });
  it('offers nothing to pay on a card with no due day', () => {
    open();
    view('Rows');
    fireEvent.click(screen.getByRole('button', { name: /Beta/, expanded: false }));
    expect(screen.queryByRole('button', { name: /Mark paid/ })).toBeNull();
  });
});

describe('states', () => {
  it('explains an empty wallet', () => {
    mocks.dashboard = { month: '2026-11', summary: {}, cards: [] };
    open();
    expect(screen.getByText('No credit cards set up')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
  });
  it('works before the other data arrives', () => {
    mocks.flow = undefined; mocks.methods = undefined; mocks.paid = undefined;
    open();
    expect(screen.getAllByText('Alpha').length).toBeGreaterThan(0);
    for (const name of ['Deck', 'Rows', 'Tiles', 'Wallet']) view(name);
    expect(screen.getByRole('list', { name: 'Your cards' })).toBeInTheDocument();
  });
  it('links to the card settings', () => {
    open();
    view('Rows');
    fireEvent.click(screen.getByRole('button', { name: /Alpha/, expanded: false }));
    expect(screen.getByRole('link', { name: 'Edit card' })).toHaveAttribute('href', '/settings');
  });
});
