// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import DealAlertSettings from './DealAlertSettings';
import NewDeals from '../Cashout/NewDeals';

let feed;
vi.mock('../../hooks/useApi', () => ({
  useCashoutProviders: () => ({ data: [
    { id: 'eb', name: 'ElectronicsBuyer' },
    { id: 'la', name: 'LA', settingsName: 'EarnFromBuying (LA)' },
    { id: 'p4d', name: 'Points4Days' },
  ] }),
  useCashoutDealAlerts: () => ({ data: feed, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false }),
}));

const base = { timezone: 'America/New_York', deal_alerts: true, deal_min_profit: 0, deal_providers: [], deal_stores: [], deal_quiet_from: null, deal_quiet_to: null };
const renderSettings = (settings, change) => render(<MemoryRouter><DealAlertSettings settings={{ ...base, ...settings }} busy={false} change={change} /></MemoryRouter>);

afterEach(cleanup);

describe('DealAlertSettings', () => {
  it('hides the filters until alerts are on', () => {
    const change = vi.fn();
    renderSettings({ deal_alerts: false }, change);
    expect(screen.queryByLabelText(/Minimum profit/)).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: /Cashout deal alerts/ }));
    expect(change).toHaveBeenCalledWith({ deal_alerts: true });
  });

  it('saves the cashouts ticked, with all ticked saved as an empty list', () => {
    const change = vi.fn();
    const { unmount } = renderSettings({}, change);
    expect(screen.getByLabelText('EarnFromBuying (LA)')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Points4Days'));
    expect(change).toHaveBeenLastCalledWith({ deal_providers: ['eb', 'la'] });
    unmount();

    renderSettings({ deal_providers: ['eb', 'la'] }, change);
    fireEvent.click(screen.getByLabelText('Points4Days'));
    expect(change).toHaveBeenLastCalledWith({ deal_providers: [] });
  });

  it("won't untick the last cashout", () => {
    renderSettings({ deal_providers: ['eb'] }, vi.fn());
    expect(screen.getByLabelText('ElectronicsBuyer')).toBeDisabled();
  });

  it('saves the minimum profit and stores on blur, and ignores a blank minimum', () => {
    const change = vi.fn();
    renderSettings({ deal_min_profit: 10 }, change);
    const min = screen.getByLabelText(/Minimum profit/);
    fireEvent.change(min, { target: { value: '' } });
    fireEvent.blur(min);
    expect(change).not.toHaveBeenCalled();
    fireEvent.change(min, { target: { value: '25' } });
    fireEvent.blur(min);
    expect(change).toHaveBeenLastCalledWith({ deal_min_profit: 25 });
    const stores = screen.getByLabelText('Only these stores');
    fireEvent.change(stores, { target: { value: ' Best Buy, , Target ' } });
    fireEvent.blur(stores);
    expect(change).toHaveBeenLastCalledWith({ deal_stores: ['Best Buy', 'Target'] });
  });

  it('turns quiet hours on at 10 PM to 7 AM and off again', () => {
    const change = vi.fn();
    renderSettings({}, change);
    fireEvent.click(screen.getByLabelText(/Quiet hours/));
    expect(change).toHaveBeenLastCalledWith({ deal_quiet_from: '22:00', deal_quiet_to: '07:00' });
    fireEvent.click(screen.getByLabelText(/Quiet hours/));
    expect(change).toHaveBeenLastCalledWith({ deal_quiet_from: null, deal_quiet_to: null });
  });
});

describe('NewDeals', () => {
  const item = (over) => ({
    id: 'a1', kind: 'new', created_at: new Date().toISOString(), previous_payout: null,
    payout: 780, retail: 699.99, spread: 80.01, rewards: 35, profit: 115.01, best_card: { card: { name: 'BB Visa' }, rate: 5, store: 'Best Buy' }, matches_filters: true,
    deal: { provider_name: 'ElectronicsBuyer', name: 'PS5 Pro', stores: ['Best Buy'], vendor_limit: 3, live: true, deal_url: null, image_url: null },
    ...over,
  });

  beforeEach(() => { feed = { alerts_on: true, items: [] }; });

  it('shows each deal with the profit at the best card', () => {
    feed.items = [item(), item({ id: 'a2', kind: 'payout_up', previous_payout: 195, profit: null, retail: null, rewards: null, best_card: null, matches_filters: false, deal: { ...item().deal, name: 'AirPods', live: false } })];
    render(<MemoryRouter><NewDeals /></MemoryRouter>);
    expect(screen.getByText('+$115.01')).toBeInTheDocument();
    expect(screen.getByText('incl. $35.00 back with BB Visa (5%)')).toBeInTheDocument();
    expect(screen.getByText('Payout up from $195.00')).toBeInTheDocument();
    expect(screen.getByText('Profit unknown without a retail price')).toBeInTheDocument();
    expect(screen.getByText("Doesn't match your deal alert filters.")).toBeInTheDocument();
    expect(screen.getByText(/No longer listed/)).toBeInTheDocument();
    expect(screen.queryByText('Turn on deal alerts')).toBeNull();
  });

  it('offers to turn alerts on, and says when there is nothing yet', () => {
    feed = { alerts_on: false, items: [] };
    render(<MemoryRouter><NewDeals /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Turn on deal alerts' })).toBeInTheDocument();
    expect(screen.getByText('No new deals this week yet')).toBeInTheDocument();
  });
});
