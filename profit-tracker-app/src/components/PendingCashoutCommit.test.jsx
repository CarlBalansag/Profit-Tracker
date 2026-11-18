import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import PendingCashoutCommit from './PendingCashoutCommit';
import { offerPendingCommit, PENDING_COMMIT_EVENT } from '../utils/pendingCashoutCommit';
import { apiFetch } from '../hooks/useApi';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const preview = (overrides = {}) => ({
  id: 'pc-1', cashout: 'EB Primary', deal_name: 'PS5 Pro', item_name: 'PS5 Pro', quantity: 2,
  tracking_number: '1Z999AA10123456784', logged_payout: 480, current_payout: 495,
  available: true, reason: null, ...overrides,
});

const renderPrompt = () => render(
  <QueryClientProvider client={new QueryClient()}>
    <PendingCashoutCommit />
  </QueryClientProvider>,
);

let fetchMock;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('PendingCashoutCommit', () => {
  it('shows nothing until a pending commit is offered', () => {
    renderPrompt();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks first, at today's payout, and starts on Not now", async () => {
    fetchMock.mockResolvedValueOnce(json(preview()));
    renderPrompt();

    act(() => offerPendingCommit('pc-1'));

    expect(await screen.findByText('$495.00 each, $990.00 total')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Commit to EB Primary now?' })).toBeInTheDocument();
    expect(screen.getByText(/Was \$480.00 when you logged it/)).toBeInTheDocument();
    expect(screen.getByText('1Z999AA10123456784')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/cashouts/commitments/pc-1/pending');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toHaveFocus());
  });

  it('commits only when Commit is pressed, sending the insured value', async () => {
    fetchMock
      .mockResolvedValueOnce(json(preview()))
      .mockResolvedValueOnce(json({ trackingSubmitted: true, trackingError: null, payout: 495, previousPayout: 480 }));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));
    await screen.findByText('$495.00 each, $990.00 total');

    fireEvent.change(screen.getByLabelText(/Insured value/), { target: { value: '600' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    });

    const [url, options] = fetchMock.mock.calls[1];
    expect(url).toContain('/api/cashouts/commitments/pc-1/commit');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ insured_value: 600 });
    expect(toast.success).toHaveBeenCalledWith('Committed to EB Primary, and tracking sent.', expect.objectContaining({
      description: expect.stringContaining('$480.00 to $495.00'),
    }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Not now closes without committing', async () => {
    fetchMock.mockResolvedValueOnce(json(preview()));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));
    await screen.findByText('$495.00 each, $990.00 total');

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(toast.message).toHaveBeenCalledWith('Not committed yet', expect.anything());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains a closed deal and offers no Commit button', async () => {
    fetchMock.mockResolvedValueOnce(json(preview({ available: false, reason: 'This deal has closed.', current_payout: null })));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));

    expect(await screen.findByRole('alert')).toHaveTextContent('This deal has closed.');
    expect(screen.queryByRole('button', { name: 'Commit' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows the cashout refusing the commit, and stays open', async () => {
    fetchMock
      .mockResolvedValueOnce(json(preview()))
      .mockResolvedValueOnce(json({ error: 'Over the commit limit.' }, 400));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));
    await screen.findByText('$495.00 each, $990.00 total');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Over the commit limit.');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('apiFetch offering the prompt', () => {
  const listen = () => {
    const seen = vi.fn();
    window.addEventListener(PENDING_COMMIT_EVENT, seen);
    return { seen, stop: () => window.removeEventListener(PENDING_COMMIT_EVENT, seen) };
  };

  it('offers it when a sale save says its new tracking belongs to a pending commit', async () => {
    const { seen, stop } = listen();
    fetchMock.mockResolvedValueOnce(json({ id: 's1', tracking_number: '1Z', cashout_commit_pending: { commitment_id: 'pc-1' } }));

    const response = await apiFetch('/api/sales/s1', { method: 'PUT', body: '{}' });
    // The caller still gets to read the body.
    expect((await response.json()).id).toBe('s1');
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    expect(seen.mock.calls[0][0].detail).toEqual({ commitment_id: 'pc-1' });
    stop();
  });

  it('also listens on the Add Outbound Tracking action', async () => {
    const { seen, stop } = listen();
    fetchMock.mockResolvedValueOnce(json({ id: 's1', cashout_commit_pending: { commitment_id: 'pc-2' } }));
    await apiFetch('/api/sales/s1/actions/add_outbound_tracking', { method: 'POST', body: '{}' });
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    stop();
  });

  it('ignores ordinary saves and other endpoints', async () => {
    const { seen, stop } = listen();
    fetchMock
      .mockResolvedValueOnce(json({ id: 's1' }))
      .mockResolvedValueOnce(json({ cashout_commit_pending: { commitment_id: 'pc-3' } }));
    await apiFetch('/api/sales/s1', { method: 'PUT', body: '{}' });
    await apiFetch('/api/inventory/i1', { method: 'PUT', body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});
