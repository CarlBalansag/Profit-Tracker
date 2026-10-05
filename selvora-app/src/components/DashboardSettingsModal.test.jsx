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

  it('explains pipeline statuses and does not offer Completed', () => {
    renderSettings();

    fireEvent.click(screen.getByTitle('About Paid'));

    expect(screen.getByText(/payment or payout has been received/i)).toBeInTheDocument();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });
});
