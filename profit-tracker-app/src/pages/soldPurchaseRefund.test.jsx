import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const mocks = vi.hoisted(() => ({ inventory: [] }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  useInventory: () => ({ data: mocks.inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useInvalidate: () => ({ all: vi.fn(), inventory: vi.fn() }),
  useRefunds: () => ({ data: [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  useTransactionNotes: () => ({ data: [] }),
  useTransactionNoteMutations: () => ({ add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// 10 boxes @ $27.18 ($271.80), all 10 sold; the store refunded the whole
// $271.80 as a price adjustment (no units sent back).
const soldOut = (refund = '271.80') => ({
  id: 'inv-1', product_name: 'Marvel Box', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-10-14', unit_purchase_cost: 27.18, qty_purchased: 10, qty_on_hand: 0,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'SHIPPED_IN', category: null, tracking_number: null,
  cashback_rate: 0, cashback_earned: 0, refunded_amount: refund, refunded_qty: 0,
  sales: [{ id: 's1', platform: null, platform_id: '', buyer_id: null, quantity: 10, unit_price: 18.16, commission_fee: 0, sale_shipping: 0, sale_date: '2026-11-12', payout_date: null, status: 'SOLD', tracking_number: null, refunded_amount: 0, refunded_qty: 0 }],
});

const desktopRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const rowOf = (label) => desktopRows().find((row) => within(row).queryByText(label));

beforeEach(() => {
  // Some app code reads localStorage; the test environment may not have one.
  if (typeof globalThis.localStorage?.getItem !== 'function') {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), clear: () => store.clear(),
    });
  }
  mocks.inventory = [soldOut()];
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Transactions: store refund on a fully sold purchase', () => {
  it('keeps a BUY row for the refund, and the SALE row has no badge', () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const rows = desktopRows();
    expect(rows).toHaveLength(2);
    const buy = rows.find((row) => within(row).queryByText('BUY'));
    const sale = rows.find((row) => within(row).queryByText('SALE'));
    expect(within(buy).getByText(/REFUNDED \$271\.80/)).toBeInTheDocument();
    expect(within(sale).queryByText(/REFUNDED/)).toBeNull();
  });

  it('the refund-only BUY row adds no units or cost and has no edit, delete or select', () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const buy = rowOf('BUY');
    expect(within(buy).queryByTitle('Edit row')).toBeNull();
    expect(within(buy).queryByTitle('Delete')).toBeNull();
    expect(within(buy).queryByRole('checkbox')).toBeNull();
    expect(within(rowOf('SALE')).getByRole('checkbox')).toBeInTheDocument();
    // Select all picks only the SALE row.
    screen.getByLabelText('Select all rows').click();
    expect(screen.getByText('1 item selected')).toBeInTheDocument();
  });

  it('a fully sold purchase without a store refund still has only its SALE row', () => {
    mocks.inventory = [soldOut(0)];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(desktopRows()).toHaveLength(1);
    expect(rowOf('BUY')).toBeUndefined();
  });
});
