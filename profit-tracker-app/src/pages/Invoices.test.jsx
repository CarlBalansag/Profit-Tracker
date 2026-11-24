import React from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

let invoices;
let invoicesState;
let buyers;
let billable;
let billableState;
const billableCalls = [];
const mutations = {
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  remove: { mutateAsync: vi.fn(), isPending: false },
};
const downloadFile = vi.fn();
const toast = { success: vi.fn(), error: vi.fn() };

vi.mock('../hooks/useApi', () => ({
  useInvoices: () => ({ data: invoices, isLoading: false, isError: false, refetch: vi.fn(), isFetching: false, ...invoicesState }),
  useBuyers: () => ({ data: buyers }),
  useBillableSales: (buyerId, invoiceId) => {
    billableCalls.push([buyerId, invoiceId]);
    return { data: buyerId ? billable : undefined, isLoading: false, isError: false, refetch: vi.fn(), ...billableState };
  },
  useInvoiceMutations: () => mutations,
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { username: 'Carl Resells' } }) }));
vi.mock('../utils/downloads', () => ({ downloadFile: (...args) => downloadFile(...args) }));
vi.mock('sonner', () => ({ toast: { success: (...args) => toast.success(...args), error: (...args) => toast.error(...args) } }));

import Invoices from './Invoices';

const invoice = (extra = {}) => ({
  id: 'inv-1', number: 1, buyer_id: 'b1', buyer_name: 'Wholesale Co', issue_date: '2026-11-10', due_date: '2026-11-24',
  status: 'DRAFT', overdue: false, notes: null, subtotal: 739.99, tax: 8.25, total: 748.24,
  lines: [
    { id: 'l1', sale_id: 's1', description: 'PS5 Pro', quantity: 3, unit_price: 33.33, amount: 99.99, tax: 8.25, sale_date: '2026-11-03' },
    { id: 'l2', sale_id: 's2', description: 'iPad Air', quantity: 1, unit_price: 640, amount: 640, tax: 0, sale_date: '2026-11-05' },
  ],
  ...extra,
});
const sale = (id, description, amount, tax = 0) => ({ sale_id: id, description, quantity: 1, unit_price: amount, amount, tax, sale_date: '2026-11-05' });
const wide = () => { window.matchMedia = (query) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }); };
const narrow = () => { window.matchMedia = (query) => ({ matches: query.includes('max-width'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }); };

beforeEach(() => {
  wide();
  invoices = [];
  invoicesState = {};
  buyers = [{ id: 'b1', name: 'Wholesale Co' }, { id: 'b2', name: 'Second Buyer' }];
  billable = [sale('s1', 'PS5 Pro', 100, 8.25), sale('s2', 'iPad Air', 640)];
  billableState = {};
  billableCalls.length = 0;
  for (const mutation of Object.values(mutations)) mutation.mutateAsync.mockReset();
  downloadFile.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe('Invoices list', () => {
  it('says there are none yet, and the New Invoice button opens the form', () => {
    render(<Invoices />);
    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New Invoice/ }));
    expect(screen.getByRole('dialog', { name: 'New invoice' })).toBeInTheDocument();
  });

  it('lists invoices with number, buyer, dates, status and total, and sums unpaid, overdue and paid', () => {
    invoices = [
      invoice(),
      invoice({ id: 'inv-2', number: 2, status: 'SENT', total: 100, buyer_name: 'Second Buyer' }),
      invoice({ id: 'inv-3', number: 3, status: 'SENT', overdue: true, total: 50 }),
      invoice({ id: 'inv-4', number: 4, status: 'PAID', total: 20 }),
    ];
    render(<Invoices />);
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('#0001');
    expect(rows[0]).toHaveTextContent('Wholesale Co');
    expect(rows[0]).toHaveTextContent('Nov 10, 2026');
    expect(rows[0]).toHaveTextContent('Nov 24, 2026');
    expect(rows[0]).toHaveTextContent('Draft');
    expect(rows[0]).toHaveTextContent('$748.24');
    expect(rows[1]).toHaveTextContent('Unpaid');
    expect(rows[2]).toHaveTextContent('Overdue');
    expect(rows[3]).toHaveTextContent('Paid');
    expect(screen.getByText('Unpaid', { selector: 'dt' }).nextSibling).toHaveTextContent('$150.00');
    expect(screen.getByText('Overdue', { selector: 'dt' }).nextSibling).toHaveTextContent('$50.00');
    expect(screen.getByText('Paid', { selector: 'dt' }).nextSibling).toHaveTextContent('$20.00');
  });

  it('searches by number, buyer or item and filters by status, overdue included', () => {
    invoices = [
      invoice(),
      invoice({ id: 'inv-2', number: 2, status: 'SENT', overdue: true, buyer_name: 'Second Buyer', lines: [{ id: 'x', sale_id: 's9', description: 'Switch 2', quantity: 1, unit_price: 5, amount: 5, tax: 0 }] }),
    ];
    render(<Invoices />);
    const count = () => screen.queryAllByRole('row').slice(1).length;
    const search = screen.getByLabelText(/Search invoices/);
    fireEvent.change(search, { target: { value: 'switch' } });
    expect(count()).toBe(1);
    fireEvent.change(search, { target: { value: 'wholesale' } });
    expect(count()).toBe(1);
    fireEvent.change(search, { target: { value: '#0002' } });
    expect(count()).toBe(1);
    fireEvent.change(search, { target: { value: 'nothing like this' } });
    expect(screen.getByText('No invoices match your search and filter.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'OVERDUE' } });
    expect(count()).toBe(1);
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'SENT' } });
    expect(screen.getByText('No invoices match your search and filter.')).toBeInTheDocument();
  });

  it('shows cards instead of a table on a phone', () => {
    narrow();
    invoices = [invoice()];
    render(<Invoices />);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = screen.getByText('#0001').closest('li');
    expect(card).toHaveTextContent('Wholesale Co');
    expect(card).toHaveTextContent('$748.24');
    expect(card).toHaveTextContent('2 sales');
  });

  it('shows the load error instead of an empty list when invoices fail to load', () => {
    invoicesState = { isError: true };
    render(<Invoices />);
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load your invoices");
    expect(screen.queryByText('No invoices yet')).not.toBeInTheDocument();
  });
});

