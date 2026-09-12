import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlatformEditModal from './PlatformEditModal';
import { Vendors } from './Vendors';
import { Marketplaces } from './Marketplaces';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), all: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch, useInvalidate: () => ({ all: mocks.all }) }));
const platform = { id: 'platform-id', name: 'Original', type: 'Marketplace', fee_pct: 12, address: 'Old address', notes: 'Old notes', tax_exempt_place: true };
const ok = value => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);
const setup = (record = platform) => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(<PlatformEditModal platform={record} onClose={onClose} onSave={onSave} />);
  return { onClose, onSave };
};

describe('platform edit flow', () => {
  it('loads values and saves cleared optional fields without changing type or tax settings', async () => {
    mocks.apiFetch.mockResolvedValue(ok({ ...platform, address: null, notes: null }));
    const handlers = setup();
    expect(screen.getByLabelText('Name').value).toBe('Original');
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledOnce());
    const body = JSON.parse(mocks.apiFetch.mock.calls[0][1].body);
    expect(body).toEqual({ name: 'Original', address: '', notes: '', fee_pct: 12 });
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
  it.each(['Cancel', 'Close edit form', 'Escape'])('cancels via %s without saving', action => {
    const handlers = setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });
    if (action === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
    else fireEvent.click(action === 'Cancel' ? screen.getByText(action) : screen.getByLabelText(action));
    expect(handlers.onClose).toHaveBeenCalledOnce();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
  it.each(['', '-1', '101'])('rejects invalid fee %s before requests', value => {
    setup();
    fireEvent.change(screen.getByLabelText('Fee percentage'), { target: { value } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(screen.getByRole('alert').textContent).toContain('0 to 100');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
  it('rejects a whitespace-only name', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  ' } });
    fireEvent.click(screen.getByText('Save Changes'));
    expect(screen.getByRole('alert').textContent).toContain('name');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });
  it('retains the draft after failure and retries the same record', async () => {
    mocks.apiFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Access denied' }), { status: 404 }));
    mocks.apiFetch.mockResolvedValueOnce(ok({ ...platform, name: 'New name' }));
    const handlers = setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New name' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Access denied'));
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(handlers.onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name').value).toBe('New name');
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls.map(call => call[0])).toEqual(['/api/platforms/platform-id', '/api/platforms/platform-id']);
  });
  it('prevents duplicate requests and dismissal while saving', async () => {
    let resolve;
    mocks.apiFetch.mockReturnValue(new Promise(done => { resolve = done; }));
    const handlers = setup();
    const form = screen.getByRole('dialog');
    fireEvent.submit(form);
    fireEvent.submit(form);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(mocks.apiFetch).toHaveBeenCalledOnce();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Cancel').disabled).toBe(true);
    await act(async () => resolve(ok(platform)));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });
  it('preserves vendor fees by omitting them', async () => {
    const vendor = { ...platform, type: 'Vendor' };
    mocks.apiFetch.mockResolvedValue(ok(vendor));
    const handlers = setup(vendor);
    expect(screen.queryByLabelText('Fee percentage')).toBeNull();
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(handlers.onSave).toHaveBeenCalled());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).not.toHaveProperty('fee_pct');
  });
  it.each([[Vendors, 'Vendor'], [Marketplaces, 'Marketplace']])('connects the pencil to editing and refreshes affected queries: %s', async (Component, type) => {
    const record = { ...platform, type };
    mocks.apiFetch.mockResolvedValueOnce(ok([record]));
    mocks.apiFetch.mockResolvedValueOnce(ok({ ...record, name: 'Updated' }));
    render(<Component />);
    fireEvent.click(await screen.findByLabelText('Edit Original'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Updated' } });
    fireEvent.click(screen.getByText('Save Changes'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(mocks.all).toHaveBeenCalledOnce();
  });
});
