import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import MoreActionsMenu from './MoreActionsMenu';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), invalidate: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock('../../hooks/useApi', () => ({
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ inventory: mocks.invalidate, sales: mocks.invalidate, dashboard: mocks.invalidate }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));

const act = (action, label, flags = {}) =>
  ({ action, label, requiresForm: false, destructive: false, secondary: false, ...flags });

// Real allowedActions() shapes for states that carry secondary actions, the
// same descriptors ContextualActions.test.jsx exercises for the primary row.
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

const sale = {
  id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT', workflow_type: 'STANDARD_MARKETPLACE',
  quantity: 2, unit_price: 150, commission_fee: 15, sale_shipping: 5, allowed_actions: WAITING_FOR_PAYMENT_ACTIONS,
};

const renderMenu = (record, kind) => render(
  <MemoryRouter><MoreActionsMenu record={record} kind={kind} /></MemoryRouter>
);

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'More actions' }));

// Block body on purpose: see ContextualActions.test.jsx for why an arrow that
// *returns* the mock would leave a stray call recorded against the next test.
beforeEach(() => { mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'sale1', allowed_actions: [] }))); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('MoreActionsMenu', () => {
  it('renders nothing when the record has no secondary actions', () => {
    const { container } = renderMenu({ id: 'x', allowed_actions: [act('mark_purchased', 'Mark Purchased')] }, 'inventory');
    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('keeps the menu closed until the trigger is clicked, then lists every secondary descriptor', () => {
    renderMenu(sale, 'sale');
    expect(screen.queryByRole('menuitem')).toBeNull();

    openMenu();
    const items = screen.getAllByRole('menuitem').map((node) => node.textContent);
    expect(items).toEqual([
      'Void Mistaken Sale', 'Cancel Sale', 'Report Return…', 'Report Dispute', 'Correct Workflow Step…',
    ]);
  });

  it('closes when Escape is pressed', () => {
    renderMenu(sale, 'sale');
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('closes when a click lands outside the menu', () => {
    renderMenu(sale, 'sale');
    openMenu();
    expect(screen.getByRole('menu')).toBeTruthy();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  // ─── Destructive actions ────────────────────────────────────────────────────
  it('abandons a destructive action when the confirmation is dismissed', async () => {
    renderMenu(sale, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void Mistaken Sale' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2 units will be restored to inventory');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('singularises the restored-unit consequence for a one-unit sale', async () => {
    renderMenu({ ...sale, quantity: 1 }, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Sale' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('1 unit will be restored');
  });

  // A requiresForm action whose transition keeps no payload (report_return only
  // stamps return_requested_at) must show the consequence, not an empty form.
  it('confirms rather than showing an empty form when the server keeps no payload', async () => {
    renderMenu(sale, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report Return…' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('No units go back on hand yet');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('fires a plain (non-destructive, non-form) secondary action straight away', async () => {
    const simple = { ...sale, allowed_actions: [act('mark_delivered', 'Mark Delivered', { secondary: true })] };
    renderMenu(simple, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark Delivered' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/sales/sale1/actions/mark_delivered');
  });

  // ─── Form actions ───────────────────────────────────────────────────────────
  it('offers a sale only the workflow steps its own workflow allows as corrections', async () => {
    renderMenu({ ...sale, workflow_type: 'DIRECT_LOCAL' }, 'sale');
    openMenu();
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
    renderMenu(onHand, 'inventory');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adjust Quantity On Hand…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Adjust Quantity On Hand' });
    expect(dialog.textContent).toContain('overrides the quantity on hand');
    // Saving the form is the confirmation -- it goes straight to the API.
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ qty_on_hand: 3 });
  });

  // The already-known-status correction keeps its original single-dropdown form.
  it('leaves the ordinary Correct Workflow Step form unchanged', async () => {
    renderMenu(sale, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Correct Workflow Step…' }));

    await screen.findByRole('dialog', { name: 'Correct Workflow Step' });
    expect(screen.queryByLabelText('What kind of sale was this?')).toBeNull();
    fireEvent.change(screen.getByLabelText('Workflow step'), { target: { value: 'PAID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ workflow_status: 'PAID' });
  });

  it('keeps the dialog open when the action fails', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Something went wrong' }), { status: 400 }));
    renderMenu(sale, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Void Mistaken Sale' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Void Mistaken Sale' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Void Mistaken Sale failed: Something went wrong'));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  // Links (record_sale is the only NAVIGATE_ACTIONS entry, and it is never
  // secondary in practice, but the menu must still render a Link correctly for
  // any action that is) -- covered structurally via the menu-items list test
  // above; this confirms an open menu's Escape/outside-click handlers do not
  // interfere with normal menuitem clicks reaching activate().
  it('does not close before the clicked menuitem is activated', async () => {
    renderMenu(sale, 'sale');
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Cancel Sale' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
