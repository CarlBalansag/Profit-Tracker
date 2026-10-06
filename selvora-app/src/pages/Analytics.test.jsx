// Covers the new "Channels" tab (platform payout, vendor spend, category
// profitability) added on top of the existing Analytics page. The backend
// already builds these three arrays from the same mode/date-filtered data
// every other stat on the page uses (see analyticsBreakdowns.test.mjs), so
// these tests only need to confirm the page renders what the API returns --
// not re-derive the aggregation math.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Analytics from './Analytics';

const mocks = vi.hoisted(() => ({
  dashboard: { data: null, isLoading: false, refetch: vi.fn() },
}));

vi.mock('../hooks/useApi', () => ({
  useDashboard: () => mocks.dashboard,
}));

afterEach(cleanup);

const baseData = {
  stats: {}, trend: [], topCards: [],
  platformBreakdown: [], vendorBreakdown: [], categoryBreakdown: [],
};

const setData = (overrides = {}) => {
  mocks.dashboard = { data: { ...baseData, ...overrides }, isLoading: false, refetch: vi.fn() };
};

const openChannels = () => fireEvent.click(screen.getByRole('button', { name: /Channels/i }));

describe('Analytics Channels tab', () => {
  it('shows the platform payout, vendor spend, and category breakdowns the API returns', () => {
    setData({
      platformBreakdown: [{
        id: 'p1', name: 'QA Marketplace', type: 'Marketplace',
        revenue: 273, cost: 208, commission: 15, profit: 69.16,
        unitsSold: 2, salesCount: 1, avgPayoutDays: 5,
        returnedCount: 0, disputedCount: 0, cancelledCount: 0, exceptionRatePct: 0,
      }],
      vendorBreakdown: [{ id: 'v1', name: 'QA Store', spend: 520, units: 5, purchases: 1, avgCostPerUnit: 104 }],
      categoryBreakdown: [{ category: 'Shoes', revenue: 273, cost: 208, profit: 69.16, margin: 25.33, unitsSold: 2 }],
    });
    render(<Analytics />);
    openChannels();

    expect(screen.getByText('QA Marketplace')).toBeTruthy();
    expect(screen.getByText('+$69.16 profit')).toBeTruthy();
    expect(screen.getByText('5d', { exact: false })).toBeTruthy();
    expect(screen.getByText('QA Store')).toBeTruthy();
    expect(screen.getByText('Shoes')).toBeTruthy();
  });

  it('warns about a platform with a high return/dispute/cancellation rate', () => {
    setData({
      platformBreakdown: [{
        id: 'p1', name: 'QA Marketplace', type: 'Marketplace',
        revenue: 273, cost: 208, commission: 15, profit: 69.16,
        unitsSold: 2, salesCount: 1, avgPayoutDays: null,
        returnedCount: 1, disputedCount: 0, cancelledCount: 0, exceptionRatePct: 50,
      }],
    });
    render(<Analytics />);
    openChannels();

    expect(screen.getByText(/50\.0% of attempted sales here were returned, disputed, or cancelled/i)).toBeTruthy();
  });

  it('does not show the exception warning for a platform with no exceptions', () => {
    setData({
      platformBreakdown: [{
        id: 'p1', name: 'Clean Platform', type: 'Marketplace',
        revenue: 100, cost: 50, commission: 5, profit: 50,
        unitsSold: 1, salesCount: 1, avgPayoutDays: null,
        returnedCount: 0, disputedCount: 0, cancelledCount: 0, exceptionRatePct: 0,
      }],
    });
    render(<Analytics />);
    openChannels();

    expect(screen.queryByText(/returned, disputed, or cancelled/i)).toBeNull();
  });

  it('shows an empty state for each section when there is no data for the period', () => {
    setData();
    render(<Analytics />);
    openChannels();

    expect(screen.getByText('No sales in this period')).toBeTruthy();
    expect(screen.getByText('No purchases in this period')).toBeTruthy();
    expect(screen.getByText('No sold items in this period')).toBeTruthy();
  });
});
