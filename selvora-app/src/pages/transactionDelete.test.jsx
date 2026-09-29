import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';

// jsdom has no ResizeObserver; Transactions.jsx uses one purely to size a scroll shadow.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const apiFetch = vi.fn();
const invalidate = { inventory: vi.fn(), sales: vi.fn(), platforms: vi.fn(), dashboard: vi.fn(), expenses: vi.fn(), paymentMethods: vi.fn(), creditCard: vi.fn(), productNote: vi.fn(), calendarEvents: vi.fn(), all: vi.fn() };

const purchase = {
  id: 'purchase-1', product_name: 'Widget', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-01-01', unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 1,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'PURCHASED', category: null, tracking_number: null,
  sales: [{ id: 'sale-1', platform: null, platform_id: '', buyer_id: null, quantity: 1, unit_price: 50, commission_fee: 0, sale_shipping: 0, sale_date: '2026-01-02', payout_date: null, status: 'SOLD', tracking_number: null }],
};

vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: [purchase], isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useInvalidate: () => invalidate,
  apiFetch: (...args) => apiFetch(...args),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const mount = () => render(<MemoryRouter><Transactions /></MemoryRouter>);

beforeEach(() => {
  apiFetch.mockReset();
  apiFetch.mockResolvedValue(new Response('{}'));
});
afterEach(cleanup);

describe('Transactions delete routing', () => {
  it('deletes a sale through the sale endpoint, not the purchase endpoint', async () => {
    mount();
    // Desktop row buttons carry a `title`; the sale row (newer date) renders above the purchase row.
    const deleteButtons = screen.getAllByTitle('Delete');
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(deleteButtons[0]);
    expect(apiFetch).toHaveBeenCalled();
    const paths = apiFetch.mock.calls.map(([path]) => path);
    expect(paths).toContain('/api/sales/sale-1');
    expect(paths).not.toContain('/api/inventory/purchase-1');
  });

  it('confirming delete on one row does not arm the sibling row sharing the same underlying item', () => {
    mount();
    const deleteButtons = screen.getAllByTitle('Delete');
    expect(deleteButtons).toHaveLength(2); // one purchase row, one sale row — same rawId, different row id
    fireEvent.click(deleteButtons[0]);
    // Only the clicked row should now show the armed "Confirm" title; the sibling stays "Delete".
    expect(screen.getAllByTitle('Delete')).toHaveLength(1);
    expect(screen.getAllByTitle('Click again to confirm delete')).toHaveLength(1);
  });
});
