// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CashoutImport } from './CashoutImport';

const preview = { mutateAsync: vi.fn(), reset: vi.fn(), isPending: false };
const commit = { mutateAsync: vi.fn(), isPending: false };
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
}));
vi.mock('../../hooks/useMatchMedia', () => ({ useMatchMedia: () => false }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const group = (over) => ({
  key: over.name, name: over.name, date: '2026-11-19', invoice: '325963', tracking: ['TBA336581719552'],
  unitPrice: 20, paid: false, qty: 2, newQty: 2, match: 'new', refs: [`eb:${over.name}`], serials: [], commission: 0, upc: null, ...over,
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
    expect(screen.getByText(/6 rows from ElectronicsBuyer/)).toBeInTheDocument();
    expect(screen.getByLabelText('Sales go to')).toHaveValue('eb-group');
    expect(screen.getByLabelText('Import Echo Dot')).toBeDisabled();
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
    expect(screen.getByText(/6 rows from ElectronicsBuyer/)).toBeInTheDocument();
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
});
