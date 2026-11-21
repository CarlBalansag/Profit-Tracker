import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ScheduleC from './ScheduleC';
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
// The page opens on the tax estimate; these tests are about the worksheet.
const mountWorksheet = () => { const view = mount(<ScheduleC />); fireEvent.click(screen.getByRole('tab', { name: 'Worksheet' })); return view; };
beforeEach(() => { vi.clearAllMocks(); apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : report(Number(new URL(path, 'https://fixture.invalid').searchParams.get('year'))))); });
afterEach(cleanup);
describe('Schedule C workflow', () => {
  it('shows per-user opt-in rather than pretending disabled reports have totals', async () => {
    apiFetch.mockResolvedValue(response({ enabled: false })); mountWorksheet();
    await screen.findByText('Enable Schedule C preparation in Settings to use this worksheet.');
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Worksheet total')).toBeNull();
  });
  it('shows reviewed totals, future-year caution, empty filters and exports all records with evidence and formula protection', async () => {
    mountWorksheet(); await screen.findByText('Worksheet total');
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
    mountWorksheet(); fireEvent.click(await screen.findByRole('button', { name: 'Review Packing tape' }));
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
    mountWorksheet(); fireEvent.click(await screen.findByRole('button', { name: 'Review Packing tape' }));
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
  it('rejects malformed years and offers loading failure retry without showing stale totals', async () => {
    apiFetch.mockResolvedValueOnce(response({ error: 'Load failed' }, false)); mountWorksheet();
    await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Retry loading' })); await screen.findByText('Worksheet total');
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '10000' } }); expect(screen.getByRole('alert').textContent).toContain('four-digit'); expect(screen.queryByText('Worksheet total')).toBeNull();
  });
});

describe('Schedule C: sale costs included automatically', () => {
  const saleRow = { id: 'sale:s1:shipping', source: 'sale', name: 'Cup · Shipping label', inventory_id: 'inv-1', sale_id: 's1', amount: '10.04', eligible: '10.04', status: 'automatic', issues: [], documentation_missing: false, receipt_url: null, possible_duplicate_of: null,
    tax_details: { ...reviewed, tax_category: 'POSTAGE', payee: 'Shipping label (Wells Fargo Debit)', purpose: 'Shipping label for the sale of Cup', paid_date: '2026-09-27', payment_reference: 'Sale record s1' } };
  const dupRow = { ...structuredClone(row), id: 'expense-2', source: 'manual', name: 'Pirate Ship label', amount: '10.04', eligible: '10.04', tax_details: { ...reviewed, tax_category: 'POSTAGE' }, possible_duplicate_of: 'Cup · Shipping label' };
  const saleReport = () => ({ ...report(2026), total: '120.08', automatic: { total: '10.04', count: 1 }, inventory_costs_excluded: { total: '53.20', count: 6 }, possible_duplicates: 1,
    groups: [{ id: 'SUPPLIES', label: 'Supplies / shipping supplies', line2025: '22', total: '100.00', count: 1 }, { id: 'POSTAGE', label: 'Postage / shipping labels', line2025: '27b', detail: 'Postage and shipping', total: '20.08', count: 2 }],
    rows: [structuredClone(saleRow), structuredClone(dupRow), { ...structuredClone(row), source: 'manual', possible_duplicate_of: null }] });
  beforeEach(() => { apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : saleReport())); });

  it('shows sale costs as automatic rows with an Open sale link and no review button', async () => {
    mountWorksheet();
    await screen.findByText('Cup · Shipping label');
    expect(screen.getByText(/Includes \$10.04 from 1 sale cost/)).toBeTruthy();
    const article = screen.getByText('Cup · Shipping label').closest('article');
    expect(article.textContent).toContain('Automatic · from your sale · Shipping label (Wells Fargo Debit) · 2026-09-27');
    expect(article.querySelector('a').getAttribute('href')).toBe('/transactions');
    expect(article.querySelector('button')).toBeNull();
  });

  it('shows refunds to buyers as returns and allowances, separate from expenses', async () => {
    apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : { ...saleReport(), returns_and_allowances: { line: '2', total: '150.00', count: 1 } }));
    mountWorksheet();
    const note = await screen.findByText(/are returns and allowances/);
    expect(note.textContent).toContain('$150.00 this year, 1 refund');
    expect(note.textContent).toContain('not in the worksheet total');
  });

  it('hides the returns note when there are no refunds', async () => {
    apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : { ...saleReport(), returns_and_allowances: { line: '2', total: '0.00', count: 0 } }));
    mountWorksheet();
    await screen.findByText('Cup · Shipping label');
    expect(screen.queryByText(/are returns and allowances/)).toBeNull();
  });

  it('explains that purchase costs are left out on purpose', async () => {
    mountWorksheet();
    expect(await screen.findByText(/\$53.20 this year, net of gift cards/)).toBeTruthy();
  });

  it('warns about a manual expense that duplicates a sale cost, and filters to it', async () => {
    mountWorksheet();
    const banner = await screen.findByRole('button', { name: /1 manual expense looks like/ });
    expect(screen.getByText(/Possible duplicate of “Cup · Shipping label”/)).toBeTruthy();
    fireEvent.click(banner);
    await waitFor(() => expect(screen.queryByText('Packing tape')).toBeNull());
    expect(screen.getByText('Pirate Ship label')).toBeTruthy();
    expect(screen.queryByText('Cup · Shipping label')).toBeNull();
  });

  it('filters to only the automatic sale rows', async () => {
    mountWorksheet();
    await screen.findByText('Cup · Shipping label');
    fireEvent.change(screen.getByLabelText('Show records'), { target: { value: 'automatic' } });
    expect(screen.queryByText('Pirate Ship label')).toBeNull();
    expect(screen.getByText('Cup · Shipping label')).toBeTruthy();
  });

  it('exports the source and duplicate flag in the supporting CSV', async () => {
    mountWorksheet();
    await screen.findByText('Cup · Shipping label');
    fireEvent.click(screen.getByRole('button', { name: 'Export supporting CSV' }));
    const csv = downloadFile.mock.calls[0][1];
    const header = csv.split(/\r?\n/)[0];
    expect(header).toContain('source');
    expect(header).toContain('possible_duplicate_of');
    expect(csv).toContain('sale:s1:shipping');
    expect(csv).toContain('Cup · Shipping label');
  });
});

