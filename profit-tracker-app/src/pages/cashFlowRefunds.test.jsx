import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import CashFlow from './CashFlow';

const mocks = vi.hoisted(() => ({ data: null }));
vi.mock('../hooks/useApi', () => ({
  useDashboard: () => ({ data: mocks.data, isLoading: false, refetch: vi.fn() }),
}));

const txn = (over = {}) => ({ id: 's1', product: 'Lego Set', buyer: 'eBay Buyer', cost: 104, revenue: 123, cashback: 2, profit: 21, status: 'SOLD', payout_status: 'paid', refunded: 0, refunded_units: 0, date: '2026-09-03', ...over });
const page = () => render(<MemoryRouter><CashFlow /></MemoryRouter>);

beforeEach(() => { mocks.data = { stats: { totalCost: 416, totalRevenue: 123, storeRefunds: 104, buyerRefunds: 150 }, pipelineCounts: {}, cashFlowTransactions: [txn({ refunded: 150, refunded_units: 1 })] }; });
afterEach(cleanup);

describe('Cash Flow: refunds', () => {
  it('says how much each total already reflects', () => {
    page();
    expect(screen.getByText('after $104.00 refunded by stores')).toBeInTheDocument();
    expect(screen.getByText('after $150.00 refunded to buyers')).toBeInTheDocument();
  });

  it('marks the refunded sale when its buyer is expanded', () => {
    page();
    fireEvent.click(screen.getByText('eBay Buyer'));
    expect(screen.getByText('Refunded $150.00 · 1 returned')).toBeInTheDocument();
  });

  it('shows nothing extra without refunds', () => {
    mocks.data = { stats: { totalCost: 520, totalRevenue: 273, storeRefunds: 0, buyerRefunds: 0 }, pipelineCounts: {}, cashFlowTransactions: [txn()] };
    page();
    fireEvent.click(screen.getByText('eBay Buyer'));
    expect(screen.queryByText(/refunded/i)).toBeNull();
  });
});
