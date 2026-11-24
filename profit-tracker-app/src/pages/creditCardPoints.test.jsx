import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CreditCard from './CreditCard';

const mocks = vi.hoisted(() => ({ card: null }));
vi.mock('../hooks/useApi', () => ({
  useCreditCard: () => ({ data: mocks.card, isLoading: false }),
  useTodos: () => ({}),
  useTodoState: () => ({}),
  useCashFlow: () => ({}),
  apiFetch: vi.fn(),
}));

afterEach(cleanup);

const dashboard = (overrides) => ({
  month: '2026-10',
  summary: { totalCashbackToKeep: 4 },
  cards: [{
    id: 'gold', name: 'Amex Gold', last4: null, cashbackRate: 0,
    totalSpend: 100, cashbackEarned: 4, totalLosses: 0, cashbackToRedeem: 0, cashbackToKeep: 4,
    uncoveredLoss: 0, amountToPay: 100, txnCount: 1, soldCount: 0, pendingCount: 1,
    statement_close_day: null, due_day: null, credit_limit: null, min_payment_pct: null,
    items: [{ id: 'i1', saleId: null, product: 'Groceries', cost: 100, cashback: 4, status: 'PURCHASED', revenue: null, netPnl: null, lossAmount: 0, lossToRedeem: 0, cashbackRate: 4 }],
    ...overrides,
  }],
});

describe('Credit Card page: points cards', () => {
  it('shows points earned alongside their dollar value', () => {
    mocks.card = dashboard({ rewardType: 'points', pointValueCents: 1, rewardsLabel: 'Membership Rewards points' });
    render(<MemoryRouter><CreditCard /></MemoryRouter>);
    expect(screen.getByText('Points Earned')).toBeTruthy();
    expect(screen.getAllByText(/400 pts/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(screen.getByText('4x (≈4% at 1¢)')).toBeTruthy();
    expect(screen.getByText('400 pts ≈ $4.00')).toBeTruthy();
  });

  it('values points at the card\'s point value', () => {
    mocks.card = dashboard({ rewardType: 'points', pointValueCents: 2, rewardsLabel: 'SkyMiles', cashbackEarned: 8, cashbackToKeep: 8 });
    render(<MemoryRouter><CreditCard /></MemoryRouter>);
    // $8 of value at 2¢ per mile = 400 miles (not 800).
    expect(screen.getAllByText(/400 miles/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/800 miles/)).toBeNull();
  });

  it('cashback cards keep the cashback wording', () => {
    mocks.card = dashboard({ rewardType: 'cashback' });
    render(<MemoryRouter><CreditCard /></MemoryRouter>);
    expect(screen.getByText('Cashback Earned')).toBeTruthy();
    expect(screen.queryByText(/pts/)).toBeNull();
  });
});
