import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import Shipping from './Shipping';

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

const UPS = '1Z999AA10123456784';

const purchase = (overrides = {}) => ({
  id: 'inv1', product_name: 'Widget', receiving_status: 'PURCHASED',
  purchase_date: '2026-09-01T12:00:00.000Z', qty_purchased: 2, qty_on_hand: 2,
  vendor: { name: 'Store' }, tracking_number: null, allowed_actions: [],
  ...overrides,
});

const saleRecord = (overrides = {}) => ({
  id: 'sale1', workflow_status: 'AWAITING_SHIPMENT', workflow_type: 'STANDARD_MARKETPLACE',
  sale_date: '2026-09-03T12:00:00.000Z', quantity: 1,
  inventory: { product_name: 'Widget' }, platform: { name: 'Market' },
  tracking_number: null, allowed_actions: [],
  ...overrides,
});

const setData = ({ inventory = [], sales = [], loading = false }) => {
  mocks.inventory = { data: inventory, isLoading: loading };
  mocks.sales = { data: sales, isLoading: loading };
};

const INBOUND = 'Inbound Shipping';
const OUTBOUND = 'Outbound Shipping';

// Each section is the card the section heading sits in, so every assertion is
// scoped to one section and a row showing up in the wrong one fails rather than
// passing by accident.
const section = (title) => screen.getByRole('heading', { name: title }).closest('.card');
const inSection = (title) => within(section(title));
// The sub-tab buttons carry their own row count in their accessible name.
const tab = (title, label) => inSection(title).getByRole('button', { name: label });
const tabCount = (title, label) => tab(title, label).textContent.replace(label, '').trim();
const TRACKED = /^Tracked/;
const NEEDS = /^Needs Tracking #/;
const openNeedsTab = (title) => fireEvent.click(tab(title, NEEDS));

beforeEach(() => {
  setData({});
  mocks.apiFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'x' })));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Shipping page scoping', () => {
  it('shows a loading state while either resource is still fetching', () => {
    setData({ loading: true });
    render(<Shipping />);
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: INBOUND })).toBeNull();
  });

  it('renders both sections empty when there is nothing in a trackable window', () => {
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('0');
    expect(tabCount(OUTBOUND, TRACKED)).toBe('0');
    expect(inSection(INBOUND).getByText('Nothing in transit right now.')).toBeTruthy();
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).getByText('Nothing is waiting on a tracking number.')).toBeTruthy();
  });
});

