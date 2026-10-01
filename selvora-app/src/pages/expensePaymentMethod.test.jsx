import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Expenses from './Expenses';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  usePaymentMethods: () => ({ data: [
    { id: 'card-1', name: 'Amex Blue' },
    { id: 'card-2', name: 'Chase Freedom' },
  ] }),
}));

afterEach(cleanup);

const jsonResponse = (body, ok = true, status = ok ? 200 : 400) => ({
  ok, status, json: async () => body,
});

describe('Expense form: card (payment method) selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockImplementation((path) => {
      if (path === '/api/expenses') return Promise.resolve(jsonResponse([]));
      if (path === '/api/recurring-expenses') return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
  });

  it('lists every payment method as a Card option, defaulting to no card', async () => {
    render(<Expenses />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    expect(await screen.findByRole('heading', { name: 'Add Expense' })).toBeInTheDocument();

    const cardSelect = screen.getByLabelText(/Card/);
    expect(cardSelect.value).toBe('');
    const optionLabels = Array.from(cardSelect.options).map(o => o.textContent);
    expect(optionLabels).toEqual(['No card / cash', 'Amex Blue', 'Chase Freedom']);
  });

  it('submits the selected card as payment_method_id when adding a one-off expense', async () => {
    render(<Expenses />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    await screen.findByRole('heading', { name: 'Add Expense' });

    fireEvent.change(screen.getByPlaceholderText('e.g. Shipping Label Purchase'), { target: { value: 'Label printer paper' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12.50' } });
    fireEvent.change(screen.getByLabelText(/Card/), { target: { value: 'card-2' } });

    mocks.apiFetch.mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 'new-exp' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/expenses', expect.objectContaining({
      method: 'POST',
      body: expect.stringContaining('"payment_method_id":"card-2"'),
    })));
  });

  it('omits a card as null when none is selected', async () => {
    render(<Expenses />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add Expense' }));
    await screen.findByRole('heading', { name: 'Add Expense' });

    fireEvent.change(screen.getByPlaceholderText('e.g. Shipping Label Purchase'), { target: { value: 'Cash tip' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '5' } });

    mocks.apiFetch.mockImplementationOnce(() => Promise.resolve(jsonResponse({ id: 'new-exp' })));
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/expenses', expect.objectContaining({
      body: expect.stringContaining('"payment_method_id":null'),
    })));
  });

  it('pre-fills the Card select when editing an expense that already has one', async () => {
    mocks.apiFetch.mockImplementation((path) => {
      if (path === '/api/expenses') return Promise.resolve(jsonResponse([
        { id: 'exp-1', name: 'Storage unit', amount: 80, date: '2026-09-15', category: null, notes: null, payment_method_id: 'card-1', payment_method: { id: 'card-1', name: 'Amex Blue' } },
      ]));
      if (path === '/api/recurring-expenses') return Promise.resolve(jsonResponse([]));
      return Promise.resolve(jsonResponse({}));
    });
    render(<Expenses />);
    fireEvent.click(await screen.findByTitle('Edit'));
    await screen.findByRole('heading', { name: 'Edit Expense' });

    expect(screen.getByLabelText(/Card/).value).toBe('card-1');
  });
});
