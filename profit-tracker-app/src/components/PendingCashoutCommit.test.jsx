import '@testing-library/jest-dom/vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import PendingCashoutCommit from './PendingCashoutCommit';
import { offerPendingCommit, offerTrackingSend, offerCommitLower, PENDING_COMMIT_EVENT, TRACKING_SEND_EVENT } from '../utils/pendingCashoutCommit';
import { apiFetch } from '../hooks/useApi';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn(), warning: vi.fn() } }));

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
    expect(seen.mock.calls[0][0].detail).toEqual({ commitment_id: 'pc-1', ask_direct: null });
    stop();
  });

  it('also listens on the Add Outbound Tracking action', async () => {
    const { seen, stop } = listen();
    fetchMock.mockResolvedValueOnce(json({ id: 's1', cashout_commit_pending: { commitment_id: 'pc-2' } }));
    await apiFetch('/api/sales/s1/actions/add_outbound_tracking', { method: 'POST', body: '{}' });
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    stop();
  });

  it('offers it, with the straight-to-cashout question, on purchase and transaction saves', async () => {
    const { seen, stop } = listen();
    const askDirect = { sale_id: 's1', tracking_number: '1Z', cashout: 'EB Primary' };
    fetchMock.mockImplementation(async () => json({ cashout_commit_pending: { commitment_id: 'pc-4', ask_direct: askDirect } }));
    await apiFetch('/api/inventory/i1', { method: 'PUT', body: '{}' });
    await apiFetch('/api/inventory/i1/transaction', { method: 'PUT', body: '{}' });
    await apiFetch('/api/inventory/i1/actions/add_tracking', { method: 'POST', body: '{}' });
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(3));
    expect(seen.mock.calls[0][0].detail).toEqual({ commitment_id: 'pc-4', ask_direct: askDirect });
    stop();
  });

  it('ignores ordinary saves and other endpoints', async () => {
    const { seen, stop } = listen();
    fetchMock
      .mockResolvedValueOnce(json({ id: 's1' }))
      .mockResolvedValueOnce(json({ cashout_commit_pending: { commitment_id: 'pc-3' } }));
    await apiFetch('/api/sales/s1', { method: 'PUT', body: '{}' });
    await apiFetch('/api/expenses/e1', { method: 'PUT', body: '{}' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen).not.toHaveBeenCalled();
    stop();
  });
});

describe('tracking added to the purchase', () => {
  const askDirect = { sale_id: 's1', tracking_number: '1ZDIRECT', cashout: 'EB Primary' };

  it('asks first whether it ships straight to the cashout, starting on No', async () => {
    renderPrompt();
    act(() => offerPendingCommit('pc-1', askDirect));

    expect(await screen.findByRole('heading', { name: 'Is this package going straight to EB Primary?' })).toBeInTheDocument();
    expect(screen.getByText('1ZDIRECT')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: "No, it's coming to me" })).toHaveFocus());
  });

  it('"No" closes without saving anything', async () => {
    renderPrompt();
    act(() => offerPendingCommit('pc-1', askDirect));
    fireEvent.click(await screen.findByRole('button', { name: "No, it's coming to me" }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith('Saved on the purchase only', expect.anything());
  });

  it('"Yes" puts the number on the sale, then shows the commit prompt without committing', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 's1', tracking_number: '1ZDIRECT', cashout_commit_pending: { commitment_id: 'pc-1' } }))
      .mockResolvedValue(json(preview({ tracking_number: '1ZDIRECT' })));
    renderPrompt();
    act(() => offerPendingCommit('pc-1', askDirect));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, commit with it' }));

    expect(await screen.findByRole('heading', { name: 'Commit to EB Primary now?' })).toBeInTheDocument();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/sales/s1');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ tracking_number: '1ZDIRECT' });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith('/commit'))).toBe(false);
  });

  it('keeps the question open with the error when the sale save fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Sale changed while saving. Reload and retry.' }, 409));
    renderPrompt();
    act(() => offerPendingCommit('pc-1', askDirect));
    fireEvent.click(await screen.findByRole('button', { name: 'Yes, commit with it' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Sale changed while saving');
    expect(screen.getByRole('heading', { name: 'Is this package going straight to EB Primary?' })).toBeInTheDocument();
  });
});

