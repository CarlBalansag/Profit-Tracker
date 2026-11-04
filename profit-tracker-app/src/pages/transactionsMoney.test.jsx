import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Transactions from './Transactions';

// jsdom has no ResizeObserver; Transactions.jsx uses one purely to size a scroll shadow.
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };

const inventory = [{
  id: 'a', product_name: 'Camera', vendor: null, vendor_id: '', payment_method: null, payment_method_id: '',
  purchase_date: '2026-01-01', unit_purchase_cost: 1000, qty_purchased: 3, qty_on_hand: 3,
  sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, status: 'PURCHASED', category: null,
  tracking_number: null, sales: [],
}];

vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: inventory, isLoading: false, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }),
  usePaymentMethods: () => ({ data: [] }),
  useBuyers: () => ({ data: [] }),
  useInvalidate: () => ({}),
  apiFetch: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', username: 'Test' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(cleanup);

describe('Transactions amounts', () => {
  it('shows thousands separators in the table', () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(screen.getAllByText('$3,000.00').length).toBeGreaterThan(0);
  });
});
