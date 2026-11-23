import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Automation from './Automation';

const mocks = vi.hoisted(() => ({ query: {}, calls: [], confirm: vi.fn(), reject: vi.fn(), success: vi.fn(), error: vi.fn(), toConfirm: 0 }));
vi.mock('../hooks/useApi', () => ({
  useActivity: (group, source, review) => { mocks.calls.push([group, source, review]); return mocks.query; },
  useAutomationReview: () => ({ data: { to_confirm: mocks.toConfirm } }),
  useAutomationReviewMutations: () => ({ confirm: { mutateAsync: mocks.confirm }, reject: { mutateAsync: mocks.reject } }),
  useEmailAutomation: () => ({ data: { linkMatches: true, updateShipping: true, cashoutPayouts: true, returnReminders: true, createPurchases: false, cancellations: false } }),
  useEmailAccounts: () => ({ data: [{ id: 'a1', status: 'active', last_synced_at: new Date(Date.now() - 5 * 60000).toISOString() }] }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const now = new Date().toISOString();
const page = (entries) => ({ pages: [{ entries, next_before: null }] });
const setQuery = (over) => {
  mocks.query = { data: undefined, isLoading: false, isError: false, refetch: vi.fn(), hasNextPage: false, fetchNextPage: vi.fn(), ...over };
};
const show = () => render(<MemoryRouter><Automation /></MemoryRouter>);

const paid = { id: 'p1', kind: 'change', record_type: 'sale', source: 'email', undo_state: 'available', review_state: null, created_at: now, detail: {
  action: 'edit', product_name: 'Samsung SSD 990 EVO Plus 1TB',
  rows: [{ model: 'sales', op: 'update', fields: { paid_amount: { before: null, after: '483' }, payout_account: { before: null, after: 'Points4Days balance' }, paid_reference: { before: null, after: 'Points4Days receipt 211338' }, workflow_status: { before: 'WAITING_FOR_PAYMENT', after: 'PAID' } } }],
} };
const details = { id: 'd1', kind: 'change', record_type: 'sale', source: 'email', undo_state: 'available', review_state: null, created_at: now, detail: {
  action: 'edit', product_name: 'Samsung SSD 990 EVO Plus 1TB',
  rows: [{ model: 'sales', op: 'update', fields: { notes: { before: null, after: 'Serials (Points4Days receipt 211338): S7U5A, S7U5B, S7U5C' }, tracking_number: { before: null, after: 'TBA336613941521' } } }],
} };
const link = { id: 'l1', kind: 'event', record_type: 'email_link', source: 'email', undo_state: 'not_undoable', review_state: null, created_at: now,
  detail: { action: 'link', product_name: 'Macbook Neo', store: 'Apple', order_number: 'W1658026658', order_type: 'purchase', linked_to: 'purchase', count: 1 } };
const tracking = { id: 't1', kind: 'status', record_type: 'purchase', source: 'email', undo_state: 'available', review_state: null, created_at: now,
  detail: { action: 'add_tracking', from: 'PURCHASED', to: 'INBOUND', product_name: 'Macbook Neo', fields: { tracking_number: { before: null, after: '1ZR448W91314993158' } } } };
const sorted = { id: 's1', kind: 'event', record_type: 'email_sort', record_id: 'o9', source: 'email', undo_state: 'not_undoable', review_state: null, created_at: now,
  detail: { action: 'personal', product_name: 'Amazon order 113-1', reason: 'Ships to SACRAMENTO, CA', total: '24.99', items: ['Pet Supplies'] } };

beforeEach(() => { mocks.calls = []; mocks.toConfirm = 0; setQuery({ data: page([]) }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Automation page', () => {
  it('opens on To confirm, says what runs on its own, and explains itself when empty', () => {
    show();
    expect(mocks.calls.at(-1)).toEqual([undefined, 'email', 'open']);
    expect(screen.getByRole('heading', { name: 'Email automation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'To confirm' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Nothing to confirm')).toBeInTheDocument();
    const running = screen.getByRole('region', { name: /Runs on its own/ });
    expect(within(running).getByText('Mark cash-out sales paid from receipts').nextSibling).toHaveTextContent('On');
    expect(within(running).getByText('Add likely resale orders as purchases').nextSibling).toHaveTextContent('Off');
    expect(within(running).getByText('Email checked 5 min ago')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(mocks.calls.at(-1)).toEqual([undefined, 'email', 'done']);
    expect(screen.getByText('Nothing completed yet')).toBeInTheDocument();
  });

  it('says each change in plain words, filters by kind, and confirms one or all shown', async () => {
    mocks.toConfirm = 4;
    mocks.confirm.mockResolvedValue({ confirmed: 1 });
    setQuery({ data: page([paid, details, link, tracking]) });
    show();
    expect(screen.getByRole('tab', { name: /To confirm/ })).toHaveTextContent('4');
    expect(screen.getByText('Marked paid')).toBeInTheDocument();
    expect(screen.getByText('$483.00')).toBeInTheDocument();
    expect(screen.getByText('To Points4Days balance')).toBeInTheDocument();
    expect(screen.getByText('3 serials')).toBeInTheDocument();
    expect(screen.getByText('Added tracking')).toBeInTheDocument();
    expect(screen.getByText('Linked an Apple order to your purchase')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm: Marked paid, Samsung SSD 990 EVO Plus 1TB' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(['p1']));

    fireEvent.click(screen.getByRole('button', { name: /Payments/ }));
    expect(screen.queryByText('Filled in details')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All/ }));
    mocks.confirm.mockResolvedValue({ confirmed: 4 });
    fireEvent.click(screen.getByRole('button', { name: /Confirm all 4 shown/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenLastCalledWith(['p1', 'd1', 'l1', 't1']));
    expect(mocks.success).toHaveBeenCalledWith("Confirmed 4. They're in Completed.");
  });

  it('"No" asks first and takes the change back; a set-aside order says it is business', async () => {
    mocks.reject.mockResolvedValue({ rejected: true });
    setQuery({ data: page([link, sorted]) });
    show();
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /No, take back: Linked an Apple order/ }));
    expect(mocks.reject).not.toHaveBeenCalled();
    expect(ask.mock.calls[0][0]).toMatch(/Unlink this order/);
    fireEvent.click(screen.getByRole('button', { name: /No, take back: Linked an Apple order/ }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith('l1'));
    expect(mocks.success).toHaveBeenCalledWith('Taken back.');

    expect(screen.getByText("No, it's business")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /No, take back: Set aside as personal/ }));
    await waitFor(() => expect(mocks.reject).toHaveBeenCalledWith('s1'));
    expect(mocks.success).toHaveBeenCalledWith('Brought back as business.');
    ask.mockRestore();
  });

  it('Details shows each field before and after, with Confirm and No right there', async () => {
    mocks.confirm.mockResolvedValue({ confirmed: 1 });
    setQuery({ data: page([details, paid]) });
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Details: Filled in details, Samsung SSD 990 EVO Plus 1TB' }));
    const dialog = screen.getByRole('dialog', { name: 'Filled in details' });
    expect(within(dialog).getByText('Tracking')).toBeInTheDocument();
    expect(within(dialog).getByText('(was —, now TBA336613941521)')).toBeInTheDocument();
    expect(within(dialog).getByText('Notes')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/S7U5A, S7U5B, S7U5C/).length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledWith(['d1']));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Details: Marked paid, Samsung SSD 990 EVO Plus 1TB' }));
    const paidDialog = screen.getByRole('dialog', { name: 'Marked paid' });
    expect(within(paidDialog).getByText('Paid to')).toBeInTheDocument();
    expect(within(paidDialog).getByText('(was Waiting for payment, now Paid)')).toBeInTheDocument();
    fireEvent.click(within(paidDialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows what happened to completed ones, without Confirm or No', () => {
    setQuery({ data: page([{ ...paid, review_state: 'confirmed' }, { ...tracking, review_state: 'rejected', undo_state: 'undone', undone_at: now }]) });
    show();
    fireEvent.click(screen.getByRole('tab', { name: 'Completed' }));
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(screen.getByText('You said no')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Confirm:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^No, take back/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Details:/ })).toHaveLength(2);
  });
});
