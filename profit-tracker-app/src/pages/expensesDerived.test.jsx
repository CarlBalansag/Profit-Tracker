import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import Expenses from './Expenses';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  usePaymentMethods: () => ({ data: [{ id: 'card-1', name: 'Amex Blue' }] }),
}));

afterEach(cleanup);

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body });
const year = new Date().getFullYear();
const thisMonth = `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15T12:00:00.000Z`;
const earlierThisYear = `${year}-01-02T12:00:00.000Z`;
const lastYear = `${year - 1}-06-01T12:00:00.000Z`;

const MANUAL = [
  { id: 'exp-1', name: 'Bubble mailers', amount: 10.1, date: thisMonth, category: 'SHIPPING_SUPPLIES', notes: null, payment_method: null },
  { id: 'exp-2', name: 'Old label', amount: 5, date: earlierThisYear, category: 'SHIPPING', notes: null, payment_method: null },
];
const DERIVED = [
  { id: 'sale:s1:shipping', source: 'sale', readonly: true, inventory_id: 'inv-1', sale_id: 's1', name: 'Nike Dunk Low · Shipping label', category: 'SHIPPING_LABEL', amount: 8.2, date: thisMonth, payment_method: null },
  { id: 'purchase:inv-1:tax', source: 'purchase', readonly: true, inventory_id: 'inv-1', sale_id: null, name: 'Nike Dunk Low · Sales tax', category: 'PURCHASE_TAX', amount: 7.7, date: earlierThisYear, payment_method: { id: 'card-1', name: 'Amex Blue' } },
  { id: 'purchase:inv-0:fees', source: 'purchase', readonly: true, inventory_id: 'inv-0', sale_id: null, name: 'Old Thing · Purchase fee', category: 'PURCHASE_FEE', amount: 100, date: lastYear, payment_method: null },
];

const mockApi = ({ derived = jsonResponse(DERIVED) } = {}) => {
  mocks.apiFetch.mockImplementation((path) => {
    if (path === '/api/expenses') return Promise.resolve(jsonResponse(MANUAL));
    if (path === '/api/recurring-expenses') return Promise.resolve(jsonResponse([]));
    if (path === '/api/expenses/derived') return typeof derived === 'function' ? derived() : Promise.resolve(derived);
    return Promise.resolve(jsonResponse({}));
  });
};

function TransactionsProbe() {
  const location = useLocation();
  return <pre data-testid="txn-state">{JSON.stringify(location.state)}</pre>;
}
const renderPage = () => render(
  <MemoryRouter initialEntries={['/expenses']}>
    <Routes>
      <Route path="/expenses" element={<Expenses />} />
      <Route path="/transactions" element={<TransactionsProbe />} />
    </Routes>
  </MemoryRouter>,
);
const total = (key) => screen.getByTestId(`expense-total-${key}`);

