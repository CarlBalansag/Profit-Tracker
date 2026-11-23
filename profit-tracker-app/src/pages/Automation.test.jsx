import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Automation from './Automation';

const mocks = vi.hoisted(() => ({ query: {}, calls: [], confirm: vi.fn(), reject: vi.fn(), name: vi.fn(), success: vi.fn(), error: vi.fn(), toConfirm: 0 }));
vi.mock('../hooks/useApi', () => ({
  useActivity: (group, source, review) => { mocks.calls.push([group, source, review]); return mocks.query; },
  useAutomationReview: () => ({ data: { to_confirm: mocks.toConfirm } }),
  useAutomationReviewMutations: () => ({ confirm: { mutateAsync: mocks.confirm }, reject: { mutateAsync: mocks.reject }, name: { mutateAsync: mocks.name } }),
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

  it('opens the email a change came from, or the store order page, in a new tab', () => {
    const gmail = 'https://mail.google.com/mail/?authuser=me%40gmail.com#search/rfc822msgid%3Aa%40lowes.test';
    const lowes = { ...link, id: 'l2', detail: { ...link.detail, product_name: "Lowe's order 9101", store: "Lowe's" },
      email_source: { store: "Lowe's", order_number: '9101', store_url: null, email: { subject: 'Your order is confirmed', url: gmail },
        emails: [{ subject: 'Your order is confirmed', sent_at: now, url: gmail }, { subject: 'Your order shipped', sent_at: now, url: null }] } };
    const walmart = { ...tracking, id: 't2', email_source: { store: 'Walmart', order_number: '2000123-45678901', store_url: 'https://www.walmart.com/orders/200012345678901', email: { subject: 'Shipped', url: null }, emails: [] } };
    setQuery({ data: page([lowes, walmart, paid]) });
    show();
    expect(screen.getByText('Your order is confirmed')).toBeInTheDocument();
    const open = screen.getByRole('link', { name: /Open the email for Linked a Lowe's order/ });
    expect(open).toHaveAttribute('href', gmail);
    expect(open).toHaveAttribute('target', '_blank');
    expect(open).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('link', { name: /Open the Walmart order page/ })).toHaveAttribute('href', 'https://www.walmart.com/orders/200012345678901');
    // No source known: no button.
    expect(screen.getAllByRole('link', { name: /Open the/ })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /Details: Linked a Lowe's order/ }));
    const dialog = screen.getByRole('dialog');
    const from = within(dialog).getByRole('region', { name: 'From your email' });
    expect(from).toHaveTextContent("From your email · Lowe's 9101");
    expect(within(from).getAllByRole('link')).toHaveLength(1);
    expect(within(from).getByText('Your order shipped')).toBeInTheDocument();
  });

  it('offers names from past purchases for one made with no item name, and names it from Details too', async () => {
    mocks.name.mockResolvedValue({});
    const values = { product_name: 'GameStop order 1101', qty_purchased: 1, qty_on_hand: 1, unit_purchase_cost: '25', sales_tax: '2.19', fees: '0', cashback_earned: '0', gift_card_amount: '0',
      shipping_cost_inbound: '0', receiving_status: 'PURCHASED', status: 'PURCHASED', order_number: '1101', notes: 'Created from an order email', purchase_date: '2026-04-16T15:00:00.000Z' };
    const made = { id: 'c1', kind: 'change', record_type: 'purchase', source: 'email', undo_state: 'available', review_state: null, created_at: now,
      detail: { action: 'create', product_name: 'GameStop order 1101', rows: [{ model: 'inventory', op: 'create', id: 'inv1', row: { values } }] },
      purchase: { id: 'inv1', name: 'GameStop order 1101', placeholder: true, hints: [{ name: 'Topps Chrome Value', times: 3 }, { name: 'Pokemon ETB', times: 1 }] },
      email_source: { store: 'GameStop', order_number: '1101', store_url: null, email: null, emails: [] } };
    const named = { ...made, id: 'c2', purchase: { id: 'inv2', name: 'GameStop Pro', placeholder: false, hints: [] } };
    setQuery({ data: page([made, named]) });
    show();
    expect(screen.getByText(/You've bought these at GameStop for the same price/)).toBeInTheDocument();
    // The one named since shows its new name and no suggestions.
    expect(screen.getByText('GameStop Pro')).toBeInTheDocument();
    expect(screen.getAllByText(/No item name in the email/)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Use “Topps Chrome Value”/ }));
    await waitFor(() => expect(mocks.name).toHaveBeenCalledWith({ id: 'c1', name: 'Topps Chrome Value' }));
    expect(mocks.success).toHaveBeenCalledWith('Named it “Topps Chrome Value”.');

    fireEvent.click(screen.getByRole('button', { name: 'Details: Added a purchase, GameStop order 1101' }));
    const dialog = screen.getByRole('dialog');
    // Each field once, no $0.00 rows, the name and amounts first.
    expect(within(dialog).getAllByText('Status')).toHaveLength(1);
    expect(within(dialog).queryByText('Fees')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Cashback')).not.toBeInTheDocument();
    expect(within(dialog).getAllByRole('term').map((t) => t.textContent).slice(0, 4)).toEqual(['Name', 'Qty bought', 'Unit cost', 'Tax']);
    const form = within(dialog).getByRole('form', { name: 'Name this purchase' });
    expect(within(form).getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(within(form).getByLabelText('Name this purchase'), { target: { value: '  GameStop Pro membership ' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.name).toHaveBeenLastCalledWith({ id: 'c1', name: 'GameStop Pro membership' }));
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
