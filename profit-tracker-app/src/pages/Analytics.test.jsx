// The Analytics tabs (Overview, Products & Stores, Channels, Cards). The
// backend builds every array from the same mode/date-filtered data (see
// analyticsBreakdowns.test.mjs and cashFlowOverview.test.mjs), so these tests
// only confirm the page shows what the API returns.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Analytics from './Analytics';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const mocks = vi.hoisted(() => ({
  dashboard: { data: null, isLoading: false, refetch: vi.fn() },
}));

vi.mock('../hooks/useApi', () => ({
  useDashboard: () => mocks.dashboard,
}));

afterEach(cleanup);

const baseData = {
  stats: {}, trend: [], topCards: [], priorStats: null, priorTrend: [], profitCalendar: [],
  platformBreakdown: [], vendorBreakdown: [], categoryBreakdown: [],
};

const setData = (overrides = {}) => {
  mocks.dashboard = { data: { ...baseData, ...overrides }, isLoading: false, refetch: vi.fn() };
};

const openTab = (name) => fireEvent.click(screen.getByRole('tab', { name }));

const platform = (over = {}) => ({
  id: 'p1', name: 'QA Marketplace', type: 'Marketplace',
  revenue: 273, cost: 208, commission: 15, profit: 69.16,
  unitsSold: 2, salesCount: 1, avgPayoutDays: 5,
  returnedCount: 0, disputedCount: 0, cancelledCount: 0, exceptionRatePct: 0, ...over,
});

describe('Analytics Channels tab', () => {
  it('shows the platform payouts the API returns', () => {
    setData({ platformBreakdown: [platform()] });
    render(<Analytics />);
    openTab(/Channels/);

    expect(screen.getByText('QA Marketplace')).toBeTruthy();
    expect(screen.getByText('+$69.16 profit')).toBeTruthy();
    expect(screen.getByText('5d', { exact: false })).toBeTruthy();
  });

  it('warns about a platform with a high return/dispute/cancellation rate', () => {
    setData({ platformBreakdown: [platform({ avgPayoutDays: null, returnedCount: 1, exceptionRatePct: 50 })] });
    render(<Analytics />);
    openTab(/Channels/);

    expect(screen.getByText(/50\.0% of attempted sales here were returned, disputed, or cancelled/i)).toBeTruthy();
  });

  it('does not show the exception warning for a platform with no exceptions', () => {
    setData({ platformBreakdown: [platform({ name: 'Clean Platform' })] });
    render(<Analytics />);
    openTab(/Channels/);

    expect(screen.queryByText(/returned, disputed, or cancelled/i)).toBeNull();
  });

  it('shows an empty state when there are no sales in the period', () => {
    setData();
    render(<Analytics />);
    openTab(/Channels/);
    expect(screen.getByText('No sales in this period')).toBeTruthy();
  });
});

describe('Analytics Products & Stores tab', () => {
  it('shows profit and ROI per store, leaving out stores with nothing sold', () => {
    setData({
      vendorBreakdown: [
        { id: 'v1', name: 'QA Store', spend: 520, units: 5, purchases: 1, avgCostPerUnit: 104, soldCost: 208, soldRevenue: 273, profit: 69.16, unitsSold: 2, roi: 33.25 },
        { id: 'v2', name: 'Unsold Store', spend: 90, units: 1, purchases: 1, avgCostPerUnit: 90, soldCost: 0, soldRevenue: 0, profit: 0, unitsSold: 0, roi: null },
      ],
      categoryBreakdown: [{ category: 'Shoes', revenue: 273, cost: 208, profit: 69.16, margin: 25.33, unitsSold: 2 }],
    });
    render(<Analytics />);
    openTab(/Products/);
    expect(screen.queryByText(/Category profitability/i)).toBeNull();

    expect(screen.getByText('QA Store')).toBeTruthy();
    expect(screen.getByText(/33\.3% ROI/)).toBeTruthy();
    expect(screen.queryByText('Unsold Store')).toBeNull();
    expect(screen.queryByText('Shoes')).toBeNull();
  });

  it('shows an empty state when nothing sold in the period', () => {
    setData();
    render(<Analytics />);
    openTab(/Products/);
    expect(screen.getAllByText('No sold items in this period')).toHaveLength(1);
  });
});

describe('Analytics Cards tab', () => {
  it('shows cashback and spend for each card', () => {
    setData({ topCards: [{ name: 'QA Credit Card', txns: 1, amount: 520, cashback: 10.4, cashbackRate: 2 }] });
    render(<Analytics />);
    openTab(/Cards/);
    expect(screen.getByText('QA Credit Card')).toBeTruthy();
    expect(screen.getByText('$10.40')).toBeTruthy();
    expect(screen.getByText(/\$520\.00 spent · 1 purchase$/)).toBeTruthy();
  });
});

describe('Analytics overview', () => {
  it('shows profit after business expenses next to profit on sales', () => {
    setData({ stats: { totalRevenue: 273, soldCost: 208, profit: 69.16, businessExpenses: 25, profitAfterExpenses: 44.16 } });
    render(<Analytics />);
    expect(screen.getAllByText('After expenses').length).toBeGreaterThan(0);
    expect(screen.getByText('Profit minus $25.00 business expenses')).toBeTruthy();
    expect(screen.getByText('Profit on sales')).toBeTruthy();
  });

  it('compares with the last period when there is one', () => {
    setData({
      stats: { totalRevenue: 300, soldCost: 200, profit: 100, roi: 50 },
      priorStats: { totalRevenue: 200, soldCost: 150, profit: 50, roi: 33.33, salesCount: 1, unitsSold: 1 },
    });
    render(<Analytics />);
    fireEvent.click(screen.getByRole('tab', { name: '30 Days' }));
    expect(screen.getByText(/▲ \$50\.00 \(\+100%\) vs prior 30 days/)).toBeTruthy();
  });

  it('no longer shows the cost breakdown chart', () => {
    setData({ stats: { soldCost: 16550.59, commissionFees: 43.92, saleShipping: 75.77 } });
    render(<Analytics />);
    expect(screen.queryByText(/Cost Breakdown/i)).toBeNull();
    expect(screen.queryByText('COGS')).toBeNull();
  });
});
