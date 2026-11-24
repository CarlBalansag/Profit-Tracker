import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { MemoryRouter } from 'react-router-dom';

let feed;
vi.mock('../../hooks/useApi', () => ({
  useCashoutDealAlerts: () => ({ data: feed, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }),
}));

import NewDeals from './NewDeals';

const item = (id, name, fields) => ({
  id,
  kind: 'new',
  created_at: new Date().toISOString(),
  alert_payout: fields.payout,
  previous_payout: null,
  deal: { id, provider: 'eb', provider_name: 'EB', name, image_url: null, deal_url: null, stores: ['Best Buy'], vendor_limit: null, expires_at: null, live: true },
  matches_filters: true,
  spread: null,
  rewards: null,
  best_card: null,
  ...fields,
});

describe('NewDeals', () => {
  it('shows each deal\'s ROI next to its profit, and none without a retail price', () => {
    feed = {
      alerts_on: true,
      items: [
        item('a', 'Priced Deal', { payout: 780, retail: 699.99, profit: 115.01, roi: 16.43, rewards: 35, best_card: { card: { name: 'BB Visa' }, rate: 5, store: 'Best Buy' } }),
        item('b', 'Unpriced Deal', { payout: 50, retail: null, profit: null, roi: null }),
      ],
    };
    render(<MemoryRouter><NewDeals /></MemoryRouter>);
    const priced = screen.getByText('Priced Deal').closest('li');
    expect(priced).toHaveTextContent('+$115.01');
    expect(priced).toHaveTextContent('+16.43% ROI');
    const unpriced = screen.getByText('Unpriced Deal').closest('li');
    expect(unpriced).toHaveTextContent('Profit unknown without a retail price');
    expect(unpriced).not.toHaveTextContent('ROI');
  });
});
