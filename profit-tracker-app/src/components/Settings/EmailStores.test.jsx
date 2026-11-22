import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { EmailStores } from './EmailStores';

const mutation = (value = {}) => ({ mutateAsync: vi.fn().mockResolvedValue(value), isPending: false });
let data;
let stores;
vi.mock('../../hooks/useApi', () => ({
  useEmailStores: () => ({ data }),
  useEmailStoreMutations: () => stores,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const etsy = { id: 'c1', domain: 'etsy.com', label: 'Etsy', order_emails: 4, requested: false };

describe('EmailStores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data = { supported: [{ key: 'gamestop', label: 'GameStop', order_emails: 9 }], candidates: [], scanned_at: null, all_stores: ['Amazon', 'GameStop'] };
    stores = { scan: mutation({ ...data, candidates: [etsy] }), request: mutation(), hide: mutation() };
  });

  it('offers a first check, and says it reads senders and subjects only', async () => {
    render(<EmailStores />);
    expect(screen.getByText('GameStop')).toBeInTheDocument();
    expect(screen.getByText(/who sent each email and its subject line only/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Find stores in my email/ }));
    await waitFor(() => expect(stores.scan.mutateAsync).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith("Found 1 store we can't read yet");
  });

  it('requests a store and cancels the request', async () => {
    data = { ...data, candidates: [etsy], scanned_at: '2026-11-22T00:00:00Z' };
    const { rerender } = render(<EmailStores />);
    expect(screen.getByText(/etsy.com · 4 order emails/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Request Etsy' }));
    await waitFor(() => expect(stores.request.mutateAsync).toHaveBeenCalledWith({ id: 'c1', on: true }));

    data = { ...data, candidates: [{ ...etsy, requested: true }] };
    rerender(<EmailStores />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel the request for Etsy' }));
    await waitFor(() => expect(stores.request.mutateAsync).toHaveBeenCalledWith({ id: 'c1', on: false }));
    expect(screen.getByRole('button', { name: /Check again/ })).toBeInTheDocument();
  });

  it('hides a store that is not one, with Undo, and shows it again', async () => {
    data = { ...data, candidates: [etsy], scanned_at: '2026-11-22T00:00:00Z' };
    const { rerender } = render(<EmailStores />);
    fireEvent.click(screen.getByRole('button', { name: 'Etsy is not a store' }));
    await waitFor(() => expect(stores.hide.mutateAsync).toHaveBeenCalledWith({ id: 'c1', on: true }));
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe('Hid Etsy');
    options.action.onClick();
    await waitFor(() => expect(stores.hide.mutateAsync).toHaveBeenCalledWith({ id: 'c1', on: false }));

    data = { ...data, candidates: [], hidden: [{ id: 'c1', domain: 'etsy.com', label: 'Etsy' }] };
    rerender(<EmailStores />);
    expect(screen.getByText('Hidden (1)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show Etsy again' }));
    await waitFor(() => expect(stores.hide.mutateAsync).toHaveBeenCalledTimes(3));
  });

  it('shows a scan error', async () => {
    stores.scan.mutateAsync.mockRejectedValue(new Error('Your email was just checked. Try again in a few minutes.'));
    render(<EmailStores />);
    fireEvent.click(screen.getByRole('button', { name: /Find stores in my email/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Your email was just checked. Try again in a few minutes.'));
  });
});
