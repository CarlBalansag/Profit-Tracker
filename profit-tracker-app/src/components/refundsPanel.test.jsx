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
    fill('Money back ($)', '52.50');
    fill('Units returned to store', '1');
    fill('Date', '2026-10-05');
    fill('Note', '  price match  ');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith({ amount: 52.5, quantity: 1, date: '2026-10-05', note: 'price match' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('Money back ($)').value).toBe('');
  });

  it('allows units back with no money (amount left blank)', async () => {
    render(<RefundsPanel kind="sale" id="s1" maxUnits={2} />);
    expect(screen.getByLabelText('Units buyer sent back')).toBeInTheDocument();
    fill('Units buyer sent back', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ amount: 0, quantity: 2, note: null })));
  });

  it.each([
    [{}, 'Enter a refund amount or the number of units returned.'],
    [{ 'Money back ($)': '-1' }, 'Enter a refund amount of $0 or more.'],
    [{ 'Money back ($)': '5', 'Units returned to store': '1.5' }, 'Units must be a whole number.'],
    [{ 'Money back ($)': '5', 'Units returned to store': '4' }, 'Only 3 units can be returned here.'],
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
    fill('Money back ($)', '10');
    fill('Units returned to store', '2');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Only 1 unit is in stock');
    expect(screen.getByLabelText('Money back ($)').value).toBe('10');
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

  // ─── Info tips, price line and the "Returning everything" prefill ──────────
  const purchaseRecord = { unit_purchase_cost: 249.99, qty_purchased: 2, sales_tax: 40, shipping_cost_inbound: 10, refunded_amount: 0 };
  const saleRecord = { unit_price: 300, quantity: 2, refunded_amount: 0 };
  const fullBox = () => screen.getByRole('checkbox', { name: /Returning everything/ });

  it('explains each field from its (i) icon', () => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} />);
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'What is money back?' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('How much money the store gave back to you');
    fireEvent.mouseLeave(screen.getByRole('button', { name: 'What is money back?' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    // A tap sends hover + focus + click; it must end up open, not toggled shut.
    const units = screen.getByRole('button', { name: 'What is units returned to store?' });
    fireEvent.mouseEnter(units);
    fireEvent.focus(units);
    fireEvent.click(units);
    expect(screen.getByRole('tooltip')).toHaveTextContent('They leave your stock');
    fireEvent.blur(units);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.getByRole('button', { name: 'What is the date?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'What is the note?' })).toBeInTheDocument();
  });

  it('shows what was paid per unit next to how many can come back', () => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} record={purchaseRecord} />);
    expect(screen.getByText('Paid $269.99 each (item + tax) · Up to 2 units can come back. Saved right away.')).toBeInTheDocument();
  });

  it('prefills every unit at item price + tax, and the fields stay editable', async () => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} record={purchaseRecord} />);
    expect(screen.getByText(/Fills in 2 units and \$539\.98/)).toBeInTheDocument();
    fireEvent.click(fullBox());
    expect(screen.getByLabelText('Money back ($)').value).toBe('539.98');
    expect(screen.getByLabelText('Units returned to store').value).toBe('2');
    fill('Money back ($)', '520');
    fireEvent.click(screen.getByRole('button', { name: 'Add refund' }));
    await waitFor(() => expect(mocks.add).toHaveBeenCalledWith(expect.objectContaining({ amount: 520, quantity: 2 })));
    // A saved refund resets the checkbox with the rest of the form.
    await waitFor(() => expect(fullBox()).not.toBeChecked());
  });

  it('keeps the units in stock when the item was kept, and puts them back when unticked', () => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} record={purchaseRecord} />);
    expect(screen.queryByRole('checkbox', { name: /kept the item/ })).toBeNull();
    fireEvent.click(fullBox());
    fireEvent.click(screen.getByRole('checkbox', { name: /I kept the item and I'm still selling it/ }));
    expect(screen.getByLabelText('Money back ($)').value).toBe('539.98');
    expect(screen.getByLabelText('Units returned to store').value).toBe('0');
    fireEvent.click(screen.getByRole('checkbox', { name: /I kept the item/ }));
    expect(screen.getByLabelText('Units returned to store').value).toBe('2');
  });

  it('clears the prefill when "Returning everything" is unticked', async () => {
    render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} record={purchaseRecord} />);
    fireEvent.click(fullBox());
    fireEvent.click(screen.getByRole('checkbox', { name: /I kept the item/ }));
    fireEvent.click(fullBox());
    expect(screen.getByLabelText('Money back ($)').value).toBe('');
    expect(screen.getByLabelText('Units returned to store').value).toBe('');
    // The kept-item row slides closed, then leaves.
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /I kept the item/ })).toBeNull());
  });

  it('offers the same prefill on a sale, with "The buyer kept the item"', () => {
    render(<RefundsPanel kind="sale" id="s1" maxUnits={2} record={saleRecord} />);
    expect(screen.getByText('Sold for $300.00 each · Up to 2 units can come back. Saved right away.')).toBeInTheDocument();
    fireEvent.click(fullBox());
    expect(screen.getByLabelText('Money refunded ($)').value).toBe('600.00');
    expect(screen.getByLabelText('Units buyer sent back').value).toBe('2');
    fireEvent.click(screen.getByRole('checkbox', { name: /The buyer kept the item/ }));
    expect(screen.getByLabelText('Units buyer sent back').value).toBe('0');
  });

  it('hides the prefill when nothing can come back or no record is given', () => {
    const { rerender } = render(<RefundsPanel kind="purchase" id="inv-1" maxUnits={0} record={purchaseRecord} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    rerender(<RefundsPanel kind="purchase" id="inv-1" maxUnits={2} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