describe('sending a changed tracking number', () => {
  const detail = { commitment_id: 'a1', tracking_number: '1ZNEW', cashout: 'EB Primary' };

  it('asks first, starting on Not now, and sends nothing until Send', async () => {
    renderPrompt();
    act(() => offerTrackingSend(detail));
    expect(await screen.findByRole('heading', { name: 'Send this tracking number to EB Primary?' })).toBeInTheDocument();
    expect(screen.getByText('1ZNEW')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends it on Send', async () => {
    fetchMock.mockResolvedValueOnce(json({ sent: ['1ZNEW'], shared: [] }));
    renderPrompt();
    act(() => offerTrackingSend(detail));
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Tracking sent to EB Primary.'));
    expect(fetchMock.mock.calls[0][0]).toContain('/api/cashouts/commitments/a1/tracking');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the reason when the send is refused', async () => {
    fetchMock.mockResolvedValueOnce(json({ error: 'Too many cashout writes in a short time. Nothing was sent. Try again in 30s.' }, 429));
    renderPrompt();
    act(() => offerTrackingSend(detail));
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was sent');
  });

  it('apiFetch offers it when a sale save says the cashout lacks the new number', async () => {
    const seen = vi.fn();
    window.addEventListener(TRACKING_SEND_EVENT, seen);
    fetchMock.mockResolvedValueOnce(json({ id: 's1', cashout_tracking_changed: detail }));
    await apiFetch('/api/sales/s1', { method: 'PUT', body: '{}' });
    await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
    expect(seen.mock.calls[0][0].detail).toEqual(detail);
    window.removeEventListener(TRACKING_SEND_EVENT, seen);
  });

  it('apiFetch warns after deleting something whose commitment is still active', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, cashout_warning: 'Your commitment with EB Primary is still active.' }));
    await apiFetch('/api/inventory/i1', { method: 'DELETE' });
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Your commitment with EB Primary is still active.', expect.anything()));
  });
});

describe('buying more of an item already committed', () => {
  it('says committing adds to the existing commitment, and shows a refused last try', async () => {
    fetchMock.mockResolvedValueOnce(json(preview({ quantity: 1, adds_to: { committed: 2, new_total: 3 }, commit_error: 'EB Primary wouldn\'t add these 1 to your commitment (Over the vendor limit.).' })));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));
    expect(await screen.findByText(/You already have 2 of this item committed to EB Primary\. Committing adds these 1, raising your binding commitment to 3/)).toBeInTheDocument();
    expect(screen.getByText(/Last try: EB Primary wouldn't add these 1/)).toBeInTheDocument();
  });

  it('reports the new total after a raise', async () => {
    fetchMock
      .mockResolvedValueOnce(json(preview({ adds_to: { committed: 2, new_total: 4 } })))
      .mockResolvedValueOnce(json({ raisedTo: 4, trackingSubmitted: true, payout: 495, previousPayout: null }));
    renderPrompt();
    act(() => offerPendingCommit('pc-1'));
    fireEvent.click(await screen.findByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added to your commitment with EB Primary: now 4.', expect.anything()));
  });
});

describe('a committed sale that was cancelled or returned', () => {
  it('asks before lowering, and only sends when confirmed', async () => {
    fetchMock.mockResolvedValueOnce(json({ status: 'withdrawn' }));
    renderPrompt();
    act(() => offerCommitLower({ commitment_id: 'c-2', cashout: 'EB Primary', quantity: 2, total: 4, remaining: 2 }));
    expect(screen.getByRole('heading', { name: 'Lower your commitment with EB Primary?' })).toBeInTheDocument();
    expect(screen.getByText(/goes from 4 to 2; the other purchases on it stay committed/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus());
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Lower to 2' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Commitment with EB Primary lowered to 2.'));
    expect(fetchMock.mock.calls[0][0]).toContain('/api/cashouts/commitments/c-2');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });

  it('offers to withdraw when it was the only purchase, and Keep it sends nothing', () => {
    renderPrompt();
    act(() => offerCommitLower({ commitment_id: 'c-1', cashout: 'EB Primary', quantity: 2, total: 2, remaining: 0 }));
    expect(screen.getByRole('heading', { name: 'Withdraw your commitment with EB Primary?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
