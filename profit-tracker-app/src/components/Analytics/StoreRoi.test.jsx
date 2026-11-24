import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import StoreRoi from './StoreRoi';

afterEach(cleanup);

const row = (over) => ({ spend: 100, units: 4, purchases: 1, avgCostPerUnit: 25, soldCost: 50, soldRevenue: 70, profit: 20, unitsSold: 2, roi: 40, accounts: [], ...over });
const amazon = (over = {}) => row({
  id: 'amz', name: 'Amazon', profit: 271.76, unitsSold: 47, roi: 5.9, spend: 4722.36, avgCostPerUnit: 98.38,
  accounts: [
    row({ id: 'a1', name: 'Business Prime', profit: 300, unitsSold: 40, roi: 8.2, spend: 4000, avgCostPerUnit: 100 }),
    row({ id: 'a2', name: 'Personal', profit: -48.24, unitsSold: 5, roi: -12.5, spend: 600, avgCostPerUnit: 85.71 }),
    row({ id: null, name: 'No account', profit: 20, unitsSold: 2, roi: null, spend: 122.36, avgCostPerUnit: 61.18 }),
  ],
  ...over,
});
const view = (stores, props = {}) => render(<StoreRoi stores={stores} showSpend loading={false} {...props} />);

describe('Store ROI', () => {
  it('opens a store bought from on several accounts to the same figures per account', () => {
    view([amazon()]);
    const toggle = screen.getByRole('button', { name: /Amazon.*2 accounts.*47 sold/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Business Prime')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const [business, personal, none] = within(screen.getByRole('list', { name: 'Amazon by account' })).getAllByRole('listitem');
    expect(business).toHaveTextContent('Business Prime40 sold · +$300.00 · 8.2% ROI$4,000.00 spent this period · $100.00 avg / unit');
    expect(personal).toHaveTextContent('Personal5 sold · −$48.24 · -12.5% ROI$600.00 spent this period · $85.71 avg / unit');
    expect(within(personal).getByText('−$48.24')).toHaveClass('text-[var(--dp-red-text)]');
    expect(none).toHaveTextContent('No account2 sold · +$20.00$122.36 spent'); // nothing to work ROI out from
  });

  it('closes again', async () => {
    view([amazon()]);
    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens one store without opening another', () => {
    view([amazon(), amazon({ id: 'tgt', name: 'Target' })]);
    fireEvent.click(screen.getByRole('button', { name: /Target/ }));
    expect(screen.getByRole('list', { name: 'Target by account' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Amazon by account' })).toBeNull();
  });

  it('has no dropdown for a store on one account or none', () => {
    const { accounts, ...fromOldCache } = row({ id: 'gs', name: 'GameStop' });
    expect(accounts).toEqual([]);
    view([row({ id: 'bb', name: 'Best Buy' }), fromOldCache]);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('Best Buy')).toBeInTheDocument();
    expect(screen.getByText('GameStop')).toBeInTheDocument();
  });

  it('hides spend on every row when one sales channel is shown', () => {
    view([amazon()], { showSpend: false });
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Personal')).toBeInTheDocument();
    expect(screen.queryByText(/spent this period/)).toBeNull();
  });

  it('says so when nothing sold', () => {
    view([]);
    expect(screen.getByText('No sold items in this period')).toBeInTheDocument();
  });
});