describe('Inbound Shipping', () => {
  it.each(['PRE_ORDER', 'PURCHASED'])('lists a %s purchase under Needs Tracking #', (receiving_status) => {
    setData({ inventory: [purchase({ receiving_status, product_name: 'Pre-shipment item' })] });
    render(<Shipping />);
    expect(tabCount(INBOUND, NEEDS)).toBe('1');
    expect(tabCount(INBOUND, TRACKED)).toBe('0');
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).getByText('Pre-shipment item')).toBeTruthy();
  });

  it('lists an INBOUND purchase under Tracked', () => {
    setData({ inventory: [purchase({ receiving_status: 'INBOUND', tracking_number: UPS, product_name: 'In transit item' })] });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('1');
    expect(tabCount(INBOUND, NEEDS)).toBe('0');
    expect(inSection(INBOUND).getByText('In transit item')).toBeTruthy();
    expect(inSection(INBOUND).getByText(UPS)).toBeTruthy();
  });

  it('excludes an ON_HAND purchase, tracking number or not', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'ON_HAND', tracking_number: UPS, product_name: 'Received with tracking' }),
        purchase({ id: 'inv2', receiving_status: 'ON_HAND', product_name: 'Received without tracking' }),
      ],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('0');
    expect(tabCount(INBOUND, NEEDS)).toBe('0');
    expect(inSection(INBOUND).queryByText('Received with tracking')).toBeNull();
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).queryByText('Received without tracking')).toBeNull();
  });

  // A purchase can sell out before ever being marked received -- recorded via
  // the Transactions page's inline sale edit, not this page. Its
  // receiving_status never leaves PRE_ORDER/PURCHASED/INBOUND, so without also
  // checking qty_on_hand this would sit in Inbound forever showing a stale
  // "needs tracking" row for stock that's already fully sold and whose own
  // sale is already further along (possibly already Completed) elsewhere.
  it('excludes a PURCHASED purchase that sold out before ever being received', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: 'PURCHASED', qty_on_hand: 0, product_name: 'Sold out before arrival' }),
      ],
      sales: [saleRecord({ id: 'sale1', workflow_status: 'PAID' })],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('0');
    expect(tabCount(INBOUND, NEEDS)).toBe('0');
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).queryByText('Sold out before arrival')).toBeNull();
  });

  it('excludes a purchase with no stored receiving_status at all', () => {
    setData({
      inventory: [
        purchase({ id: 'inv1', receiving_status: null, product_name: 'Legacy untracked' }),
        purchase({ id: 'inv2', receiving_status: undefined, tracking_number: UPS, product_name: 'Legacy tracked' }),
      ],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('0');
    expect(inSection(INBOUND).queryByText('Legacy tracked')).toBeNull();
    openNeedsTab(INBOUND);
    expect(tabCount(INBOUND, NEEDS)).toBe('0');
    expect(inSection(INBOUND).queryByText('Legacy untracked')).toBeNull();
  });

  it('keeps only the trackable window when every receiving status is present at once', () => {
    setData({
      inventory: [
        purchase({ id: 'a', receiving_status: 'PRE_ORDER', product_name: 'A pre-order' }),
        purchase({ id: 'b', receiving_status: 'PURCHASED', product_name: 'B purchased' }),
        purchase({ id: 'c', receiving_status: 'INBOUND', tracking_number: UPS, product_name: 'C inbound' }),
        purchase({ id: 'd', receiving_status: 'ON_HAND', product_name: 'D on hand' }),
        purchase({ id: 'e', receiving_status: null, product_name: 'E no status' }),
      ],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('1');
    expect(tabCount(INBOUND, NEEDS)).toBe('2');
    expect(inSection(INBOUND).getByText('C inbound')).toBeTruthy();
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).getByText('A pre-order')).toBeTruthy();
    expect(inSection(INBOUND).getByText('B purchased')).toBeTruthy();
    expect(inSection(INBOUND).queryByText('D on hand')).toBeNull();
    expect(inSection(INBOUND).queryByText('E no status')).toBeNull();
  });
});

describe('Outbound Shipping', () => {
  it('lists an AWAITING_SHIPMENT sale under Needs Tracking #', () => {
    setData({ sales: [saleRecord({ inventory: { product_name: 'Waiting to ship' } })] });
    render(<Shipping />);
    expect(tabCount(OUTBOUND, NEEDS)).toBe('1');
    expect(tabCount(OUTBOUND, TRACKED)).toBe('0');
    openNeedsTab(OUTBOUND);
    expect(inSection(OUTBOUND).getByText('Waiting to ship')).toBeTruthy();
  });

  it('lists an OUTBOUND sale under Tracked', () => {
    setData({
      sales: [saleRecord({
        workflow_status: 'OUTBOUND', tracking_number: UPS, inventory: { product_name: 'Shipped to buyer' },
      })],
    });
    render(<Shipping />);
    expect(tabCount(OUTBOUND, TRACKED)).toBe('1');
    expect(tabCount(OUTBOUND, NEEDS)).toBe('0');
    expect(inSection(OUTBOUND).getByText('Shipped to buyer')).toBeTruthy();
    expect(inSection(OUTBOUND).getByText(UPS)).toBeTruthy();
  });

  // Paid/waiting sales are past shipping, a DIRECT_LOCAL handoff never ships at
  // all, and an exception status is off the forward path entirely.
  it.each([
    ['WAITING_FOR_PAYMENT', 'STANDARD_MARKETPLACE'],
    ['PAID', 'STANDARD_MARKETPLACE'],
    ['AWAITING_HANDOFF', 'DIRECT_LOCAL'],
    ['HANDED_OVER', 'DIRECT_LOCAL'],
    ['CANCELLED', 'STANDARD_MARKETPLACE'],
    ['RETURNED', 'STANDARD_MARKETPLACE'],
    ['DISPUTED', 'STANDARD_MARKETPLACE'],
  ])('excludes a %s sale', (workflow_status, workflow_type) => {
    setData({
      sales: [saleRecord({
        workflow_status, workflow_type, tracking_number: UPS, inventory: { product_name: 'Out of scope sale' },
      })],
    });
    render(<Shipping />);
    expect(tabCount(OUTBOUND, TRACKED)).toBe('0');
    expect(inSection(OUTBOUND).queryByText('Out of scope sale')).toBeNull();
    openNeedsTab(OUTBOUND);
    expect(tabCount(OUTBOUND, NEEDS)).toBe('0');
    expect(inSection(OUTBOUND).queryByText('Out of scope sale')).toBeNull();
  });

  it('excludes a sale with no stored workflow_status at all', () => {
    setData({
      sales: [
        saleRecord({ id: 'sale1', workflow_status: null, inventory: { product_name: 'Legacy sale untracked' } }),
        saleRecord({ id: 'sale2', workflow_status: undefined, tracking_number: UPS, inventory: { product_name: 'Legacy sale tracked' } }),
      ],
    });
    render(<Shipping />);
    expect(tabCount(OUTBOUND, TRACKED)).toBe('0');
    expect(inSection(OUTBOUND).queryByText('Legacy sale tracked')).toBeNull();
    openNeedsTab(OUTBOUND);
    expect(tabCount(OUTBOUND, NEEDS)).toBe('0');
    expect(inSection(OUTBOUND).queryByText('Legacy sale untracked')).toBeNull();
  });
});

