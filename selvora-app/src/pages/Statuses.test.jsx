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
  it('puts a sale in Outbound whatever its workflow_type or forward status, except PAID', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: 'AWAITING_SHIPMENT', allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'OUTBOUND', allowed_actions: [] }),
        saleRecord({ id: 'sale3', workflow_status: 'AUTHENTICATING', workflow_type: 'AUTH_MARKETPLACE', allowed_actions: [] }),
        saleRecord({ id: 'sale4', workflow_status: 'SCANNED_IN', workflow_type: 'CASHOUT', allowed_actions: [] }),
        saleRecord({ id: 'sale5', workflow_status: 'HANDED_OVER', workflow_type: 'DIRECT_LOCAL', allowed_actions: [] }),
        // A finished sale lives in Completed, not Outbound -- see the dedicated
        // "Completed section" tests below.
        saleRecord({ id: 'sale6', workflow_status: 'PAID', allowed_actions: [] }),
      ],
    });
    renderPage();

    expect(cardKeys('Outbound')).toHaveLength(5);
    expect(cardKeys('Outbound')).not.toContain('sale-sale6');
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

    // No fourth column: all six live in Outbound (spread across two pages at
    // 5 per page -- the column header's own count is independent of paging).
    expect(inColumn('Outbound').getByText('6')).toBeTruthy();
    for (const key of ['sale2', 'sale3', 'sale4', 'sale5']) {
      const node = card('Outbound', `sale-${key}`);
      expect(node.getAttribute('data-exception')).toBe('true');
      expect(node.className).toContain('border-red-500/40');
      expect(within(node).getByText('Exception')).toBeTruthy();
    }
    fireEvent.click(inColumn('Outbound').getByRole('button', { name: /Next/ }));
    {
      const node = card('Outbound', 'sale-sale6');
      expect(node.getAttribute('data-exception')).toBe('true');
      expect(node.className).toContain('border-red-500/40');
      expect(within(node).getByText('Exception')).toBeTruthy();
    }
    fireEvent.click(inColumn('Outbound').getByRole('button', { name: /Previous/ }));
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

  // ─── "Last status updated" on the card ─────────────────────────────────────
  // The stamp sits on the item-name row, right-aligned, as a calendar date (see
  // formatStatusChangedAt in data/statusWorkflow.js for why a date and not an age).
  const stampOf = (title, key) => card(title, key).querySelector('[data-status-changed]');
  const asDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  it('shows the date each card\'s status last changed, on the item-name row', () => {
    const purchaseChangedAt = '2026-10-03T13:30:00.000Z';
    const saleChangedAt = '2026-10-01T15:30:00.000Z';
    setData({
      inventory: [purchase({ receiving_status_changed_at: purchaseChangedAt, allowed_actions: [] })],
      sales: [saleRecord({ workflow_status_changed_at: saleChangedAt, allowed_actions: [] })],
    });
    renderPage();

    const purchaseStamp = stampOf('Incoming', 'inventory-inv1');
    expect(purchaseStamp.textContent).toBe(asDate(purchaseChangedAt));
    expect(stampOf('Outbound', 'sale-sale1').textContent).toBe(asDate(saleChangedAt));

    // Same row as the product name, with the name still truncating and the stamp
    // pinned to the right of it.
    const nameRow = purchaseStamp.parentElement;
    expect(nameRow.className).toContain('justify-between');
    expect(within(nameRow).getByText('Widget')).toBeTruthy();
    expect(nameRow.querySelector('p').className).toContain('truncate');
    expect(purchaseStamp.className).toContain('shrink-0');
  });

  it('shows no timestamp at all on a record whose status has never been stamped', () => {
    setData({
      // A legacy row the status-workflow backfill never reached: the column is
      // NULL, and a fabricated date would be worse than nothing.
      inventory: [purchase({ receiving_status_changed_at: null, allowed_actions: [] })],
      sales: [saleRecord({ allowed_actions: [] })], // field absent entirely
    });
    renderPage();

    expect(stampOf('Incoming', 'inventory-inv1')).toBeNull();
    expect(stampOf('Outbound', 'sale-sale1')).toBeNull();
    // The rest of the card is unaffected.
    expect(within(card('Incoming', 'inventory-inv1')).getByText('Widget')).toBeTruthy();
    expect(within(card('Incoming', 'inventory-inv1')).getByText('Purchased')).toBeTruthy();
  });

  it('stamps a completed and an unassigned card the same way as a board card', () => {
    const leftoverChangedAt = '2026-10-03T15:29:45.000Z';
    const completedChangedAt = '2026-10-03T12:30:00.000Z';
    setData({
      inventory: [purchase({ receiving_status: null, receiving_status_changed_at: leftoverChangedAt, allowed_actions: [] })],
      sales: [saleRecord({ workflow_status: 'PAID', workflow_status_changed_at: completedChangedAt, allowed_actions: [] })],
    });
    renderPage();

    const leftover = screen.getByRole('region', { name: 'Not in the workflow yet' });
    expect(leftover.querySelector('[data-status-changed]').textContent).toBe(asDate(leftoverChangedAt));
    expect(screen.getByRole('region', { name: 'Completed' }).querySelector('[data-status-changed]').textContent)
      .toBe(asDate(completedChangedAt));
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

  // ─── Completed section ──────────────────────────────────────────────────────
  it('does not render the Completed section when there is nothing paid', () => {
    setData({ sales: [saleRecord({ workflow_status: 'OUTBOUND', allowed_actions: [] })] });
    renderPage();
    expect(screen.queryByRole('region', { name: 'Completed' })).toBeNull();
  });

  it('lists every PAID sale in a full-width Completed section below the board', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: 'PAID', allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'PAID', workflow_type: 'CASHOUT', allowed_actions: [] }),
        saleRecord({ id: 'sale3', workflow_status: 'WAITING_FOR_PAYMENT', allowed_actions: [] }),
      ],
    });
    renderPage();

    const completedSection = inColumn('Completed');
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]'))
      .map((n) => n.getAttribute('data-record'))).toEqual(['sale-sale1', 'sale-sale2']);
    expect(completedSection.getByText('2')).toBeTruthy();
    expect(cardKeys('Outbound')).toEqual(['sale-sale3']);
  });

  // A PAID sale is not its own stored status -- it is treated as fully done,
  // and moves to Completed, 3 days after paid_at, recomputed on every render
  // rather than written to the database anywhere.
  it('keeps a recently paid sale in Outbound, tagged Paid, instead of Completed', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
    setData({ sales: [saleRecord({ id: 'sale1', workflow_status: 'PAID', paid_at: recent, allowed_actions: [] })] });
    renderPage();

    expect(screen.queryByRole('region', { name: 'Completed' })).toBeNull();
    expect(cardKeys('Outbound')).toEqual(['sale-sale1']);
    expect(within(card('Outbound', 'sale-sale1')).getByText('Paid')).toBeTruthy();
  });

  it('moves a sale into Completed once 3 days have passed since paid_at', () => {
    const justUnder = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000 - 1000)).toISOString();
    const justOver = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000 + 1000)).toISOString();
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: 'PAID', paid_at: justUnder, allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'PAID', paid_at: justOver, allowed_actions: [] }),
      ],
    });
    renderPage();

    expect(cardKeys('Outbound')).toEqual(['sale-sale1']);
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]'))
      .map((n) => n.getAttribute('data-record'))).toEqual(['sale-sale2']);
  });

  it('moves a recently paid sale into Completed immediately once marked complete by hand', () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // still well inside 3 days
    setData({
      sales: [saleRecord({
        id: 'sale1', workflow_status: 'PAID', paid_at: recent, completed_at: new Date().toISOString(), allowed_actions: [],
      })],
    });
    renderPage();

    expect(cardKeys('Outbound')).toEqual([]);
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]')))
      .toHaveLength(1);
  });

  it('offers Mark Completed on a recently paid sale and fires it straight away', async () => {
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    setData({
      sales: [saleRecord({
        id: 'sale1', workflow_status: 'PAID', paid_at: recent,
        allowed_actions: [act('mark_completed', 'Mark Completed')],
      })],
    });
    renderPage();

    const button = within(card('Outbound', 'sale-sale1')).getByRole('button', { name: 'Mark Completed' });
    fireEvent.click(button);

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/mark_completed');
    expect(JSON.parse(options.body)).toEqual({});
  });

  it('treats a PAID sale with no paid_at as already settled (legacy data)', () => {
    setData({ sales: [saleRecord({ id: 'sale1', workflow_status: 'PAID', paid_at: null, allowed_actions: [] })] });
    renderPage();

    expect(cardKeys('Outbound')).toEqual([]);
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]')))
      .toHaveLength(1);
  });

  it('shows a Paid filter tile in Outbound when a recently paid sale is present', () => {
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: 'WAITING_FOR_PAYMENT', allowed_actions: [] }),
        saleRecord({ id: 'sale2', workflow_status: 'PAID', paid_at: recent, allowed_actions: [] }),
      ],
    });
    renderPage();

    fireEvent.click(tile('Outbound', 'Paid'));
    expect(cardKeys('Outbound')).toEqual(['sale-sale2']);
  });

  it('paginates the Completed section at 5 per page like the board columns', () => {
    setData({
      sales: Array.from({ length: 6 }, (_, i) => saleRecord({ id: `sale${i + 1}`, workflow_status: 'PAID' })),
    });
    renderPage();

    const completed = () => inColumn('Completed');
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]'))).toHaveLength(5);
    expect(completed().getByText('Page 1 of 2')).toBeTruthy();

    fireEvent.click(completed().getByRole('button', { name: /Next/ }));
    expect(Array.from(screen.getByRole('region', { name: 'Completed' }).querySelectorAll('[data-record]'))).toHaveLength(1);
  });

  it('still offers the quick status dropdown and actions on a completed card for corrections', () => {
    setData({ sales: [saleRecord({ workflow_status: 'PAID', allowed_actions: [act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true })] })] });
    renderPage();

    const node = screen.getByRole('region', { name: 'Completed' }).querySelector('[data-record="sale-sale1"]');
    expect(within(node).getByLabelText('Change sale status')).toBeTruthy();
    expect(within(node).getByRole('button', { name: 'More actions' })).toBeTruthy();
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

  // ─── Quick inline status dropdown ──────────────────────────────────────────
  // A second, faster route to the same `correct_status` action the More menu's
  // form reaches. What it must never do is offer a mixed list: the options are
  // scoped to the record's own category (and, for a sale, its own workflow), and
  // nothing is written until the apply control is pressed.
  const CORRECT_RECEIVING = act('correct_status', 'Correct Receiving Step', { requiresForm: true, secondary: true });
  const CORRECT_WORKFLOW = act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true });

  const SALE_EXCEPTIONS = ['CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED'];

  const quick = (title, key) => {
    const node = card(title, key);
    return within(node).queryByLabelText(key.startsWith('inventory-') ? 'Change receiving status' : 'Change sale status');
  };
  const optionValues = (select) => Array.from(select.options).map((option) => option.value);
  const applyButton = (title, key) => within(card(title, key)).queryByRole('button', { name: 'Apply status change' });

  it('offers every receiving status on an inventory card, in either column', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PRE_ORDER', allowed_actions: [CORRECT_RECEIVING] }),
        purchase({ id: 'inv2', receiving_status: 'ON_HAND', qty_on_hand: 2, allowed_actions: [CORRECT_RECEIVING] }),
      ],
    });
    renderPage();

    const incoming = quick('Incoming', 'inventory-inv1');
    expect(optionValues(incoming)).toEqual(['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND']);
    expect(incoming.value).toBe('PRE_ORDER');

    // The same four options whatever column the card currently sits in.
    const onHand = quick('On Hand', 'inventory-inv2');
    expect(optionValues(onHand)).toEqual(['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND']);
    expect(onHand.value).toBe('ON_HAND');

    // Never a sale status on a purchase.
    expect(optionValues(incoming).some((value) => SALE_EXCEPTIONS.includes(value))).toBe(false);
  });

  // The whole point of the scoping rule: three sales in the *same* status, each
  // offered a different list because each is on a different workflow.
  it('scopes a sale card to its own workflow path plus the exceptions', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_type: 'STANDARD_MARKETPLACE', allowed_actions: [CORRECT_WORKFLOW] }),
        saleRecord({ id: 'sale2', workflow_type: 'DIRECT_LOCAL', allowed_actions: [CORRECT_WORKFLOW] }),
        saleRecord({ id: 'sale3', workflow_type: 'CASHOUT', allowed_actions: [CORRECT_WORKFLOW] }),
      ],
    });
    renderPage();

    expect(optionValues(quick('Outbound', 'sale-sale1'))).toEqual([
      'AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID', ...SALE_EXCEPTIONS,
    ]);
    expect(optionValues(quick('Outbound', 'sale-sale2'))).toEqual([
      'AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID', ...SALE_EXCEPTIONS,
    ]);
    expect(optionValues(quick('Outbound', 'sale-sale3'))).toEqual([
      'AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN',
      'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID', ...SALE_EXCEPTIONS,
    ]);
    // No receiving status ever reaches a sale card.
    for (const key of ['sale-sale1', 'sale-sale2', 'sale-sale3']) {
      expect(optionValues(quick('Outbound', key))).not.toContain('PURCHASED');
    }
  });

  // Matches the server: SALE_TRANSITIONS.correct_status validates against
  // saleWorkflowOf(record), which falls back to the default workflow too.
  it('falls back to the default workflow for a sale with no workflow type', () => {
    setData({ sales: [saleRecord({ workflow_type: null, workflow_status: 'OUTBOUND', allowed_actions: [CORRECT_WORKFLOW] })] });
    renderPage();
    expect(optionValues(quick('Outbound', 'sale-sale1'))).toEqual([
      'AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID', ...SALE_EXCEPTIONS,
    ]);
    // No workflow-type picker here -- that belongs to the Set Sale Status form.
    expect(within(card('Outbound', 'sale-sale1')).queryByLabelText('What kind of sale was this?')).toBeNull();
  });

  // A stored status outside the record's own list (workflow_type and
  // workflow_status disagreeing) must still be what the control displays.
  it('still shows a stored status that is not on the record\'s own path', () => {
    setData({ sales: [saleRecord({ workflow_type: 'DIRECT_LOCAL', workflow_status: 'OUTBOUND', allowed_actions: [CORRECT_WORKFLOW] })] });
    renderPage();
    const select = quick('Outbound', 'sale-sale1');
    expect(select.value).toBe('OUTBOUND');
    expect(Array.from(select.options).find((option) => option.value === 'OUTBOUND').disabled).toBe(true);
    expect(applyButton('Outbound', 'sale-sale1')).toBeNull();
  });

  it('writes nothing on the select change alone, only on the apply press', async () => {
    setData({ inventory: [purchase({ allowed_actions: [CORRECT_RECEIVING] })] });
    renderPage();
    expect(applyButton('Incoming', 'inventory-inv1')).toBeNull();

    fireEvent.change(quick('Incoming', 'inventory-inv1'), { target: { value: 'INBOUND' } });
    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(applyButton('Incoming', 'inventory-inv1')).toBeTruthy();

    fireEvent.click(applyButton('Incoming', 'inventory-inv1'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/inventory/inv1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ receiving_status: 'INBOUND' });
  });

  it('sends a sale only its workflow status, never a workflow type', async () => {
    setData({ sales: [saleRecord({ workflow_type: 'CASHOUT', workflow_status: 'OUTBOUND', allowed_actions: [CORRECT_WORKFLOW] })] });
    renderPage();

    fireEvent.change(quick('Outbound', 'sale-sale1'), { target: { value: 'SCANNED_IN' } });
    fireEvent.click(applyButton('Outbound', 'sale-sale1'));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/correct_status');
    // Exactly one key: no workflow_type, no correction_note.
    expect(JSON.parse(options.body)).toEqual({ workflow_status: 'SCANNED_IN' });
  });

  it('offers no apply control while the choice still matches the stored status', () => {
    setData({ inventory: [purchase({ allowed_actions: [CORRECT_RECEIVING] })] });
    renderPage();
    const select = quick('Incoming', 'inventory-inv1');

    fireEvent.change(select, { target: { value: 'PURCHASED' } }); // the current one
    expect(applyButton('Incoming', 'inventory-inv1')).toBeNull();

    fireEvent.change(select, { target: { value: 'INBOUND' } });
    expect(applyButton('Incoming', 'inventory-inv1')).toBeTruthy();

    // Picking the original back resets the control away again.
    fireEvent.change(select, { target: { value: 'PURCHASED' } });
    expect(applyButton('Incoming', 'inventory-inv1')).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('moves the card to its new column once the refreshed record arrives', async () => {
    setData({ inventory: [purchase({ allowed_actions: [CORRECT_RECEIVING] })] });
    const { rerender } = renderPage();

    fireEvent.change(quick('Incoming', 'inventory-inv1'), { target: { value: 'ON_HAND' } });
    fireEvent.click(applyButton('Incoming', 'inventory-inv1'));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    // Apply goes away immediately, so a slow refetch cannot be double-posted.
    await waitFor(() => expect(applyButton('Incoming', 'inventory-inv1')).toBeNull());
    expect(quick('Incoming', 'inventory-inv1').value).toBe('ON_HAND');

    // What the invalidated inventory query now returns.
    setData({ inventory: [purchase({ receiving_status: 'ON_HAND', qty_on_hand: 5, allowed_actions: [CORRECT_RECEIVING] })] });
    rerender(ui());

    expect(cardKeys('Incoming')).toEqual([]);
    expect(cardKeys('On Hand')).toEqual(['inventory-inv1']);
    expect(quick('On Hand', 'inventory-inv1').value).toBe('ON_HAND');
    expect(applyButton('On Hand', 'inventory-inv1')).toBeNull();
  });

  it('keeps the choice so apply can be pressed again when the request fails', async () => {
    mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Purchase changed while saving. Reload and retry.' }), { status: 409 }));
    setData({ inventory: [purchase({ allowed_actions: [CORRECT_RECEIVING] })] });
    renderPage();

    fireEvent.change(quick('Incoming', 'inventory-inv1'), { target: { value: 'INBOUND' } });
    fireEvent.click(applyButton('Incoming', 'inventory-inv1'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());

    await waitFor(() => expect(applyButton('Incoming', 'inventory-inv1')).toBeTruthy());
    expect(quick('Incoming', 'inventory-inv1').value).toBe('INBOUND');
    expect(cardKeys('Incoming')).toEqual(['inventory-inv1']);

    fireEvent.click(applyButton('Incoming', 'inventory-inv1'));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledTimes(2));
  });

  // FLAGGED: `correct_status` is registered destructive: false even when the
  // destination is an exception status, and the existing Correct Workflow Step
  // form already lets one be picked with no extra confirmation. This dropdown
  // follows that precedent rather than inventing a different rule, so an
  // exception status is one select + one apply press away. The dedicated Cancel
  // Sale / Void buttons still carry their full consequence dialogs.
  it('lets an exception status be picked, matching the existing correction form', async () => {
    setData({ sales: [saleRecord({ allowed_actions: [CORRECT_WORKFLOW] })] });
    renderPage();

    fireEvent.change(quick('Outbound', 'sale-sale1'), { target: { value: 'CANCELLED' } });
    fireEvent.click(applyButton('Outbound', 'sale-sale1'));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    expect(JSON.parse(mocks.apiFetch.mock.calls[0][1].body)).toEqual({ workflow_status: 'CANCELLED' });
    // No consequence dialog on this path, same as the form-based correction.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('puts no dropdown on a record whose allowed actions do not include a correction', () => {
    setData({ inventory: [purchase()] });
    renderPage();
    expect(quick('Incoming', 'inventory-inv1')).toBeNull();
    expect(within(card('Incoming', 'inventory-inv1')).getByRole('button', { name: 'Mark On Hand' })).toBeTruthy();
  });

  it('leaves the Not in the workflow yet section to its own Set Status flow', () => {
    setData({
      inventory: [purchase({ receiving_status: null, allowed_actions: [setStatusAction('Set Receiving Status')] })],
      sales: [saleRecord({ workflow_status: null, workflow_type: null, allowed_actions: [setStatusAction('Set Sale Status')] })],
    });
    renderPage();

    const leftover = screen.getByRole('region', { name: 'Not in the workflow yet' });
    expect(within(leftover).queryByLabelText('Change receiving status')).toBeNull();
    expect(within(leftover).queryByLabelText('Change sale status')).toBeNull();
    expect(within(leftover).getByRole('button', { name: 'Set Receiving Status…' })).toBeTruthy();
    expect(within(leftover).getByRole('button', { name: 'Set Sale Status…' })).toBeTruthy();
  });

  // The dropdown is additive: the form-based correction must still be reachable
  // from the same card and behave exactly as it did before.
  it('keeps the form-based correction working alongside the dropdown', async () => {
    setData({ sales: [saleRecord({ workflow_type: 'DIRECT_LOCAL', allowed_actions: [CORRECT_WORKFLOW] })] });
    renderPage();

    fireEvent.click(within(card('Outbound', 'sale-sale1')).getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Correct Workflow Step…' }));
    await screen.findByRole('dialog', { name: 'Correct Workflow Step' });

    // The form keeps its own placeholder-first option list; the dropdown has not
    // replaced or reshaped it.
    expect(optionValues(screen.getByLabelText('Workflow step'))).toEqual([
      '', 'AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID', ...SALE_EXCEPTIONS,
    ]);
    fireEvent.change(screen.getByLabelText('Workflow step'), { target: { value: 'PAID' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledOnce());
    const [path, options] = mocks.apiFetch.mock.calls[0];
    expect(path).toBe('/api/sales/sale1/actions/correct_status');
    expect(JSON.parse(options.body)).toEqual({ workflow_status: 'PAID' });
  });

  // ─── Pagination ────────────────────────────────────────────────────────────
  describe('pagination', () => {
    const manyPurchases = (count) => Array.from({ length: count }, (_, i) => purchase({ id: `inv${i + 1}` }));
    const pager = (title) => inColumn(title);

    it('shows no pager when a column has 5 or fewer records', () => {
      setData({ inventory: manyPurchases(5) });
      renderPage();
      expect(cardKeys('Incoming')).toHaveLength(5);
      expect(pager('Incoming').queryByText(/Page \d+ of \d+/)).toBeNull();
    });

    it('shows only the first 5 records and a pager once a column exceeds 5', () => {
      setData({ inventory: manyPurchases(7) });
      renderPage();
      expect(cardKeys('Incoming')).toHaveLength(5);
      expect(pager('Incoming').getByText('Page 1 of 2')).toBeTruthy();
      expect(pager('Incoming').getByRole('button', { name: /Previous/ }).disabled).toBe(true);
      expect(pager('Incoming').getByRole('button', { name: /Next/ }).disabled).toBe(false);
    });

    it('moves to the next page and shows the remaining records', () => {
      setData({ inventory: manyPurchases(7) });
      renderPage();

      fireEvent.click(pager('Incoming').getByRole('button', { name: /Next/ }));

      expect(cardKeys('Incoming')).toEqual(['inventory-inv6', 'inventory-inv7']);
      expect(pager('Incoming').getByText('Page 2 of 2')).toBeTruthy();
      expect(pager('Incoming').getByRole('button', { name: /Next/ }).disabled).toBe(true);

      fireEvent.click(pager('Incoming').getByRole('button', { name: /Previous/ }));
      expect(cardKeys('Incoming')).toHaveLength(5);
      expect(pager('Incoming').getByText('Page 1 of 2')).toBeTruthy();
    });

    it('paginates each column independently', () => {
      setData({
        inventory: manyPurchases(6),
        sales: [saleRecord({ id: 'sale1' })],
      });
      renderPage();

      expect(pager('Incoming').getByText('Page 1 of 2')).toBeTruthy();
      expect(pager('On Hand').queryByText(/Page \d+ of \d+/)).toBeNull();
      expect(pager('Outbound').queryByText(/Page \d+ of \d+/)).toBeNull();
    });

    it('resets to page 1 when a status filter tile is applied or cleared', () => {
      setData({ inventory: manyPurchases(7) });
      renderPage();

      fireEvent.click(pager('Incoming').getByRole('button', { name: /Next/ }));
      expect(pager('Incoming').getByText('Page 2 of 2')).toBeTruthy();

      fireEvent.click(tile('Incoming', 'Purchased'));
      expect(cardKeys('Incoming')).toHaveLength(5);
      expect(pager('Incoming').getByText('Page 1 of 2')).toBeTruthy();

      fireEvent.click(pager('Incoming').getByRole('button', { name: /Next/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
      expect(pager('Incoming').getByText('Page 1 of 2')).toBeTruthy();
    });
  });
});
