import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddSale from './AddSale';
import AddTransaction from './AddTransaction';
import Expenses from './Expenses';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: [{ id: 'inv-1', product_name: 'Fixture item', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 10, purchase_date: '2026-09-01', vendor: { name: 'Store' }, sales: [] }] }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useProductNames: () => ({ data: [] }),
  useRecentTransaction: () => ({ data: null }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useInvalidate: () => ({ all: vi.fn() }),
}));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));

// 11:30 PM local time on Nov 2. In any timezone behind UTC this instant is
// already Nov 3 in UTC, which is what the forms used to default to.
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.apiFetch.mockImplementation(async () => ({ ok: true, json: async () => [] }));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 2, 23, 30));
});
afterEach(() => { vi.useRealTimers(); cleanup(); });

describe('date fields default to the local day late in the evening', () => {
  it('Add Transaction', () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    expect(document.querySelector('input[name="purchase_date"]').value).toBe('2026-11-02');
  });

  it('Record Sale', () => {
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fixture item/ }));
    expect(document.querySelector('input[name="sale_date"]').value).toBe('2026-11-02');
  });

  it('Add Expense', async () => {
    render(<MemoryRouter><Expenses /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    await screen.findByRole('heading', { name: 'Add Expense' });
    expect(document.querySelector('input[type="date"]').value).toBe('2026-11-02');
  });
});