describe('Expenses tab: costs from transactions', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it('splits YTD and this-month totals into manual and from-transactions, excluding other years', async () => {
    renderPage();
    await screen.findByText('Nike Dunk Low · Shipping label');
    expect(within(total('manual')).getByText('$15.10')).toBeInTheDocument();
    expect(within(total('manual')).getByText('This month: $10.10')).toBeInTheDocument();
    expect(within(total('derived')).getByText('$15.90')).toBeInTheDocument();
    expect(within(total('derived')).getByText('This month: $8.20')).toBeInTheDocument();
    expect(within(total('all')).getByText('$31.00')).toBeInTheDocument();
    expect(within(total('all')).getByText('This month: $18.30')).toBeInTheDocument();
  });

  it('marks rows by source and only lets manual rows be edited or deleted', async () => {
    renderPage();
    const derivedRow = (await screen.findByText('Nike Dunk Low · Sales tax')).closest('tr');
    expect(within(derivedRow).getByText('From purchase')).toBeInTheDocument();
    expect(within(derivedRow).queryByTitle('Edit')).toBeNull();
    expect(within(derivedRow).queryByTitle('Delete')).toBeNull();
    expect(within(derivedRow).getByText('Purchase Tax')).toBeInTheDocument();
    expect(within(derivedRow).getByText('Amex Blue')).toBeInTheDocument();

    const saleRow = screen.getByText('Nike Dunk Low · Shipping label').closest('tr');
    expect(within(saleRow).getByText('From sale')).toBeInTheDocument();
    expect(within(saleRow).getByRole('button', { name: /Open sale/ })).toBeInTheDocument();

    const manualRow = screen.getByText('Bubble mailers').closest('tr');
    expect(within(manualRow).getByText('Manual')).toBeInTheDocument();
    expect(within(manualRow).getByTitle('Edit')).toBeInTheDocument();
    expect(within(manualRow).getByTitle('Delete')).toBeInTheDocument();
    // A retired category still displays on the row that has it.
    expect(within(screen.getByText('Old label').closest('tr')).getByText('Shipping (old)')).toBeInTheDocument();
  });

  it('opens the linked purchase or sale on the Transactions page', async () => {
    renderPage();
    const saleRow = (await screen.findByText('Nike Dunk Low · Shipping label')).closest('tr');
    fireEvent.click(within(saleRow).getByRole('button', { name: /Open sale/ }));
    expect(JSON.parse((await screen.findByTestId('txn-state')).textContent)).toEqual({ openTransaction: { inventoryId: 'inv-1', saleId: 's1' } });
  });

  it('opens a purchase link with no sale id', async () => {
    renderPage();
    const row = (await screen.findByText('Nike Dunk Low · Sales tax')).closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /Open purchase/ }));
    expect(JSON.parse((await screen.findByTestId('txn-state')).textContent)).toEqual({ openTransaction: { inventoryId: 'inv-1', saleId: null } });
  });

  it('filters by source and keeps the table footer equal to the visible rows', async () => {
    renderPage();
    await screen.findByText('Nike Dunk Low · Shipping label');
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'manual' } });
    expect(screen.queryByText('Nike Dunk Low · Shipping label')).toBeNull();
    expect(screen.getByText('2 expenses')).toBeInTheDocument();
    expect(screen.getByText('$15.10', { selector: 'tfoot td' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'derived' } });
    expect(screen.queryByText('Bubble mailers')).toBeNull();
    expect(screen.getByText('3 expenses')).toBeInTheDocument();
    expect(screen.getByText('$115.90', { selector: 'tfoot td' })).toBeInTheDocument();
  });

  it('no longer offers the retired Shipping/Platform Fee categories for a new expense, and explains where per-transaction costs go', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    const dialog = (await screen.findByRole('heading', { name: 'Add Expense' })).closest('div.relative');
    const categorySelect = within(dialog).getAllByRole('combobox')[0];
    const labels = Array.from(categorySelect.options).map((o) => o.textContent);
    expect(labels).toEqual(['Uncategorized', 'Credit Card Fee', 'Membership', 'Shipping Supplies', 'Software / Tools', 'Other']);
    expect(within(dialog).getByText(/Enter it on that transaction instead/)).toBeInTheDocument();
  });

  it('keeps a retired category selectable when editing a row that already uses it', async () => {
    renderPage();
    const row = (await screen.findByText('Old label')).closest('tr');
    fireEvent.click(within(row).getByTitle('Edit'));
    const dialog = (await screen.findByRole('heading', { name: 'Edit Expense' })).closest('div.relative');
    expect(within(dialog).getAllByRole('combobox')[0].value).toBe('SHIPPING');
  });

  it('still shows manual expenses and warns when the transaction costs fail to load', async () => {
    mockApi({ derived: jsonResponse({ error: 'boom' }, false) });
    renderPage();
    await screen.findByText('Bubble mailers');
    expect(screen.getByText(/couldn.t be loaded/)).toBeInTheDocument();
    expect(within(total('derived')).getByText('$0.00')).toBeInTheDocument();
    expect(within(total('all')).getByText('$15.10')).toBeInTheDocument();
  });

  it('survives a network error on the derived request', async () => {
    mockApi({ derived: () => Promise.reject(new Error('offline')) });
    renderPage();
    await waitFor(() => expect(screen.getByText('Bubble mailers')).toBeInTheDocument());
    expect(screen.getByText(/couldn.t be loaded/)).toBeInTheDocument();
  });
});
