import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TodoItem from './TodoItem';

const mocks = vi.hoisted(() => ({ accept: vi.fn(), reject: vi.fn(), success: vi.fn(), error: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({
  useEmailMatchPreview: (id) => ({ data: id ? {
  match: { id: 'm1', record_type: 'sale', score: 80, reasons: [] },
  order: { store: 'Points4Days', order_number: '190261', total: '85.00', date: '2026-03-02', status: 'payout', tracking: null, items: ['Amazon Echo Dot'] },
  records: [{ id: 's1', title: 'Amazon Echo Dot', fields: [
    { key: 'product_name', label: 'Product', value: 'Amazon Echo Dot' },
    { key: 'tracking_number', label: 'Tracking #', value: null, fill: '1Z999AA10123456784' },
  ] }],
  also: ['Marks the sale paid to your Points4Days balance, from the receipt'],
} : undefined, isLoading: false, isError: false }),
  useEmailOrderMutations: () => ({
    accept: { mutateAsync: mocks.accept, isPending: false },
    reject: { mutateAsync: mocks.reject, isPending: false },
  }),
}));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const entry = {
  key: 'email-review:o1:m1', type: 'email_review', group: 'cashout', urgency: 'info', amount: 85,
  title: 'Is this Points4Days email #190261 your sale?', detail: 'Your sale: Amazon Echo Dot · Sale already marked paid',
  email_match: { id: 'm1', order_id: 'o1' }, link: { kind: 'page', to: '/settings', state: { tab: 'email' } }, actions: ['snooze', 'dismiss'],
};
const show = () => render(<MemoryRouter><ul><TodoItem entry={entry} busy={false} onAct={vi.fn()} onEdit={vi.fn()} /></ul></MemoryRouter>);

describe('an order from email on the To-Do', () => {
  it('is answered right there: Review & link shows what fills in first, or Not this', async () => {
    mocks.accept.mockResolvedValue({ linked: true });
    show();
    expect(screen.getByText('Is this Points4Days email #190261 your sale?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review and link/ }));
    expect(mocks.accept).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Link this order' });
    expect(within(dialog).getByText('1Z999AA10123456784')).toBeInTheDocument();
    expect(within(dialog).getByText('(filled in by linking)')).toBeInTheDocument();
    expect(within(dialog).getByText(/Marks the sale paid/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mocks.accept).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Review and link/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Link and fill 1' }));
    await waitFor(() => expect(mocks.accept).toHaveBeenCalledWith('m1'));
    expect(mocks.success).toHaveBeenCalledWith('Linked. Filled in 1 field.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    mocks.reject.mockRejectedValue(new Error('This match is no longer available.'));
    fireEvent.click(screen.getByRole('button', { name: /Not this/ }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('This match is no longer available.'));
  });
});
