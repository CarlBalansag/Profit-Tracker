import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import CreditCard from './CreditCard';
import TransactionDetailModal from '../components/TransactionDetailModal';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), inventory: [], card: null, refunds: {} }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...args) => mocks.apiFetch(...args),
  useInventory: () => ({ data: mocks.inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useInvalidate: () => ({ all: vi.fn(), inventory: vi.fn() }),
  useCreditCard: () => ({ data: mocks.card, isLoading: false }),
  useRefunds: (kind, id) => ({ data: mocks.refunds[`${kind}:${id}`] || [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  useTransactionNotes: () => ({ data: [] }),
  useTransactionNoteMutations: () => ({ add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (body) => new Response(JSON.stringify(body), { status: 200 });
// 5 units @ $100 = $500 (no tax/fees); 1 sent back to the store for $100 and a
// $20 price adjustment; one sale of 2 units @ $150 where the buyer returned 1
// for $150. Stock: 5 - 1 back to store - 2 sold + 1 returned = 3.
const purchase = () => ({
  id: 'inv-1', product_name: 'Lego Set', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-09-01', unit_purchase_cost: 100, qty_purchased: 5, qty_on_hand: 3,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'PURCHASED', category: null, tracking_number: null,
  cashback_rate: 2, cashback_earned: 10, refunded_amount: '120.00', refunded_qty: 1,
  sales: [{ id: 's1', platform: null, platform_id: '', buyer_id: null, quantity: 2, unit_price: 150, commission_fee: 15, sale_shipping: 12, sale_date: '2026-09-03', payout_date: null, status: 'SOLD', tracking_number: null, refunded_amount: '150.00', refunded_qty: 1 }],
});

beforeEach(() => { vi.clearAllMocks(); mocks.inventory = [purchase()]; mocks.refunds = {}; mocks.apiFetch.mockImplementation(async () => json(purchase())); });
afterEach(cleanup);

describe('Transactions: refunded rows', () => {
  it('marks the purchase and the sale as refunded and uses the net numbers', () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(screen.getAllByText('REFUNDED $120.00 · 1 sent back').length).toBeGreaterThan(0);
    expect(screen.getAllByText('REFUNDED $150.00 · 1 returned').length).toBeGreaterThan(0);
  });

  it('shows no badge on a transaction without refunds', () => {
    mocks.inventory = [{ ...purchase(), refunded_amount: 0, refunded_qty: 0, sales: [{ ...purchase().sales[0], refunded_amount: 0, refunded_qty: 0 }] }];
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(screen.queryByText(/REFUNDED/)).toBeNull();
  });
});

describe('Credit Card page: refund credit rows', () => {
  it('shows a store refund as a green credit and the cashback taken back', () => {
    mocks.card = {
      month: '2026-10', summary: {},
      cards: [{ id: 'c1', name: 'Chase', totalSpend: -100, cashbackEarned: -2, totalLosses: 0, cashbackToRedeem: 0, cashbackToKeep: -2, uncoveredLoss: 0, amountToPay: -100, txnCount: 1, soldCount: 0, pendingCount: 0,
        items: [{ id: 'inv-1', saleId: null, kind: 'refund', product: 'Lego Set · Refund', cost: -100, cashback: -2, status: 'Refund', revenue: null, netPnl: null, lossAmount: 0, lossToRedeem: 0, cashbackRate: 2 }] }],
    };
    render(<MemoryRouter><CreditCard /></MemoryRouter>);
    const row = screen.getByText('Lego Set · Refund').closest('tr');
    expect(within(row).getByText('−$100.00')).toBeInTheDocument();
    expect(within(row).getByText('−$2.00')).toBeInTheDocument();
    expect(within(row).getByText('Refund')).toBeInTheDocument();
    fireEvent.click(row);
    expect(screen.getByText('Refund credit')).toBeInTheDocument();
    expect(screen.getByText('Cashback taken back')).toBeInTheDocument();
  });
});

describe('Transaction edit window: refunds', () => {
  const open = async () => {
    render(<TransactionDetailModal row={{ rawId: 'inv-1', status: 'SOLD' }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Refunds from the store')).toBeInTheDocument());
  };

  it('shows the purchase refunds panel and refund lines in the summaries that add up', async () => {
    await open();
    expect(screen.getByText('After −$120.00 refunded · 1 sent back')).toBeInTheDocument();
    expect(screen.getByText('Refunds from store')).toBeInTheDocument();
    expect(screen.getByText('Refunds to buyers')).toBeInTheDocument();
    // Store refund: $500 - $120 = $380 over 4 kept units = $95; buyer kept 1 unit.
    // Profit: 300 - 15 - 12 - 150 - 95 = 28, plus cashback 10 x 380/500 x 1/4 = 1.90.
    expect(screen.getAllByText('+$29.90').length).toBeGreaterThan(0);
  });

  it('opens a sale\'s refunds with the units the buyer can still return', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Refunds/ }));
    expect(screen.getByText('Refunds to the buyer')).toBeInTheDocument();
    expect(screen.getByText(/Up to 1 unit can come back/)).toBeInTheDocument();
  });

  it('a cancelled sale explains how to change its refunds instead of offering the form', async () => {
    mocks.apiFetch.mockImplementation(async () => json({ ...purchase(), sales: [{ ...purchase().sales[0], status: 'CANCELLED' }] }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: /Refunds/ }));
    expect(screen.getByText(/its refunds can.t be changed/)).toBeInTheDocument();
  });

  it('keeps the stored cashback on the full original charge when the rate changes', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Cashback %'), { target: { value: '3' } });
    // 3% of the $500 charged, not of the $380 left after refunds.
    expect(Number(screen.getByLabelText('Cashback $').value)).toBe(15);
  });

  it('saving the window never sends the refund totals', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
    const body = JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory/inv-1/transaction')[1].body);
    expect(body.inventory).not.toHaveProperty('refunded_amount');
    expect(body.sales[0]).not.toHaveProperty('refunded_qty');
  });
});