describe('Schedule C profit (Parts I and III)', () => {
  const amounts = { 1: '205.00', 2: '0.00', 3: '205.00', 4: '124.50', 5: '80.50', 6: '0.00', 7: '80.50', 28: '7.00', 29: '73.50', 30: '0.00', 31: '73.50' };
  const books = {
    year: 2026, basis: 'Cash method; inventory at cost (specific identification); sales counted on the sale date.',
    lines: Object.entries(amounts).map(([line, amount]) => ({ line, label: `Line ${line} label`, amount })),
    partIII: [{ line: '33', label: 'Method', value: 'Cost' }, { line: '35', label: 'Beginning inventory', amount: '172.50' }, { line: '42', label: 'Cost of goods sold', amount: '124.50' }],
    netProfit: '73.50',
    sales: { count: 2, byPlatform: [{ platform: 'StockX', gross: '180.00', count: 1 }, { platform: 'eBay', gross: '25.00', count: 1 }] },
    reconciliation: { appProfitOnSales: '93.50', appExpenses: '12.00', appProfitAfterExpenses: '81.50', differences: [{ key: 'refund_timing', label: 'Refund timing', amount: '-20.00' }, { key: 'inventory_cost', label: 'Inventory', amount: '0.00' }, { key: 'expenses', label: 'Expense review', amount: '12.00' }], scheduleCNetProfit: '73.50' },
    checks: { directCostOfUnitsSold: '124.50', oversold: [{ inventory_id: 'A', product_name: 'Console' }], soldBeforePurchase: [], salesWithRestoredUnits: 0 },
    yearEndCutoff: { from: '2026-12-25', sales: [{ sale_id: 's9', inventory_id: 'i9', product_name: 'Late Shoe', sale_date: '2026-12-28', paid_at: null, amount: '80.00' }], total: '80.00' },
    notes: ['Gift cards paid $5.00 of this year\'s purchases and are counted as free.'],
    form1099K: { forms: [], platforms: [], total: '0.00', unlinkedTotal: '0.00', comparison: [
      { platform_id: 'p1', platform: 'StockX', recordedGross: '180.00', recordedCount: 1, formGross: null, formCount: null, difference: null },
      { platform_id: 'p2', platform: 'eBay', recordedGross: '25.00', recordedCount: 1, formGross: null, formCount: null, difference: null },
    ] },
  };
  beforeEach(() => {
    apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), books }));
  });

  it('shows gross receipts, cost of goods sold, expenses and net profit with the lines behind them', async () => {
    mountWorksheet();
    expect(await screen.findByText('Net profit (line 31)')).toBeTruthy();
    expect(screen.getAllByText('$73.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$205.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$124.50').length).toBeGreaterThan(0);
    expect(screen.getByText('Part III: Cost of goods sold')).toBeTruthy();
    expect(screen.getByText('Cost')).toBeTruthy();
  });

  it('reconciles to app profit, lists platforms, late-December sales, data problems and notes', async () => {
    mountWorksheet();
    await screen.findByText('Why this differs from your profit elsewhere in the app');
    expect(screen.getByText('$93.50')).toBeTruthy();
    expect(screen.getByText('-$20.00')).toBeTruthy();
    expect(screen.getByText('+$12.00')).toBeTruthy();
    expect(screen.getByText('StockX')).toBeTruthy();
    expect(screen.getByText(/1 late-December sale paid after the year ended/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Late Shoe' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/more units sold than bought \(Console\)/);
    expect(screen.getByText(/Gift cards paid \$5\.00/)).toBeTruthy();
  });

  it('says loss instead of profit when line 31 is negative', async () => {
    apiFetch.mockImplementation(async path => response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), books: { ...books, netProfit: '-40.00', checks: { ...books.checks, oversold: [] } } }));
    mountWorksheet();
    expect(await screen.findByText('Net loss (line 31)')).toBeTruthy();
    expect(screen.getByText('-$40.00')).toBeTruthy();
  });
});

