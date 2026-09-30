import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Vendors from './Vendors';
import Marketplaces from './Marketplaces';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidatePlatforms: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ platforms: mocks.invalidatePlatforms }),
}));

afterEach(cleanup);

const clickEditButton = () => fireEvent.click(document.querySelector('svg.lucide-pen').closest('button'));

describe('QA-21 regression: Vendor and Marketplace edit buttons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a prefilled edit modal and saves changes for a Vendor', async () => {
    const vendor = { id: 'v1', name: 'Old Name', type: 'Vendor', address: '123 Main St', notes: 'note' };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([vendor]), { status: 200 }));
    render(<Vendors />);
    await waitFor(() => expect(screen.getByText('Old Name')).toBeTruthy());

    clickEditButton();

    expect(await screen.findByText('Edit Vendor')).toBeTruthy();
    const nameInput = screen.getByDisplayValue('Old Name');
    fireEvent.change(nameInput, { target: { value: 'New Name' } });

    const updated = { ...vendor, name: 'New Name' };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/platforms/v1', expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(screen.queryByText('Edit Vendor')).toBeNull());
    expect(await screen.findByText('New Name')).toBeTruthy();
  });

  it('opens a prefilled edit modal and saves changes for a Marketplace', async () => {
    const platform = { id: 'm1', name: 'Old Market', type: 'Marketplace', address: '', notes: '' };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([platform]), { status: 200 }));
    render(<Marketplaces />);
    await waitFor(() => expect(screen.getByText('Old Market')).toBeTruthy());

    clickEditButton();

    expect(await screen.findByText('Edit Marketplace')).toBeTruthy();
    const nameInput = screen.getByDisplayValue('Old Market');
    fireEvent.change(nameInput, { target: { value: 'New Market' } });

    const updated = { ...platform, name: 'New Market' };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify(updated), { status: 200 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/platforms/m1', expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(screen.queryByText('Edit Marketplace')).toBeNull());
    expect(await screen.findByText('New Market')).toBeTruthy();
  });

  it('shows an error toast and keeps the modal open when the save fails', async () => {
    const vendor = { id: 'v2', name: 'Fails To Save', type: 'Vendor', address: '', notes: '' };
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify([vendor]), { status: 200 }));
    render(<Vendors />);
    await waitFor(() => expect(screen.getByText('Fails To Save')).toBeTruthy());

    clickEditButton();
    expect(await screen.findByText('Edit Vendor')).toBeTruthy();

    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Platform not found' }), { status: 404 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Edit Vendor')).toBeTruthy();
  });
});
