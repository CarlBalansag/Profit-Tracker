import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import ContextualActions from './ContextualActions';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ inventory: mocks.invalidate, sales: mocks.invalidate, dashboard: mocks.invalidate }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const act = (action, label, flags = {}) =>
  ({ action, label, requiresForm: false, destructive: false, secondary: false, ...flags });

// The descriptor sets below are exactly what statusTransitions.allowedActions
// returns for these states, so the component is tested against the real shapes.
const PRE_ORDER_ACTIONS = [
  act('mark_purchased', 'Mark Purchased'),
  act('add_tracking', 'Add Tracking', { requiresForm: true }),
  act('cancel', 'Cancel', { destructive: true }),
  act('correct_status', 'Correct Receiving Step', { requiresForm: true, secondary: true }),
];

const WAITING_FOR_PAYMENT_ACTIONS = [
  act('mark_paid', 'Mark Paid', { requiresForm: true }),
  act('void_sale', 'Void Mistaken Sale', { destructive: true, secondary: true }),
  act('cancel_sale', 'Cancel Sale', { destructive: true, secondary: true }),
  act('report_return', 'Report Return', { requiresForm: true, destructive: true, secondary: true }),
  act('report_dispute', 'Report Dispute', { destructive: true, secondary: true }),
  act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true }),
];

const ON_HAND_ACTIONS = [
  act('list_item', 'List Item'),
  act('record_sale', 'Record Sale', { requiresForm: true }),
  act('restore_inventory', 'Adjust Quantity On Hand', { requiresForm: true, destructive: true, secondary: true }),
  act('correct_status', 'Correct Receiving Step', { requiresForm: true, secondary: true }),
];

const purchase = { id: 'inv1', receiving_status: 'PRE_ORDER', qty_purchased: 5, qty_on_hand: 5, allowed_actions: PRE_ORDER_ACTIONS };
const sale = {
  id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT', workflow_type: 'STANDARD_MARKETPLACE',
  quantity: 2, unit_price: 150, commission_fee: 15, sale_shipping: 5, allowed_actions: WAITING_FOR_PAYMENT_ACTIONS,
};

const renderActions = (record, kind) => render(
  <MemoryRouter><ContextualActions record={record} kind={kind} /></MemoryRouter>
);