describe('Schedule C: stock not in ProfitTracker', () => {
  const base = {
    year: 2026, basis: 'Cash method.', lines: [{ line: '1', label: 'Gross', amount: '0.00' }, { line: '31', label: 'Net', amount: '0.00' }],
    partIII: [{ line: '35', label: 'Beginning inventory', amount: '672.50' }], netProfit: '0.00', sales: { count: 0, byPlatform: [] },
    reconciliation: { appProfitOnSales: '0.00', appExpenses: '0.00', appProfitAfterExpenses: '0.00', differences: [], scheduleCNetProfit: '0.00' },
    checks: { directCostOfUnitsSold: '0.00', oversold: [], soldBeforePurchase: [], salesWithRestoredUnits: 0, negativeCogs: false },
    yearEndCutoff: { sales: [], total: '0.00' }, notes: [],
    untracked: { start: '500.00', end: '500.00', startEntered: '500.00', endEntered: null, trackedBeginning: '172.50' },
  };
  let books; let puts;
  beforeEach(() => {
    books = structuredClone(base); puts = [];
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === 'PUT') { puts.push({ path, body: JSON.parse(options.body) }); return response({ ok: true }); }
      return response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), books });
    });
  });
  const open = async () => {
    mountWorksheet();
    await screen.findAllByText(/Stock not in ProfitTracker/);
    fireEvent.change(screen.getByLabelText('Tax year'), { target: { value: '2026' } });
    return { start: await screen.findByLabelText('On hand January 1, 2026'), end: screen.getByLabelText('Still on hand December 31, 2026') };
  };

  it('shows the January 1 amount, explains a blank December 31, and saves only what changed', async () => {
    const { start, end } = await open();
    expect(start.value).toBe('500.00');
    expect(end.value).toBe('');
    expect(screen.getByText(/Left blank, the January 1 amount \(\$500\.00\) is treated as still on hand/)).toBeTruthy();
    expect(screen.getByText(/\$172\.50 from your purchases plus this/)).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save amounts' });
    expect(save.disabled).toBe(true);
    fireEvent.change(end, { target: { value: '200' } });
    const loads = apiFetch.mock.calls.length;
    fireEvent.click(save);
    await waitFor(() => expect(puts).toEqual([{ path: '/api/schedule-c/years/2026', body: { untracked_inventory_end: '200' } }]));
    await waitFor(() => expect(apiFetch.mock.calls.length).toBeGreaterThan(loads + 1)); // worksheet reloaded
  });

  it('saves January 1 to the previous tax year, and a blank clears it', async () => {
    const { start } = await open();
    fireEvent.change(start, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save amounts' }));
    await waitFor(() => expect(puts).toEqual([{ path: '/api/schedule-c/years/2025', body: { untracked_inventory_end: '' } }]));
  });

  it('refuses a bad amount without saving, and shows a server error', async () => {
    const { end } = await open();
    fireEvent.change(end, { target: { value: '-5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save amounts' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/dollars and cents/);
    expect(puts).toEqual([]);
    apiFetch.mockImplementation(async (path, options) => options?.method === 'PUT' ? response({ error: 'Enable Schedule C in Settings first' }, false) : response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), books }));
    fireEvent.change(end, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save amounts' }));
    expect((await screen.findByText('Enable Schedule C in Settings first')).getAttribute('role')).toBe('alert');
    expect(end.value).toBe('5');
  });

  it('warns when cost of goods sold is below zero', async () => {
    books.checks.negativeCogs = true;
    await open();
    expect(screen.getByRole('alert').textContent).toMatch(/Cost of goods sold is below zero/);
  });
});