describe('invoice actions', () => {
  it('downloads the PDF with the invoice number and buyer in the file name', () => {
    invoices = [invoice({ number: 12 })];
    render(<Invoices />);
    fireEvent.click(screen.getByRole('button', { name: 'Download invoice #0012 as PDF' }));
    const [name, bytes, type] = downloadFile.mock.calls[0];
    expect(name).toBe('invoice-0012-Wholesale-Co.pdf');
    expect(type).toBe('application/pdf');
    const file = String.fromCharCode(...bytes);
    expect(file.startsWith('%PDF-1.4')).toBe(true);
    expect(file).toContain('(Carl Resells)');
    expect(file).toContain('($748.24)');
  });

  it('steps a draft to sent and a sent invoice to paid, and offers no step after that', async () => {
    invoices = [invoice(), invoice({ id: 'inv-2', number: 2, status: 'SENT' }), invoice({ id: 'inv-3', number: 3, status: 'PAID' }), invoice({ id: 'inv-4', number: 4, status: 'CANCELLED' })];
    mutations.update.mutateAsync.mockResolvedValue({});
    render(<Invoices />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark sent' })); });
    expect(mutations.update.mutateAsync).toHaveBeenLastCalledWith({ id: 'inv-1', status: 'SENT' });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark paid' })); });
    expect(mutations.update.mutateAsync).toHaveBeenLastCalledWith({ id: 'inv-2', status: 'PAID' });
    expect(screen.getAllByRole('button', { name: /^Mark / })).toHaveLength(2);
  });

  it('tells you when a status change is refused', async () => {
    invoices = [invoice()];
    mutations.update.mutateAsync.mockRejectedValue(new Error('Invoice not found'));
    render(<Invoices />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Mark sent' })); });
    expect(toast.error).toHaveBeenCalledWith('Invoice not found');
  });

  it('deletes only after confirming, and going back deletes nothing', async () => {
    invoices = [invoice()];
    mutations.remove.mutateAsync.mockResolvedValue({ deleted: true });
    render(<Invoices />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete invoice #0001' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete invoice #0001?' });
    expect(dialog).toHaveTextContent('Removes this $748.24 invoice to Wholesale Co for good. Its sales stay in your records');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(mutations.remove.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete invoice #0001' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete invoice' })); });
    expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('inv-1');
  });
});

describe('new invoice form', () => {
  const open = () => {
    render(<Invoices />);
    fireEvent.click(screen.getByRole('button', { name: /New Invoice/ }));
    return screen.getByRole('dialog', { name: 'New invoice' });
  };
  const save = () => act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create invoice' })); });

  it('needs a buyer and at least one sale before it saves', async () => {
    const dialog = open();
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose who the invoice is for.');
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b1' } });
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Tick at least one sale');
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('totals the ticked sales with tax and saves the buyer, sales, dates and notes', async () => {
    mutations.create.mutateAsync.mockResolvedValue({ number: 5 });
    const dialog = open();
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b1' } });
    expect(billableCalls.at(-1)).toEqual(['b1', null]);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(dialog).toHaveTextContent('Subtotal$740.00');
    expect(dialog).toHaveTextContent('Sales tax$8.25');
    expect(dialog).toHaveTextContent('Total for 2 sales$748.25');
    fireEvent.click(screen.getByLabelText(/iPad Air/));
    expect(dialog).toHaveTextContent('Total for 1 sale$108.25');
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-24' } });
    fireEvent.change(screen.getByLabelText(/Notes on the invoice/), { target: { value: '  Net 14  ' } });
    await save();
    expect(mutations.create.mutateAsync).toHaveBeenCalledWith({ buyer_id: 'b1', sale_ids: ['s1'], issue_date: '2026-11-10', due_date: '2026-11-24', notes: 'Net 14' });
    expect(toast.success).toHaveBeenCalledWith('Invoice #0005 created');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clears the ticked sales when the buyer changes', () => {
    const dialog = open();
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByLabelText(/PS5 Pro/));
    expect(dialog).toHaveTextContent('Total for 1 sale');
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b2' } });
    expect(dialog).not.toHaveTextContent('Total for');
    expect(screen.getByLabelText(/PS5 Pro/)).not.toBeChecked();
  });

  it('refuses a due date before the invoice date and keeps the form open when the save fails', async () => {
    const dialog = open();
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b1' } });
    fireEvent.click(screen.getByLabelText(/PS5 Pro/));
    fireEvent.change(screen.getByLabelText('Invoice date'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-01' } });
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent("The due date can't be before the invoice date.");
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-20' } });
    mutations.create.mutateAsync.mockRejectedValue(new Error('One of those sales is already on another invoice.'));
    await save();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('One of those sales is already on another invoice.');
    expect(screen.getByLabelText(/PS5 Pro/)).toBeChecked();
    // Retry works.
    mutations.create.mutateAsync.mockResolvedValue({ number: 6 });
    await save();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains an empty buyer list and a buyer with nothing to bill, and Cancel saves nothing', () => {
    buyers = [];
    const dialog = open();
    expect(dialog).toHaveTextContent('No buyers yet.');
    cleanup();
    buyers = [{ id: 'b1', name: 'Wholesale Co' }];
    billable = [];
    const second = open();
    fireEvent.change(screen.getByLabelText('Buyer'), { target: { value: 'b1' } });
    expect(second).toHaveTextContent('No sales to bill for this buyer.');
    fireEvent.click(within(second).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('editing an invoice', () => {
  it('opens a draft with its sales ticked and saves changed sales, dates and status', async () => {
    invoices = [invoice()];
    mutations.update.mutateAsync.mockResolvedValue({});
    render(<Invoices />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice #0001' }));
    expect(billableCalls.at(-1)).toEqual(['b1', 'inv-1']);
    expect(screen.queryByLabelText('Buyer')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/PS5 Pro/)).toBeChecked();
    fireEvent.click(screen.getByLabelText(/iPad Air/));
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-12-01' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 'inv-1', issue_date: '2026-11-10', due_date: '2026-12-01', notes: null, sale_ids: ['s1'] });
  });

  it('locks the sales of a sent invoice and sends only dates, notes and a changed status', async () => {
    invoices = [invoice({ status: 'SENT', notes: 'Net 14' })];
    mutations.update.mutateAsync.mockResolvedValue({});
    render(<Invoices />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice #0001' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('The sales can only be changed while an invoice is a draft.');
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(billableCalls.at(-1)[0]).toBeNull();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CANCELLED' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); });
    expect(mutations.update.mutateAsync).toHaveBeenCalledWith({ id: 'inv-1', issue_date: '2026-11-10', due_date: '2026-11-24', notes: 'Net 14', status: 'CANCELLED' });
  });
});
