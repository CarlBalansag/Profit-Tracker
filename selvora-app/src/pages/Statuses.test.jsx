import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

const renderPage = () => render(<MemoryRouter><Statuses /></MemoryRouter>);

const rows = () => screen.getAllByRole('row').filter((row) => within(row).queryAllByRole('cell').length > 0);
// Scoped to the filter strip: a tile label like "On Hand" is also a substring of
// a row's "Mark On Hand" action button, and a status label like "Purchased"
// appears in both the tile and the row.
const strip = () => within(screen.getByRole('group', { name: 'Status filters' }));
const tile = (name) => strip().getByRole('button', { name: new RegExp(name) });
const table = () => within(screen.getByRole('table'));

beforeEach(() => {
  setData({});
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'x', allowed_actions: [] })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Statuses page', () => {
  it('shows a loading state while either resource is still fetching', () => {
    setData({ loading: true });
    renderPage();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows an empty state and no pipeline when there are no records', () => {
    renderPage();
    expect(screen.getByText('Nothing to track yet.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Status filters' })).toBeNull();
  });

  it('renders a single record with its status, detail and actions', () => {
    setData({ inventory: [purchase()] });
    renderPage();

    expect(table().getByText('Widget')).toBeTruthy();
    expect(table().getByText('Store')).toBeTruthy();
    expect(table().getByText('PURCHASE')).toBeTruthy();
    expect(table().getByText('Purchased')).toBeTruthy();
    expect(table().getByText('5 of 5 on hand · Available')).toBeTruthy();
    expect(table().getByRole('button', { name: 'Mark On Hand' })).toBeTruthy();
    expect(screen.getByText('1 record')).toBeTruthy();
  });

  it('groups purchases by receiving status and sales by workflow status', () => {
    setData({
      inventory: [purchase(), purchase({ id: 'inv2', receiving_status: 'INBOUND' }), purchase({ id: 'inv3' })],
      sales: [saleRecord(), saleRecord({ id: 'sale2', workflow_status: 'OUTBOUND', allowed_actions: [] })],
    });
    renderPage();

    expect(tile('Purchased').textContent).toContain('2');
    expect(tile('Inbound').textContent).toContain('1');
    expect(tile('Waiting for Payment').textContent).toContain('1');
    expect(tile('Outbound').textContent).toContain('1');
    expect(rows()).toHaveLength(5);
    expect(screen.getByText('5 records')).toBeTruthy();
  });

  it('orders the tiles along the canonical pipeline, receiving before sale steps', () => {
    setData({
      inventory: [purchase({ receiving_status: 'ON_HAND' }), purchase({ id: 'inv2', receiving_status: 'PRE_ORDER' })],
      sales: [saleRecord({ workflow_status: 'PAID', allowed_actions: [] }), saleRecord({ id: 'sale2', workflow_status: 'OUTBOUND', allowed_actions: [] })],
    });
    renderPage();

    const labels = within(screen.getByRole('group', { name: 'Status filters' }))
      .getAllByRole('button')
      .map((button) => button.textContent.replace(/\d+$/, ''));
    expect(labels).toEqual(['Pre-order', 'On Hand', 'Outbound', 'Paid']);
  });

  it('filters the list to the clicked status and clears again on a second click', () => {
    setData({
      inventory: [purchase(), purchase({ id: 'inv2', product_name: 'Gadget', receiving_status: 'INBOUND' })],
      sales: [saleRecord({ allowed_actions: [] })],
    });
    renderPage();
    expect(rows()).toHaveLength(3);

    fireEvent.click(tile('Inbound'));
    expect(rows()).toHaveLength(1);
    expect(table().getByText('Gadget')).toBeTruthy();
    expect(table().queryByText('Widget')).toBeNull();
    expect(screen.getByText('1 record')).toBeTruthy();

    fireEvent.click(tile('Inbound'));
    expect(rows()).toHaveLength(3);
  });

  it('clears the filter from the Clear filter button', () => {
    setData({ inventory: [purchase(), purchase({ id: 'inv2', receiving_status: 'ON_HAND' })] });
    renderPage();

    fireEvent.click(tile('On Hand'));
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(rows()).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Clear filter' })).toBeNull();
  });

  // Legacy rows the status-workflow backfill has not reached have no status at
  // all; they must stay visible rather than vanishing from every tile.
  it('buckets records with no status yet under their own tile', () => {
    setData({ inventory: [purchase({ receiving_status: null, allowed_actions: [] })] });
    renderPage();

    expect(tile('No status yet')).toBeTruthy();
    fireEvent.click(tile('No status yet'));
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('No action needed')).toBeTruthy();
  });

  it('marks a cancelled purchase without dropping it from its receiving tile', () => {
    setData({ inventory: [purchase({ cancelled_at: '2026-09-30T00:00:00.000Z', allowed_actions: [] })] });
    renderPage();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(tile('Purchased').textContent).toContain('1');
  });

  it('notes a listed purchase and a sold-out batch in the row detail', () => {
    setData({ inventory: [purchase({ receiving_status: 'ON_HAND', qty_on_hand: 0, is_listed: true, allowed_actions: [] })] });
    renderPage();
    expect(screen.getByText('0 of 5 on hand · Sold Out · Listed')).toBeTruthy();
  });

  it('renders each row\'s own contextual actions against the shared endpoints', () => {
    setData({ inventory: [purchase()], sales: [saleRecord()] });
    renderPage();
    // The sale's Mark Paid is a modal trigger, not a one-click button.
    expect(screen.getByRole('button', { name: 'Mark Paid…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark On Hand' })).toBeTruthy();
  });
});
