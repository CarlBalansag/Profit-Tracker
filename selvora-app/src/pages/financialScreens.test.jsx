import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddSale from './AddSale';
import AddTransaction from './AddTransaction';
import Inventory from './Inventory';
import TransactionDetailModal from '../components/TransactionDetailModal';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), inventory: [], platforms: [], cards: [] }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: mocks.inventory }),
  usePlatforms: () => ({ data: mocks.platforms }),
  usePaymentMethods: () => ({ data: mocks.cards }),
  useProductNames: () => ({ data: [] }),
  useRecentTransaction: () => ({ data: null }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useInvalidate: () => ({ all: vi.fn() }),
}));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
const purchase = { id: 'purchase', product_name: 'Fixture item', vendor_id: 'vendor', payment_method_id: 'card',
  qty_purchased: 2, qty_on_hand: 1, unit_purchase_cost: 100, sales_tax: 10, shipping_cost_inbound: 6,
  fees: 4, gift_card_amount: 20, purchase_date: '2026-09-01', vendor: { name: 'Vendor' },
  sales: [{ id: 'sale', quantity: 1, unit_price: 140, commission_fee: 10, sale_shipping: 8, status: 'SOLD', sale_date: '2026-09-02' }] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.inventory = [purchase];
  mocks.platforms = [{ id: 'vendor', name: 'Vendor', type: 'Vendor' }];
  mocks.cards = [{ id: 'card', name: 'Card', default_cashback_rate: 2 }];
});
afterEach(cleanup);
describe('financial screen regression', () => {
  it('distributes split-unit residual cents consistently in Inventory and Add Sale preview', () => {
    mocks.inventory = [{ ...purchase, qty_purchased: 3, qty_on_hand: 2, unit_purchase_cost: 3.33,
      sales_tax: 0, shipping_cost_inbound: 0, fees: 0.01, gift_card_amount: 0,
      sales: [{ id: 'first', quantity: 1, unit_price: 4, sale_date: '2026-09-01', status: 'SOLD' }] }];
    const view = render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(screen.getAllByText('$6.67').length).toBe(2);
    view.unmount();
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fixture item/ }));
    fireEvent.change(document.querySelector('input[name="unit_price"]'), { target: { value: '4' } });
    expect(screen.getByText('+$0.66')).toBeTruthy();
  });
  it('allocates purchase fees and cashback in Add Transaction partial-sale preview', () => {
    localStorage.setItem('add_transaction_draft', JSON.stringify({ ts: Date.now(), data: { ...purchase,
      qty_sold: 1, sale_price: 140, commission_fee: 10, sale_shipping: 8, sale_tab: 'marketplace',
      cashback_include_tax: false, cashback_include_shipping: false } }));
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Has this item been sold/ }));
    fireEvent.click(screen.getByRole('button', { name: '+ Cashback', exact: true }));
    expect(screen.getByText('+$24.00')).toBeTruthy();
    expect(screen.getByText(/Includes \$2.00 cashback/)).toBeTruthy();
    expect(screen.queryByText('Include tax in cashback')).toBeNull();
    localStorage.clear();
  });
  it('shows allocated remaining purchase value on Inventory', () => {
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(screen.getAllByText('$100.00').length).toBe(2);
    expect(screen.queryByText('$120.00')).toBeNull();
  });
  it('includes purchase fees in Add Sale profit preview', () => {
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fixture item/ }));
    const fill = (name, value) => fireEvent.change(document.querySelector(`input[name="${name}"]`), { target: { value } });
    fill('unit_price', '140');
    fill('commission_fee', '10');
    fill('sale_shipping', '8');
    expect(screen.getByText('+$22.00')).toBeTruthy();
    expect(screen.queryByText('+$24.00')).toBeNull();
  });
  it('uses sold cost and sold cashback for partial-sale editor summary, not full-batch cost', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify(purchase), { status: 200 }));
    render(<TransactionDetailModal row={{ rawId: 'purchase', status: 'SOLD' }} platforms={mocks.platforms}
      paymentMethods={mocks.cards} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Realized Profit + Cashback')).toBeTruthy());
    expect(screen.getAllByText('+$24.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('-$74.00')).toBeNull();
    expect(screen.getByText(/Includes \$2.00 sold-unit cashback/)).toBeTruthy();
  });
  it('excludes a cancelled sale from the editor realized profit summary', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ ...purchase, sales: [{ ...purchase.sales[0], status: 'CANCELLED' }] }), { status: 200 }));
    render(<TransactionDetailModal row={{ rawId: 'purchase', status: 'SOLD' }} platforms={mocks.platforms}
      paymentMethods={mocks.cards} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Realized Profit + Cashback')).toBeTruthy());
    expect(screen.getAllByText('+$0.00').length).toBeGreaterThan(0);
  });
});