describe('the two sections stay independent', () => {
  it('scopes each record to its own section', () => {
    setData({
      inventory: [purchase({ receiving_status: 'PURCHASED', product_name: 'Inbound only' })],
      sales: [saleRecord({ workflow_status: 'OUTBOUND', tracking_number: UPS, inventory: { product_name: 'Outbound only' } })],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, NEEDS)).toBe('1');
    expect(tabCount(OUTBOUND, TRACKED)).toBe('1');
    expect(inSection(OUTBOUND).getByText('Outbound only')).toBeTruthy();
    expect(inSection(OUTBOUND).queryByText('Inbound only')).toBeNull();
    openNeedsTab(INBOUND);
    expect(inSection(INBOUND).getByText('Inbound only')).toBeTruthy();
    expect(inSection(INBOUND).queryByText('Outbound only')).toBeNull();
  });

  it('still saves a tracking number from the Needs Tracking # tab', async () => {
    setData({ inventory: [purchase({ id: 'inv9', receiving_status: 'PURCHASED' })] });
    render(<Shipping />);
    openNeedsTab(INBOUND);
    fireEvent.change(inSection(INBOUND).getByPlaceholderText('Enter tracking number…'), { target: { value: ` ${UPS} ` } });
    fireEvent.click(inSection(INBOUND).getByRole('button', { name: /Save/ }));
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv9', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ tracking_number: UPS }),
    }));
  });
});

