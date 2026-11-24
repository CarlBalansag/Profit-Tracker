import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let history;
const calls = [];
vi.mock('../../hooks/useApi', () => ({
  useCashoutDealHistory: (provider, dealId) => {
    calls.push([provider, dealId]);
    return { refetch: vi.fn(), isFetching: false, isLoading: false, isError: false, ...history };
  },
}));

import DealHistoryButton from './DealHistory';
import { summarizePayoutHistory } from '../../utils/cashoutDeals';

const deal = { id: '5213', name: 'PS5 Pro', connectionProvider: 'eb', connectionName: 'EB' };
const snap = (capturedAt, payout, status = 'active') => ({ capturedAt, payout, status });

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe('summarizePayoutHistory', () => {
  it('lists each change with how far it moved, the range and the rise and drop counts', () => {
    const summary = summarizePayoutHistory([
      snap('2026-11-01T12:00:00Z', 700),
      snap('2026-11-05T12:00:00Z', 720.5),
      snap('2026-11-09T12:00:00Z', 690),
      snap('2026-11-12T12:00:00Z', 690, 'closed'),
    ]);
    expect(summary.points.map((point) => point.change)).toEqual([null, 20.5, -30.5, 0]);
    expect(summary).toMatchObject({ high: 720.5, low: 690, rises: 1, drops: 1 });
    expect(summary.latest).toMatchObject({ payout: 690, status: 'closed' });
  });

  it('skips entries it cannot read and gives nothing for an empty history', () => {
    expect(summarizePayoutHistory([])).toBeNull();
    expect(summarizePayoutHistory(undefined)).toBeNull();
    expect(summarizePayoutHistory([snap('not a date', 5), snap('2026-11-01T12:00:00Z', null)])).toBeNull();
    expect(summarizePayoutHistory([snap('2026-11-01T12:00:00Z', 'x'), snap('2026-11-02T12:00:00Z', 10)]).points).toHaveLength(1);
  });
});

describe('DealHistoryButton', () => {
  it('asks for the history only once opened, then shows the range and each change', () => {
    history = { data: { snapshots: [snap('2026-11-01T12:00:00Z', 700), snap('2026-11-05T12:00:00Z', 720), snap('2026-11-09T12:00:00Z', 690)] } };
    render(<DealHistoryButton deal={deal} />);
    expect(calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Payout history for PS5 Pro' }));
    expect(calls[0]).toEqual(['eb', '5213']);

    const dialog = screen.getByRole('dialog', { name: 'Payout history for PS5 Pro' });
    expect(dialog).toHaveTextContent('Now$690.00');
    expect(dialog).toHaveTextContent('Highest$720.00');
    expect(dialog).toHaveTextContent('Lowest$690.00');
    expect(dialog).toHaveTextContent('went up 1 time, down 1 time');
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('-$30.00');
    expect(rows[1]).toHaveTextContent('+$20.00');
    expect(rows[2]).toHaveTextContent('First seen');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when nothing is recorded, when it has not changed, and when loading fails', () => {
    history = { data: { snapshots: [] } };
    render(<DealHistoryButton deal={deal} />);
    fireEvent.click(screen.getByRole('button', { name: /Payout history/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('No payouts recorded for this deal yet');
    cleanup();

    history = { data: { snapshots: [snap('2026-11-01T12:00:00Z', 700)] } };
    render(<DealHistoryButton deal={deal} />);
    fireEvent.click(screen.getByRole('button', { name: /Payout history/ }));
    expect(screen.getByRole('dialog')).toHaveTextContent('No change since it was first seen');
    cleanup();

    const refetch = vi.fn();
    history = { isError: true, refetch };
    render(<DealHistoryButton deal={deal} />);
    fireEvent.click(screen.getByRole('button', { name: /Payout history/ }));
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load the payout history.");
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('shows no button for a deal it cannot look up', () => {
    render(<DealHistoryButton deal={{ id: '1', name: 'X' }} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
