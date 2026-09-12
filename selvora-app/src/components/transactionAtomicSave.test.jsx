import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TransactionDetailModal from './TransactionDetailModal';
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), invalidate: vi.fn(), error: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.fetch, useInvalidate: () => ({ all: mocks.invalidate }) }));
vi.mock('sonner', () => ({ toast: { error: mocks.error } }));
const purchase = { id: '33333333-3333-4333-8333-333333333333', product_name: 'Saved purchase', qty_purchased: 5, qty_on_hand: 3, status: 'PURCHASED', unit_purchase_cost: 100, sales_tax: 40, shipping_cost_inbound: 20, fees: 10, gift_card_amount: 50, purchase_date: '2026-09-01',
  sales: [{ id: '44444444-4444-4444-8444-444444444444', quantity: 2, unit_price: 150, commission_fee: 15, sale_shipping: 12, status: 'SOLD', sale_date: '2026-09-03', payout_date: null }] };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('expanded editor atomic save', () => {
  it('uses one combined request and retains the draft on failure for retry', async () => {
    mocks.fetch.mockResolvedValueOnce(response(purchase)).mockResolvedValueOnce(response({ error: 'Sale validation failed' }, 400)).mockResolvedValueOnce(response(purchase));
    const close = vi.fn(); const saved = vi.fn();
    render(<TransactionDetailModal row={{ rawId: purchase.id }} onClose={close} onSaved={saved} />);
    await waitFor(() => expect(screen.getByDisplayValue('Saved purchase')).toBeTruthy());
    fireEvent.change(screen.getByDisplayValue('Saved purchase'), { target: { value: 'Edited purchase' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Sale validation failed'));
    expect(close).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('Edited purchase')).toBeTruthy();
    const payload = JSON.parse(mocks.fetch.mock.calls[1][1].body);
    expect(mocks.fetch.mock.calls[1][0]).toBe(`/api/inventory/${purchase.id}/transaction`);
    expect(payload.inventory).toMatchObject({ product_name: 'Edited purchase', fees: 10, gift_card_amount: 50, status: 'PURCHASED' });
    expect(payload.sales).toHaveLength(1);
    expect(payload.sales[0]).toMatchObject({ id: purchase.sales[0].id, quantity: 2, payout_date: null });
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(close).toHaveBeenCalledOnce(); expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
  it('prevents duplicate save and dismissal while the combined operation is pending', async () => {
    let finish;
    mocks.fetch.mockResolvedValueOnce(response(purchase)).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const close = vi.fn();
    render(<TransactionDetailModal row={{ rawId: purchase.id }} onClose={close} onSaved={vi.fn()} />);
    await waitFor(() => expect(screen.getByDisplayValue('Saved purchase')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Update Transaction' }));
    fireEvent.click(screen.getByRole('button', { name: /Saving/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(close).not.toHaveBeenCalled(); expect(mocks.fetch).toHaveBeenCalledTimes(2);
    finish(response(purchase));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
  });
});
