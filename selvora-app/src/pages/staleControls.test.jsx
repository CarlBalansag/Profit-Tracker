import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Inventory from './Inventory';
import Transactions from './Transactions';
import Invoices from './Invoices';
const mocks = vi.hoisted(() => ({ inventory: [], download: vi.fn() }));
vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
vi.mock('../hooks/useApi', () => ({
  useInventory: () => ({ data: mocks.inventory, refetch: vi.fn() }),
  usePlatforms: () => ({ data: [] }), usePaymentMethods: () => ({ data: [] }),
  useInvalidate: () => ({ all: vi.fn() }),
}));
vi.mock('../context/auth', () => ({ useAuth: () => ({ user: { id: 'a' } }) }));
vi.mock('../components/ProductNoteButton', () => ({ default: () => null }));
vi.mock('../components/TransactionDetailModal', () => ({ default: ({ row, onClose }) => <div role="dialog">{row.rawId}<button onClick={onClose}>Close detail</button></div> }));
vi.mock('../utils/downloads', async original => ({ ...await original(), downloadFile: mocks.download }));
beforeEach(() => { localStorage.clear(); mocks.inventory = Array.from({ length: 27 }, (_, index) => ({ id: `batch-${index}`, product_name: `Product ${index}`, category: 'Tools', qty_on_hand: 1, qty_purchased: 1, unit_purchase_cost: 10, purchase_date: '2026-09-01', sales: [] })); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('previously stale controls', () => {
  it('paginates 27 ledger records, exports all filtered records, resets on filtering and clears filters', () => {
    render(<MemoryRouter><Transactions /></MemoryRouter>);
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous page' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select records on this page' }));
    expect(document.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(26);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText('Page 2 of 2')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Next page' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'CSV', exact: true }));
    expect(mocks.download.mock.calls[0][1].split('\r\n')).toHaveLength(28);
    const search = screen.getByPlaceholderText(/Search/);
    fireEvent.change(search, { target: { value: 'Product 26' } });
    expect(screen.getByText('Page 1 of 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(search.value).toBe('');
    expect(screen.getByText('Page 1 of 2')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'no matches' } });
    expect(screen.getByText('Showing 0–0 of 0 records')).toBeTruthy();
  });
  it('searches inventory, exports matching stock, opens and closes an existing transaction', () => {
    render(<MemoryRouter><Inventory /></MemoryRouter>);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search inventory' }), { target: { value: 'Product 26' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export Report' }));
    expect(mocks.download.mock.calls[0][1].split('\r\n')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'View transaction for Product 26' }));
    expect(screen.getByRole('dialog').textContent).toContain('batch-26');
    fireEvent.click(screen.getByRole('button', { name: 'Close detail' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('shows batch controls for grouped inventory and routes Add Inventory to purchase creation', () => {
    mocks.inventory[1].product_name = 'Product 0';
    render(<MemoryRouter><Routes><Route path="/" element={<Inventory />} /><Route path="/add-transaction" element={<p>Create purchase</p>} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Show batches for Product 0' }));
    expect(screen.getAllByRole('button', { name: 'View transaction for Product 0' })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add Inventory' }));
    expect(screen.getByText('Create purchase')).toBeTruthy();
  });
  it('clearly disables unfinished invoice creation and filters', () => {
    render(<Invoices />);
    expect(screen.getByRole('button', { name: 'New Invoice' }).disabled).toBe(true);
    expect(screen.getByRole('textbox').disabled).toBe(true);
    expect(screen.getByRole('combobox').disabled).toBe(true);
    expect(screen.queryByText(/Create your first/)).toBeNull();
  });
});
