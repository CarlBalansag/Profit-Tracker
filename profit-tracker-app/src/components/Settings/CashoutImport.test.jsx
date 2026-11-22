// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CashoutImport } from './CashoutImport';

const preview = { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
const commit = { mutateAsync: vi.fn(), isPending: false };
const matchOrders = { mutateAsync: vi.fn(), isPending: false };
let connections;
let providers;

vi.mock('../../hooks/useApi', () => ({
  useCashoutConnections: () => ({ data: connections }),
  useCashoutProviders: () => ({ data: providers }),
  usePlatforms: () => ({ data: [
    { id: 'eb-group', name: 'ElectronicsBuyer', type: 'Cashout' },
    { id: 'p4d-group', name: 'Points4Days', type: 'Cashout' },
    { id: 'amazon', name: 'Amazon', type: 'Vendor' },
  ] }),
  usePaymentMethods: () => ({ data: [{ id: 'card', name: 'Chase Prime' }] }),
  useCashoutImport: () => ({ preview, commit }),
  useStoreOrderCosts: () => ({ preview: { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false }, commit: { mutateAsync: vi.fn(), isPending: false }, match: matchOrders }),
}));
vi.mock('../../hooks/useMatchMedia', () => ({ useMatchMedia: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const group = (over) => ({
  key: over.name, name: over.name, date: '2026-11-19', invoice: '325963', tracking: ['TBA336581719552'],
  unitPrice: 20, paid: false, qty: 2, newQty: 2, match: 'new', refs: [`eb:${over.name}`], serials: [], fee: 0, upc: null, ...over,
});
const RESULT = {
  source: 'eb',
  sourceName: 'ElectronicsBuyer',
  summary: { rows: 6, problems: 0, groups: 3, new: 2, imported: 1, existing: 0, newUnits: 3, newPayout: 56 },
  groups: [
    group({ name: 'Fire TV Stick 4K', newQty: 1, match: 'partial' }),
    group({ name: 'Fire TV Stick 4K Select', unitPrice: 18 }),
    group({ name: 'Echo Dot', newQty: 0, match: 'imported' }),
  ],
  problems: [],
};

const upload = async (text = 'csv') => {
  const file = new File([text], 'items.csv', { type: 'text/csv' });
  fireEvent.change(document.getElementById('cashout-import-file'), { target: { files: [file] } });
  await waitFor(() => expect(preview.mutateAsync).toHaveBeenCalled());
  await act(async () => {});
};

afterEach(cleanup);

describe('CashoutImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connections = [];
    providers = [{ id: 'eb' }, { id: 'la', supportsImportPull: true }, { id: 'p4d', supportsImportPull: true }];
    preview.mutateAsync.mockResolvedValue(RESULT);
    commit.mutateAsync.mockResolvedValue({ created: 2, units: 3, costNeeded: 1, skipped: 0 });
  });

  it('previews an uploaded EB file and imports only the new rows, with costs', async () => {
    render(<CashoutImport />);
    await upload('Date,Invoice #');
    expect(preview.mutateAsync).toHaveBeenCalledWith({ source: 'eb', csv: 'Date,Invoice #' });
    const dialog = screen.getByRole('dialog', { name: 'Review import' });
    expect(dialog).toHaveTextContent(/6 rows read/);
    const summary = screen.getByLabelText('Import summary');
    expect(summary).toHaveTextContent(/Will be added\s*2 purchases\s*3 units/);
    expect(summary).toHaveTextContent(/Payout\s*\$56\.00/);
    expect(summary).toHaveTextContent(/Skipped\s*2/);
    expect(screen.getByLabelText('Sales go to')).toHaveValue('eb-group');
    // Already-recorded rows are listed as skipped, not offered for import.
    expect(screen.queryByLabelText('Import Echo Dot')).not.toBeInTheDocument();
    const skipped = screen.getByLabelText('Skipped items');
    expect(skipped).toHaveTextContent(/Echo Dot.*2 of 2 · imported before/);
    expect(skipped).toHaveTextContent(/Fire TV Stick 4K.*1 of 2 · already logged with the same tracking number/);
    expect(screen.getByText('1 of 2')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Cost per unit for Fire TV Stick 4K Select'), { target: { value: '12.50' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import 2 purchases \(3 units\)/ }));
    });

    const body = commit.mutateAsync.mock.calls[0][0];
    expect(body).toMatchObject({ source: 'eb', platform_id: 'eb-group', vendor_id: null, payment_method_id: null });
    expect(body.groups.map((g) => [g.name, g.qty, g.unitCost])).toEqual([
      ['Fire TV Stick 4K', 1, null],
      ['Fire TV Stick 4K Select', 2, '12.50'],
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(/Imported 2 purchases \(3 units\).*1 has no cost yet/);
  });

  it('fills costs from an Amazon export added in the review, and imports them with the order', async () => {
    const line = (index, over) => ({ index, orderId: `112-${index}`, orderDate: '2026-11-16', name: `Amazon line ${index}`, qty: 2, tracking: ['TBA336581719552'], perUnit: { cost: 44.99, tax: 3.5, shipping: 0 }, payment: 'Visa - 4242', paymentMethodId: 'card', ...over });
    matchOrders.mutateAsync.mockResolvedValue({
      source: 'amazon',
      sourceName: 'Amazon',
      summary: { lines: 3, problems: 0, byTracking: 1, byName: 0, unmatched: 1 },
      matches: [
        { key: 'Fire TV Stick 4K', lineIndex: 0, match: 'tracking', candidates: [0, 1], review: null },
        { key: 'Fire TV Stick 4K Select', lineIndex: null, match: 'none', candidates: [], review: null },
      ],
      lines: [line(0), line(1, { perUnit: { cost: 24.99, tax: 1.75, shipping: 0 } })],
    });
    render(<CashoutImport />);
    await upload();
    const file = new File(['"Order ID","Shipping Address","Product Name"\n1,secret,X'], 'Retail.OrderHistory.1.csv', { type: 'text/csv' });
    fireEvent.change(document.getElementById('cashout-import-orders-file'), { target: { files: [file] } });
    await waitFor(() => expect(matchOrders.mutateAsync).toHaveBeenCalled());
    await act(async () => {});
    // Only the needed columns go up, with the rows about to be imported.
    expect(matchOrders.mutateAsync.mock.calls[0][0]).toEqual({
      source: 'amazon',
      csv: 'Order ID,Product Name\n1,X',
      groups: [
        { key: 'Fire TV Stick 4K', name: 'Fire TV Stick 4K', date: '2026-11-19', qty: 1, tracking: ['TBA336581719552'] },
        { key: 'Fire TV Stick 4K Select', name: 'Fire TV Stick 4K Select', date: '2026-11-19', qty: 2, tracking: ['TBA336581719552'] },
      ],
    });
    expect(screen.getByText(/1 matched by tracking/)).toBeInTheDocument();
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('44.99');
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K Select')).toHaveValue('');

    // Switching to the other order line takes its cost.
    fireEvent.change(screen.getByLabelText('Order for Fire TV Stick 4K'), { target: { value: '1' } });
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('24.99');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import 2 purchases/ }));
    });
    const [first, second] = commit.mutateAsync.mock.calls[0][0].groups;
    expect(first).toMatchObject({ unitCost: '24.99', salesTax: 1.75, shipping: 0, orderNumber: '112-1', orderDate: '2026-11-16', orderStore: 'Amazon', vendorId: 'amazon', paymentMethodId: 'card' });
    expect(second.orderNumber).toBeUndefined();
    expect(second.unitCost).toBeNull();
  });

  it('removing the Amazon file drops the costs it filled but keeps typed ones', async () => {
    matchOrders.mutateAsync.mockResolvedValue({
      source: 'amazon', sourceName: 'Amazon',
      summary: { lines: 1, problems: 0, byTracking: 2, byName: 0, unmatched: 0 },
      matches: [
        { key: 'Fire TV Stick 4K', lineIndex: 0, match: 'tracking', candidates: [0], review: null },
        { key: 'Fire TV Stick 4K Select', lineIndex: 0, match: 'tracking', candidates: [0], review: null },
      ],
      lines: [{ index: 0, orderId: '112-0', orderDate: '2026-11-16', name: 'X', qty: 3, tracking: [], perUnit: { cost: 30, tax: 0, shipping: 0 }, payment: null, paymentMethodId: null }],
    });
    render(<CashoutImport />);
    await upload();
    fireEvent.change(screen.getByLabelText('Cost per unit for Fire TV Stick 4K Select'), { target: { value: '12' } });
    fireEvent.change(document.getElementById('cashout-import-orders-file'), { target: { files: [new File(['Order ID\n1'], 'a.csv')] } });
    await waitFor(() => expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('30'));
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K Select')).toHaveValue('12');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K')).toHaveValue('');
    expect(screen.getByLabelText('Cost per unit for Fire TV Stick 4K Select')).toHaveValue('12');
    expect(screen.queryByLabelText('Order for Fire TV Stick 4K')).not.toBeInTheDocument();
  });

  it('leaves out rows the user unticks', async () => {
    render(<CashoutImport />);
    await upload();
    fireEvent.click(screen.getByLabelText('Import Fire TV Stick 4K'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import 1 purchase \(2 units\)/ }));
    });
    expect(commit.mutateAsync.mock.calls[0][0].groups.map((g) => g.name)).toEqual(['Fire TV Stick 4K Select']);
  });

  it('shows the server error and keeps the preview when the import fails', async () => {
    commit.mutateAsync.mockRejectedValue(new Error('Sales have to go to one of your cashouts.'));
    render(<CashoutImport />);
    await upload();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import 2 purchases/ }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Sales have to go to one of your cashouts.');
    expect(screen.getByRole('dialog', { name: 'Review import' })).toBeInTheDocument();
  });

  it('closes the review with Cancel or Escape without saving anything', async () => {
    render(<CashoutImport />);
    await upload();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await upload();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(commit.mutateAsync).not.toHaveBeenCalled();
  });

  it('shows why a file was refused', async () => {
    preview.mutateAsync.mockRejectedValue(new Error("This doesn't look like ElectronicsBuyer's Items Sold export."));
    render(<CashoutImport />);
    await upload();
    expect(screen.getByRole('alert')).toHaveTextContent(/Items Sold export/);
    expect(commit.mutateAsync).not.toHaveBeenCalled();
  });

  it('pulls LA/P4D with the saved login for a date range when connected', async () => {
    connections = [{ id: 'conn-p4d', provider: 'p4d', platformId: 'p4d-group' }];
    render(<CashoutImport />);
    fireEvent.click(screen.getByRole('radio', { name: /P4D/ }));
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-01' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Read from P4D/ }));
    });
    expect(preview.mutateAsync).toHaveBeenCalledWith({ connectionId: 'conn-p4d', from: '2026-10-01', to: '2026-11-01' });
    expect(screen.getByLabelText('Sales go to')).toHaveValue('p4d-group');
  });

  it('offers only file upload while the server cannot pull that cashout', () => {
    connections = [{ id: 'conn-p4d', provider: 'p4d', platformId: 'p4d-group' }];
    providers = [{ id: 'p4d', supportsImportPull: false }];
    render(<CashoutImport />);
    fireEvent.click(screen.getByRole('radio', { name: /P4D/ }));
    expect(screen.queryByText('Pull with saved login')).not.toBeInTheDocument();
    expect(screen.getByText('Choose P4D CSV')).toBeInTheDocument();
  });

  it('offers only file upload for EB, even when EB is connected', () => {
    connections = [{ id: 'conn-eb', provider: 'eb', platformId: 'eb-group' }];
    render(<CashoutImport />);
    expect(screen.queryByText('Pull with saved login')).not.toBeInTheDocument();
    expect(screen.getByText('Choose EB CSV')).toBeInTheDocument();
  });

  it('saves unpaid items received on or before "Paid through" as paid', async () => {
    preview.mutateAsync.mockResolvedValue({
      ...RESULT,
      groups: [group({ name: 'Old', date: '2025-12-03' }), group({ name: 'Recent', date: '2026-11-19' })],
    });
    render(<CashoutImport />);
    await upload();
    fireEvent.change(screen.getByLabelText('Paid through (optional)'), { target: { value: '2026-11-01' } });
    expect(screen.getAllByText('Paid')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Import 2 purchases/ }));
    });
    expect(commit.mutateAsync.mock.calls[0][0].groups.map((g) => [g.name, g.paid])).toEqual([['Old', true], ['Recent', false]]);
  });
});
