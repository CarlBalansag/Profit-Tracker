import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Statuses from './Statuses';

const mocks = vi.hoisted(() => ({
  inventory: { data: [], isLoading: false },
  sales: { data: [], isLoading: false },
  apiFetch: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock('../hooks/useApi', () => ({
  useInventory: () => mocks.inventory,
  useSales: () => mocks.sales,
  apiFetch: mocks.apiFetch,
  useInvalidate: () => ({ inventory: mocks.invalidate, sales: mocks.invalidate, dashboard: mocks.invalidate }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const act = (action, label, flags = {}) =>
  ({ action, label, requiresForm: false, destructive: false, secondary: false, ...flags });

const purchase = (overrides = {}) => ({
  id: 'inv1', product_name: 'Widget', receiving_status: 'PURCHASED',
  qty_purchased: 5, qty_on_hand: 5, vendor: { name: 'Store' },
  allowed_actions: [act('mark_on_hand', 'Mark On Hand')],
  ...overrides,
});

const saleRecord = (overrides = {}) => ({
  id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT', workflow_type: 'STANDARD_MARKETPLACE',
  quantity: 2, unit_price: 150, inventory: { product_name: 'Widget' }, platform: { name: 'Market' },
  allowed_actions: [act('mark_paid', 'Mark Paid', { requiresForm: true })],
  ...overrides,
});

const setData = ({ inventory = [], sales = [], loading = false }) => {
  mocks.inventory = { data: inventory, isLoading: loading };
  mocks.sales = { data: sales, isLoading: loading };
};

const ui = () => <MemoryRouter><Statuses /></MemoryRouter>;
const renderPage = () => render(ui());

// ─── Board helpers ───────────────────────────────────────────────────────────
// Each column is a labelled region, so every assertion is scoped to one column
// and a card showing up in the wrong one fails rather than passing by accident.
const column = (title) => screen.getByRole('region', { name: title });
const inColumn = (title) => within(column(title));
// Cards carry data-record; the per-column empty state is an <li> too, so role
// alone would count it as a card.
const cardKeys = (title) => Array.from(column(title).querySelectorAll('[data-record]'))
  .map((card) => card.getAttribute('data-record'));
const card = (title, key) => column(title).querySelector(`[data-record="${key}"]`);
// A column's own mini filter strip, named after the column.
const strip = (title) => within(screen.getByRole('group', { name: `${title} status filters` }));
const tile = (title, name) => strip(title).getByRole('button', { name: new RegExp(name) });

beforeEach(() => {
  setData({});
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'x', allowed_actions: [] })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Statuses board', () => {
  it('shows a loading state while either resource is still fetching', () => {
    setData({ loading: true });
    renderPage();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows the page-level empty state and no columns when there is nothing at all', () => {
    renderPage();
    expect(screen.getByText('Nothing to track yet.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Incoming' })).toBeNull();
  });

  it('renders exactly three columns', () => {
    setData({ inventory: [purchase()] });
    renderPage();
    expect(column('Incoming')).toBeTruthy();
    expect(column('On Hand')).toBeTruthy();
    expect(column('Outbound')).toBeTruthy();
  });

  // ─── Left column: Incoming ─────────────────────────────────────────────────
  it('puts a PURCHASED purchase in the Incoming column with its actions', () => {
    setData({ inventory: [purchase()] });
    renderPage();

    expect(cardKeys('Incoming')).toEqual(['inventory-inv1']);
    expect(cardKeys('On Hand')).toEqual([]);
    expect(cardKeys('Outbound')).toEqual([]);
    // Card-scoped: the column's own filter tile carries the status label too.
    const node = card('Incoming', 'inventory-inv1');
    expect(within(node).getByText('Widget')).toBeTruthy();
    expect(within(node).getByText('Store')).toBeTruthy();
    expect(within(node).getByText('Purchased')).toBeTruthy();
    expect(within(node).getByText('5 units')).toBeTruthy();
    expect(within(node).getByRole('button', { name: 'Mark On Hand' })).toBeTruthy();
  });

  it('keeps every not-yet-received receiving status in Incoming', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PRE_ORDER' }),
        purchase({ id: 'inv2', receiving_status: 'PURCHASED' }),
        purchase({ id: 'inv3', receiving_status: 'INBOUND' }),
      ],
    });
    renderPage();
    expect(cardKeys('Incoming')).toEqual(['inventory-inv1', 'inventory-inv2', 'inventory-inv3']);
  });

  // ─── Middle column: On Hand ────────────────────────────────────────────────
  it('puts an ON_HAND purchase with stock left in On Hand, showing the remaining quantity', () => {
    setData({ inventory: [purchase({ receiving_status: 'ON_HAND', qty_on_hand: 3, allowed_actions: [] })] });
    renderPage();

    expect(cardKeys('On Hand')).toEqual(['inventory-inv1']);
    expect(cardKeys('Incoming')).toEqual([]);
    expect(inColumn('On Hand').getByText('3 of 5 on hand')).toBeTruthy();
  });

  it('tags an on-hand purchase as listed or not and offers the listing action', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'ON_HAND', is_listed: true, allowed_actions: [act('unlist', 'Unlist')] }),
        purchase({ id: 'inv2', receiving_status: 'ON_HAND', is_listed: false, allowed_actions: [act('list_item', 'List Item')] }),
      ],
    });
    renderPage();

    expect(within(card('On Hand', 'inventory-inv1')).getByText('Listed')).toBeTruthy();
    expect(within(card('On Hand', 'inventory-inv1')).getByRole('button', { name: 'Unlist' })).toBeTruthy();
    expect(within(card('On Hand', 'inventory-inv2')).getByText('Not listed')).toBeTruthy();
    expect(within(card('On Hand', 'inventory-inv2')).getByRole('button', { name: 'List Item' })).toBeTruthy();
  });

  // A sold-out batch has nothing left to act on from this board; the remaining
  // story for those units is told by its sales in Outbound.
  it('drops an ON_HAND purchase from the board once qty_on_hand reaches 0', () => {
    setData({ inventory: [purchase({ receiving_status: 'ON_HAND', qty_on_hand: 0, allowed_actions: [] })] });
    renderPage();

    expect(cardKeys('On Hand')).toEqual([]);
    expect(cardKeys('Incoming')).toEqual([]);
    expect(cardKeys('Outbound')).toEqual([]);
    expect(inColumn('On Hand').getByText('Nothing on hand right now.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Not in the workflow yet' })).toBeNull();
  });

  // ─── Right column: Outbound ────────────────────────────────────────────────
  it('puts a sale in Outbound whatever its workflow_type or forward status', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: 'AWAITING_SHIPMENT', allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'OUTBOUND', allowed_actions: [] }),
        saleRecord({ id: 'sale3', workflow_status: 'AUTHENTICATING', workflow_type: 'AUTH_MARKETPLACE', allowed_actions: [] }),
        saleRecord({ id: 'sale4', workflow_status: 'SCANNED_IN', workflow_type: 'CASHOUT', allowed_actions: [] }),
        saleRecord({ id: 'sale5', workflow_status: 'HANDED_OVER', workflow_type: 'DIRECT_LOCAL', allowed_actions: [] }),
        saleRecord({ id: 'sale6', workflow_status: 'PAID', allowed_actions: [] }),
      ],
    });
    renderPage();

    expect(cardKeys('Outbound')).toHaveLength(6);
    expect(cardKeys('Incoming')).toEqual([]);
    expect(cardKeys('On Hand')).toEqual([]);
  });

  it('renders a sale card from the linked inventory the sales endpoint already includes', () => {
    setData({ sales: [saleRecord()] });
    renderPage();
    expect(inColumn('Outbound').getByText('Widget')).toBeTruthy();
    expect(inColumn('Outbound').getByText('Market')).toBeTruthy();
    expect(inColumn('Outbound').getByText('2 units')).toBeTruthy();
    expect(inColumn('Outbound').getByRole('button', { name: 'Mark Paid…' })).toBeTruthy();
  });

  it('keeps exception-status sales in Outbound but flags them visually', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'CANCELLED', allowed_actions: [] }),
        saleRecord({ id: 'sale3', workflow_status: 'RETURN_IN_PROGRESS', allowed_actions: [] }),
        saleRecord({ id: 'sale4', workflow_status: 'RETURNED', allowed_actions: [] }),
        saleRecord({ id: 'sale5', workflow_status: 'DISPUTED', allowed_actions: [] }),
        saleRecord({ id: 'sale6', workflow_status: 'AUTHENTICATION_FAILED', allowed_actions: [] }),
      ],
    });
    renderPage();

    // No fourth column: all six live in Outbound.
    expect(cardKeys('Outbound')).toHaveLength(6);
    for (const key of ['sale2', 'sale3', 'sale4', 'sale5', 'sale6']) {
      const node = card('Outbound', `sale-${key}`);
      expect(node.getAttribute('data-exception')).toBe('true');
      expect(node.className).toContain('border-red-500/40');
      expect(within(node).getByText('Exception')).toBeTruthy();
    }
    // The healthy sale carries neither the tag nor the accent.
    const healthy = card('Outbound', 'sale-sale1');
    expect(healthy.getAttribute('data-exception')).toBeNull();
    expect(within(healthy).queryByText('Exception')).toBeNull();
  });

  it('flags a cancelled purchase without dropping it from Incoming', () => {
    setData({ inventory: [purchase({ cancelled_at: '2026-09-30T00:00:00.000Z', allowed_actions: [] })] });
    renderPage();
    const node = card('Incoming', 'inventory-inv1');
    expect(node.getAttribute('data-exception')).toBe('true');
    expect(within(node).getByText('Cancelled')).toBeTruthy();
  });

  // ─── Per-column filter strips ──────────────────────────────────────────────
  it('gives each column its own strip scoped to that column\'s statuses and counts', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PURCHASED' }),
        purchase({ id: 'inv2', receiving_status: 'PURCHASED' }),
        purchase({ id: 'inv3', receiving_status: 'INBOUND' }),
        purchase({ id: 'inv4', receiving_status: 'ON_HAND', allowed_actions: [] }),
      ],
      sales: [saleRecord({ allowed_actions: [] })],
    });
    renderPage();

    expect(strip('Incoming').getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Purchased2', 'Inbound1']);
    expect(strip('On Hand').getAllByRole('button').map((b) => b.textContent))
      .toEqual(['On Hand1']);
    expect(strip('Outbound').getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Waiting for Payment1']);
  });

  it('filters one column without touching the others, and clears on a second click', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PURCHASED' }),
        purchase({ id: 'inv2', receiving_status: 'INBOUND' }),
      ],
      sales: [saleRecord({ allowed_actions: [] })],
    });
    renderPage();
    expect(cardKeys('Incoming')).toHaveLength(2);

    fireEvent.click(tile('Incoming', 'Inbound'));
    expect(cardKeys('Incoming')).toEqual(['inventory-inv2']);
    expect(cardKeys('Outbound')).toEqual(['sale-sale1']);

    fireEvent.click(tile('Incoming', 'Inbound'));
    expect(cardKeys('Incoming')).toHaveLength(2);
  });

  it('clears a column filter from that column\'s Clear filter button', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PURCHASED' }),
        purchase({ id: 'inv2', receiving_status: 'INBOUND' }),
      ],
    });
    renderPage();

    fireEvent.click(tile('Incoming', 'Inbound'));
    expect(cardKeys('Incoming')).toHaveLength(1);
    fireEvent.click(inColumn('Incoming').getByRole('button', { name: 'Clear filter' }));
    expect(cardKeys('Incoming')).toHaveLength(2);
    expect(inColumn('Incoming').queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });

  // The filtered status disappearing (its last record moved on) must not strand
  // the column on an empty filter with no way back.
  it('falls back to showing the whole column when the filtered status empties out', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'INBOUND', allowed_actions: [] }),
        purchase({ id: 'inv2', receiving_status: 'PURCHASED', allowed_actions: [] }),
      ],
    });
    const { rerender } = renderPage();

    fireEvent.click(tile('Incoming', 'Inbound'));
    expect(cardKeys('Incoming')).toEqual(['inventory-inv1']);

    setData({ inventory: [purchase({ id: 'inv2', receiving_status: 'PURCHASED', allowed_actions: [] })] });
    rerender(ui());

    expect(cardKeys('Incoming')).toEqual(['inventory-inv2']);
    expect(inColumn('Incoming').queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });

  // ─── Empty columns ─────────────────────────────────────────────────────────
  it('renders each column\'s own empty state without crashing', () => {
    setData({ inventory: [purchase()] });
    renderPage();
    expect(inColumn('On Hand').getByText('Nothing on hand right now.')).toBeTruthy();
    expect(inColumn('Outbound').getByText('Nothing outbound right now.')).toBeTruthy();
    // Incoming has the one purchase, so it shows no empty message.
    expect(inColumn('Incoming').queryByText('Nothing incoming right now.')).toBeNull();
    // An empty column renders no strip at all.
    expect(screen.queryByRole('group', { name: 'Outbound status filters' })).toBeNull();
  });

  // ─── Status change moves the card ──────────────────────────────────────────
  // There is no "move" mechanism: the action posts, the caches are invalidated,
  // and the refreshed record simply matches a different column. The mocked query
  // data standing in for the refetch is what proves that.
  it('moves a purchase from Incoming to On Hand once the refreshed record says ON_HAND', async () => {
    setData({ inventory: [purchase()] });
    const { rerender } = renderPage();
    expect(cardKeys('Incoming')).toEqual(['inventory-inv1']);

    fireEvent.click(inColumn('Incoming').getByRole('button', { name: 'Mark On Hand' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/inventory/inv1/actions/mark_on_hand');
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());

    // What the invalidated inventory query now returns.
    setData({ inventory: [purchase({ receiving_status: 'ON_HAND', qty_on_hand: 5, allowed_actions: [act('list_item', 'List Item')] })] });
    rerender(ui());

    expect(cardKeys('Incoming')).toEqual([]);
    expect(cardKeys('On Hand')).toEqual(['inventory-inv1']);
    expect(inColumn('On Hand').getByText('5 of 5 on hand')).toBeTruthy();
    expect(inColumn('On Hand').getByRole('button', { name: 'List Item' })).toBeTruthy();
  });

  it('moves a sale into the exception treatment once the refreshed record says CANCELLED', async () => {
    setData({ sales: [saleRecord({ allowed_actions: [act('cancel_sale', 'Cancel Sale')] })] });
    const { rerender } = renderPage();
    expect(card('Outbound', 'sale-sale1').getAttribute('data-exception')).toBeNull();

    fireEvent.click(inColumn('Outbound').getByRole('button', { name: 'Cancel Sale' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(mocks.apiFetch.mock.calls[0][0]).toBe('/api/sales/sale1/actions/cancel_sale');

    setData({ sales: [saleRecord({ workflow_status: 'CANCELLED', allowed_actions: [] })] });
    rerender(ui());

    // Still the right column -- exceptions are not a fourth column.
    expect(cardKeys('Outbound')).toEqual(['sale-sale1']);
    expect(card('Outbound', 'sale-sale1').getAttribute('data-exception')).toBe('true');
    expect(inColumn('Outbound').getByText('Exception')).toBeTruthy();
  });

  // ─── Records with no stored status ─────────────────────────────────────────
  it('lists records with no stored workflow status under the board rather than hiding them', () => {
    setData({
      inventory: [purchase({ receiving_status: null, allowed_actions: [] })],
      sales: [saleRecord({ workflow_status: null, allowed_actions: [] })],
    });
    renderPage();

    const leftover = screen.getByRole('region', { name: 'Not in the workflow yet' });
    expect(Array.from(leftover.querySelectorAll('[data-record]')).map((n) => n.getAttribute('data-record')))
      .toEqual(['inventory-inv1', 'sale-sale1']);
    expect(cardKeys('Incoming')).toEqual([]);
    expect(cardKeys('Outbound')).toEqual([]);
    expect(within(leftover).getAllByText('No action needed')).toHaveLength(2);
  });

  // What the API actually sends for these rows: one primary `correct_status`
  // descriptor flagged `initial`. The section must render it as a real button,
  // not swallow it into a More menu, or the row stays unfixable.
  const setStatusAction = (label) => act('correct_status', label, { requiresForm: true, initial: true });

  it('offers a visible Set Status button on every record with no stored status', () => {
    setData({
      inventory: [purchase({ receiving_status: null, allowed_actions: [setStatusAction('Set Receiving Status')] })],
      sales: [saleRecord({ workflow_status: null, workflow_type: null, allowed_actions: [setStatusAction('Set Sale Status')] })],
    });
    renderPage();

    const leftover = screen.getByRole('region', { name: 'Not in the workflow yet' });
    expect(within(leftover).getByRole('button', { name: 'Set Receiving Status…' })).toBeTruthy();
    expect(within(leftover).getByRole('button', { name: 'Set Sale Status…' })).toBeTruthy();
    expect(within(leftover).queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(within(leftover).queryByText('No action needed')).toBeNull();
    expect(within(leftover).getAllByText('No status yet')).toHaveLength(2);
  });

  it('sets the status from the card and the record joins a column once refreshed', async () => {
    setData({ inventory: [purchase({ receiving_status: null, allowed_actions: [setStatusAction('Set Receiving Status')] })] });
    const { rerender } = renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Set Receiving Status…' }));
    await screen.findByRole('dialog', { name: 'Set Receiving Status' });
    fireEvent.change(screen.getByLabelText('Where is this purchase now?'), { target: { value: 'INBOUND' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ receiving_status: 'INBOUND' });

    setData({ inventory: [purchase({ receiving_status: 'INBOUND', allowed_actions: [] })] });
    rerender(ui());

    expect(cardKeys('Incoming')).toEqual(['inventory-inv1']);
    expect(screen.queryByRole('region', { name: 'Not in the workflow yet' })).toBeNull();
  });

  it('sends the workflow type with the status for a sale that had neither', async () => {
    setData({ sales: [saleRecord({ workflow_status: null, workflow_type: null, allowed_actions: [setStatusAction('Set Sale Status')] })] });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Set Sale Status…' }));
    await screen.findByRole('dialog', { name: 'Set Sale Status' });
    fireEvent.change(screen.getByLabelText('What kind of sale was this?'), { target: { value: 'DIRECT_LOCAL' } });
    fireEvent.change(screen.getByLabelText('Where is it now?'), { target: { value: 'AWAITING_HANDOFF' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ workflow_type: 'DIRECT_LOCAL', workflow_status: 'AWAITING_HANDOFF' });
  });
});
