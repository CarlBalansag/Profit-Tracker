// The CSV button on Transactions: exports the rows the filters leave.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';

globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const mocks = vi.hoisted(() => ({ downloadFile: vi.fn(), success: vi.fn(), error: vi.fn(), inventory: [] }));

vi.mock('../utils/downloads', async (original) => ({ ...(await original()), downloadFile: mocks.downloadFile }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: mocks.success, error: mocks.error }) }));
vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: mocks.inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [{ id: 'p1', name: 'eBay', type: 'Marketplace' }] }),
  usePaymentMethods: () => ({ data: [{ id: 'pm1', name: 'Chase Ink' }] }),
  useBuyers: () => ({ data: [] }),
  useInvalidate: () => ({ all: vi.fn() }),
  apiFetch: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));

const purchase = (over = {}) => ({
  id: 'purchase-1', product_name: 'Nintendo Switch OLED', category: 'Gaming',
  vendor: { name: 'Best Buy' }, vendor_id: 'v1', payment_method: { name: 'Chase Ink' }, payment_method_id: 'pm1',
  purchase_date: '2026-02-10T12:00:00.000Z', unit_purchase_cost: 1300, qty_purchased: 2, qty_on_hand: 1,
  sales_tax: 20, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'PURCHASED', tracking_number: '1Z99999999',
  sales: [{
    id: 'sale-1', platform: { name: 'eBay' }, platform_id: 'p1', buyer_id: null, quantity: 1, unit_price: 1200,
    commission_fee: 38, sale_shipping: 10, sale_date: '2026-02-12T12:00:00.000Z', payout_date: null, status: 'SOLD',
  }],
  ...over,
});

const page = () => render(<MemoryRouter><Transactions /></MemoryRouter>);
const press = () => fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
// Rows of the last export, as objects keyed by header.
function exported() {
  const [header, ...lines] = mocks.downloadFile.mock.calls.at(-1)[1].split('\r\n')
    .map((line) => line.slice(1, -1).split('","'));
  return lines.map((cells) => Object.fromEntries(cells.map((cell, i) => [header[i], cell])));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.inventory = [purchase()];
});
afterEach(cleanup);

describe('Transactions CSV export', () => {
  it('downloads the rows on screen, sale and purchase, in the order shown', () => {
    page();
    press();
    const [name, , type] = mocks.downloadFile.mock.calls[0];
    expect(name).toBe(`transactions-${new Date().toLocaleDateString('en-CA')}.csv`);
    expect(type).toBe('text/csv;charset=utf-8');
    const [sale, buy] = exported();
    expect(sale).toMatchObject({
      Date: '2026-02-12', Type: 'Sale', Product: 'Nintendo Switch OLED', Category: 'Gaming', Vendor: 'Best Buy', Platform: 'eBay',
      Quantity: '1', Cost: '1310', 'Sale Amount': '1200', Fees: '48', 'Payment Method': 'Chase Ink', 'Purchase Tracking': '1Z99999999',
    });
    expect(buy).toMatchObject({ Date: '2026-02-10', Type: 'Purchase', Quantity: '2', Cost: '2620', 'Sale Amount': '', Fees: '', Profit: '', Platform: '' });
    expect(mocks.success).toHaveBeenCalledWith('Exported 2 rows to CSV');
  });

  it('writes a loss and thousands as plain numbers a spreadsheet can add up', () => {
    page();
    press();
    expect(exported()[0].Profit).toBe('-158'); // 1200 − 48 − 1310, no apostrophe or comma
  });

  it('exports only what the filters leave', () => {
    mocks.inventory = [purchase(), purchase({ id: 'purchase-2', product_name: 'Echo Dot', sales: [] })];
    page();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'echo' } });
    press();
    expect(exported().map((row) => row.Product)).toEqual(['Echo Dot']);
    expect(mocks.success).toHaveBeenCalledWith('Exported 1 row to CSV');
  });

  it('keeps a product name that looks like a formula as text', () => {
    mocks.inventory = [purchase({ product_name: '=HYPERLINK("x")', sales: [] })];
    page();
    press();
    expect(mocks.downloadFile.mock.calls[0][1]).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('leaves missing values blank', () => {
    mocks.inventory = [purchase({ category: null, vendor: null, payment_method: null, purchase_date: null, tracking_number: null, sales: [] })];
    page();
    press();
    expect(exported()[0]).toMatchObject({ Date: '', Category: '', Vendor: 'Direct', 'Payment Method': '', 'Purchase Tracking': '' });
  });

  it('says so instead of downloading when there is nothing to export', () => {
    mocks.inventory = [];
    page();
    press();
    expect(mocks.downloadFile).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('No transactions to export');
  });
});
