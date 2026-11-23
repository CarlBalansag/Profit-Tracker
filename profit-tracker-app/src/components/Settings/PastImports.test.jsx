// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PastImports } from './PastImports';

const undo = { mutateAsync: vi.fn(), isPending: false, reset: vi.fn() };
const apiFetch = vi.fn();
const invalidate = vi.fn();
let imports;
let detail;

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }));
vi.mock('../../hooks/useApi', () => ({
  apiFetch: (...a) => apiFetch(...a),
  useBuyers: () => ({ data: [] }),
  useCashoutImports: () => ({ data: imports, isLoading: false, isError: false }),
  useCashoutImportDetail: () => ({ data: detail, isLoading: false, isError: false }),
  useUndoCashoutImport: () => undo,
}));
vi.mock('../TransactionDetailModal', () => ({
  default: ({ row, onClose }) => <div role="dialog" aria-label="Edit window">editing {row.rawId}<button type="button" onClick={onClose}>close edit</button></div>,
}));
const toastWithUndo = vi.fn();
vi.mock('../../utils/undoToast', () => ({ toastWithUndo: (...a) => toastWithUndo(...a) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const imp = (over) => ({
  id: 'imp-1', source: 'eb', sourceName: 'ElectronicsBuyer', cashoutName: 'EB', fileName: 'eb-items-sold.csv',
  createdAt: '2026-11-22T20:10:00.000Z', purchases: 2, units: 4, payout: 76, costNeeded: 1, remaining: 2, ...over,
});
const purchase = (over) => ({
  id: 'inv-1', name: 'Fire TV Stick 4K', purchaseDate: '2026-11-19T12:00:00.000Z', qty: 2, unitCost: 0, salesTax: 0, shipping: 0,
  costNeeded: true, orderNumber: null, store: 'Amazon', account: null, card: null,
  sales: [{ id: 's-1', qty: 2, unitPrice: 20, fee: 0, date: '2026-11-19T12:00:00.000Z', status: 'WAITING_FOR_PAYMENT', cashout: 'EB' }],
  ...over,
});

beforeEach(() => {
  imports = [imp(), imp({ id: 'imp-2', remaining: 0, fileName: null, costNeeded: 0 })];
  detail = { ...imp(), purchases: [purchase(), purchase({ id: 'inv-2', name: 'Fire TV Stick 4K Select', unitCost: 12.5, costNeeded: false, sales: [] })] };
  undo.mutateAsync.mockReset();
  apiFetch.mockReset();
  toastWithUndo.mockReset();
  invalidate.mockReset();
});
afterEach(cleanup);

describe('Past imports', () => {
  it('lists each import with what it added, and undone ones can\'t be undone again', () => {
    render(<PastImports />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('ElectronicsBuyer → EB');
    expect(rows[0]).toHaveTextContent('eb-items-sold.csv');
    expect(rows[0]).toHaveTextContent('2 purchases · 4 units · $76.00 payout · 1 imported without a cost');
    expect(rows[1]).toHaveTextContent('Undone or all deleted');
    expect(within(rows[0]).getByRole('button', { name: /^Undo/ })).toBeEnabled();
    expect(within(rows[1]).getByRole('button', { name: /^Undo/ })).toBeDisabled();
  });

  it('says so when there are none, and shows 5 until asked for all', () => {
    imports = [];
    const { unmount } = render(<PastImports />);
    expect(screen.getByText(/No imports yet/)).toBeInTheDocument();
    unmount();
    imports = Array.from({ length: 7 }, (_, i) => imp({ id: `imp-${i}` }));
    render(<PastImports />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('undoes an import after a confirm that says what goes, with Undo in the toast', async () => {
    undo.mutateAsync.mockResolvedValue({ removed: 2, sales: 2, activity_id: 'act-1' });
    render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Undo/ })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Undo this import?' });
    expect(dialog).toHaveTextContent('Deletes the 2 purchases this ElectronicsBuyer import added');
    expect(dialog).toHaveTextContent('put it all back from Activity');
    // Going back changes nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(undo.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: /^Undo/ })[0]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete 2 purchases' })); });
    expect(undo.mutateAsync).toHaveBeenCalledWith('imp-1');
    expect(toastWithUndo).toHaveBeenCalledWith('Import undone: removed 2 purchases.', 'act-1', expect.any(Function));
    expect(screen.queryByRole('dialog', { name: 'Undo this import?' })).not.toBeInTheDocument();
  });

  it('keeps the confirm open and says why when the undo is refused', async () => {
    const { toast } = await import('sonner');
    undo.mutateAsync.mockRejectedValue(new Error('Everything from this import is already gone.'));
    render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^Undo/ })[0]);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete 2 purchases' })); });
    expect(toast.error).toHaveBeenCalledWith('Everything from this import is already gone.');
    expect(screen.getByRole('dialog', { name: 'Undo this import?' })).toBeInTheDocument();
  });

  it('views an import: each purchase and its sale, with edit and delete', async () => {
    render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^View/ })[0]);
    const view = screen.getByRole('dialog', { name: 'ElectronicsBuyer import' });
    const items = within(within(view).getByRole('list', { name: 'Purchases from this import' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Bought 11/19/2026 · 2 × cost needed · Amazon');
    expect(items[0]).toHaveTextContent('Sold 11/19/2026 to EB · 2 × $20.00 · Waiting for Payment');
    expect(items[1]).toHaveTextContent('2 × $12.50');

    // Edit opens the usual edit window on that purchase; Escape there doesn't close the import.
    fireEvent.click(within(view).getByRole('button', { name: 'Edit Fire TV Stick 4K' }));
    expect(screen.getByRole('dialog', { name: 'Edit window' })).toHaveTextContent('editing inv-1');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'ElectronicsBuyer import' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'close edit' }));

    // Delete asks first, then deletes that purchase only, with Undo in the toast.
    apiFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, activity_id: 'act-9' }) });
    fireEvent.click(within(view).getByRole('button', { name: 'Delete Fire TV Stick 4K' }));
    expect(screen.getByRole('dialog', { name: 'Delete this purchase?' })).toHaveTextContent('Deletes Fire TV Stick 4K and its sale');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete purchase' })); });
    expect(apiFetch).toHaveBeenCalledWith('/api/inventory/inv-1', { method: 'DELETE' });
    expect(toastWithUndo).toHaveBeenCalledWith('Purchase deleted.', 'act-9', expect.any(Function));
    expect(invalidate).toHaveBeenCalled();

    // Undo whole import from inside the view.
    fireEvent.click(within(view).getByRole('button', { name: 'Undo whole import' }));
    expect(screen.getByRole('dialog', { name: 'Undo this import?' })).toBeInTheDocument();
  });

  it('shows a refused delete and keeps the purchase', async () => {
    const { toast } = await import('sonner');
    apiFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'Not found or access denied' }) });
    render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^View/ })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Fire TV Stick 4K' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete purchase' })); });
    expect(toast.error).toHaveBeenCalledWith('Not found or access denied');
    expect(toastWithUndo).not.toHaveBeenCalled();
  });

  it('counts what is left now, not when the window opened, in the undo confirm', () => {
    const { rerender } = render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^View/ })[0]);
    // A purchase was deleted from the view: the list comes back with one left.
    imports = [imp({ remaining: 1 })];
    rerender(<PastImports />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo whole import' }));
    expect(screen.getByRole('dialog', { name: 'Undo this import?' })).toHaveTextContent('Deletes the 1 purchase this ElectronicsBuyer import added');
    expect(screen.getByRole('button', { name: 'Delete 1 purchase' })).toBeInTheDocument();
  });

  it('says when nothing from an import is left', () => {
    detail = { ...imp({ remaining: 0 }), remaining: 0, purchases: [] };
    render(<PastImports />);
    fireEvent.click(screen.getAllByRole('button', { name: /^View/ })[0]);
    expect(screen.getByText(/Nothing from this import is left/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo whole import' })).toBeDisabled();
  });
});
