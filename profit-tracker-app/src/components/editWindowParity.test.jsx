import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TransactionDetailModal from './TransactionDetailModal';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: (...args) => mocks.apiFetch(...args),
  useInvalidate: () => ({ all: vi.fn() }),
  useRefunds: () => ({ data: [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  useTransactionNotes: () => ({ data: [] }),
  useTransactionNoteMutations: () => ({ add: { mutate: vi.fn() }, update: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
  useProductNote: () => ({ data: null }),
  useProductNoteMutations: () => ({ upsert: { mutate: vi.fn() }, remove: { mutate: vi.fn() } }),
}));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

const json = (body) => new Response(JSON.stringify(body), { status: 200 });
const purchase = (over = {}) => ({
  id: 'inv-1', product_name: 'Lego Set', category: 'Home', qty_purchased: 2, qty_on_hand: 2, unit_purchase_cost: 50,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 5, purchase_date: '2026-09-01', status: 'PURCHASED',
  order_number: 'ORD-1', tracking_number: '1Z999', receipt_url: 'https://example.invalid/r.png', sales: [], ...over,
});
const sold = { id: 's1', quantity: 1, unit_price: 90, commission_fee: 9, sale_shipping: 5, status: 'SOLD', sale_date: '2026-09-03', payout_date: null, taxable: true, customer_tax_exempt: true, exemption_type: 'Resale' };

const open = async (data) => {
  mocks.apiFetch.mockImplementation(async (url) => json(url === '/api/receipts/attach' ? { receipt_url: 'https://example.invalid/new.png' } : data));
  render(<TransactionDetailModal row={{ rawId: 'inv-1' }} onClose={vi.fn()} onSaved={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Product Information')).toBeInTheDocument());
};
const savedBody = () => JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory/inv-1/transaction')[1].body);
const save = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
  await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('edit window matches Add Transaction', () => {
  it('a purchase-only item has every purchase section and no sold section', async () => {
    await open(purchase());
    for (const title of ['Product Information', 'Purchase Details', 'Purchase Location', 'Payment & Cashback']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Sale Details/)).toBeNull();
    expect(screen.queryByText(/No sales recorded/)).toBeNull();
  });

  it('a sold item has those sections plus the sold section', async () => {
    await open(purchase({ sales: [sold] }));
    expect(screen.getByText('Purchase Location')).toBeInTheDocument();
    expect(screen.getByText('Sale Details')).toBeInTheDocument();
    expect(screen.getByLabelText('Exemption Type').value).toBe('Resale');
    expect(screen.getByRole('checkbox', { name: 'Customer Tax Exempt' })).toBeChecked();
  });

  it('loads and saves the order and tracking numbers, and clears them when emptied', async () => {
    await open(purchase());
    expect(screen.getByLabelText('Order Number').value).toBe('ORD-1');
    expect(screen.getByLabelText('Tracking Number').value).toBe('1Z999');
    fireEvent.change(screen.getByLabelText('Order Number'), { target: { value: 'ORD-2' } });
    fireEvent.change(screen.getByLabelText('Tracking Number'), { target: { value: '' } });
    await save();
    expect(savedBody().inventory).toMatchObject({ order_number: 'ORD-2', tracking_number: null });
  });

  it('category is the same list as Add Transaction', async () => {
    await open(purchase());
    const select = screen.getByRole('option', { name: 'Electronics' }).closest('select');
    expect(select.value).toBe('Home');
    expect(Array.from(select.options).map(o => o.textContent)).toEqual(['Select category…', 'Electronics', 'Apparel', 'Home', 'Grocery', 'Auto', 'Sports', 'Other']);
  });

  it('keeps an older free-text category instead of losing it on save', async () => {
    await open(purchase({ category: 'Sneakers' }));
    expect(screen.getByRole('option', { name: 'Sneakers' }).closest('select').value).toBe('Sneakers');
    await save();
    expect(savedBody().inventory.category).toBe('Sneakers');
  });

  it('gift card sits with payment and still saves', async () => {
    await open(purchase());
    expect(screen.getByText('Gift Card Used')).toBeInTheDocument();
    await save();
    expect(savedBody().inventory.gift_card_amount).toBe(5);
  });

  it('saves the buyer tax fields', async () => {
    await open(purchase({ sales: [{ ...sold, customer_tax_exempt: false, exemption_type: null }] }));
    fireEvent.change(screen.getByLabelText('Exemption Type'), { target: { value: 'Nonprofit' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Customer Tax Exempt' }));
    await save();
    expect(savedBody().sales[0]).toMatchObject({ exemption_type: 'Nonprofit', customer_tax_exempt: true });
  });
});

describe('edit window receipt', () => {
  const file = (over = {}) => new File(['x'], over.name || 'r.png', { type: over.type || 'image/png' });
  const pick = (f) => fireEvent.change(screen.getByLabelText('Receipt file'), { target: { files: [f] } });

  it('shows the existing receipt and replaces it immediately', async () => {
    await open(purchase());
    expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', 'https://example.invalid/r.png');
    expect(screen.getByText('Replace receipt')).toBeInTheDocument();
    pick(file());
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/receipts/attach', expect.anything()));
    await waitFor(() => expect(screen.getByRole('link', { name: 'View receipt' })).toHaveAttribute('href', 'https://example.invalid/new.png'));
    expect(mocks.toast.success).toHaveBeenCalledWith('Receipt attached.');
  });

  it('offers to attach when there is none yet', async () => {
    await open(purchase({ receipt_url: null }));
    expect(screen.getByText('Attach receipt')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View receipt' })).toBeNull();
  });

  it('rejects a file type the receipts page rejects, without uploading', async () => {
    await open(purchase({ receipt_url: null }));
    pick(file({ name: 'notes.txt', type: 'text/plain' }));
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Use a JPEG, PNG, WebP, GIF, or PDF receipt.'));
    expect(mocks.apiFetch).not.toHaveBeenCalledWith('/api/receipts/attach', expect.anything());
  });
});
