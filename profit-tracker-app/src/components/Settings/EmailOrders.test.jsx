import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailOrders } from './EmailOrders';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({ linked: 2 }), mutate: vi.fn(), isPending: false });
const m = { accept: mutation(), reject: mutation(), acceptAll: mutation(), dismiss: mutation(), automation: mutation() };
let data;
const r = { addExpense: mutation(), addPurchase: mutation(), handled: mutation(), saveInvoice: mutation() };
const calls = [];
vi.mock('../../hooks/useApi', () => ({
  useEmailOrders: (opts) => { calls.push(opts); return { data }; },
  useEmailAutomation: () => ({ data: { linkMatches: true } }),
  useEmailOrderMutations: () => m,
  useEmailMatchPreview: (id) => ({ data: id ? { match: { id, record_type: 'purchase' }, order: { store: 'Amazon', order_number: '112-1', total: '485.99', date: '2026-03-02', items: [] }, records: [{ id: 'p1', title: 'Nintendo Switch 2 Console', fields: [{ key: 'order_number', label: 'Order #', value: null, fill: '112-1' }] }], also: [] } : undefined }),
  useEmailRuleMutations: () => r,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const order = {
  id: 'o1', merchant: 'amazon', order_number: '112-1', total: '485.99', first_seen: '2026-03-02T15:00:00Z', status: 'delivered',
  matches: [{ id: 'm1', record_type: 'purchase', state: 'suggested', band: 'medium', score: 65, auto: false, will_fill: ['Order #'],
    reasons: [{ code: 'total', text: 'Same total', points: 25 }, { code: 'card_conflict', text: 'Different card', points: -5 }],
    records: [{ id: 'p1', name: 'Nintendo Switch 2 Console', amount: 449.99, date: '2026-03-02T15:00:00Z', quantity: 1 }] }],
};

describe('EmailOrders', () => {
  beforeEach(() => { data = { orders: [order], counts: { review: 2, linked: 5 }, total: 2 }; calls.length = 0; vi.clearAllMocks(); });

  it('shows what the order looks like and why, and links or rejects it', async () => {
    render(<EmailOrders found={3} />);
    expect(screen.getByText('Amazon')).toBeInTheDocument();
    expect(screen.getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText(/Nintendo Switch 2 Console/)).toBeInTheDocument();
    expect(screen.getByText('Same total')).toBeInTheDocument();
    expect(screen.getByText('Different card')).toBeInTheDocument();
    expect(screen.getByText('Will fill:')).toBeInTheDocument();
    expect(screen.getByText('Order #')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review & link/ }));
    expect(screen.getByRole('dialog', { name: 'Link this order' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Link and fill 1' }));
    await waitFor(() => expect(m.accept.mutateAsync).toHaveBeenCalledWith('m1'));
    fireEvent.click(screen.getByRole('button', { name: /Not this/ }));
    await waitFor(() => expect(m.reject.mutateAsync).toHaveBeenCalledWith('m1'));
  });

  it('links everything after asking, switches tabs and saves the auto-link switch', async () => {
    render(<EmailOrders found={3} />);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Link all 2' }));
    await waitFor(() => expect(m.acceptAll.mutateAsync).toHaveBeenCalled());
    confirm.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Linked (5)' }));
    expect(calls.at(-1)).toMatchObject({ state: 'linked' });
    fireEvent.click(screen.getByLabelText(/Link sure matches without asking/));
    expect(m.automation.mutate).toHaveBeenCalledWith({ linkMatches: false });
  });

  it('shows the home state and personal words without opening Automatic actions', () => {
    render(<EmailOrders found={3} />);
    const state = screen.getByLabelText('Your home state');
    expect(state).toBeVisible();
    expect(state.closest('details')).toBeNull();
    fireEvent.change(state, { target: { value: 'CA' } });
    expect(m.automation.mutate).toHaveBeenCalledWith({ homeState: 'CA' });
    expect(screen.getByLabelText('Always personal').closest('details')).toBeNull();
  });

  it('hides itself until emails are found', () => {
    const { container } = render(<EmailOrders found={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('creates a purchase for an order with no match, and clears a cancellation note', async () => {
    data = { orders: [{ ...order, id: 'o2', type: 'purchase', status: 'order', attention: 'cancelled', matches: [] }], counts: { unmatched: 1 }, total: 1 };
    render(<EmailOrders found={1} />);
    fireEvent.click(screen.getByRole('button', { name: /No match/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Create purchase' }));
    await waitFor(() => expect(r.addPurchase.mutateAsync).toHaveBeenCalledWith('o2'));
    expect(screen.getByText(/The store cancelled this order/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(r.handled.mutateAsync).toHaveBeenCalledWith('o2'));
  });

  it('shows every automatic action with its current setting', () => {
    render(<EmailOrders found={1} />);
    for (const label of [/Update purchases from shipping emails/, /Fill in return-by dates/, /Add likely resale orders as purchases/, /Cancel purchases the store cancelled/]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByLabelText(/Add likely resale orders as purchases/));
    expect(m.automation.mutate).toHaveBeenCalledWith({ createPurchases: true });
  });

  it('saves a PDF invoice from a linked order as the receipt', async () => {
    data = { orders: [{ ...order, id: 'o3', has_invoice: true, matches: [{ ...order.matches[0], state: 'linked', auto: true }] }], counts: { linked: 1 }, total: 1 };
    render(<EmailOrders found={1} />);
    fireEvent.click(screen.getByRole('button', { name: /Linked/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save invoice as receipt' }));
    await waitFor(() => expect(r.saveInvoice.mutateAsync).toHaveBeenCalledWith('o3'));
  });
});
