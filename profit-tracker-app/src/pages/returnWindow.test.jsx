import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddSale from './AddSale';
import AddTransaction from './AddTransaction';
import Inventory from './Inventory';
import TransactionDetailModal from '../components/TransactionDetailModal';
import { addDays, daysBetween, localToday, returnWindowStatus } from '../utils/returnWindow';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), inventory: [] }));
vi.mock('../hooks/useApi', () => ({
  useRefunds: () => ({ data: [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: mocks.inventory }),
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

const today = localToday();
// Local calendar date n days from today (n may be negative), as the API returns it.
const inDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${localToday(d)}T12:00:00.000Z`; };
const item = (over = {}) => ({
  id: 'inv-1', product_name: 'Target Lego Set', qty_purchased: 2, qty_on_hand: 2, unit_purchase_cost: 50,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, purchase_date: inDays(-10), status: 'On Hand',
  vendor: { name: 'Target' }, sales: [], return_by_date: inDays(20), ...over,
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.inventory = [item()]; mocks.apiFetch.mockResolvedValue(json({ id: 'new' })); });
afterEach(cleanup);

describe('return window date math', () => {
  it('adds calendar days across month and year ends', () => {
    expect(addDays('2026-01-31', 30)).toBe('2026-03-02');
    expect(addDays('2026-12-15', 30)).toBe('2027-01-14');
    expect(addDays('2026-11-02T12:00:00.000Z', 0)).toBe('2026-11-02');
  });

  it('ignores blank, negative, fractional or missing input', () => {
    expect(addDays('2026-11-02', '')).toBe('');
    expect(addDays('2026-11-02', -1)).toBe('');
    expect(addDays('2026-11-02', 2.5)).toBe('');
    expect(addDays('', 30)).toBe('');
  });

  it('counts whole days, including negative', () => {
    expect(daysBetween('2026-11-02', '2026-11-30')).toBe(28);
    expect(daysBetween('2026-11-02', '2026-11-01T12:00:00.000Z')).toBe(-1);
  });

  it('describes open, last-day, warning and closed windows', () => {
    const now = new Date(2026, 10, 2, 23, 59); // late evening local time still counts as Nov 2
    const at = (ymd) => returnWindowStatus({ return_by_date: `${ymd}T12:00:00.000Z`, qty_on_hand: 1 }, now);
    expect(at('2026-12-02')).toMatchObject({ daysLeft: 30, tone: 'ok', label: '30 days left to return' });
    expect(at('2026-11-09')).toMatchObject({ daysLeft: 7, tone: 'warning' });
    expect(at('2026-11-03')).toMatchObject({ label: '1 day left to return' });
    expect(at('2026-11-02')).toMatchObject({ daysLeft: 0, label: 'Last day to return' });
    expect(at('2026-11-01')).toMatchObject({ tone: 'closed', label: 'Return window closed' });
  });

  it('shows nothing without a window or once nothing is left in stock', () => {
    expect(returnWindowStatus({ qty_on_hand: 1 })).toBe(null);
    expect(returnWindowStatus({ return_by_date: inDays(5), qty_on_hand: 0 })).toBe(null);
  });
});

describe('Add Transaction: return window (days)', () => {
  it('previews the return-by date and sends it with the purchase', async () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    expect(screen.getByText(/Leave blank if you won.t return it/)).toBeInTheDocument();
    fireEvent.change(document.querySelector('input[name="product_name"]'), { target: { name: 'product_name', value: 'New Lego' } });
    fireEvent.change(document.querySelector('input[name="purchase_date"]'), { target: { name: 'purchase_date', value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('Return window (days)'), { target: { name: 'return_window_days', value: '90' } });
    expect(screen.getByText('2027-01-31')).toBeInTheDocument();
    fireEvent.submit(screen.getByLabelText('Return window (days)').closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory', expect.anything()));
    const body = JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory')[1].body);
    expect(body).toMatchObject({ product_name: 'New Lego', purchase_date: '2026-11-02', return_by_date: '2027-01-31' });
  });

  it('sends no return-by date when left blank', async () => {
    render(<MemoryRouter><AddTransaction /></MemoryRouter>);
    fireEvent.change(document.querySelector('input[name="product_name"]'), { target: { name: 'product_name', value: 'No window' } });
    fireEvent.submit(screen.getByLabelText('Return window (days)').closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory', expect.anything()));
    const body = JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory')[1].body);
    expect(body.return_by_date).toBe('');
  });
});

describe('Record Sale: days left to return', () => {
  it('shows the badge on the item card and on the selected item', () => {
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    const card = screen.getByRole('button', { name: /Target Lego Set/ });
    expect(within(card).getByText('20 days left to return')).toBeInTheDocument();
    fireEvent.click(card);
    expect(screen.getAllByText('20 days left to return').length).toBe(2);
  });

  it('shows nothing for an item without a window', () => {
    mocks.inventory = [item({ return_by_date: null })];
    render(<MemoryRouter><AddSale /></MemoryRouter>);
    expect(screen.queryByText(/left to return|window closed/)).toBeNull();
  });
});

describe('Inventory: days left to return', () => {
  it('shows each batch, and the soonest open window on a collapsed group', () => {
    mocks.inventory = [
      item({ id: 'a', return_by_date: inDays(40) }),
      item({ id: 'b', return_by_date: inDays(3) }),
      item({ id: 'c', return_by_date: inDays(-2) }),
      item({ id: 'solo', product_name: 'Solo item', return_by_date: inDays(-1) }),
    ];
    render(<Inventory />);
    expect(screen.getByText('3 days left to return')).toBeInTheDocument();
    expect(screen.queryByText('40 days left to return')).toBeNull();
    expect(screen.getByText('Return window closed')).toBeInTheDocument(); // the single "Solo item" row
  });
});

describe('Transaction edit window: return by', () => {
  const open = async (data) => {
    mocks.apiFetch.mockResolvedValueOnce(json(data));
    render(<TransactionDetailModal row={{ rawId: 'inv-1' }} onClose={vi.fn()} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText('Return by')).toBeInTheDocument());
    return screen.getByLabelText('Return by');
  };
  const saved = () => JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory/inv-1/transaction')[1].body).inventory;

  it('loads the date with its badge, and saving unchanged keeps it', async () => {
    const input = await open(item());
    expect(input.value).toBe(addDays(today, 20));
    expect(screen.getByText('20 days left to return')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
    expect(saved().return_by_date).toBe(addDays(today, 20));
  });

  it('can clear the date', async () => {
    const input = await open(item());
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText(/left to return/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
    expect(saved().return_by_date).toBe(null);
  });
});
