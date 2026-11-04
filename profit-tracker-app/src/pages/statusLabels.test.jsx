import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import Inventory from './Inventory';

// jsdom has no ResizeObserver; Transactions.jsx uses one purely to size a scroll shadow.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-01-01', unit_purchase_cost: 10, qty_purchased: 3, qty_on_hand: 3,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'SHIPPED_IN', category: null,
  tracking_number: null, sales: [], ...over,
});
const inventory = [
  item(),
  item({ id: 'b', product_name: 'Gadget', qty_on_hand: 2, qty_purchased: 2, status: 'SCANNED_IN' }),
  item({ id: 'c', product_name: 'Preorder Thing', qty_on_hand: 4, qty_purchased: 4, status: 'Pre Order' }),
  item({ id: 'd', product_name: 'Shelf Thing', qty_on_hand: 1, qty_purchased: 1, status: 'On Hand' }),
];

vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useInvalidate: () => ({}),
  apiFetch: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mountTransactions = () => render(<MemoryRouter><Transactions /></MemoryRouter>);

afterEach(cleanup);

describe('status labels on Transactions', () => {
  it('counts unsold units under a label that says so', () => {
    mountTransactions();
    expect(screen.queryByText('Active Listed')).toBeNull();
    const card = screen.getByText('Unsold Units').parentElement;
    expect(within(card).getByText('10')).toBeTruthy();
  });

  it('shows friendly names in the filter while keeping the stored value', () => {
    mountTransactions();
    const option = screen.getByRole('option', { name: 'Shipped In' });
    expect(option.value).toBe('SHIPPED_IN');
    expect(screen.queryByRole('option', { name: 'SHIPPED_IN' })).toBeNull();
  });

  it('still filters by the stored status after the rename', () => {
    mountTransactions();
    const select = screen.getByRole('option', { name: 'Shipped In' }).closest('select');
    fireEvent.change(select, { target: { value: 'SHIPPED_IN' } });
    const card = screen.getByText('Unsold Units').parentElement;
    expect(within(card).getByText('3')).toBeTruthy();
  });

  it.each([
    ['Pre-order', 'Pre Order', '4'],
    ['On Hand', 'On Hand', '1'],
  ])('filters %s rows, whose stored status is mixed case', (label, value, units) => {
    mountTransactions();
    const select = screen.getByRole('option', { name: label }).closest('select');
    fireEvent.change(select, { target: { value } });
    const card = screen.getByText('Unsold Units').parentElement;
    expect(within(card).getByText(units)).toBeTruthy();
  });

  it('never prints a raw status code in a badge', () => {
    const { container } = mountTransactions();
    expect(container.textContent).not.toMatch(/SHIPPED_IN|SCANNED_IN/);
    expect(screen.getAllByText('Shipped In').length).toBeGreaterThan(0);
  });
});

describe('status labels on Inventory', () => {
  it('shows friendly names instead of raw status codes', () => {
    const { container } = render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(container.textContent).not.toMatch(/SHIPPED_IN|SCANNED_IN/);
    expect(screen.getAllByText('Scanned In').length).toBeGreaterThan(0);
  });
});
