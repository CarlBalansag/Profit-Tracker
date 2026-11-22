// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StoreOrderImport } from './StoreOrderImport';
import { trimOrderCsv } from '../../utils/orderCsv';

const preview = { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
const commit = { mutateAsync: vi.fn(), isPending: false };

vi.mock('../../hooks/useApi', () => ({
  usePlatforms: () => ({ data: [
    { id: 'eb', name: 'ElectronicsBuyer', type: 'Cashout' },
    { id: 'amazon', name: 'Amazon', type: 'Vendor' },
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

const upload = async (text = 'Order ID,Product Name\n1,X') => {
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
    preview.mutateAsync.mockResolvedValue(RESULT);
    commit.mutateAsync.mockResolvedValue({ updated: 2, skipped: 0 });
  });

  it('uploads only the kept columns and previews the matches', async () => {
    render(<StoreOrderImport />);
    await upload('Order ID,Billing Address,Product Name\n1,secret,X');
    expect(preview.mutateAsync).toHaveBeenCalledWith({ source: 'amazon', csv: 'Order ID,Product Name\n1,X' });
    expect(screen.getByText(/3 purchases need a cost/)).toBeInTheDocument();
    expect(screen.getByText(/Matched by name and date/)).toBeInTheDocument();
    expect(screen.getByText(/No order with this tracking number/)).toBeInTheDocument();
    expect(screen.getByLabelText('Store, where none is set')).toHaveValue('amazon');
    expect(screen.getByLabelText('Save cost for Kindle')).toBeDisabled();
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
        { inventory_id: 'p1', unit_cost: '40', sales_tax: 6, shipping: 0, order_number: '112-0', order_date: '2026-11-16', payment_method_id: 'visa' },
        { inventory_id: 'p2', unit_cost: '449.99', sales_tax: 31.5, shipping: 5.99, order_number: '112-2', order_date: '2026-11-16', payment_method_id: null },
      ],
    });
    expect(await screen.findByText(/Filled in the cost on 2 purchases/)).toBeInTheDocument();
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

  it('shows a file error from the server', async () => {
    preview.mutateAsync.mockRejectedValueOnce(new Error('This doesn\'t look like an Amazon order export'));
    render(<StoreOrderImport />);
    await upload();
    expect(await screen.findByRole('alert')).toHaveTextContent(/Amazon order export/);
  });
});
