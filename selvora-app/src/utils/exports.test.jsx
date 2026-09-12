import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import JSZip from 'jszip';
import { DataExport } from '../components/Settings/DataExport';
import { csvText, shareCard } from './downloads';
import { exportSnapshot, receiptArchive, transactionExport } from './exportData';

const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn(), json: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.request }));
vi.mock('./downloads', async original => ({ ...await original(), downloadFile: mocks.download, downloadJSON: mocks.json }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const response = data => ({ ok: true, json: async () => data });
describe('data exports', () => {
  it('exports selected categories only, deduplicates reads and keeps recurring reads side-effect free', async () => {
    const request = vi.fn(async path => response(path.includes('inventory') ? [{ id: 'a', qty_on_hand: 1 }, { id: 'b', qty_on_hand: 0 }] : []));
    const snapshot = await exportSnapshot(['Inventory', 'Transactions', 'Expenses'], request);
    expect(Object.keys(snapshot.data)).toEqual(['Inventory', 'Transactions', 'Expenses']);
    expect(snapshot.data.Inventory).toHaveLength(1);
    expect(snapshot.data.Transactions).toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenCalledWith('/api/recurring-expenses?export=true', { exactCurrency: true });
  });
  it('rejects empty/unavailable selections without requests', async () => {
    const request = vi.fn();
    await expect(exportSnapshot([], request)).rejects.toThrow('Select');
    await expect(exportSnapshot(['Buyers'], request)).rejects.toThrow('Select');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated, failed and malformed data responses', async () => {
    for (const result of [{ ok: false, status: 401 }, { ok: false, status: 500 }, response({ error: 'bad' })]) {
      await expect(exportSnapshot(['Accounts'], async () => result)).rejects.toThrow();
    }
  });
  it('escapes CSV quotes, commas, newlines and spreadsheet formulas while retaining negative numbers', () => {
    expect(csvText([{ product: '=SUM(1,2)', note: 'a"b\nc', profit: -5 }])).toBe('"product","note","profit"\r\n"\'=SUM(1,2)","a""b\nc","-5.00"');
    expect(csvText([])).toBe('');
  });
  it('uses full purchase records and allocated sale costs, excluding cancelled profit', () => {
    const rows = transactionExport([{ product_name: 'Item', qty_purchased: 2, unit_purchase_cost: 10, fees: 2, sales: [{ quantity: 1, unit_price: 15, status: 'SOLD' }, { quantity: 1, unit_price: 15, status: 'CANCELLED' }] }]);
    expect(rows.map(row => row.cost)).toEqual([22, 11, 11]);
    expect(rows.map(row => row.profit)).toEqual([null, 4, 0]);
  });
  it('produces a valid share SVG with escaped labels and the displayed financial values', () => {
    const svg = shareCard({ totalRevenue: 50, profit: -10, inventoryValue: 20 }, '<Cash & Sale>', 'All Time');
    expect(svg).toContain('&lt;Cash &amp; Sale&gt;');
    expect(svg).toContain('Realized profit: -$10.00');
    expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
  });
  it('archives selected receipts once with safe filenames and without credentials', async () => {
    const item = { id: '../id', receipt_url: 'https://res.cloudinary.com/demo/test.pdf' };
    const request = vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/pdf' }), arrayBuffer: async () => new Uint8Array([1, 2]).buffer }));
    const bytes = await receiptArchive({ data: { Inventory: [item], Transactions: [item] } }, request);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).toContain('receipts/purchase-___id.pdf');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ credentials: 'omit', redirect: 'error' });
  });
  it('supports an archive without receipts and rejects unavailable receipts and oversized exports', async () => {
    expect((await JSZip.loadAsync(await receiptArchive({ data: {} }))).file('data.json')).toBeTruthy();
    await expect(receiptArchive({ data: { Inventory: [{ id: 'a', receipt_url: 'https://other.example/a' }] } })).rejects.toThrow('unsupported');
    const snapshot = { data: { Inventory: [{ id: 'a', receipt_url: 'https://res.cloudinary.com/a' }] } };
    await expect(receiptArchive(snapshot, async () => ({ ok: false }))).rejects.toThrow('could not');
    await expect(receiptArchive(snapshot, async () => ({ ok: true, headers: new Headers({ 'content-length': '52428801' }) }))).rejects.toThrow('50 MB');
  });
  it('selects/deselects available categories and disables unfinished selections and empty exports', () => {
    render(<DataExport />);
    expect(screen.getByRole('checkbox', { name: /Buyers/ }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Deselect all' }));
    expect(screen.getByRole('button', { name: 'Export as JSON' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Export as JSON' }).disabled).toBe(false);
  });
  it('retains selections after failure and supports retry without duplicate submission', async () => {
    mocks.request.mockResolvedValue({ ok: false, status: 500 });
    render(<DataExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    await screen.findByRole('alert');
    expect(mocks.json).not.toHaveBeenCalled();
    mocks.request.mockResolvedValue(response([]));
    fireEvent.click(screen.getByRole('button', { name: 'Export as JSON' }));
    await waitFor(() => expect(mocks.json).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
