import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScheduleC from './ScheduleC';
import Expenses from './Expenses';
import { ScheduleCSettings } from '../components/Settings/ScheduleCSettings';
import { emptyTaxDetails } from '../../../shared/scheduleC.mjs';
const { apiFetch, downloadFile, downloadJSON } = vi.hoisted(() => ({ apiFetch: vi.fn(), downloadFile: vi.fn(), downloadJSON: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch }));
vi.mock('../utils/downloads', async importOriginal => ({ ...await importOriginal(), downloadFile, downloadJSON }));
const response = (data, ok = true) => ({ ok, json: async () => structuredClone(data) });
const reviewed = { ...emptyTaxDetails(), business_use: 'business', payee: 'Packing Store', purpose: 'Pack orders', tax_category: 'SUPPLIES', payment_status: 'paid', paid_date: '2026-01-01', payment_reference: 'Visa Jan, 123', reviewed: true };
const row = { id: 'expense-1', name: 'Packing tape', amount: '100.00', date: '2026-01-01', tax_details: reviewed, status: 'reviewed', eligible: '100.00', issues: [], documentation_missing: true };
const report = (year = new Date().getFullYear()) => ({ year, mapping_year: 2025, planning: year !== 2025, total: '100.00', pending: 0, documentation_gaps: 1, groups: [{ id: 'SUPPLIES', label: 'Supplies / shipping supplies', line2025: '22', total: '100.00', count: 1 }], rows: [structuredClone(row)] });
const mount = component => render(<MemoryRouter>{component}</MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : report(Number(new URL(path, 'https://fixture.invalid').searchParams.get('year'))))); });
afterEach(cleanup);
describe('Schedule C workflow', () => {
  it('shows per-user opt-in rather than pretending disabled reports have totals', async () => {
    apiFetch.mockResolvedValue(response({ enabled: false })); mount(<ScheduleC />);
    await screen.findByText('Enable Schedule C preparation in Settings to use this worksheet.');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Reviewed expense total')).toBeNull();
  });
  it('shows reviewed totals, future-year caution, empty filters and exports all records with evidence and formula protection', async () => {
    mount(<ScheduleC />); await screen.findByText('Reviewed expense total');
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2030' } });
    await screen.findByText(/Planning worksheet for 2030/);
    fireEvent.change(screen.getByLabelText('Show records'), { target: { value: 'pending' } });
    expect(screen.getByText('No expenses match this view.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export supporting CSV' }));
    const csv = downloadFile.mock.calls[0][1]; expect(csv).toContain('100.00'); expect(csv).toContain('Visa Jan, 123'); expect(csv).toContain('2030'); expect(csv).toContain('reference_mapping_year');
    fireEvent.click(screen.getByRole('button', { name: 'Export worksheet JSON' })); expect(downloadJSON.mock.calls[0][1].year).toBe(2030);
  });
  it('preserves failed tax drafts, retries one tax-only request, refreshes totals and supports cancel', async () => {
    let failed = true; let savedTax;
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === 'PUT') { if (failed) return response({ error: 'Save rejected' }, false); savedTax = JSON.parse(options.body).tax_details; return response({}); }
      return response(path.includes('/preferences/') ? { enabled: true } : report());
    });
    mount(<ScheduleC />); fireEvent.click(await screen.findByRole('button', { name: 'Review Packing tape' }));
    fireEvent.change(screen.getByLabelText('Business purpose'), { target: { value: 'Boxes for online orders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save tax details' })); await screen.findByRole('alert');
    expect(screen.getByLabelText('Business purpose').value).toBe('Boxes for online orders');
    failed = false; fireEvent.click(screen.getByRole('button', { name: 'Save tax details' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(savedTax.purpose).toBe('Boxes for online orders'); expect(savedTax.reviewed).toBe(false);
    const puts = apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT'); expect(puts).toHaveLength(2); expect(Object.keys(JSON.parse(puts[1][1].body))).toEqual(['tax_details', 'expected_tax_version']);
    fireEvent.click(await screen.findByRole('button', { name: 'Review Packing tape' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('blocks false reviewed claims but permits incomplete drafts; guards duplicate save and pending cancellation', async () => {
    let release; const pending = new Promise(resolve => { release = resolve; });
    apiFetch.mockImplementation(async (path, options) => options?.method === 'PUT' ? pending : response(path.includes('/preferences/') ? { enabled: true } : report()));
    mount(<ScheduleC />); fireEvent.click(await screen.findByRole('button', { name: 'Review Packing tape' }));
    fireEvent.change(screen.getByLabelText('Payee / vendor'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Save tax details' }));
    expect(screen.getByRole('alert').textContent).toContain('Complete business details'); expect(apiFetch.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false);
    fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Save tax details' }));
    fireEvent.click(screen.getByRole('button', { name: 'Saving…' })); fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog')).toBeTruthy(); expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(1);
    release(response({})); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('retains the preference on failure and prevents duplicate toggles during retry', async () => {
    let failed = true; let release;
    apiFetch.mockImplementation(async (_path, options) => options?.method === 'PUT' ? failed ? response({ error: 'Preference failed' }, false) : new Promise(resolve => { release = resolve; }) : response({ enabled: false }));
    mount(<ScheduleCSettings />); await waitFor(() => expect(screen.getByRole('checkbox').disabled).toBe(false));
    fireEvent.click(screen.getByRole('checkbox')); await screen.findByRole('alert'); expect(screen.getByRole('checkbox').checked).toBe(false);
    failed = false; fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('checkbox')); expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT')).toHaveLength(2);
    release(response({ enabled: true })); await waitFor(() => expect(screen.getByRole('checkbox').checked).toBe(true));
  });
  it('reuses ordinary expense inputs and retains a failed new business expense without duplicate create', async () => {
    let failed = true; let payload;
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') { payload = JSON.parse(options.body); return failed ? response({ error: 'Expense failed' }, false) : response({}); }
      return response(path.includes('/preferences/') ? { enabled: true } : []);
    });
    mount(<Expenses />); await waitFor(() => expect(apiFetch.mock.calls.some(([path]) => path.includes('/preferences/'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Add Expense' }));
    await screen.findByText('Schedule C business details');
    fireEvent.change(screen.getByPlaceholderText('e.g. Packing Tape'), { target: { value: 'Packing supplies' } });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '50.00' } });
    fireEvent.change(screen.getByLabelText('Business use'), { target: { value: 'mixed' } });
    fireEvent.change(screen.getByLabelText('Business-use percentage'), { target: { value: '80' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1)); await screen.findByText('Expense failed');
    expect(screen.getByLabelText('Business-use percentage').value).toBe('80'); expect(payload.tax_details.business_use).toBe('mixed'); expect(payload.amount).toBe(50);
    failed = false; fireEvent.click(screen.getAllByRole('button', { name: 'Add Expense' }).at(-1)); await waitFor(() => expect(screen.queryByText('Schedule C business details')).toBeNull());
  });
  it('rejects malformed years and offers loading failure retry without showing stale totals', async () => {
    apiFetch.mockResolvedValueOnce(response({ error: 'Load failed' }, false)); mount(<ScheduleC />);
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByText('Reviewed expense total');
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '10000' } }); expect(screen.getByRole('alert').textContent).toContain('four-digit'); expect(screen.queryByText('Reviewed expense total')).toBeNull();
  });
});
