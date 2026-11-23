// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreOrderImport } from './StoreOrderImport';
import { trimOrderCsv } from '../../utils/orderCsv';

const preview = { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
const commit = { mutateAsync: vi.fn(), isPending: false };
let amazonAccounts = [];

vi.mock('../../hooks/useApi', () => ({
  usePlatforms: () => ({ data: [
    { id: 'eb', name: 'ElectronicsBuyer', type: 'Cashout' },
    { id: 'amazon', name: 'Amazon', type: 'Vendor', accounts: amazonAccounts },
  ] }),
  usePaymentMethods: () => ({ data: [{ id: 'visa', name: 'Chase Prime Visa' }, { id: 'mc', name: 'Citi MC' }] }),
  useStoreOrderCosts: () => ({ preview, commit }),
}));
vi.mock('../../hooks/useMatchMedia', () => ({ useMatchMedia: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const line = (index, over) => ({ index, orderId: `112-${index}`, orderDate: '2026-11-16', name: `Line ${index}`, qty: 2, tracking: [], perUnit: { cost: 40, tax: 3, shipping: 0 }, payment: 'Visa - 4242', paymentMethodId: 'visa', ...over });
const RESULT = {
  source: 'amazon',
  sourceName: 'Amazon',
  summary: { lines: 5, problems: 1, costNeeded: 3, byTracking: 1, byName: 1, unmatched: 1 },
  purchases: [
    { id: 'p1', name: 'Fire TV Stick 4K', date: '2026-11-19', qty: 2, cashout: 'EB', lineIndex: 0, match: 'tracking', candidates: [0, 1], review: null },
    { id: 'p2', name: 'Nintendo Switch 2', date: '2026-11-20', qty: 1, cashout: 'EB', lineIndex: 2, match: 'name', candidates: [2], review: 'Matched by name and date. Check it\'s the right order.' },
    { id: 'p3', name: 'Kindle', date: '2026-11-21', qty: 1, cashout: 'EB', lineIndex: null, match: 'none', candidates: [], review: null },
  ],
  lines: [line(0), line(1, { perUnit: { cost: 25, tax: 1.75, shipping: 0 } }), line(2, { qty: 1, perUnit: { cost: 449.99, tax: 31.5, shipping: 5.99 }, paymentMethodId: null, payment: 'Discover - 1111' })],
};

const upload = async (text = 'Order ID,Product Name,Unit Price,Quantity\n1,X,5,1') => {
  const file = new File([text], 'Retail.OrderHistory.1.csv', { type: 'text/csv' });
  fireEvent.change(document.getElementById('store-order-file'), { target: { files: [file] } });
  await waitFor(() => expect(preview.mutateAsync).toHaveBeenCalled());
  await act(async () => {});
};

afterEach(cleanup);

describe('trimOrderCsv', () => {
  it('keeps only the columns the server reads, so addresses never upload', () => {
    const csv = '"Order ID","Shipping Address","Product Name","Unit Price"\n"112-1","1 Main St, Town","Echo, Dot","9.99"\n';
    expect(trimOrderCsv(csv)).toBe('Order ID,Product Name,Unit Price\n112-1,"Echo, Dot",9.99');
  });
  it('reads a file that starts with a byte-order mark', () => {
    expect(trimOrderCsv('\uFEFF"Order ID","Billing Address"\n1,x')).toBe('Order ID\n1');
  });
  it('sends an unknown file as is, so the server can explain', () => {
    expect(trimOrderCsv('a,b\n1,2')).toBe('a,b\n1,2');
  });
});

describe('StoreOrderImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    amazonAccounts = [];
    preview.mutateAsync.mockResolvedValue(RESULT);
    commit.mutateAsync.mockResolvedValue({ updated: 2, skipped: 0 });
  });

  it('uploads only the kept columns and previews the matches', async () => {
    render(<StoreOrderImport />);
    await upload('Order ID,Billing Address,Product Name,Unit Price,Quantity\n1,secret,X,5,1');
    expect(preview.mutateAsync).toHaveBeenCalledWith({ source: 'amazon', files: [{ id: 1, csv: 'Order ID,Product Name,Unit Price,Quantity\n1,X,5,1', accountId: null }] });
    const dialog = screen.getByRole('dialog', { name: 'Review costs' });
    expect(dialog).toHaveTextContent('Waiting for a cost3');
    // $40 x 2 + $6 tax, and $449.99 + $31.50 tax + $5.99 shipping.
    expect(dialog).toHaveTextContent('Will be saved$573.48');
    expect(screen.getByText(/Matched by name and date/)).toBeInTheDocument();
    expect(screen.getByText('No matching order (1)')).toBeInTheDocument();
    expect(screen.queryByLabelText('Save cost for Kindle')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Store, where none is set')).toHaveValue('amazon');
  });

  it('saves the matched rows with tax and shipping for the purchase\'s quantity', async () => {
    render(<StoreOrderImport />);
    await upload();
    fireEvent.change(screen.getByLabelText('Card, where the order\'s card isn\'t recognized'), { target: { value: 'mc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save costs for 2 purchases' }));
    await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
    expect(commit.mutateAsync).toHaveBeenCalledWith({
      source: 'amazon', vendor_id: 'amazon', payment_method_id: 'mc', use_order_date: true,
      items: [
        { inventory_id: 'p1', unit_cost: '40', sales_tax: 6, shipping: 0, order_number: '112-0', order_date: '2026-11-16', payment_method_id: 'visa', account_id: null },
        { inventory_id: 'p2', unit_cost: '449.99', sales_tax: 31.5, shipping: 5.99, order_number: '112-2', order_date: '2026-11-16', payment_method_id: null, account_id: null },
      ],
    });
    expect(await screen.findByText(/Filled in the cost on 2 purchases/)).toBeInTheDocument();
  });

  it('with several Amazon accounts, reads one file per account together and saves each order\'s account', async () => {
    amazonAccounts = [{ id: 'cb', name: 'CBAmazon', status: 'Active' }, { id: 'bizz', name: 'Bizz', username: 'bizz1', status: 'Active' }];
    preview.mutateAsync.mockResolvedValue({
      ...RESULT,
      summary: { ...RESULT.summary, files: [{ id: 1, accountId: 'cb', lines: 3, problems: 1, duplicates: 0 }, { id: 2, accountId: 'bizz', lines: 2, problems: 0, duplicates: 1 }] },
      lines: [line(0, { accountId: 'cb', accountName: 'CBAmazon' }), line(1), line(2, { qty: 1, accountId: 'bizz', accountName: 'Bizz', perUnit: { cost: 449.99, tax: 31.5, shipping: 5.99 } })],
    });
    render(<StoreOrderImport />);
    const add = async (name) => {
      fireEvent.change(document.getElementById('store-order-file'), { target: { files: [new File(['Order ID,Product Name,Unit Price,Quantity\n1,X,5,1'], name)] } });
      await screen.findByLabelText(`Amazon account for ${name}`);
    };
    // With two accounts nothing is read until each file has its account.
    await add('cb.csv');
    expect(preview.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Amazon account for cb.csv')).toHaveValue('');
    expect(screen.getByText('Pick its account to use this file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review costs' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Amazon account for cb.csv'), { target: { value: 'cb' } });
    expect(screen.getByText('Not read yet')).toBeInTheDocument();
    await add('bizz.csv');
    expect(screen.getAllByRole('option', { name: 'Bizz (bizz1)' })).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Amazon account for bizz.csv'), { target: { value: 'bizz' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Review costs from 2 files' })); });
    expect(preview.mutateAsync).toHaveBeenCalledWith({ source: 'amazon', files: [
      { id: 1, csv: 'Order ID,Product Name,Unit Price,Quantity\n1,X,5,1', accountId: 'cb' },
      { id: 2, csv: 'Order ID,Product Name,Unit Price,Quantity\n1,X,5,1', accountId: 'bizz' },
    ] });
    // The order picker names the account an order came from.
    expect(screen.getAllByRole('option', { name: /^112-0 · CBAmazon · 2026-11-16/ }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save costs for 2 purchases' }));
    await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
    expect(commit.mutateAsync.mock.calls[0][0].items.map((i) => i.account_id)).toEqual(['cb', 'bizz']);
  });

  it('keeps the files after Cancel so an account can be changed, and removes one', async () => {
    render(<StoreOrderImport />);
    await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Retail.OrderHistory.1.csv')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Retail.OrderHistory.1.csv' }));
    expect(screen.queryByText('Retail.OrderHistory.1.csv')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review costs/ })).not.toBeInTheDocument();
  });

  it('switching to another order line takes its cost; unticking leaves the row out', async () => {
    render(<StoreOrderImport />);
    await upload();
    fireEvent.change(screen.getByLabelText('Order for Fire TV Stick 4K'), { target: { value: '1' } });
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('25');
    fireEvent.click(screen.getByLabelText('Save cost for Nintendo Switch 2'));
    fireEvent.click(screen.getByRole('button', { name: 'Save costs for 1 purchase' }));
    await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
    const { items } = commit.mutateAsync.mock.calls[0][0];
    expect(items).toEqual([expect.objectContaining({ inventory_id: 'p1', unit_cost: '25', sales_tax: 3.5, order_number: '112-1' })]);
  });

  it('refuses a $0 or blank cost before sending, and shows a server error', async () => {
    render(<StoreOrderImport />);
    await upload();
    fireEvent.change(screen.getByLabelText('Cost per unit for Fire TV Stick 4K'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save costs for 2 purchases' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Fire TV Stick 4K');
    expect(commit.mutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Cost per unit for Fire TV Stick 4K'), { target: { value: '41' } });
    commit.mutateAsync.mockRejectedValueOnce(new Error('Pick one of your stores.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save costs for 2 purchases' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pick one of your stores.');
    // The preview stays, so the user can fix and retry.
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('41');
  });

  it('closes without saving on Cancel or Escape', async () => {
    render(<StoreOrderImport />);
    await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await upload();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(commit.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows a file error from the server', async () => {
    preview.mutateAsync.mockRejectedValueOnce(new Error('This doesn\'t look like an Amazon order export'));
    render(<StoreOrderImport />);
    await upload();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Amazon order export/);
  });
});
