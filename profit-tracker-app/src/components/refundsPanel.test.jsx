import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RefundsPanel from './RefundsPanel';
import { localToday } from '../utils/returnWindow';

const mocks = vi.hoisted(() => ({ refunds: [], add: vi.fn(), remove: vi.fn(), isPending: false }));
vi.mock('../hooks/useApi', () => ({
  useRefunds: () => ({ data: mocks.refunds, isLoading: false }),
  useRefundMutations: () => ({ add: { mutateAsync: mocks.add, isPending: false }, remove: { mutateAsync: mocks.remove, isPending: false } }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => { vi.clearAllMocks(); mocks.refunds = []; mocks.add.mockResolvedValue({}); mocks.remove.mockResolvedValue({}); });
afterEach(cleanup);

const fill = (label, value) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('RefundsPanel', () => {
  it('records a purchase refund with amount, units, date and note, then clears the form', async () => {
    const onChanged = vi.fn();
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={3} onChanged={onChanged} />);
    expect(screen.getByText('Refunds from the store')).toBeInTheDocument();
    expect(screen.getByLabelText('Date').value).toBe(localToday());
    fill('Amount', '52.50');
    fill('Units sent back', '1');
    fill('Date', '2026-10-05');
    fill('Note', '  price match  ');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ amount: 52.5, quantity: 1, date: '2026-10-05', note: 'price match' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Amount').value).toBe('');
  });

  it('allows units back with no money (amount left blank)', async () => {
    render(<RefundsPanel kind="sale" id="s1" maxUnits={2} />);
    expect(screen.getByLabelText('Units returned by buyer')).toBeInTheDocument();
    fill('Units returned by buyer', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ amount: 0, quantity: 2, note: null })));
  });

  it.each([
    [{}, 'Enter a refund amount or the number of units returned.'],
    [{ Amount: '-1' }, 'Enter a refund amount of $0 or more.'],
    [{ Amount: '5', 'Units sent back': '1.5' }, 'Units must be a whole number.'],
    [{ Amount: '5', 'Units sent back': '4' }, 'Only 3 units can be returned here.'],
  ])('blocks %j before sending anything', async (fields, message) => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={3} />);
    for (const [label, value] of Object.entries(fields)) fill(label, value);
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('shows the server\'s reason and keeps the draft when a refund is refused', async () => {
    mocks.add.mockRejectedValueOnce(new Error('Only 1 unit is in stock to send back'));
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={3} />);
    fill('Amount', '10');
    fill('Units sent back', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 unit is in stock');
    expect(screen.getByLabelText('Amount').value).toBe('10');
  });

  it('lists refunds with a total and removes one only after confirming', async () => {
    mocks.refunds = [
      { id: 'r2', amount: 20, quantity: 1, date: '2026-10-05T12:00:00.000Z', note: 'Returned one' },
      { id: 'r1', amount: 5.5, quantity: 0, date: '2026-09-20T12:00:00.000Z', note: null },
    ];
    const onChanged = vi.fn();
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={3} onChanged={onChanged} />);
    expect(screen.getByText('−$25.50 · 1 unit back')).toBeInTheDocument();
    expect(screen.getByText('Returned one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove refund of $20.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(mocks.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove refund of $20.00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('r2'));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });

  it('explains why refunds can\'t change on a cancelled sale and hides the form', () => {
    mocks.refunds = [{ id: 'r1', amount: 10, quantity: 0, date: '2026-09-20T12:00:00.000Z' }];
    render(<RefundsPanel kind="sale" id="s1" maxUnits={2} disabledReason="Reopen it to record or remove a refund." />);
    expect(screen.getByText('Reopen it to record or remove a refund.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add refund' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove refund of $10.00' })).toBeDisabled();
  });
});
