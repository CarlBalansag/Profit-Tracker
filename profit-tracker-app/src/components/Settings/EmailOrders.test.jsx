import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailOrders } from './EmailOrders';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({ linked: 2 }), mutate: vi.fn(), isPending: false });
const m = { accept: mutation(), reject: mutation(), acceptAll: mutation(), dismiss: mutation(), automation: mutation() };
let data;
const calls = [];
vi.mock('../../hooks/useApi', () => ({
  useEmailOrders: (opts) => { calls.push(opts); return { data }; },
  useEmailAutomation: () => ({ data: { linkMatches: true } }),
  useEmailOrderMutations: () => m,
  useEmailRuleMutations: () => ({ addExpense: m.accept }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

const order = {
  id: 'o1', merchant: 'amazon', order_number: '112-1', total: '485.99', first_seen: '2026-03-02T15:00:00Z', status: 'delivered',
  matches: [{ id: 'm1', record_type: 'purchase', state: 'suggested', band: 'medium', score: 65, auto: false,
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
    fireEvent.click(screen.getByRole('button', { name: /Yes, link/ }));
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
    fireEvent.click(screen.getByLabelText('Link sure matches without asking'));
    expect(m.automation.mutate).toHaveBeenCalledWith({ linkMatches: false });
  });

  it('hides itself until emails are found', () => {
    const { container } = render(<EmailOrders found={0} />);
    expect(container).toBeEmptyDOMElement();
  });
});
