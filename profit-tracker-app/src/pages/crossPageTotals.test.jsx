import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
import Inventory from './Inventory';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-01-01', unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 2, refunded_amount: 0, refunded_qty: 0,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'PURCHASED', category: null,
  tracking_number: null, sales: [], ...over,
});
const sale = (over) => ({
  id: 's', quantity: 1, unit_price: 20, commission_fee: 0, sale_shipping: 0, refunded_amount: 0, refunded_qty: 0, restored_qty: 0,
  status: 'SOLD', workflow_status: null, sale_date: '2026-01-05', platform: null, platform_id: '', ...over,
});

let inventory = [];
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
const card = (label) => screen.getByText(label).parentElement;

afterEach(cleanup);

describe('Transactions summary cards', () => {
  it('counts a cancelled sale with restored units once in Total Cost', () => {
    inventory = [item({ unit_purchase_cost: 38.96, sales: [sale({ status: 'CANCELLED', workflow_status: 'CANCELLED', restored_qty: 1 })] })];
    mountTransactions();
    expect(within(card('Total Cost')).getByText('$77.92')).toBeTruthy();
    expect(screen.getAllByText('1 BACK IN STOCK').length).toBeGreaterThan(0);
  });

  it('keeps the cost of a cancelled sale whose units never came back', () => {
    inventory = [item({ qty_on_hand: 1, sales: [sale({ status: 'CANCELLED' })] })];
    mountTransactions();
    expect(within(card('Total Cost')).getByText('$20.00')).toBeTruthy();
    expect(screen.queryByText('1 BACK IN STOCK')).toBeNull();
  });

  it('says rows and purchases are different counts', () => {
    inventory = [
      item({ id: 'a', qty_on_hand: 1, sales: [sale()] }),
      item({ id: 'b', qty_on_hand: 0, qty_purchased: 1, sales: [sale({ id: 't' })] }),
    ];
    mountTransactions();
    expect(screen.queryByText('Total Items')).toBeNull();
    const rows = card('Rows Shown');
    expect(within(rows).getByText('3')).toBeTruthy();
    expect(within(rows).getByText('2 purchases · 2 sales')).toBeTruthy();
  });

  it('counts only units really sold in Sold / Done', () => {
    inventory = [item({
      qty_purchased: 6, qty_on_hand: 1,
      sales: [
        sale({ id: 'kept', quantity: 2 }),
        sale({ id: 'part', quantity: 2, refunded_qty: 1 }),
        sale({ id: 'gone', quantity: 1, status: 'CANCELLED', restored_qty: 1 }),
      ],
    })];
    mountTransactions();
    expect(within(card('Sold / Done')).getByText('3')).toBeTruthy();
  });

  it('rounds a half-cent total up, as the API does', () => {
    inventory = [item({ sales_tax: 0.01, qty_on_hand: 1 })];
    mountTransactions();
    // Only the on-hand unit shows: half of $20.01.
    expect(within(card('Total Cost')).getByText('$10.01')).toBeTruthy();
  });
});

describe('Inventory total cost', () => {
  it('always shows two decimals, rounded as Analytics rounds', () => {
    inventory = [item({ sales_tax: 0.01, qty_on_hand: 1 })];
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(screen.queryByText(/10\.005/)).toBeNull();
    const heading = screen.getByText('Inventory Total Cost').parentElement;
    expect(within(heading).getByText('$10.01')).toBeTruthy();
  });
});
