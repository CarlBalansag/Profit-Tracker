import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Vendors } from './Vendors';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ platforms: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const vendor = { id: 'v1', name: 'Home Depot', type: 'Vendor', address: '', notes: '', default_return_days: 90 };
const json = (body) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.apiFetch.mockImplementation(async (url, options) => (options?.method === 'PUT' ? json({ ...vendor, default_return_days: 30 }) : json([vendor])));
});
afterEach(cleanup);

describe('Vendors: return window', () => {
  it('shows the saved window and saves an edit', async () => {
    const { container } = render(<Vendors />);
    expect(await screen.findByText('90-day returns')).toBeInTheDocument();
    fireEvent.click(container.querySelector('.lucide-pen, .lucide-pencil, .lucide-edit-2, .lucide-square-pen').closest('button'));
    const input = screen.getByLabelText('Return window (days, optional)');
    expect(input.value).toBe('90');
    fireEvent.change(input, { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/platforms/v1', expect.objectContaining({ method: 'PUT' })));
    const [, options] = mocks.apiFetch.mock.calls.find(([url, o]) => url === '/api/platforms/v1' && o?.method === 'PUT');
    expect(JSON.parse(options.body).default_return_days).toBe('30');
    expect(await screen.findByText('30-day returns')).toBeInTheDocument();
  });
});
