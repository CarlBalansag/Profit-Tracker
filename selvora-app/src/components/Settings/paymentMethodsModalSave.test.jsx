import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethods } from './PaymentMethods';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidatePaymentMethods: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ paymentMethods: mocks.invalidatePaymentMethods }),
}));
vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'tester' } }),
}));

afterEach(cleanup);

describe('QA-20/QA-23 regression: card modals do not close/clear before save succeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
  });

  it('keeps the Custom Card modal open and shows an error when the save fails', async () => {
    render(<PaymentMethods />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Card creation failed' }), { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    // Modal must still be open and the entered name must not be cleared.
    expect(screen.getByText('Add Card')).toBeTruthy();
    expect(screen.getByDisplayValue('My Card')).toBeTruthy();
  });

  it('closes the Custom Card modal and refreshes only after a successful save', async () => {
    render(<PaymentMethods />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    const created = { id: 'c1', name: 'My Card', type: 'Credit Card', default_cashback_rate: 0, category_rates: [] };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify(created), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));

    await waitFor(() => expect(screen.queryByText('Add Card')).toBeNull());
    expect(mocks.invalidatePaymentMethods).toHaveBeenCalled();
  });

  it('does not close the Custom Card modal on Escape while a save is in flight', async () => {
    render(<PaymentMethods />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Card')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('e.g., Chase Freedom Flex'), { target: { value: 'My Card' } });

    let resolveSave;
    mocks.apiFetch.mockReturnValueOnce(new Promise(resolve => { resolveSave = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Card' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saving...' })).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByText('Add Card')).toBeTruthy();

    const created = { id: 'c2', name: 'My Card', type: 'Credit Card', default_cashback_rate: 0, category_rates: [] };
    resolveSave(new Response(JSON.stringify(created), { status: 200 }));
    await waitFor(() => expect(screen.queryByText('Add Card')).toBeNull());
  });

  it('keeps the Quick Add modal open with the selection intact when a card fails to add', async () => {
    render(<PaymentMethods />);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Quick Add/ }));
    expect(await screen.findByText('Quick Add Cards')).toBeTruthy();

    const firstCardButton = screen.getAllByRole('button').find(b => b.textContent.includes('% base'));
    fireEvent.click(firstCardButton);

    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'failed' }), { status: 500 }));
    fireEvent.click(screen.getByRole('button', { name: /Add Cards/ }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Quick Add Cards')).toBeTruthy();
  });
});
