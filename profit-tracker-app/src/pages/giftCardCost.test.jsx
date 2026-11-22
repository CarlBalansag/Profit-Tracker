// The optional "what the gift card cost you" field on Add Transaction and in
// the purchase editor: shown only once a gift card amount is entered, sent with
// the purchase, and cleared to null when blanked.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddTransaction from './AddTransaction';
import TransactionDetailModal from '../components/TransactionDetailModal';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useRefunds: () => ({ data: [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: [] }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useProductNames: () => ({ data: [] }),
  useRecentTransaction: () => ({ data: null }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useInvalidate: () => ({ all: vi.fn() }),
  useTransactionNotes: () => ({ data: [] }),
  useTransactionNoteMutations: () => ({ add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.apiFetch.mockResolvedValue(json({ id: 'new' })); });
afterEach(cleanup);

describe('Add Transaction: gift card cost', () => {
  const costInput = () => document.querySelector('input[name="gift_card_cost"]');
  const change = (name, value) => fireEvent.change(document.querySelector(`input[name="${name}"]`), { target: { name, value } });
  const submit = async () => {
    fireEvent.submit(document.querySelector('input[name="product_name"]').closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory', expect.anything()));
    return JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory')[1].body);
  };

  it('appears only after a gift card amount is entered, and is sent with the purchase', async () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    expect(costInput()).toBeNull();
    change('product_name', 'Gift card buy');
    change('gift_card_amount', '60');
    expect(screen.getByText('What the gift card cost you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is gift card cost?' })).toBeInTheDocument(); // info tip
    change('gift_card_cost', '54');
    const body = await submit();
    expect(body).toMatchObject({ gift_card_amount: '60', gift_card_cost: '54' });
  });

  it('hides again when the gift card amount is cleared', () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    change('gift_card_amount', '60');
    expect(costInput()).not.toBeNull();
    change('gift_card_amount', '');
    expect(costInput()).toBeNull();
  });
});

describe('Purchase editor: gift card cost', () => {
  const item = (over = {}) => ({
    id: 'inv-1', product_name: 'Lego Set', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: 100,
    sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 60, gift_card_cost: '54.00',
    purchase_date: '2026-11-01T12:00:00.000Z', status: 'On Hand', vendor: { name: 'Target' }, sales: [], ...over,
  });
  const open = async (data) => {
    mocks.apiFetch.mockResolvedValueOnce(json(data));
    render(<TransactionDetailModal row={{ rawId: 'inv-1' }} onClose={vi.fn()} onSaved={vi.fn()} platforms={[]} />);
    await waitFor(() => expect(screen.getByLabelText('Gift card used')).toBeInTheDocument());
  };
  const save = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
    return JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory/inv-1/transaction')[1].body).inventory;
  };

  it('shows the saved cost and keeps it on an unchanged save', async () => {
    await open(item());
    expect(screen.getByLabelText('What the gift card cost you')).toHaveValue(54);
    expect((await save()).gift_card_cost).toBe(54);
  });

  it('sends null when the cost is blanked or was never entered', async () => {
    await open(item());
    fireEvent.change(screen.getByLabelText('What the gift card cost you'), { target: { value: '' } });
    expect((await save()).gift_card_cost).toBeNull();
  });

  it('is hidden with no gift card', async () => {
    await open(item({ gift_card_amount: 0, gift_card_cost: null }));
    expect(screen.queryByLabelText('What the gift card cost you')).toBeNull();
    expect((await save()).gift_card_cost).toBeNull();
  });
});
