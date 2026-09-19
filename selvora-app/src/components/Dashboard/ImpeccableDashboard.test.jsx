import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImpeccableDashboard } from './ImpeccableDashboard';

afterEach(() => cleanup());

const baseProps = {
  user: { username: 'carlbbb' },
  lastUpdated: new Date('2026-01-01T00:00:00Z'),
  isLoading: false,
  modeFilter: 'All',
  setModeFilter: vi.fn(),
  dateFilter: '30 Days',
  setDateFilter: vi.fn(),
  settingsOpen: false,
  setSettingsOpen: vi.fn(),
  settings: {},
  saveSettings: vi.fn(),
  uiStyle: 'impeccable',
  navigate: vi.fn(),
  stats: { profit: 120, totalCost: 500, totalRevenue: 620, totalCashback: 10 },
  pipeline: { PURCHASED: 3 },
  topCards: [{ name: 'Visa', txns: 4, amount: 88 }],
  trend: [],
  trendMeta: null,
  recent: [{ product: 'Widget', platform: 'eBay', date: '2026-01-01', cost: 10, revenue: 25, profit: 15 }],
  visibleStatCards: [{ id: 'profit', visible: true, order: 0 }],
  statCardRegistry: {
    profit: { label: 'Net Profit', getValue: (s) => `$${s.profit}`, getSubtext: () => 'this period' },
  },
  visiblePipelineCards: [{ id: 'PURCHASED', visible: true, order: 0 }],
  pipelineCardRegistry: { PURCHASED: { label: 'Purchased', icon: () => null, color: 'accent' } },
  visibleChartSeries: [],
  showTrendChart: false,
  visibleRecentSalesColumns: [],
  showRecentSales: true,
  showPaymentMethods: true,
  showPipeline: true,
  showStatCards: true,
  activeGoals: [{ id: 'g1', name: 'Hit $500 profit', metric: 'netProfit', target_30d: 500 }],
  showGoalsWidget: true,
  trendMode: 'period',
  setTrendMode: vi.fn(),
  chartView: 'line',
  setChartView: vi.fn(),
};

describe('ImpeccableDashboard', () => {
  it('renders the stat row, pipeline, goals, top cards, and recent sales as Sections', () => {
    render(<ImpeccableDashboard {...baseProps} />);
    expect(screen.getByText('Net Profit')).toBeInTheDocument();
    expect(screen.getByText('$120')).toBeInTheDocument();
    expect(screen.getByText('Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Purchased')).toBeInTheDocument();
    expect(screen.getByText('Goals')).toBeInTheDocument();
    expect(screen.getByText('Hit $500 profit')).toBeInTheDocument();
    expect(screen.getByText('Top Cards')).toBeInTheDocument();
    expect(screen.getByText('Visa')).toBeInTheDocument();
    expect(screen.getByText('Recent Sales')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText('+$15')).toBeInTheDocument();
  });

  it('mode and date filter tabs call their setters with the clicked value', () => {
    render(<ImpeccableDashboard {...baseProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cashout' }));
    expect(baseProps.setModeFilter).toHaveBeenCalledWith('Cashout');
    fireEvent.click(screen.getByRole('button', { name: 'YTD' }));
    expect(baseProps.setDateFilter).toHaveBeenCalledWith('YTD');
  });

  it('clicking a pipeline row navigates to Transactions filtered by status', () => {
    render(<ImpeccableDashboard {...baseProps} />);
    fireEvent.click(screen.getByText('Purchased'));
    expect(baseProps.navigate).toHaveBeenCalledWith('/transactions', expect.objectContaining({
      state: expect.objectContaining({ status: 'PURCHASED' }),
    }));
  });

  it('omits sections whose visibility flags are false', () => {
    render(<ImpeccableDashboard {...baseProps} showPipeline={false} showRecentSales={false} />);
    expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    expect(screen.queryByText('Recent Sales')).not.toBeInTheDocument();
  });
});
