import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentMethods } from './PaymentMethods';
import { _resetCatalogCacheForTests } from '../../utils/cardRewards';

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(), invalidatePaymentMethods: vi.fn(), invalidateAll: vi.fn(), success: vi.fn(), error: vi.fn(),
}));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ paymentMethods: mocks.invalidatePaymentMethods, all: mocks.invalidateAll }),
}));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'tester' } }) }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const CARD = { id: 'c1', name: 'Amazon Store Card', type: 'Credit', default_cashback_rate: 5, category_rates: [], total_spend: 120 };
let onDelete;

beforeEach(() => {
  vi.clearAllMocks();
  _resetCatalogCacheForTests();
  onDelete = () => Promise.resolve(json({ success: true, activity_id: 'act-1' }));
  mocks.apiFetch.mockImplementation((path, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && path === '/api/card-catalog') return Promise.resolve(json({ cards: [] }));
    if (method === 'GET' && path === '/api/payment-methods') return Promise.resolve(json([CARD]));
    if (method === 'DELETE') return onDelete(path);
    return Promise.resolve(json({}));
  });
});
afterEach(cleanup);

const deletes = () => mocks.apiFetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');

describe('removing a card', () => {
  it('asks first; going back removes nothing', async () => {
    render(<PaymentMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete card' }));
    expect(screen.getByRole('dialog', { name: 'Remove Amazon Store Card?' })).toBeInTheDocument();
    expect(screen.getByText(/every purchase, expense and shipping label on it shows no card/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Go back' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(deletes()).toHaveLength(0);
  });

  it('removes on confirm and offers Undo in the toast', async () => {
    render(<PaymentMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove card' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalled());
    expect(deletes()[0][0]).toBe('/api/payment-methods/c1');
    const [message, options] = mocks.success.mock.calls[0];
    expect(message).toBe('Amazon Store Card removed.');
    expect(options.action.label).toBe('Undo');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.invalidateAll).toHaveBeenCalled();
  });

  it('keeps the dialog open and says why when the removal fails', async () => {
    onDelete = () => Promise.resolve(json({ error: 'Not found' }, 404));
    render(<PaymentMethods />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete card' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove card' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Could not remove payment method: Not found'));
    expect(screen.getByRole('dialog', { name: 'Remove Amazon Store Card?' })).toBeInTheDocument();
  });
});
