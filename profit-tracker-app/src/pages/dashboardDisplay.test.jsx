import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from './Dashboard';
import { DEFAULT_DASHBOARD_SETTINGS } from '../data/dashboardRegistry';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const data = {
  stats: {
    totalCost: 23097.2, totalRevenue: 31250.5, profit: 8153.3, soldCost: 20000, grossProfit: 6653.3, unitsSold: 40,
    inventoryValue: 12345.67, totalCashback: 1500, totalTax: 2100, roi: 12.5,
  },
  recentTransactions: [
    { id: 'sale-1', product: 'Big TV', cost: 1234.5, revenue: 2345.6, profit: 1111.1, status: 'SHIPPED_IN', buyer: 'Unknown', date: '2026-11-01', quantity: 2 },
    { id: 'sale-2', product: 'Old Row', cost: 10, revenue: 20, profit: 0.4, status: null, buyer: 'Unknown', date: '2026-11-01', quantity: 1 },
  ],
  pipelineCounts: { 'Pre Order': 1234 },
  workflowPipelines: {
    all: { stages: [
      { status: 'ON_HAND', count: 1234, value: 50000, itemCount: 0, items: [] },
      { status: 'PAID', count: 3, value: 900, itemCount: 0, items: [] },
    ] },
    cashout: { stages: [{ status: 'SCANNED_IN', count: 2, value: 600, itemCount: 0, items: [] }] },
    marketplace: { stages: [{ status: 'OUTBOUND', count: 1, value: 50, itemCount: 0, items: [] }] },
  },
  topCards: [{ name: 'Visa', amount: 4567.8, txns: 3 }],
};

let uiStyle = 'premium';
let placeholder = false;

vi.mock('../hooks/useApi', () => ({
  useDashboard: () => ({ data, isLoading: false, isError: false, refetch: vi.fn(), isPlaceholderData: placeholder }),
  useGoals: () => ({ data: [] }),
  useTodos: () => ({ data: undefined }),
  useTodoCount: () => 0,
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../hooks/useUiPreferences', () => ({ useUiPreferences: () => ({ preferences: { style: uiStyle } }) }));
vi.mock('../hooks/useDashboardSettings', () => ({
  useDashboardSettings: () => ({ settings: DEFAULT_DASHBOARD_SETTINGS, saveSettings: vi.fn() }),
}));
vi.mock('../components/Dashboard/ProfitCostTrendChart', () => ({ default: ({ markType }) => <div data-testid="trend-chart">{markType}</div> }));
const navigateSpy = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal()), useNavigate: () => navigateSpy }));
vi.mock('../components/Dashboard/MonthlyProfitSpendChart', () => ({ default: () => null }));

const mount = (style) => {
  uiStyle = style;
  return render(<MemoryRouter><Dashboard /></MemoryRouter>);
};

afterEach(() => {
  cleanup();
  placeholder = false;
  localStorage.clear();
});

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

