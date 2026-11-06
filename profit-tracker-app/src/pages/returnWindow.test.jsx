import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import AddSale from './AddSale';
import AddTransaction from './AddTransaction';
import Inventory from './Inventory';
import TransactionDetailModal from '../components/TransactionDetailModal';
import { addDays, daysBetween, localToday, returnWindowStatus } from '../utils/returnWindow';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), inventory: [], platforms: [] }));
vi.mock('../hooks/useApi', () => ({
  useRefunds: () => ({ data: [], isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: vi.fn(), isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
  apiFetch: mocks.apiFetch,
  useInventory: () => ({ data: mocks.inventory }),
  usePlatforms: () => ({ data: mocks.platforms }),
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

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.inventory = [item()]; mocks.platforms = []; mocks.apiFetch.mockResolvedValue(json({ id: 'new' })); });
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

describe('Add Transaction: vendor return days', () => {
  const vendors = [
    { id: 'v1', name: 'Home Depot', type: 'Vendor', default_return_days: 90 },
    { id: 'v2', name: 'Target', type: 'Vendor', default_return_days: 30 },
    { id: 'v3', name: 'No Policy', type: 'Vendor', default_return_days: null },
  ];
  const days = () => screen.getByLabelText('Return window (days)');
  const pick = (id) => fireEvent.change(document.querySelector('select[name="vendor_id"]'), { target: { name: 'vendor_id', value: id } });
  const mount = () => { mocks.platforms = vendors; render(<MemoryRouter><AddTransaction /></MemoryRouter>); };

  it('prefills from the vendor and follows a change of vendor', () => {
    mount();
    pick('v1');
    expect(days().value).toBe('90');
    pick('v2');
    expect(days().value).toBe('30');
    pick('v3');
    expect(days().value).toBe('');
  });

  it('keeps what was typed, including an emptied box', () => {
    mount();
    pick('v1');
    fireEvent.change(days(), { target: { value: '30' } });
    pick('v2');
    pick('v1');
    expect(days().value).toBe('30');
    fireEvent.change(days(), { target: { value: '' } });
    pick('v2');
    expect(days().value).toBe('');
  });

  it('sends the edited days as the return-by date', async () => {
    mount();
    fireEvent.change(document.querySelector('input[name="product_name"]'), { target: { name: 'product_name', value: 'Drill' } });
    fireEvent.change(document.querySelector('input[name="purchase_date"]'), { target: { name: 'purchase_date', value: '2026-11-02' } });
    pick('v1');
    fireEvent.change(days(), { target: { value: '30' } });
    fireEvent.submit(days().closest('form'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory', expect.anything()));
    const body = JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory')[1].body);
    expect(body.return_by_date).toBe('2026-12-02');
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
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    expect(screen.getByText('3 days left to return')).toBeInTheDocument();
    expect(screen.queryByText('40 days left to return')).toBeNull();
    expect(screen.getByText('Return window closed')).toBeInTheDocument(); // the single "Solo item" row
  });
});

describe('Transaction edit window: return window', () => {
  const open = async (data, platforms) => {
    mocks.apiFetch.mockResolvedValueOnce(json(data));
    render(<TransactionDetailModal row={{ rawId: 'inv-1' }} onClose={vi.fn()} onSaved={vi.fn()} platforms={platforms} />);
    await waitFor(() => expect(screen.getByLabelText('Return window (days)')).toBeInTheDocument());
    return screen.getByLabelText('Return window (days)');
  };
  const save = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1/transaction', expect.anything()));
  };
  const saved = () => JSON.parse(mocks.apiFetch.mock.calls.find(([url]) => url === '/api/inventory/inv-1/transaction')[1].body).inventory;

  it('shows the window in days, and saving unchanged keeps the date', async () => {
    const input = await open(item());
    expect(input.value).toBe('30');
    expect(screen.getByText(`Return by ${addDays(today, 20)}`)).toBeInTheDocument();
    expect(screen.getByText('20 days left to return')).toBeInTheDocument();
    await save();
    expect(saved().return_by_date).toBe(addDays(today, 20));
  });

  it('turns edited days into a date', async () => {
    const input = await open(item());
    fireEvent.change(input, { target: { value: '90' } });
    await save();
    expect(saved().return_by_date).toBe(addDays(today, 80));
  });

  it('moves the date when the purchase date changes', async () => {
    await open(item({ purchase_date: '2026-11-02T12:00:00.000Z', return_by_date: '2026-12-02T12:00:00.000Z' }));
    fireEvent.change(screen.getByDisplayValue('2026-11-02'), { target: { value: '2026-11-12' } });
    await save();
    expect(saved().return_by_date).toBe('2026-12-12');
  });

  it('can clear the window', async () => {
    const input = await open(item());
    fireEvent.change(input, { target: { value: '' } });
    expect(screen.queryByText(/left to return/)).toBeNull();
    await save();
    expect(saved().return_by_date).toBe(null);
  });

  it('keeps an older date that falls before the purchase date', async () => {
    await open(item({ purchase_date: '2026-11-10T12:00:00.000Z', return_by_date: '2026-11-05T12:00:00.000Z' }));
    await save();
    expect(saved().return_by_date).toBe('2026-11-05');
  });

  it('leaves an existing purchase with no window empty until the vendor changes', async () => {
    const vendors = [
      { id: 'v1', name: 'Target', type: 'Vendor', default_return_days: null },
      { id: 'v2', name: 'Home Depot', type: 'Vendor', default_return_days: 90 },
    ];
    const input = await open(item({ return_by_date: null, vendor_id: 'v1' }), vendors);
    expect(input.value).toBe('');
    fireEvent.change(screen.getByDisplayValue('Target'), { target: { value: 'v2' } });
    expect(input.value).toBe('90');
    await save();
    expect(saved().return_by_date).toBe(addDays(today, 80));
  });

  it('does not replace a window already set when the vendor changes', async () => {
    const vendors = [
      { id: 'v1', name: 'Target', type: 'Vendor', default_return_days: null },
      { id: 'v2', name: 'Home Depot', type: 'Vendor', default_return_days: 90 },
    ];
    const input = await open(item({ vendor_id: 'v1' }), vendors);
    fireEvent.change(screen.getByDisplayValue('Target'), { target: { value: 'v2' } });
    expect(input.value).toBe('30');
  });
});
