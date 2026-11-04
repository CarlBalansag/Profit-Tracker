import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import Inventory from './Inventory';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString();
const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: daysAgo(40), received_date: null, unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 2,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'On Hand', category: null,
  tracking_number: null, sales: [], ...over,
});
const inventory = [
  item({ id: 'a', purchase_date: daysAgo(40), is_listed: true, receiving_status: 'RECEIVED' }),
  item({ id: 'b', purchase_date: daysAgo(100), qty_on_hand: 1, qty_purchased: 1 }),
  item({ id: 'c', product_name: 'Sold Out Batch', purchase_date: daysAgo(200), qty_on_hand: 0 }),
  item({ id: 'd', product_name: 'Old Style Listing', purchase_date: daysAgo(5), status: 'LISTED', qty_on_hand: 3, qty_purchased: 3 }),
  item({ id: 'e', product_name: 'Unlisted Workflow Row', purchase_date: daysAgo(5), status: 'LISTED', receiving_status: 'RECEIVED', is_listed: false, qty_on_hand: 7, qty_purchased: 7 }),
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

const headers = (container) => [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());
const mountTransactions = () => render(<MemoryRouter><Transactions /></MemoryRouter>);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('Transactions default columns', () => {
  it('starts with the key columns and leaves the rest in the menu', () => {
    const cols = headers(mountTransactions().container);
    expect(cols).toEqual(expect.arrayContaining(['Date', 'Product', 'Cost', 'Sale', 'Profit', 'Status']));
    expect(cols).not.toContain('Tracking');
    expect(cols).not.toContain('Place Sold');
    expect(cols).not.toContain('Retail Price');
  });

  it('moves someone with the old saved all-on set to the shorter default', () => {
    const allOn = ['date', 'product', 'vendor', 'platform', 'qty', 'cost', 'sale', 'commission', 'profit', 'cashback', 'payment', 'status', 'retail', 'tax', 'shipping', 'category', 'tracking'];
    localStorage.setItem('txn_visible_cols', JSON.stringify(Object.fromEntries(allOn.map(k => [k, true]))));
    expect(headers(mountTransactions().container)).not.toContain('Tracking');
  });

  it('keeps a set someone chose themselves', () => {
    localStorage.setItem('txn_visible_cols', JSON.stringify({ date: true, product: true, tracking: true, profit: false }));
    const cols = headers(mountTransactions().container);
    expect(cols).toContain('Tracking');
    expect(cols).not.toContain('Profit');
  });

  it('keeps every column on for someone who chose that after the move', () => {
    const allOn = ['date', 'product', 'vendor', 'platform', 'qty', 'cost', 'sale', 'commission', 'profit', 'cashback', 'payment', 'status', 'retail', 'tax', 'shipping', 'category', 'tracking'];
    localStorage.setItem('txn_visible_cols', JSON.stringify(Object.fromEntries(allOn.map(k => [k, true]))));
    localStorage.setItem('txn_visible_cols_v2', '1');
    expect(headers(mountTransactions().container)).toContain('Tracking');
  });
});

describe('Inventory counts', () => {
  const mountInventory = () => render(<MemoryRouter><Inventory /></MemoryRouter>);

  it('counts listings the way Analytics does', () => {
    mountInventory();
    const card = screen.getByText('Active Listings').parentElement;
    // 2 flagged is_listed + 3 older LISTED rows; the row unlisted through the workflow is left out.
    expect(within(card).getByText('5 units')).toBeTruthy();
  });

  it('shows the oldest in-stock age on a grouped row', () => {
    mountInventory();
    expect(screen.getByText('Up to 100 days')).toBeTruthy();
  });
});
