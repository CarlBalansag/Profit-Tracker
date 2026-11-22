import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EmailRules } from './EmailRules';

const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue({}), mutate: vi.fn(), isPending: false });
const rules = { save: mutation(), remove: mutation(), addExpense: mutation() };
const orders = { automation: mutation() };
let data;
vi.mock('../../hooks/useApi', () => ({
  useEmailRules: () => ({ data }),
  useEmailAutomation: () => ({ data: { createExpenses: false } }),
  useEmailOrderMutations: () => orders,
  useEmailRuleMutations: () => rules,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(cleanup);

describe('EmailRules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    data = {
      rules: [{ id: 'r1', label: 'Claude subscription', domain: 'anthropic.com', action: 'create_expense', category: 'Software', tax_category: null }],
      suggestions: [{ merchant: 'pirateship', label: 'Pirate Ship', receipts: 3, past_expenses: 2, category: 'Shipping', tax_category: 'supplies' }],
      stores: [{ key: 'pirateship', label: 'Pirate Ship' }, { key: 'amazon', label: 'Amazon' }],
    };
  });

  it('lists rules, removes one, and turns automatic expenses on', () => {
    render(<EmailRules />);
    expect(screen.getByText('Claude subscription')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Claude subscription' }));
    expect(rules.remove.mutate).toHaveBeenCalledWith('r1');
    fireEvent.click(screen.getByLabelText('Add receipts from trusted stores as expenses automatically'));
    expect(orders.automation.mutate).toHaveBeenCalledWith({ createExpenses: true });
  });

  it('sets up a suggested store with what the user already uses', async () => {
    render(<EmailRules />);
    fireEvent.click(screen.getByRole('button', { name: 'Set up' }));
    expect(screen.getByLabelText('Expense category')).toHaveValue('Shipping');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rules.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ merchant: 'pirateship', category: 'Shipping', tax_category: 'supplies', action: 'create_expense' })));
  });

  it('adds a subscription by its sender domain', async () => {
    render(<EmailRules />);
    fireEvent.click(screen.getByRole('button', { name: /Add a trusted store/ }));
    fireEvent.change(screen.getByLabelText('Emails from'), { target: { value: 'domain' } });
    fireEvent.change(screen.getByLabelText('Sender domain'), { target: { value: 'anthropic.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(rules.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ domain: 'anthropic.com' })));
    expect(rules.save.mutateAsync.mock.calls[0][0]).not.toHaveProperty('merchant');
  });
});
