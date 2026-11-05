import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import Inventory from './Inventory';
import Analytics from './Analytics';
import CashFlow from './CashFlow';
import CreditCard from './CreditCard';
import Goals from './Goals';
import Statuses from './Statuses';
import Shipping from './Shipping';
import AddSale from './AddSale';
import Calendar from './Calendar';
import Expenses from './Expenses';
import Receipts from './Receipts';
import TaxExempt from './TaxExempt';
import { apiFetch } from '../hooks/useApi';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const { failed, ok, refetch } = vi.hoisted(() => {
  const refetch = vi.fn();
  return {
    refetch,
    failed: { data: undefined, isLoading: false, isLoadingError: true, refetch },
    ok: { data: [], isLoading: false, isLoadingError: false, refetch },
  };
});

let stale = false;
const load = () => (stale ? { ...ok, data: [] } : failed);

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(),
  useInvalidate: () => ({}),
  useInventory: () => load(),
  useSales: () => load(),
  usePlatforms: () => load(),
  useDashboard: () => load(),
  useCreditCard: () => load(),
  useGoals: () => load(),
  useCalendarEvents: () => load(),
  useCalendarAutoEvents: () => load(),
  useBuyers: () => ok,
  usePaymentMethods: () => ok,
  useCalendarToken: () => ok,
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: {}, remove: {} }),
  useGoalsMutations: () => ({ create: {}, update: {} }),
  useCalendarMutations: () => ({}),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mount = (page) => render(<MemoryRouter>{createElement(page)}</MemoryRouter>);

beforeEach(() => {
  stale = false;
  refetch.mockClear();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'down' }) });
});
afterEach(cleanup);

describe('pages that load through shared queries', () => {
  it.each([
    ['Transactions', Transactions, 'your transactions'],
    ['Inventory', Inventory, 'your inventory'],
    ['Analytics', Analytics, 'your analytics'],
    ['Cash Flow', CashFlow, 'your cash flow'],
    ['Credit Card', CreditCard, 'your credit cards'],
    ['Goals', Goals, 'your goals'],
    ['Statuses', Statuses, 'your statuses'],
    ['Shipping', Shipping, 'your shipments'],
    ['Record Sale', AddSale, 'your in-stock items'],
    ['Calendar', Calendar, 'your calendar'],
  ])('%s says the load failed instead of showing empty numbers', (_name, Page, what) => {
    const { container } = mount(Page);
    expect(screen.getByRole('alert').textContent).toContain(`Couldn't load ${what}`);
    expect(container.textContent).not.toContain('$0.00');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('tries again when asked', () => {
    mount(Inventory);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('keeps the page when a query only failed to refresh data it already has', () => {
    stale = true;
    mount(Inventory);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Inventory On Hand');
  });
});

describe('pages that load their own data', () => {
  it.each([
    ['Expenses', Expenses, 'your expenses'],
    ['Receipts', Receipts, 'your receipts'],
    ['Tax Exempt', TaxExempt, 'your tax-exempt records'],
  ])('%s says the load failed instead of showing empty numbers', async (_name, Page, what) => {
    const { container } = mount(Page);
    expect((await screen.findByRole('alert')).textContent).toContain(`Couldn't load ${what}`);
    expect(container.textContent).not.toContain('$0.00');
  });

  it('shows the same error when the request never reaches the server', async () => {
    apiFetch.mockRejectedValue(new Error('offline'));
    mount(Receipts);
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load your receipts");
  });

  it('recovers when trying again works', async () => {
    mount(Receipts);
    await screen.findByRole('alert');
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ withReceipts: [], withoutReceipts: [] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Receipts');
  });

  it('counts a failure on either request behind Tax Exempt', async () => {
    apiFetch.mockImplementation(async (path) => (path === '/api/sales'
      ? { ok: false, status: 500, json: async () => ({}) }
      : { ok: true, status: 200, json: async () => [] }));
    mount(TaxExempt);
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't load");
  });
});