// A wrong tracking number used to be permanent on this page: the "Needs Tracking #"
// row that could enter one disappears the moment a number exists. The Tracked row
// now edits it in place through the very same PUT.
describe('correcting a tracking number on a Tracked row', () => {
  const FEDEX = '390244304011';
  const editButton = (title) => inSection(title).queryByRole('button', { name: 'Edit tracking number' });
  const input = (title) => inSection(title).getByLabelText('Tracking number');
  const saveButton = (title) => inSection(title).getByRole('button', { name: /Save/ });
  const cancelButton = (title) => inSection(title).getByRole('button', { name: 'Cancel' });

  const trackedPurchase = (overrides = {}) =>
    purchase({ receiving_status: 'INBOUND', tracking_number: UPS, ...overrides });

  it('offers the edit button on a tracked row and nothing to edit before a number exists', () => {
    setData({ inventory: [trackedPurchase()] });
    render(<Shipping />);
    expect(editButton(INBOUND)).toBeTruthy();

    // The untracked row has no number yet -- adding a first one is still the
    // Needs Tracking # tab's own input, not an edit affordance.
    openNeedsTab(INBOUND);
    expect(editButton(INBOUND)).toBeNull();
  });

  it('reveals an input pre-filled with the current number, replacing the read-only display', () => {
    setData({ inventory: [trackedPurchase()] });
    render(<Shipping />);
    expect(inSection(INBOUND).getByText(UPS)).toBeTruthy();

    fireEvent.click(editButton(INBOUND));
    expect(input(INBOUND).value).toBe(UPS);
    // The read-only number (and its copy chip) give way to the editor.
    expect(inSection(INBOUND).queryByText(UPS)).toBeNull();
    expect(editButton(INBOUND)).toBeNull();
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('refuses to save an emptied value — this corrects a number, it does not remove one', () => {
    setData({ inventory: [trackedPurchase()] });
    render(<Shipping />);
    fireEvent.click(editButton(INBOUND));

    expect(saveButton(INBOUND).disabled).toBe(false);
    fireEvent.change(input(INBOUND), { target: { value: '' } });
    expect(saveButton(INBOUND).disabled).toBe(true);
    fireEvent.change(input(INBOUND), { target: { value: '   ' } });
    expect(saveButton(INBOUND).disabled).toBe(true);

    fireEvent.click(saveButton(INBOUND));
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it('PUTs the corrected number, refreshes the cache and confirms, then closes the editor', async () => {
    setData({ inventory: [trackedPurchase({ id: 'inv7' })] });
    render(<Shipping />);

    fireEvent.click(editButton(INBOUND));
    fireEvent.change(input(INBOUND), { target: { value: ` ${FEDEX} ` } });
    fireEvent.click(saveButton(INBOUND));

    // The same plain record endpoint the Needs Tracking # row already uses --
    // no new action or endpoint is involved in an edit.
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/inventory/inv7', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ tracking_number: FEDEX }),
    })));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    expect(toast.success).toHaveBeenCalledWith('Tracking number saved');
    await waitFor(() => expect(inSection(INBOUND).queryByLabelText('Tracking number')).toBeNull());
    expect(editButton(INBOUND)).toBeTruthy();
  });

  it('edits an outbound sale through the sales endpoint', async () => {
    setData({ sales: [saleRecord({ id: 'sale7', workflow_status: 'OUTBOUND', tracking_number: UPS })] });
    render(<Shipping />);

    fireEvent.click(editButton(OUTBOUND));
    fireEvent.change(input(OUTBOUND), { target: { value: FEDEX } });
    fireEvent.click(saveButton(OUTBOUND));

    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/sales/sale7', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ tracking_number: FEDEX }),
    })));
  });

  it('discards the edit on Cancel, leaving the stored number untouched', () => {
    setData({ inventory: [trackedPurchase()] });
    render(<Shipping />);

    fireEvent.click(editButton(INBOUND));
    fireEvent.change(input(INBOUND), { target: { value: FEDEX } });
    fireEvent.click(cancelButton(INBOUND));

    expect(mocks.apiFetch).not.toHaveBeenCalled();
    expect(inSection(INBOUND).getByText(UPS)).toBeTruthy();
    expect(inSection(INBOUND).queryByText(FEDEX)).toBeNull();
    // Re-opening starts from the stored number again, not the abandoned draft.
    fireEvent.click(editButton(INBOUND));
    expect(input(INBOUND).value).toBe(UPS);
  });

  it('keeps the editor open with the typed value when the save fails', async () => {
    mocks.apiFetch.mockResolvedValue(new Response('{}', { status: 400 }));
    setData({ inventory: [trackedPurchase()] });
    render(<Shipping />);

    fireEvent.click(editButton(INBOUND));
    fireEvent.change(input(INBOUND), { target: { value: FEDEX } });
    fireEvent.click(saveButton(INBOUND));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(input(INBOUND).value).toBe(FEDEX);
  });

  // Out of scope on purpose: rewriting a number shared by several records means
  // updating every member of the package at once, which needs backend support
  // that does not exist yet. One assertion is enough.
  it('puts no edit button on a collapsed group sharing one tracking number', () => {
    setData({
      inventory: [
        trackedPurchase({ id: 'inv1' }),
        trackedPurchase({ id: 'inv2' }),
      ],
    });
    render(<Shipping />);
    expect(tabCount(INBOUND, TRACKED)).toBe('2');
    expect(inSection(INBOUND).queryAllByRole('button', { name: 'Edit tracking number' })).toHaveLength(0);
  });
});