// Block body on purpose: an arrow that *returns* the mock would hand Vitest the
// mock function as a per-test teardown callback, which it then invokes -- leaving
// a stray zero-argument apiFetch call recorded against the next test.
beforeEach(() => { mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'inv1', allowed_actions: [] }))); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ContextualActions', () => {
  it('renders only the non-secondary descriptors as buttons', () => {
    renderActions(purchase, 'inventory');
    expect(screen.getByRole('button', { name: 'Mark Purchased' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Tracking…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Correct Receiving Step/ })).toBeNull();
  });

  it('fires a plain action straight away', async () => {
    renderActions(purchase, 'inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Purchased' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/inventory/inv1/actions/mark_purchased');
  });

  it('shows no action row at all when the record allows nothing', () => {
    renderActions({ id: 'x', allowed_actions: [] }, 'sale');
    expect(screen.getByText('No action needed')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  // ─── Destructive actions ────────────────────────────────────────────────────
  it('does not fire a destructive action until its consequence is confirmed', async () => {
    renderActions(purchase, 'inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    // A concrete consequence, not "Are you sure?".
    expect(dialog.textContent).toContain('drops out of the active receiving queues');
    expect(dialog.textContent).not.toMatch(/are you sure/i);
    // The dismiss button must not also read "Cancel" here -- the action's own
    // label is "Cancel", so the dialog uses "Go back" for backing out.
    expect(screen.getByRole('button', { name: 'Go back' })).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/inventory/inv1/actions/cancel');
  });

  // ─── Form actions ───────────────────────────────────────────────────────────
  it('does not fire a form action until the form is submitted', async () => {
    renderActions(purchase, 'inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Add Tracking…' }));

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    await screen.findByRole('dialog', { name: 'Add Tracking' });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/add_tracking');
    expect(JSON.parse(options.body)).toEqual({ tracking_number: '1Z999' });
  });

  // ─── Mark Paid ──────────────────────────────────────────────────────────────
  it('never renders a bare one-click Mark Paid button', () => {
    renderActions(sale, 'sale');
    expect(screen.queryByRole('button', { name: 'Mark Paid' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mark Paid…' })).toBeTruthy();
  });

  it('only ever opens the Mark Paid modal, never firing mark_paid directly', async () => {
    renderActions(sale, 'sale');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Paid…' }));

    await screen.findByRole('dialog', { name: 'Mark Paid' });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Payment date')).toBeTruthy();
    // No generic Save: this is the dedicated modal.
    expect(screen.getByRole('button', { name: 'Record Payment' })).toBeTruthy();
  });

  it('submits the Mark Paid form through the action endpoint', async () => {
    renderActions(sale, 'sale');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Paid…' }));
    await screen.findByRole('dialog', { name: 'Mark Paid' });

    fireEvent.change(screen.getByLabelText('Payment date'), { target: { value: '2026-10-02' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record Payment' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/mark_paid');
    // 2 x 150 - 15 - 5 = 280, prefilled from the sale's own figures.
    expect(JSON.parse(options.body)).toEqual({ paid_date: '2026-10-02', amount: '280.00', reference: null });
  });

  // ─── Record Sale ────────────────────────────────────────────────────────────
  // record_sale is an allowed action with no transition of its own, so it links
  // to the Record Sale page instead of POSTing to the action endpoint.
  it('links Record Sale to the Record Sale page instead of posting it', () => {
    const onHand = { id: 'inv1', receiving_status: 'ON_HAND', qty_purchased: 5, qty_on_hand: 3, allowed_actions: ON_HAND_ACTIONS };
    renderActions(onHand, 'inventory');
    const link = screen.getByRole('link', { name: 'Record Sale' });
    expect(link.getAttribute('href')).toBe('/add-sale');
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  // ─── Records with no status yet ──────────────────────────────────────────────
  // allowedActions' default branch (no recognized status) now returns one
  // primary `correct_status` descriptor flagged `initial`, so these rows can be
  // given a first status instead of being stranded with nothing to click.
  const SET_RECEIVING_STATUS = [act('correct_status', 'Set Receiving Status', { requiresForm: true, initial: true })];
  const SET_SALE_STATUS = [act('correct_status', 'Set Sale Status', { requiresForm: true, initial: true })];

  const unresolvedPurchase = { id: 'inv1', receiving_status: null, qty_purchased: 5, qty_on_hand: 5, allowed_actions: SET_RECEIVING_STATUS };
  const unresolvedSale = { id: 'sale1', workflow_status: null, workflow_type: null, quantity: 2, allowed_actions: SET_SALE_STATUS };

  it('renders Set Status as a visible button, never hidden in the More menu', () => {
    renderActions(unresolvedPurchase, 'inventory');
    expect(screen.getByRole('button', { name: 'Set Receiving Status…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByText('No action needed')).toBeNull();

    cleanup();
    renderActions(unresolvedSale, 'sale');
    expect(screen.getByRole('button', { name: 'Set Sale Status…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('sets a receiving status on a purchase that has none', async () => {
    renderActions(unresolvedPurchase, 'inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Set Receiving Status…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Set Receiving Status' });
    // The framing asks where the purchase is, not what to correct it from.
    expect(dialog.textContent).not.toMatch(/correct/i);
    const select = screen.getByLabelText('Where is this purchase now?');
    expect(Array.from(select.options).map((o) => o.value))
      .toEqual(['', 'PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND']);
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.change(select, { target: { value: 'ON_HAND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ receiving_status: 'ON_HAND' });
  });

  it('asks a statusless sale for its workflow type and status, and sends both', async () => {
    renderActions(unresolvedSale, 'sale');
    fireEvent.click(screen.getByRole('button', { name: 'Set Sale Status…' }));
    await screen.findByRole('dialog', { name: 'Set Sale Status' });

    const kindSelect = screen.getByLabelText('What kind of sale was this?');
    expect(Array.from(kindSelect.options).map((o) => o.value))
      .toEqual(['', 'STANDARD_MARKETPLACE', 'AUTH_MARKETPLACE', 'CASHOUT', 'DIRECT_LOCAL']);
    // Readable labels, not the stored constants.
    expect(Array.from(kindSelect.options).map((o) => o.textContent)).toContain('Cash-out / instant payout');

    // The status list is empty until the kind of sale is chosen -- it is what
    // decides which statuses even exist.
    const statusSelect = screen.getByLabelText('Where is it now?');
    expect(Array.from(statusSelect.options).map((o) => o.value)).toEqual(['']);

    fireEvent.change(kindSelect, { target: { value: 'CASHOUT' } });
    expect(Array.from(statusSelect.options).map((o) => o.value)).toEqual([
      '', 'AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN',
      'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID',
      'CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED',
    ]);
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);

    fireEvent.change(statusSelect, { target: { value: 'SCANNED_IN' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ workflow_type: 'CASHOUT', workflow_status: 'SCANNED_IN' });
  });

  // A status picked for one workflow must not survive a change of workflow --
  // the server would reject the pair, and silently sending it would be worse.
  it('clears a chosen status when the kind of sale changes under it', async () => {
    renderActions(unresolvedSale, 'sale');
    fireEvent.click(screen.getByRole('button', { name: 'Set Sale Status…' }));
    await screen.findByRole('dialog', { name: 'Set Sale Status' });

    fireEvent.change(screen.getByLabelText('What kind of sale was this?'), { target: { value: 'CASHOUT' } });
    fireEvent.change(screen.getByLabelText('Where is it now?'), { target: { value: 'SCANNED_IN' } });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('What kind of sale was this?'), { target: { value: 'DIRECT_LOCAL' } });
    expect(screen.getByLabelText('Where is it now?').value).toBe('');
    expect(Array.from(screen.getByLabelText('Where is it now?').options).map((o) => o.value))
      .not.toContain('SCANNED_IN');
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('keeps the dialog open when the action fails', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Tracking number is required' }), { status: 400 }));
    renderActions(purchase, 'inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Add Tracking…' }));
    await screen.findByRole('dialog', { name: 'Add Tracking' });

    fireEvent.change(screen.getByLabelText('Tracking number'), { target: { value: '1Z999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Add Tracking failed: Tracking number is required'));
    expect(screen.getByRole('dialog', { name: 'Add Tracking' })).toBeTruthy();
  });
});