describe('Dashboard KPI cards', () => {
  it('says the period and sales type once above the tiles instead of tagging every card', () => {
    mount('premium');
    expect(screen.getByText('Last 30 days')).toBeInTheDocument();
    expect(screen.getByText(/· all sales/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Sales type' })).getByRole('button', { name: 'Cashout' }));
    expect(screen.getByText(/· Cashout sales only/)).toBeInTheDocument();
    expect(screen.queryByText(/sold via/)).not.toBeInTheDocument();
  });

  it('shows Net Profit as Gross plus cashback so the cards add up, with live numbers in its popover', () => {
    mount('premium');
    // Net 8,153.30 = Gross 6,653.30 + 1,500.00 cashback on sold items
    expect(screen.getByText('$6,653.30 gross + $1,500.00 cashback')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'How Net Profit is calculated' }));
    const dialog = screen.getByRole('dialog', { name: 'How Net Profit is calculated' });
    expect(within(dialog).getByText('$6,653.30 + $1,500.00 cashback on sold items = $8,153.30')).toBeInTheDocument();
  });

  it('remembers the chosen filters after a reload', () => {
    const first = mount('premium');
    fireEvent.click(within(screen.getByRole('group', { name: 'Date range' })).getByRole('button', { name: 'YTD' }));
    first.unmount();
    mount('premium');
    expect(within(screen.getByRole('group', { name: 'Date range' })).getByRole('button', { name: 'YTD' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps the page and the last numbers up, not faded or locked, while another filter loads', () => {
    placeholder = true;
    const { container } = mount('premium');
    expect(screen.queryByText(/^Loading /)).not.toBeInTheDocument();
    expect(container.textContent).toContain('$23,097.20');
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.opacity-50, .animate-pulse, .pointer-events-none:not(.invisible)')).toBeNull();
    expect(screen.getByText(/Welcome back/)).toBeInTheDocument();
  });

  it('opens the Status Pipeline on All with every step and no second filter of its own', () => {
    mount('premium');
    expect(screen.queryByRole('group', { name: 'Pipeline view' })).not.toBeInTheDocument();
    expect(screen.getByText(/Unsold stock right now, at cost\. Sold items from this period/)).toBeInTheDocument();
    const onHand = screen.getByRole('button', { name: /^On Hand/ });
    expect(within(onHand).getByText('1234', { selector: '.sr-only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Paid/ })).toBeInTheDocument();
  });

  it('switches the pipeline to the workflow the dashboard filter picks, and back to All', () => {
    mount('premium');
    const salesType = within(screen.getByRole('group', { name: 'Sales type' }));
    fireEvent.click(salesType.getByRole('button', { name: 'Cashout' }));
    expect(salesType.getByRole('button', { name: 'Cashout' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^Scanned In/ })).toBeInTheDocument();
    fireEvent.click(salesType.getByRole('button', { name: 'Marketplace' }));
    expect(screen.getByRole('button', { name: /^Outbound/ })).toBeInTheDocument();
    fireEvent.click(salesType.getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /^On Hand/ })).toBeInTheDocument();
  });

  it('lets a KPI card be opened from the keyboard and its formula closed with Escape', () => {
    mount('premium');
    expect(screen.getByRole('button', { name: 'Net Profit: see these transactions' })).toBeInTheDocument();
    const info = screen.getByRole('button', { name: 'How Net Profit is calculated' });
    fireEvent.click(info);
    expect(screen.getByRole('dialog', { name: 'How Net Profit is calculated' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'How Net Profit is calculated' })).not.toBeInTheDocument();
  });

  it('has no dead Share button and names the settings button', () => {
    mount('premium');
    expect(screen.queryByText(/Generate Share Card/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dashboard settings' })).toBeInTheDocument();
  });

  it('uses h2 for section titles under the page h1', () => {
    mount('premium');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Welcome back/);
    expect(screen.getByRole('heading', { level: 2, name: 'Status Pipeline' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Recent Sales' })).toBeInTheDocument();
    expect(screen.queryAllByRole('heading', { level: 3 })).toHaveLength(0);
  });
});

describe('Dashboard Recent Sales and chart', () => {
  it('opens a sale from its row and from the keyboard, and links to all sales', () => {
    navigateSpy.mockClear();
    mount('premium');
    expect(screen.getByRole('button', { name: 'Big TV ×2' })).toBeInTheDocument();
    expect(screen.getByText('Profit includes the card cashback on each sale.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Big TV ×2' }));
    expect(navigateSpy).toHaveBeenLastCalledWith('/transactions', { state: { openTransaction: { saleId: 'sale-1' } } });
    fireEvent.click(screen.getByText('Old Row').closest('tr'));
    expect(navigateSpy).toHaveBeenLastCalledWith('/transactions', { state: { openTransaction: { saleId: 'sale-2' } } });
    fireEvent.click(screen.getByRole('button', { name: /View all sales/ }));
    expect(navigateSpy.mock.lastCall[0]).toBe('/transactions');
    expect(navigateSpy.mock.lastCall[1].state.cardScope).toBe('sold');
  });

  it('renames the purchase tiles in a channel view so they never look bigger than All', () => {
    mount('premium');
    expect(screen.getByText('Purchase Spend')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Sales type' })).getByRole('button', { name: 'Marketplace' }));
    expect(screen.getByText('Cost of Sales')).toBeInTheDocument();
    expect(screen.getByText('Cashback on Sales')).toBeInTheDocument();
    expect(screen.queryByText('Purchase Spend')).not.toBeInTheDocument();
  });

  it('hides the Buyer column when no sale has a buyer and shows small profits to the cent', () => {
    mount('premium');
    expect(screen.queryByRole('columnheader', { name: 'Buyer' })).not.toBeInTheDocument();
    expect(screen.getByText('+$0.40')).toBeInTheDocument();
    expect(screen.queryByText('+$0')).not.toBeInTheDocument();
  });

  it('draws Line and Bar with the same chart, only the marks change', () => {
    mount('premium');
    expect(screen.getByTestId('trend-chart')).toHaveTextContent('line');
    fireEvent.click(within(screen.getByRole('group', { name: 'Chart type' })).getByRole('button', { name: 'Bar' }));
    expect(screen.getByTestId('trend-chart')).toHaveTextContent('bar');
    expect(screen.getByRole('heading', { level: 2, name: 'Profit & Cost Trend' })).toBeInTheDocument();
  });
});

describe('Dashboard empty period', () => {
  it('says the period has no sales and offers All Time', () => {
    const saved = data.recentTransactions;
    data.recentTransactions = [];
    try {
      mount('premium');
      expect(screen.getByText('No sales in the last 30 days.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Show All Time' }));
      expect(within(screen.getByRole('group', { name: 'Date range' })).getByRole('button', { name: 'All Time' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByText('No sales recorded yet.')).toBeInTheDocument();
    } finally {
      data.recentTransactions = saved;
    }
  });
});
