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

// 10 boxes @ $27.18 ($271.80); the store refunded $271.80 as a price
// adjustment (no units sent back). `onHand` units are still in stock.
const purchase = ({ refund = '271.80', onHand = 0, saleRefund = 0 } = {}) => ({
  id: 'inv-1', product_name: 'Marvel Box', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-10-14', unit_purchase_cost: 27.18, qty_purchased: 10, qty_on_hand: onHand,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'SHIPPED_IN', category: null, tracking_number: null,
  cashback_rate: 0, cashback_earned: 0, refunded_amount: refund, refunded_qty: 0,
  sales: [{ id: 's1', platform: null, platform_id: '', buyer_id: null, quantity: 10 - onHand, unit_price: 18.16, commission_fee: 0, sale_shipping: 0, sale_date: '2026-11-12', payout_date: null, status: 'SOLD', tracking_number: null, refunded_amount: saleRefund, refunded_qty: 0 }],
});

const desktopRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const pills = (row) => within(row).queryAllByText(/^(SALE|BUY|REFUND)$/).map((el) => el.textContent);

beforeEach(() => {
  // Some app code reads localStorage; the test environment may not have one.
  if (typeof globalThis.localStorage?.getItem !== 'function') {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k), clear: () => store.clear(),
    });
  }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Transactions: yellow REFUND box', () => {

  it('a store refund on a purchase still on hand: BUY stays, its Sale column says REFUND, the SALE row is untouched', () => {
    mocks.inventory = [purchase({ onHand: 2 })];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const rows = desktopRows();
    const buy = rows.find((row) => pills(row).includes('BUY'));
    const sale = rows.find((row) => pills(row).includes('SALE'));
    expect(within(buy).getByTitle('Refunded by the store: $271.80')).toHaveTextContent('REFUND');
    expect(within(sale).queryByText('REFUND')).toBeNull();
    expect(pills(buy)).toEqual(['BUY', 'REFUND']);
  });

  it('a fully sold purchase with a store refund: only its SALE row, which stays SALE', () => {
    mocks.inventory = [purchase()];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const rows = desktopRows();
    expect(rows).toHaveLength(1);
    expect(pills(rows[0])).toEqual(['SALE']);
    expect(screen.queryByText('REFUND')).toBeNull();
  });

  it('a refund to the buyer: the SALE row says REFUND, the BUY row stays BUY', () => {
    mocks.inventory = [purchase({ refund: 0, onHand: 2, saleRefund: '18.16' })];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(desktopRows().map(pills).flat().sort()).toEqual(['BUY', 'REFUND']);
    expect(screen.getAllByTitle('Refunded to the buyer: $18.16').length).toBeGreaterThan(0);
  });

  it('no refunds: plain SALE and BUY, no REFUND anywhere', () => {
    mocks.inventory = [purchase({ refund: 0, onHand: 2 })];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(desktopRows().map(pills).flat().sort()).toEqual(['BUY', 'SALE']);
    expect(screen.queryByText('REFUND')).toBeNull();
  });
});
