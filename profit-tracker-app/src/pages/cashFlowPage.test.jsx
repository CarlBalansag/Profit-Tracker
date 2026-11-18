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

const mocks = vi.hoisted(() => ({ data: null }));
vi.mock('../hooks/useApi', () => ({
  useCashFlow: () => ({ data: mocks.data, isLoading: false, isFetching: false, isLoadingError: false, refetch: vi.fn() }),
}));

const page = () => render(<MemoryRouter><CashFlow /></MemoryRouter>);

beforeEach(() => { mocks.data = cashFlowFixture(); });
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
