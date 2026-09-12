import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(), error: vi.fn() }));
const purchase = { id: 'purchase', product_name: 'Fixture', qty_purchased: 5, qty_on_hand: 3, unit_purchase_cost: 100, sales_tax: 40, shipping_cost_inbound: 20, fees: 10, gift_card_amount: 50, status: 'PURCHASED', vendor_id: 'vendor', payment_method_id: 'card', vendor: { name: 'Store' }, payment_method: { name: 'Card' },
  sales: [{ id: 'sale', quantity: 2, unit_price: 150, commission_fee: 15, status: 'SOLD', platform_id: 'market', platform: { name: 'Market' }, payout_date: null }] };
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
vi.mock('../hooks/useApi', () => ({ useInventory: () => ({ data: [purchase] }), usePlatforms: () => ({ data: [{ id: 'vendor', name: 'Store', type: 'Vendor' }, { id: 'market', name: 'Market', type: 'Marketplace' }] }), usePaymentMethods: () => ({ data: [{ id: 'card', name: 'Card' }] }), useInvalidate: () => ({ all: mocks.invalidate }), apiFetch: mocks.fetch }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: mocks.error } }));
beforeEach(() => { mocks.fetch.mockResolvedValue(new Response('{}')); localStorage.clear(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); });
const open = index => { render(<MemoryRouter><Transactions /></MemoryRouter>); const row = screen.getAllByText(index === 1 ? 'BUY' : 'SALE', { exact: true }).find(node => node.closest('tr')).closest('tr'); fireEvent.click(within(row).getByRole('button', { name: 'Edit row' })); };
const save = async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce()); return JSON.parse(mocks.fetch.mock.calls[0][1].body); };
describe('inline transaction edits', () => {
  it('keeps failed bulk selections for retry and respects cancellation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    mocks.fetch.mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(new Response('{}'));
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const saleRow = screen.getAllByText('SALE', { exact: true }).find(node => node.closest('tr')).closest('tr');
    fireEvent.click(within(saleRow).getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Failed to delete 1 items.'));
    expect(screen.getByRole('button', { name: 'Delete Selected' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete Selected' })).toBeNull());
    expect(mocks.fetch.mock.calls.map(([path]) => path)).toEqual(['/api/sales/sale', '/api/sales/sale']);
    expect(confirm).toHaveBeenCalledTimes(3);
  });
  it('routes a SALE deletion to the sale endpoint and preserves purchase deletion scope', async () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    const button = screen.getAllByTitle('Delete sale').find(node => node.closest('tr'));
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/sales/sale');
    expect(screen.getAllByTitle('Delete purchase and linked sales').length).toBeGreaterThan(0);
  });
  it('deduplicates a selected purchase and its sale in bulk deletion', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select records on this page' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Selected' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/inventory/purchase');
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('all their linked sales'));
    vi.restoreAllMocks();
  });
  it('preserves full purchased quantity when saving an unchanged remaining BUY row', async () => {
    open(1);
    const body = await save();
    expect(body.inventory).toMatchObject({ qty_purchased: 5, unit_purchase_cost: 100, status: 'PURCHASED', vendor_id: 'vendor', payment_method_id: 'card' });
    expect(body.sales).toEqual([]); expect(body.newSale).toBeUndefined();
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/inventory/purchase/transaction');
  });
  it('adds already-sold units when changing the remaining BUY quantity', async () => {
    open(1);
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '4' } });
    expect((await save()).inventory.qty_purchased).toBe(6);
  });
  it('saves an existing SALE and its purchase relationships in one request and keeps a failed draft', async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Save rejected' }), { status: 400 }));
    open(0);
    const body = await save();
    expect(body.sales[0]).toMatchObject({ id: 'sale', quantity: 2, unit_price: 150, platform_id: 'market', payout_date: null });
    expect(body.inventory).toMatchObject({ vendor_id: 'vendor', payment_method_id: 'card' });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Transaction update failed: Save rejected'));
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
  it('rejects fractional quantities before a request', async () => {
    open(1);
    fireEvent.change(screen.getAllByRole('spinbutton')[0], { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith('Quantity must be a whole number above zero.');
  });
});
