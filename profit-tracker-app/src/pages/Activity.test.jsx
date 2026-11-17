import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Activity from './Activity';

const mocks = vi.hoisted(() => ({ query: {}, apiFetch: vi.fn(), invalidateAll: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useActivity: () => mocks.query,
  useInvalidate: () => ({ all: mocks.invalidateAll }),
  apiFetch: mocks.apiFetch,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const now = new Date();
const entry = (over) => ({
  id: 'e1', kind: 'status', record_type: 'sale', record_id: 's1', source: 'web', undo_state: 'available',
  created_at: now.toISOString(),
  detail: { action: 'cancel_sale', from: 'PAID', to: 'CANCELLED', product_name: 'Meta Quest 3S', stock: { delta: 2 } },
  ...over,
});
const page = (entries, next_before = null) => ({ pages: [{ entries, next_before }] });
const setQuery = (over) => {
  mocks.query = { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn(), ...over };
};

beforeEach(() => setQuery({ data: page([entry()]) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Activity page', () => {
  it('lists an action under Today with what it did', () => {
    render(<Activity />);
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('Cancel Sale')).toBeInTheDocument();
    expect(within(today).getByText('Meta Quest 3S')).toBeInTheDocument();
    expect(within(today).getByText('Paid → Cancelled · 2 units back in stock')).toBeInTheDocument();
  });

  it('undoes an entry through the server and refreshes everything', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ undone: {}, entry: {} })));
    render(<Activity />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo Cancel Sale, Meta Quest 3S' }));
    await waitFor(() => expect(mocks.success).toHaveBeenCalledWith('Undone.'));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/activity/e1/undo', { method: 'POST' });
    expect(mocks.invalidateAll).toHaveBeenCalledOnce();
  });

  it("shows the server's reason when an undo is refused", async () => {
    const reason = "This sale changed after this action, so it can't be undone safely.";
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: reason }), { status: 409 }));
    render(<Activity />);
    fireEvent.click(screen.getByRole('button', { name: /^Undo / }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(`Could not undo: ${reason}`));
    expect(mocks.invalidateAll).not.toHaveBeenCalled();
  });

  it('shows Undone and too-old entries without an Undo button', () => {
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000).toISOString();
    setQuery({ data: page([entry({ id: 'a', undo_state: 'undone' }), entry({ id: 'b', undo_state: 'expired', created_at: old })]) });
    render(<Activity />);
    expect(screen.queryByRole('button', { name: /^Undo / })).toBeNull();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    expect(screen.getByText('Older than 30 days')).toBeInTheDocument();
  });

  it('labels actions the AI assistant took', () => {
    setQuery({ data: page([entry({ source: 'assistant' })]) });
    render(<Activity />);
    expect(screen.getByText('AI assistant')).toBeInTheDocument();
  });

  it('loads older entries on request', () => {
    const fetchNextPage = vi.fn();
    setQuery({ data: page([entry()], 'cursor'), hasNextPage: true, fetchNextPage });
    render(<Activity />);
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('explains the empty state, and shows a retry when loading failed', () => {
    setQuery({ data: page([]) });
    const { unmount } = render(<Activity />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
    unmount();
    setQuery({ isError: true });
    render(<Activity />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your activity");
  });
});
