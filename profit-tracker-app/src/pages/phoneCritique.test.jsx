import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AddSale from './AddSale';
import Inventory from './Inventory';
import Transactions from './Transactions';
import { downloadFile } from '../utils/downloads';
import { apiFetch } from '../hooks/useApi';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const item = (over) => ({
  id: 'a', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-10-01T12:00:00Z', received_date: null, unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 2,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'LISTED', category: null,
  tracking_number: null, sales: [], ...over,
});
let inventory = [];

vi.mock('../hooks/useApi', () => ({
  apiFetch: vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  useInvalidate: () => ({ all: vi.fn() }),
  useInventory: () => ({ data: inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [], isLoading: false }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}));
vi.mock('../utils/downloads', async (original) => ({ ...(await original()), downloadFile: vi.fn() }));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), promise: vi.fn() }) }));

const Where = () => {
  const { pathname, state } = useLocation();
  return <p data-testid="where">{pathname} {state?.inventoryId}</p>;
};

beforeEach(() => {
  inventory = [item({})];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('Record Sale', () => {
  const mount = (entry = '/add-sale') => render(
    <MemoryRouter initialEntries={[entry]}><AddSale /></MemoryRouter>,
  );

  it('swaps the list for the form once an item is picked, and back again', () => {
    const { container } = mount();
    const list = container.querySelector('.grid > div');
    expect(list.className).not.toContain('max-lg:hidden');
    fireEvent.click(screen.getByRole('button', { name: /Widget/ }));
    expect(list.className).toContain('max-lg:hidden');
    fireEvent.click(screen.getByRole('button', { name: 'Change item' }));
    expect(list.className).not.toContain('max-lg:hidden');
  });

  it('opens with the batch chosen when Inventory sends one', async () => {
    mount({ pathname: '/add-sale', state: { inventoryId: 'a' } });
    expect(await screen.findByRole('button', { name: 'Change item' })).toBeTruthy();
  });
});

describe('Inventory actions', () => {
  const mount = () => render(
    <MemoryRouter initialEntries={['/inventory']}>
      <Routes><Route path="*" element={<><Inventory /><Where /></>} /></Routes>
    </MemoryRouter>,
  );

  it('sends Add Inventory to the add form', () => {
    mount();
    expect(screen.getByRole('link', { name: 'Add Inventory' }).getAttribute('href')).toBe('/add-transaction');
  });

  it('sells a batch with it already chosen', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'Sell Widget' }));
    expect(screen.getByTestId('where').textContent).toBe('/add-sale a');
  });

  it('exports what is on the page', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Export Report' }));
    const [name, content] = downloadFile.mock.calls[0];
    expect(name).toBe('inventory-on-hand.csv');
    expect(content).toContain('Widget');
    expect(content).toContain('20.00');
  });

  it('says what the eBay link opens', () => {
    mount();
    expect(screen.getByText('eBay sold prices')).toBeTruthy();
  });
});

describe('Transactions phone cards', () => {
  const sale = { id: 's1', platform: null, platform_id: '', buyer_id: null, quantity: 1, unit_price: 449.74, commission_fee: 71.09, sale_shipping: 0, status: 'SOLD', sale_date: '2026-10-05T12:00:00Z', refunded_amount: 0, refunded_qty: 0, restored_qty: 0 };
  const mount = () => render(<MemoryRouter>{createElement(Transactions)}</MemoryRouter>);

  beforeEach(() => {
    inventory = [item({ unit_purchase_cost: 425.86, qty_purchased: 1, qty_on_hand: 0, cashback_rate: 1.5, cashback_earned: 6.39, sales: [sale] })];
  });

  it('shows every number that makes up the profit', () => {
    const { container } = mount();
    const card = container.querySelector('.md\\:hidden .card');
    const text = card.textContent;
    expect(text).toContain('Fees-$71.09');
    expect(text).toContain('Cashback+$6.39');
    expect(text).toContain('-$40.82');
    expect(text).not.toContain('$-');
  });

  it('explains a delete and only runs it once confirmed', async () => {
    const { container } = mount();
    const card = container.querySelector('.md\\:hidden .card');
    fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/any units it still holds go back into stock/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(apiFetch).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Delete' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/sales/s1', expect.objectContaining({ method: 'DELETE' })));
  });
});
