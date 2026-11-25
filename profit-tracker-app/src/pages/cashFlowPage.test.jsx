// The rebuilt Cash Flow page: owed vs due, the coverage line, card balances,
// and the money map, from GET /api/analytics/cashflow. The math is tested on
// the API side (cashFlowOverview.test.mjs); these check the page shows it.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CashFlow from './CashFlow';
import { cashFlowFixture } from '../test/cashFlowFixture';

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
globalThis.IntersectionObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const mocks = vi.hoisted(() => ({ data: null, apiFetch: null }));
vi.mock('../hooks/useApi', () => ({
  useCashFlow: () => ({ data: mocks.data, isLoading: false, isFetching: false, isLoadingError: false, refetch: vi.fn() }),
  apiFetch: (...args) => mocks.apiFetch(...args),
}));
const res = (body, ok = true) => ({ ok, json: async () => structuredClone(body) });

const page = () => render(<MemoryRouter><CashFlow /></MemoryRouter>);

beforeEach(() => { mocks.data = cashFlowFixture(); mocks.apiFetch = vi.fn(async () => res({ enabled: false })); });
afterEach(cleanup);

describe('Cash Flow page', () => {
  it('lists who owes you, flags the late one, and opens to the sales inside', () => {
    page();
    const row = screen.getByRole('button', { name: /eBay Buyer/ });
    expect(within(row).getByText('Late 16d')).toBeInTheDocument();
    expect(row).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Lego Set')).toBeInTheDocument();
    expect(screen.getByText('· short-paid', { exact: false })).toBeInTheDocument();
  });

  describe.each([['desktop', false], ['phone', true]])('store account on owed items (%s)', (_name, phone) => {
    beforeEach(() => { vi.stubGlobal('matchMedia', () => ({ matches: phone, addEventListener() {}, removeEventListener() {} })); });
    afterEach(() => vi.unstubAllGlobals());

    it('shows the account next to the item name, and nothing extra without one', () => {
      const [group] = cashFlowFixture().owed;
      const [lego, jordan] = group.items;
      mocks.data = cashFlowFixture({ owed: [{ ...group, items: [{ ...lego, account: 'Business Prime' }, { ...jordan, account: null }] }] });
      const { container } = page();
      fireEvent.click(screen.getByRole('button', { name: /eBay Buyer/ }));
      const rows = [...container.querySelectorAll(phone ? 'li' : 'tbody tr')];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent('Lego Set · Business Prime');
      expect(rows[1]).toHaveTextContent('Jordan 4 · short-paid');
      expect(container.querySelectorAll('[data-store-account]')).toHaveLength(1);
    });
  });

  it('shows each upcoming card bill and whether payouts cover it', () => {
    page();
    expect(screen.getByText('Short $224.00')).toBeInTheDocument();
    expect(screen.getByText(/\$296\.00 expected in payouts by then, against \$520\.00/)).toBeInTheDocument();
    expect(screen.getByText(/falls short of/)).toBeInTheDocument();
  });

  it('says covered when what you are owed covers the next 30 days of bills', () => {
    mocks.data = cashFlowFixture({
      summary: { ...cashFlowFixture().summary, billsDue30: 100, coverageGap: 196 },
      coverage: [{ ...cashFlowFixture().coverage[0], amount: 100, billsSoFar: 100, covered: true, gap: 196 }],
    });
    page();
    expect(screen.getAllByText('Covered').length).toBeGreaterThan(0);
    expect(screen.getByText(/covers the next 30 days/)).toBeInTheDocument();
  });

  it('calls a balance below zero a credit', () => {
    mocks.data = cashFlowFixture({ cards: [{ ...cashFlowFixture().cards[0], balance: -42.5, currentCycle: -42.5, utilizationPct: 0 }] });
    page();
    expect(screen.getByText('$42.50 credit')).toBeInTheDocument();
    expect(screen.queryByText(/of \$5,000\.00/)).not.toBeInTheDocument();
  });

  it('shows card balance against its limit', () => {
    page();
    expect(screen.getByText(/of \$5,000\.00 · 10%/)).toBeInTheDocument();
  });

  it('asks for card dates when no card has them', () => {
    mocks.data = cashFlowFixture({ coverage: [], cards: [{ ...cashFlowFixture().cards[0], hasDates: false }] });
    page();
    expect(screen.getByText(/Add statement close and due days/)).toBeInTheDocument();
  });

  it('says so when every sale is paid', () => {
    mocks.data = cashFlowFixture({ owed: [], summary: { ...cashFlowFixture().summary, owedTotal: 0, owedCount: 0, lateCount: 0 } });
    page();
    expect(screen.getByText('Every sale has been paid.')).toBeInTheDocument();
    expect(screen.getByText('Nothing waiting')).toBeInTheDocument();
  });

  it('describes the money map for screen readers', () => {
    page();
    expect(screen.getByRole('img', { name: /Put in \$1,040: \$312 in stock, \$296 sold and unpaid, \$400 paid back/ })).toBeInTheDocument();
  });
});

describe('Cash Flow: tax reserve', () => {
  const books = { netProfit: '10000.00', forecast: { status: 'current', daysElapsed: 182, daysInYear: 364, recent: { days: 90, profit: 0 }, prior: null } };
  const api = (overrides = {}) => vi.fn(async (path) => {
    if (path === '/api/preferences/schedule-c') return res({ enabled: true });
    if (path.startsWith('/api/schedule-c')) return res({ books });
    if (path.startsWith('/api/tax/profile/')) return res({ profile: overrides.profile ?? null });
    if (path.startsWith('/api/tax/reserves/')) return res({ entries: [], balance: overrides.balance ?? '1000.00' });
    if (path.startsWith('/api/tax/payments/')) return res({ payments: overrides.payments ?? [{ id: 'p1', year: 2026, jurisdiction: 'US', period: 'Q1', amount: '500.00', paid_date: '2026-04-10' }] });
    throw new Error(path);
  });

  it('is hidden while Schedule C is off', async () => {
    page();
    await Promise.resolve();
    expect(screen.queryByText(/Tax reserve,/)).toBeNull();
  });

  it('shows the recommendation, what is set aside, the shortfall and coverage', async () => {
    // Without saved details: a flat 25% of the projected $20,000 = $5,000;
    // $1,000 set aside and $500 paid leave $3,500.
    mocks.apiFetch = api();
    page();
    expect(await screen.findByText(/Tax reserve,/)).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('$500.00')).toBeInTheDocument(); // a recorded federal payment
    expect(screen.getByText('$3,500.00')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tax reserve covered' })).toHaveAttribute('aria-valuenow', '30');
    expect(screen.getByRole('link', { name: 'Open tax estimate' })).toHaveAttribute('href', '/schedule-c');
  });

  it('stays out of the way when loading fails', async () => {
    mocks.apiFetch = vi.fn(async () => res({ error: 'nope' }, false));
    page();
    await Promise.resolve(); await Promise.resolve();
    expect(screen.queryByText(/Tax reserve,/)).toBeNull();
    expect(screen.getByText('Cash Flow')).toBeInTheDocument();
  });
});
