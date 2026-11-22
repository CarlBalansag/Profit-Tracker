import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Automation from './Automation';

const mocks = vi.hoisted(() => ({ query: {}, calls: [], apiFetch: vi.fn(), invalidateAll: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../hooks/useApi', () => ({
  useActivity: (group, source) => { mocks.calls.push([group, source]); return mocks.query; },
  useInvalidate: () => ({ all: mocks.invalidateAll }),
  useEmailAutomation: () => ({ data: { linkMatches: true, updateShipping: true, cashoutPayouts: true, returnReminders: true, createPurchases: false, cancellations: false } }),
  useEmailAccounts: () => ({ data: [{ id: 'a1', status: 'active', last_synced_at: new Date(Date.now() - 5 * 60000).toISOString() }] }),
  apiFetch: mocks.apiFetch,
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const now = new Date().toISOString();
const page = (entries) => ({ pages: [{ entries, next_before: null }] });
const setQuery = (over) => {
  mocks.query = { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn(), ...over };
};
const show = () => render(<MemoryRouter><Automation /></MemoryRouter>);

const paid = { id: 'p1', kind: 'change', record_type: 'sale', source: 'email', undo_state: 'available', created_at: now, detail: {
  action: 'edit', product_name: 'Samsung SSD 990 EVO Plus 1TB',
  rows: [{ model: 'sales', op: 'update', fields: { paid_amount: { before: null, after: '483' }, payout_account: { before: null, after: 'Points4Days balance' }, paid_reference: { before: null, after: 'Points4Days receipt 211338' }, workflow_status: { before: 'WAITING_FOR_PAYMENT', after: 'PAID' } } }],
} };
const details = { id: 'd1', kind: 'change', record_type: 'sale', source: 'email', undo_state: 'undone', created_at: now, detail: {
  action: 'edit', product_name: 'Samsung SSD 990 EVO Plus 1TB',
  rows: [{ model: 'sales', op: 'update', fields: { notes: { before: null, after: 'Serials (Points4Days receipt 211338): S7U5A, S7U5B, S7U5C' }, tracking_number: { before: null, after: 'TBA336613941521' } } }],
} };
const link = { id: 'l1', kind: 'event', record_type: 'email_link', source: 'email', undo_state: 'not_undoable', created_at: now,
  detail: { action: 'link', product_name: 'Macbook Neo', store: 'Apple', order_number: 'W1658026658', order_type: 'purchase', linked_to: 'purchase', count: 1 } };
const tracking = { id: 't1', kind: 'status', record_type: 'purchase', source: 'email', undo_state: 'available', created_at: now,
  detail: { action: 'add_tracking', from: 'PURCHASED', to: 'INBOUND', product_name: 'Macbook Neo', fields: { tracking_number: { before: null, after: '1ZR448W91314993158' } } } };

beforeEach(() => { mocks.calls = []; setQuery({ data: page([]) }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Automation page', () => {
  it('lists only what the email sync changed, says what runs on its own, and explains itself when empty', () => {
    show();
    expect(mocks.calls.at(-1)).toEqual([undefined, 'email']);
    expect(screen.getByRole('heading', { name: 'Email automation' })).toBeInTheDocument();
    expect(screen.getByText('Nothing changed on its own yet')).toBeInTheDocument();
    const running = screen.getByRole('region', { name: /Runs on its own/ });
    expect(within(running).getByText('Mark cash-out sales paid from receipts').nextSibling).toHaveTextContent('On');
    expect(within(running).getByText('Create purchases from order emails').nextSibling).toHaveTextContent('Off');
    expect(within(running).getByText('Email checked 5 min ago')).toBeInTheDocument();
  });

  it('says each change in plain words, filters by kind, shows serials on request, and undoes one', async () => {
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    setQuery({ data: page([paid, details, link, tracking]) });
    show();
    expect(screen.getByText('Marked paid')).toBeInTheDocument();
    expect(screen.getByText('$483.00')).toBeInTheDocument();
    expect(screen.getByText('To Points4Days balance')).toBeInTheDocument();
    expect(screen.getByText('Filled in details')).toBeInTheDocument();
    expect(screen.getByText('3 serials')).toBeInTheDocument();
    expect(screen.getByText('Added tracking')).toBeInTheDocument();
    expect(screen.getByText('Linked an Apple order to your purchase')).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Show serials/ }));
    expect(screen.getByText('From Points4Days receipt 211338: S7U5A, S7U5B, S7U5C')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Payments/ }));
    expect(screen.queryByText('Filled in details')).not.toBeInTheDocument();
    expect(screen.getByText('Marked paid')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Undo Marked paid, Samsung SSD 990 EVO Plus 1TB' }));
    await waitFor(() => expect(mocks.invalidateAll).toHaveBeenCalled());
    expect(mocks.success).toHaveBeenCalledWith('Undone.');
  });
});
