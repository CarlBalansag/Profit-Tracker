import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Expenses from './Expenses';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  usePaymentMethods: () => ({ data: [{ id: 'card-1', name: 'Amex Blue' }] }),
}));

afterEach(cleanup);

const jsonResponse = (body, ok = true, status = ok ? 200 : 500) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-15T12:00:00.000Z`;
const MANUAL = [
  { id: 'exp-1', name: 'Residential proxies', amount: 30, date: thisMonth, category: 'PROXY', notes: null, external_id: 'cp-123', payment_method: null },
];

let posted;
const mockApi = ({ postResponse } = {}) => {
  posted = [];
  mocks.apiFetch.mockImplementation((path, opts = {}) => {
    if (opts.method === 'POST' || opts.method === 'PUT') {
      posted.push({ path, method: opts.method, body: JSON.parse(opts.body) });
      return Promise.resolve(postResponse || jsonResponse({ id: 'new' }));
    }
    if (path === '/api/expenses') return Promise.resolve(jsonResponse(MANUAL));
    if (path === '/api/recurring-expenses') return Promise.resolve(jsonResponse([]));
    if (path === '/api/expenses/derived') return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse({}));
  });
};
const renderPage = () => render(<MemoryRouter><Expenses /></MemoryRouter>);
const openAdd = async () => {
  renderPage();
  await screen.findByText('Residential proxies');
  fireEvent.click(screen.getAllByRole('button', { name: /Add Expense/ })[0]);
  return screen.findByLabelText(/Transaction ID/);
};

describe('Expenses: PROXY category and transaction id', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it('labels a PROXY expense "Proxies" and finds it by its transaction id', async () => {
    renderPage();
    expect(await screen.findAllByText('Proxies')).not.toHaveLength(0);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'cp-123' } });
    expect(screen.getByText('Residential proxies')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'cp-999' } });
    await waitFor(() => expect(screen.queryByText('Residential proxies')).not.toBeInTheDocument());
  });

  it('offers Proxies in the category picker and sends the transaction id on save', async () => {
    const idInput = await openAdd();
    // The page's category filter lists Proxies too; the form's picker is the
    // one with an "Uncategorized" choice.
    const category = screen.getAllByRole('combobox').find((el) => [...el.options].some((o) => o.value === 'PROXY')
      && [...el.options].some((o) => o.value === '' && o.textContent === 'Uncategorized'));
    expect(category).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g. Bubble mailers'), { target: { value: 'Proxy plan' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12' } });
    fireEvent.change(category, { target: { value: 'PROXY' } });
    fireEvent.change(idInput, { target: { value: '  cp-456 ' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ path: '/api/expenses', method: 'POST', body: { category: 'PROXY', external_id: 'cp-456' } });
  });

  it('sends null when the transaction id is left blank, and shows a duplicate error from the server', async () => {
    mockApi({ postResponse: jsonResponse({ error: 'An expense with this external_id is already recorded (exp-1).' }, false, 409) });
    await openAdd();
    fireEvent.change(screen.getByPlaceholderText('e.g. Bubble mailers'), { target: { value: 'Proxy plan' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));
    expect(await screen.findByText(/already recorded/)).toBeInTheDocument();
    expect(posted[0].body.external_id).toBeNull();
  });

  it('hides the transaction id for a recurring expense', async () => {
    await openAdd();
    fireEvent.click(screen.getByRole('button', { name: /recurring/i }));
    expect(screen.queryByLabelText(/Transaction ID/)).not.toBeInTheDocument();
  });
});
