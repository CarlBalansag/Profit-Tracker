import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vendors from './Vendors';
import Marketplaces from './Marketplaces';
import { Accounts } from './Accounts';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidatePlatforms: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ platforms: mocks.invalidatePlatforms }),
}));

afterEach(cleanup);

// ideas.md ISSUES #10 ("Several pages fail silently and log console errors")
// and #9 ("Accounts shows zero accounts for every vendor") -- Vendors,
// Marketplaces, and Accounts all silently did nothing on a failed load or a
// failed add (no toast, no visible error state), so a user who hit a real
// API failure while adding an account would see nothing happen and no
// indication why -- directly explaining why accounts might never end up
// created. Both now surface a toast on a failed mutation and a visible
// retry state on a failed list load.
describe('ideas.md #9/#10 regression: Vendors/Marketplaces/Accounts surface failures visibly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Vendors: shows a visible error with retry when the list fails to load, and recovers on retry', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }));
    render(<Vendors />);

    expect(await screen.findByText(/Could not load vendors/)).toBeTruthy();
    const retryButton = screen.getByRole('button', { name: 'Retry' });

    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'v1', name: 'Recovered Vendor', type: 'Vendor' }]), { status: 200 }));
    fireEvent.click(retryButton);

    expect(await screen.findByText('Recovered Vendor')).toBeTruthy();
    expect(screen.queryByText(/Could not load vendors/)).toBeNull();
  });

  it('Vendors: Custom Add shows an error toast and keeps the modal open when the create fails', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }));
    render(<Vendors />);
    await waitFor(() => expect(screen.getByText(/No vendors yet/)).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Custom/ }));
    expect(await screen.findByText('Add Vendor')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('e.g. Amazon, Home Depot...'), { target: { value: 'New Vendor' } });
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Name already exists' }), { status: 400 }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Add Vendor')).toBeTruthy(); // modal stays open, not silently closed
  });

  it('Marketplaces: shows a visible error with retry when the list fails to load', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }));
    render(<Marketplaces />);

    expect(await screen.findByText(/Could not load marketplaces/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Accounts: shows a visible error with retry when platforms fail to load', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 }));
    render(<Accounts />);

    expect(await screen.findByText(/Could not load platforms/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('Accounts: Add Account shows an error toast and keeps the modal open when the create fails', async () => {
    const vendor = { id: 'p1', name: 'A Vendor', type: 'Vendor', accounts: [] };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([vendor]), { status: 200 }));
    render(<Accounts />);
    await waitFor(() => expect(screen.getByText('A Vendor')).toBeTruthy());

    fireEvent.click(screen.getByText('A Vendor').closest('div[class*="cursor-pointer"]'));
    expect(await screen.findByText(/A Vendor Accounts/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Add Account' }));
    const nameInput = await screen.findByPlaceholderText('e.g. Main Account, Business...');

    fireEvent.change(nameInput, { target: { value: 'My Login' } });
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Platform not found or access denied' }), { status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByPlaceholderText('e.g. Main Account, Business...')).toBeTruthy(); // modal stays open, not silently closed
  });
});
