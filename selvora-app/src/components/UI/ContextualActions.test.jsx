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

const openMore = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

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

  it('puts the secondary descriptors behind a More menu', () => {
    renderActions(sale, 'sale');
    expect(screen.queryByRole('menuitem')).toBeNull();
    openMore();
    const items = screen.getAllByRole('menuitem').map((node) => node.textContent);
    expect(items).toEqual([
      'Void Mistaken Sale', 'Cancel Sale', 'Report Return…', 'Report Dispute', 'Correct Workflow Step…',
    ]);
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

  it('abandons a destructive action when the confirmation is dismissed', async () => {
    renderActions(sale, 'sale');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void Mistaken Sale' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 units will be restored to inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('singularises the restored-unit consequence for a one-unit sale', async () => {
    renderActions({ ...sale, quantity: 1 }, 'sale');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Sale' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('1 unit will be restored');
  });

  // A requiresForm action whose transition keeps no payload (report_return only
  // stamps return_requested_at) must show the consequence, not an empty form.
  it('confirms rather than showing an empty form when the server keeps no payload', async () => {
    renderActions(sale, 'sale');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report Return…' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('No units go back on hand yet');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
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

  it('offers a sale only the workflow steps its own workflow allows as corrections', async () => {
    renderActions({ ...sale, workflow_type: 'DIRECT_LOCAL' }, 'sale');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Correct Workflow Step…' }));

    await screen.findByRole('dialog', { name: 'Correct Workflow Step' });
    const options = Array.from(screen.getByLabelText('Workflow step').options).map((o) => o.value);
    expect(options).toEqual([
      '', 'AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID',
      'CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED',
    ]);
  });

  it('shows the consequence inside the form for a destructive form action, with no second confirmation', async () => {
    const onHand = { id: 'inv1', receiving_status: 'ON_HAND', qty_purchased: 5, qty_on_hand: 3, allowed_actions: ON_HAND_ACTIONS };
    renderActions(onHand, 'inventory');
    openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adjust Quantity On Hand…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Adjust Quantity On Hand' });
    expect(dialog.textContent).toContain('overrides the quantity on hand');
    // Saving the form is the confirmation -- it goes straight to the API.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ qty_on_hand: 3 });
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
