import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddSale from './AddSale';
import AddTransaction from './AddTransaction';
import Expenses from './Expenses';
import TransactionDetailModal from '../components/TransactionDetailModal';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), inventory: [], cards: [] }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: mocks.inventory }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: mocks.cards }),
  useBuyers: () => ({ data: [] }),
  useProductNames: () => ({ data: [] }),
  useRecentTransaction: () => ({ data: null }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useInvalidate: () => ({ all: vi.fn() }),
}));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));

const purchase = {
  id: 'purchase', product_name: 'Fixture item', qty_purchased: 2, qty_on_hand: 1, unit_purchase_cost: 100,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, purchase_date: '2026-09-01',
  sales: [{ id: 'sale', quantity: 1, unit_price: 140, commission_fee: 10, sale_shipping: 8, status: 'SOLD', sale_date: '2026-09-02', sale_shipping_payment_method_id: 'card-2' }],
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (path) => JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === path)[1].body);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.inventory = [purchase];
  mocks.cards = [{ id: 'card-1', name: 'Chase Freedom Flex', default_cashback_rate: 1.5 }, { id: 'card-2', name: 'Wells Fargo Debit', default_cashback_rate: 0 }];
  mocks.apiFetch.mockResolvedValue(json({ id: 'new' }));
});
afterEach(cleanup);

describe('Record Sale: label paid with', () => {
  it('lists every card, defaults to "from payout", and sends the chosen card', async () => {
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fixture item/ }));
    const select = screen.getByLabelText('Label Paid With');
    expect(select.value).toBe('');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['From payout', 'Chase Freedom Flex', 'Wells Fargo Debit']);
    fireEvent.change(document.querySelector('input[name="unit_price"]'), { target: { name: 'unit_price', value: '140' } });
    fireEvent.change(document.querySelector('input[name="sale_shipping"]'), { target: { name: 'sale_shipping', value: '7.12' } });
    fireEvent.change(select, { target: { name: 'sale_shipping_payment_method_id', value: 'card-1' } });
    fireEvent.submit(select.closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/sales', expect.anything()));
    expect(bodyOf('/api/sales')).toMatchObject({ sale_shipping: '7.12', sale_shipping_payment_method_id: 'card-1' });
  });

  it('sends an empty card (stored as no card) when left on "from payout"', async () => {
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /Fixture item/ }));
    fireEvent.change(document.querySelector('input[name="unit_price"]'), { target: { name: 'unit_price', value: '140' } });
    fireEvent.submit(screen.getByLabelText('Label Paid With').closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/sales', expect.anything()));
    expect(bodyOf('/api/sales').sale_shipping_payment_method_id).toBe('');
  });
});

describe('Add Transaction sold section: label paid with', () => {
  it('shows the card picker next to Sale Shipping and sends the chosen card with the new purchase', async () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    expect(screen.queryByLabelText('Label Paid With')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Has this item been sold/ }));
    const select = screen.getByLabelText('Label Paid With');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['From payout', 'Chase Freedom Flex', 'Wells Fargo Debit']);
    fireEvent.change(document.querySelector('input[name="product_name"]'), { target: { name: 'product_name', value: 'New thing' } });
    fireEvent.change(select, { target: { name: 'sale_shipping_payment_method_id', value: 'card-2' } });
    fireEvent.submit(select.closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory', expect.anything()));
    expect(bodyOf('/api/inventory')).toMatchObject({ product_name: 'New thing', sale_shipping_payment_method_id: 'card-2' });
  });
});

describe('Transaction edit window: label paid with', () => {
  const openModal = async () => {
    mocks.apiFetch.mockResolvedValueOnce(json(purchase));
    render(<TransactionDetailModal row={{ rawId: 'purchase', status: 'SOLD' }} paymentMethods={mocks.cards} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Label paid with')).toBeInTheDocument());
    return screen.getByText('Label paid with').parentElement.querySelector('select');
  };

  it('loads the saved card, and saving keeps it when nothing changed', async () => {
    const select = await openModal();
    expect(select.value).toBe('card-2');
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/purchase/transaction', expect.anything()));
    expect(bodyOf('/api/inventory/purchase/transaction').sales[0].sale_shipping_payment_method_id).toBe('card-2');
  });

  it('can change the card or switch back to "from payout"', async () => {
    let select = await openModal();
    fireEvent.change(select, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/purchase/transaction', expect.anything()));
    expect(bodyOf('/api/inventory/purchase/transaction').sales[0].sale_shipping_payment_method_id).toBe(null);

    cleanup(); vi.clearAllMocks(); mocks.apiFetch.mockResolvedValue(json(purchase));
    select = await openModal();
    fireEvent.change(select, { target: { value: 'card-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/purchase/transaction', expect.anything()));
    expect(bodyOf('/api/inventory/purchase/transaction').sales[0].sale_shipping_payment_method_id).toBe('card-1');
  });
});

describe('Expenses tab: card column for sale lines', () => {
  it('shows the label card, and "From payout" for platform fees and card-less labels', async () => {
    const year = new Date().getFullYear();
    mocks.apiFetch.mockImplementation((path) => Promise.resolve(json(
      path === '/api/expenses/derived' ? [
        { id: 'sale:s1:shipping', source: 'sale', inventory_id: 'i', sale_id: 's1', name: 'Cup · Shipping label', category: 'SHIPPING_LABEL', amount: 10.04, date: `${year}-01-05`, payment_method: { id: 'card-2', name: 'Wells Fargo Debit' }, paid_from_payout: false },
        { id: 'sale:s1:commission', source: 'sale', inventory_id: 'i', sale_id: 's1', name: 'Cup · Platform fee', category: 'SALE_PLATFORM_FEE', amount: 13.33, date: `${year}-01-05`, payment_method: null, paid_from_payout: true },
        { id: 'sale:s2:shipping', source: 'sale', inventory_id: 'i', sale_id: 's2', name: 'Box · Shipping label', category: 'SHIPPING_LABEL', amount: 8.99, date: `${year}-01-04`, payment_method: null, paid_from_payout: true },
      ] : [],
    )));
    render(<MemoryRouter><Expenses /></MemoryRouter>);
    const row = (name) => screen.getByText(name).closest('tr');
    await screen.findByText('Cup · Shipping label');
    expect(within(row('Cup · Shipping label')).getByText('Wells Fargo Debit')).toBeInTheDocument();
    expect(within(row('Cup · Platform fee')).getByText('From payout')).toBeInTheDocument();
    expect(within(row('Box · Shipping label')).getByText('From payout')).toBeInTheDocument();
  });
});
