import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { DEFAULT_DASHBOARD_SETTINGS } from '../data/dashboardRegistry';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const data = {
  stats: {
    totalCost: 23097.2, totalRevenue: 31250.5, profit: 8153.3, soldCost: 20000, unitsSold: 40,
    inventoryValue: 12345.67, totalCashback: 1500, totalTax: 2100, roi: 12.5,
  },
  recentTransactions: [
    { product: 'Big TV', cost: 1234.5, revenue: 2345.6, profit: 1111.1, status: 'SHIPPED_IN', date: '2026-11-01', quantity: 1 },
    { product: 'Old Row', cost: 10, revenue: 20, profit: 10, status: null, date: '2026-11-01', quantity: 1 },
  ],
  pipelineCounts: {},
  topCards: [{ name: 'Visa', amount: 4567.8, txns: 3 }],
};

let uiStyle = 'premium';

vi.mock('../hooks/useApi', () => ({
  useDashboard: () => ({ data, isLoading: false, isError: false, refetch: vi.fn() }),
  useGoals: () => ({ data: [] }),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../hooks/useUiPreferences', () => ({ useUiPreferences: () => ({ preferences: { style: uiStyle } }) }));
vi.mock('../hooks/useDashboardSettings', () => ({
  useDashboardSettings: () => ({ settings: DEFAULT_DASHBOARD_SETTINGS, saveSettings: vi.fn() }),
}));
vi.mock('../components/Dashboard/ProfitRevenueTrendChart', () => ({ default: () => null }));
vi.mock('../components/Dashboard/MonthlyProfitSpendChart', () => ({ default: () => null }));

const mount = (style) => {
  uiStyle = style;
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
};

afterEach(cleanup);

describe.each(['premium', 'glass'])('Dashboard display in the %s style', (style) => {
  it('never prints a raw status code', () => {
    const { container } = mount(style);
    expect(container.textContent).not.toMatch(/SHIPPED_IN/);
    expect(screen.getAllByText('Shipped In').length).toBeGreaterThan(0);
  });

  it('labels a row with no stored status as Sold', () => {
    mount(style);
    expect(screen.getAllByText('Sold').length).toBeGreaterThan(0);
  });

  it('never prints a dollar amount of four or more digits without a comma', () => {
    const { container } = mount(style);
    expect(container.textContent).not.toMatch(/\$-?\d{4}/);
  });
});

describe('Dashboard amounts', () => {
  it('shows stat card totals with thousands separators', () => {
    const { container } = mount('premium');
    expect(container.textContent).toContain('$23,097.20');
  });
});
