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

describe('DashboardSettingsModal metric explanations', () => {
  it('shows the corrected ROI meaning from the registry', () => {
    renderSettings();

    fireEvent.click(screen.getByTitle('About ROI'));

    expect(screen.getByText(/not an average of individual sale percentages/i)).toBeInTheDocument();
  });

  it('explains current pipeline statuses without offering retired options', () => {
    renderSettings();

    fireEvent.click(screen.getByTitle('About Waiting for Payment'));

    expect(screen.getByText(/awaiting payment or payout/i)).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipped In')).not.toBeInTheDocument();
    expect(screen.queryByText('Shipped Out')).not.toBeInTheDocument();
  });
});