describe('Schedule C: 1099-K forms', () => {
  const books = () => ({
    year: 2026, basis: 'Cash method.', lines: [{ line: '1', label: 'Gross', amount: '330.00' }, { line: '31', label: 'Net', amount: '0.00' }],
    partIII: [], netProfit: '0.00', sales: { count: 3, byPlatform: [] },
    reconciliation: { appProfitOnSales: '0.00', appExpenses: '0.00', appProfitAfterExpenses: '0.00', differences: [], scheduleCNetProfit: '0.00' },
    checks: { directCostOfUnitsSold: '0.00', oversold: [], soldBeforePurchase: [], salesWithRestoredUnits: 0, negativeCogs: false },
    yearEndCutoff: { sales: [], total: '0.00' }, notes: [],
    form1099K: {
      platforms: [{ id: 'p-ebay', name: 'eBay', type: 'Marketplace' }, { id: 'p-mercari', name: 'Mercari', type: 'Marketplace' }],
      forms: [{ id: 'f1', payer_name: 'eBay', platform_id: 'p-ebay', platform_name: 'eBay', gross_amount: '350.00', transaction_count: 3 }],
      comparison: [{ platform_id: 'p-ebay', platform: 'eBay', recordedGross: '300.00', recordedCount: 2, formGross: '350.00', formCount: 3, difference: '50.00' }],
      total: '350.00', unlinkedTotal: '0.00',
    },
  });
  let calls;
  beforeEach(() => {
    calls = [];
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method) { calls.push({ path, method: options.method, body: options.body && JSON.parse(options.body) }); return response({ ok: true }); }
      return response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), books: books() });
    });
  });
  const open = async () => { mountWorksheet(); await screen.findByText(/Sales by platform and 1099-K forms \(1 form, \$350\.00\)/); };

  it('shows each platform next to its 1099-K and the difference', async () => {
    await open();
    expect(screen.getByText('+$50.00')).toBeTruthy();
    expect(screen.getAllByText('$350.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/3 transactions/)).toBeTruthy();
  });

  it('adds a form, filling the payer from the platform picked', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a 1099-K' }));
    const form = screen.getByRole('form', { name: 'Add a 1099-K' });
    expect(screen.getByLabelText(/Who sent it/).value).toBe('eBay');
    fireEvent.change(screen.getByLabelText('Which platform is it for?'), { target: { value: 'p-mercari' } });
    expect(screen.getByLabelText(/Who sent it/).value).toBe('Mercari');
    fireEvent.change(screen.getByLabelText('Which platform is it for?'), { target: { value: '' } });
    expect(screen.getByLabelText(/Who sent it/).value).toBe('');
    fireEvent.change(screen.getByLabelText(/Who sent it/), { target: { value: 'PayPal' } });
    fireEvent.change(screen.getByLabelText('Which platform is it for?'), { target: { value: 'p-ebay' } });
    expect(screen.getByLabelText(/Who sent it/).value).toBe('PayPal'); // typed names stay
    fireEvent.change(screen.getByLabelText(/Who sent it/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Which platform is it for?'), { target: { value: 'p-mercari' } });
    fireEvent.change(screen.getByLabelText('Gross amount (box 1a)'), { target: { value: '25' } });
    fireEvent.submit(form);
    await waitFor(() => expect(calls).toEqual([{ path: '/api/schedule-c/years/2026/1099-k', method: 'POST', body: { payer_name: 'Mercari', platform_id: 'p-mercari', gross_amount: '25', transaction_count: null } }]));
  });

  it('refuses a missing amount without saving', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add a 1099-K' }));
    fireEvent.submit(screen.getByRole('form', { name: 'Add a 1099-K' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/box 1a amount/);
    expect(calls).toEqual([]);
  });

  it('edits and deletes a form, asking before deleting', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const amount = screen.getByLabelText('Gross amount (box 1a)');
    expect(amount.value).toBe('350.00');
    fireEvent.change(amount, { target: { value: '340' } });
    fireEvent.change(screen.getByLabelText('Which platform is it for?'), { target: { value: '' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Edit 1099-K from eBay' }));
    await waitFor(() => expect(calls[0]).toEqual({ path: '/api/schedule-c/1099-k/f1', method: 'PUT', body: { payer_name: 'eBay', platform_id: null, gross_amount: '340', transaction_count: '3' } }));
    await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }));
    await waitFor(() => expect(calls[1]).toEqual({ path: '/api/schedule-c/1099-k/f1', method: 'DELETE', body: undefined }));
  });
});

describe('Schedule C: reviewing expenses faster', () => {
  const pending = (id, name, suggestion, extra = {}) => ({ id, name, amount: '20.00', date: '2026-03-01', tax_details: emptyTaxDetails(), status: 'pending', eligible: '0.00', issues: ['Choose tax category'], documentation_missing: true, suggestion, possible_duplicate_of: null, ...extra });
  const labels = { fields: { tax_category: 'POSTAGE', business_use: 'business', payee: 'Pirate Ship labels', purpose: 'Postage to ship orders to buyers', payment_status: 'paid', paid_date: '2026-03-01', payment_reference: 'Paid with QA Card on 2026-03-01' }, reason: 'Suggested because the name mentions "labels".' };
  let rows; let puts;
  beforeEach(() => {
    rows = [pending('e1', 'Pirate Ship labels', labels), pending('e2', 'Uline boxes', { fields: { tax_category: 'SUPPLIES' }, reason: null }),
      { ...row, id: 'e3', name: 'Canva', possible_duplicate_of: 'Canva Pro', possible_duplicate_source: 'expense', documentation_missing: false }];
    puts = [];
    apiFetch.mockImplementation(async (path, options) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(options.body); puts.push({ path, body });
        const id = path.split('/').pop();
        rows = rows.map((r) => (r.id === id ? { ...r, tax_details: body.tax_details, status: 'reviewed', suggestion: null } : r));
        return response({});
      }
      return response(path.includes('/preferences/') ? { enabled: true } : { ...report(2026), rows, possible_duplicates: 1, possible_duplicates_of_sales: 0, possible_duplicates_of_expenses: 1 });
    });
  });

  it('shows suggestions on rows and fills only blank fields when asked', async () => {
    mountWorksheet();
    expect(await screen.findByText('Suggested: Postage / shipping labels')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review Pirate Ship labels' }));
    expect(screen.getByText(/name mentions "labels"/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Payee/i), { target: { value: 'Pirate Ship LLC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestions' }));
    expect(screen.getByLabelText(/Payee/i).value).toBe('Pirate Ship LLC'); // kept
    expect(screen.getByLabelText(/Purpose/i).value).toBe('Postage to ship orders to buyers');
    expect(puts).toEqual([]); // nothing saved yet
  });

  it('saves and opens the next expense waiting for review', async () => {
    mountWorksheet();
    fireEvent.click(await screen.findByRole('button', { name: 'Review Pirate Ship labels' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use suggestions' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /reviewed/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save and review next' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].body.tax_details).toMatchObject({ tax_category: 'POSTAGE', payee: 'Pirate Ship labels', payment_reference: 'Paid with QA Card on 2026-03-01', reviewed: true });
    const dialog = await screen.findByRole('dialog', { name: 'Review expense tax details' });
    expect(within(dialog).getByRole('heading', { name: /Uline boxes/ })).toBeTruthy();
    // The last one waiting has no "next".
    expect(screen.queryByRole('button', { name: 'Save and review next' })).toBeNull();
  });

  it('filters to missing receipts and explains an expense entered twice', async () => {
    mountWorksheet();
    await screen.findByText(/1 expense looks like another expense entered twice/);
    expect(screen.getByText(/Possible duplicate of the expense “Canva Pro”/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Show records'), { target: { value: 'receipts' } });
    expect(screen.getByRole('button', { name: 'Review Pirate Ship labels' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review Canva' })).toBeNull();
  });
});
