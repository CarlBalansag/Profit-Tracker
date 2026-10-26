import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DASHBOARD_SETTINGS } from '../data/dashboardRegistry';
import DashboardSettingsModal from './DashboardSettingsModal';

afterEach(cleanup);

const renderSettings = () => render(
  <DashboardSettingsModal
    settings={DEFAULT_DASHBOARD_SETTINGS}
    onClose={vi.fn()}
    onSave={vi.fn()}
  />
);

describe('DashboardSettingsModal quick-info explanations', () => {
  it('explains Net Profit in plain language and names excluded expenses', () => {
    renderSettings();

    fireEvent.click(screen.getAllByTitle('About Net Profit')[0]);

    expect(screen.getByText(/gross profit plus the cashback earned/i)).toBeInTheDocument();
    expect(screen.getByText(/subscriptions, rent, or supplies/i)).toBeInTheDocument();
  });

  it('explains ROI with a per-dollar example', () => {
    renderSettings();

    fireEvent.click(screen.getByTitle('About ROI'));

    expect(screen.getByText(/25% ROI means you made \$0\.25 for every \$1\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/not an average of each sale/i)).toBeInTheDocument();
  });

  it('explains current pipeline statuses without offering retired options', () => {
    renderSettings();

    fireEvent.click(screen.getByTitle('About Waiting for Payment'));

    expect(screen.getByText(/payment or payout has not arrived yet/i)).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipped In')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipped Out')).not.toBeInTheDocument();
  });
});
