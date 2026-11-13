import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Expenses from './Expenses';
import Receipts from './Receipts';
import { EXPENSES_PAGE_KEY, RECEIPTS_PAGE_KEY } from '../hooks/usePageCache';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  usePaymentMethods: () => ({ data: [] }),
}));

afterEach(cleanup);

const jsonResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const today = new Date().toISOString();
const expense = (id, name) => ({ id, name, amount: 12.5, date: today, category: 'SHIPPING', notes: null, payment_method: null });
const never = () => new Promise(() => {});

const renderWithCache = (ui, queryClient) => render(
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>{ui}</MemoryRouter>
  </QueryClientProvider>,
);

describe('Pages that start from the cache', () => {
  let queryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  it('Expenses shows the cached copy at once, while the server is still answering', async () => {
    mocks.apiFetch.mockImplementation(never);
    queryClient.setQueryData(EXPENSES_PAGE_KEY, {
      expenses: [expense('e1', 'Bubble mailers')], recurring: [], derived: [], derivedFailed: false,
    });

    renderWithCache(<Expenses />, queryClient);

    expect(await screen.findByText('Bubble mailers')).toBeInTheDocument();
    // It still refreshes on every visit.
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/expenses', expect.anything());
  });

  it('Expenses swaps the cached copy for the fresh one when it arrives, and caches that', async () => {
    queryClient.setQueryData(EXPENSES_PAGE_KEY, {
      expenses: [expense('e1', 'Old name')], recurring: [], derived: [], derivedFailed: false,
    });
    mocks.apiFetch.mockImplementation((path) => {
      if (path === '/api/expenses') return Promise.resolve(jsonResponse([expense('e1', 'New name')]));
      return Promise.resolve(jsonResponse([]));
    });

    renderWithCache(<Expenses />, queryClient);

    expect(await screen.findByText('New name')).toBeInTheDocument();
    expect(screen.queryByText('Old name')).not.toBeInTheDocument();
    await waitFor(() => expect(queryClient.getQueryData(EXPENSES_PAGE_KEY).expenses[0].name).toBe('New name'));
  });

  it('Expenses keeps the cached copy when the refresh fails, instead of an error page', async () => {
    queryClient.setQueryData(EXPENSES_PAGE_KEY, {
      expenses: [expense('e1', 'Bubble mailers')], recurring: [], derived: [], derivedFailed: false,
    });
    mocks.apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    renderWithCache(<Expenses />, queryClient);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());
    expect(screen.getByText('Bubble mailers')).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load/i)).not.toBeInTheDocument();
  });

  it('Expenses shows a prefetch that lands before its own first load', async () => {
    mocks.apiFetch.mockImplementation(never);
    renderWithCache(<Expenses />, queryClient);

    await act(async () => {
      await queryClient.fetchQuery({
        queryKey: EXPENSES_PAGE_KEY,
        queryFn: async () => ({ expenses: [expense('e2', 'Poly bags')], recurring: [], derived: [], derivedFailed: false }),
      });
    });

    expect(await screen.findByText('Poly bags')).toBeInTheDocument();
  });

  it('Receipts shows the cached copy at once', async () => {
    mocks.apiFetch.mockImplementation(never);
    queryClient.setQueryData(RECEIPTS_PAGE_KEY, {
      withReceipts: [],
      withoutReceipts: [{ id: 'i1', type: 'purchase', name: 'Jordan 4 Retro', amount: 180, date: today }],
    });

    renderWithCache(<Receipts />, queryClient);

    expect(await screen.findByText('Jordan 4 Retro')).toBeInTheDocument();
  });

  it('still works with no query client (loads as before)', async () => {
    mocks.apiFetch.mockImplementation((path) => Promise.resolve(jsonResponse(path === '/api/expenses' ? [expense('e1', 'Tape')] : [])));
    render(<MemoryRouter><Expenses /></MemoryRouter>);
    expect(await screen.findByText('Tape')).toBeInTheDocument();
  });
});
