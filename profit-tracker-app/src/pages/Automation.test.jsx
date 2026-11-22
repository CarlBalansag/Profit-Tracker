import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Automation from './Automation';

const mocks = vi.hoisted(() => ({ query: {}, calls: [], apiFetch: vi.fn(), invalidateAll: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useActivity: (group, source) => { mocks.calls.push([group, source]); return mocks.query; },
  useInvalidate: () => ({ all: mocks.invalidateAll }),
  apiFetch: mocks.apiFetch,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const now = new Date().toISOString();
const page = (entries) => ({ pages: [{ entries, next_before: null }] });
const setQuery = (over) => {
  mocks.query = { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn(), ...over };
};
const show = () => render(<MemoryRouter><Automation /></MemoryRouter>);

beforeEach(() => { mocks.calls = []; setQuery({ data: page([]) }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Automation page', () => {
  it('lists only what the email sync changed, and explains itself when empty', () => {
    show();
    expect(mocks.calls.at(-1)).toEqual([undefined, 'email']);
    expect(screen.getByRole('heading', { name: 'Automation' })).toBeInTheDocument();
    expect(screen.getByText(/links an order, adds tracking, marks a sale paid/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Automatic actions/ })).toHaveAttribute('href', '/settings');
  });

  it('shows automatic links and changes, and undoes one', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    setQuery({ data: page([
      { id: 'l1', kind: 'event', record_type: 'email_link', source: 'email', undo_state: 'not_undoable', created_at: now,
        detail: { action: 'link', product_name: 'Samsung SSD 990 EVO Plus 1TB', store: 'Points4Days', order_number: '211338', order_type: 'sale', linked_to: 'sale', count: 1 } },
      { id: 'c1', kind: 'event', record_type: 'email_link', source: 'email', undo_state: 'not_undoable', created_at: now,
        detail: { action: 'link', product_name: 'Widget, Gadget', store: 'Points4Days', order_number: 'CHECK 77', order_type: 'check', linked_to: 'sale', count: 2 } },
      { id: 'p1', kind: 'change', record_type: 'sale', source: 'email', undo_state: 'available', created_at: now,
        detail: { action: 'edit', product_name: 'Samsung SSD 990 EVO Plus 1TB', rows: [] } },
    ]) });
    show();
    expect(screen.getByText('Linked a Points4Days email to your sale')).toBeInTheDocument();
    expect(screen.getByText('#211338')).toBeInTheDocument();
    expect(screen.getByText('Linked a Points4Days check to your 2 sales')).toBeInTheDocument();
    expect(screen.getByText('Check #77')).toBeInTheDocument();
    expect(screen.getAllByText('From email')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /^Undo / }));
    await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith('Undone.');
  });
});
