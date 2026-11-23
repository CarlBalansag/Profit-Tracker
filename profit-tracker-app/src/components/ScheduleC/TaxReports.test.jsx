// The year-end report tab: finalize, see changes, revise with a reason, view
// an earlier revision, and the CSV.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaxReports } from './TaxReports';
import { reportCsv } from '../../utils/taxLogs';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));

const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => structuredClone(body) });
const report = (line9 = '0.00', net = '900.00') => ({
  year: 2025, form_lines_year: 2025, planning: false, basis: 'Cash method.',
  part1: [{ line: '1', label: 'Gross receipts or sales', amount: '1000.00' }, { line: '4', label: 'Cost of goods sold (line 42)', amount: '0.00' }, { line: '28', label: 'Total expenses (Part II)', amount: line9 === '0.00' ? '100.00' : '110.00' }, { line: '30', label: 'Business use of home', amount: '0.00' }, { line: '31', label: 'Net profit or (loss)', amount: net }],
  part2: [{ line: '9', label: 'Car and truck expenses', amount: line9 }, { line: '22', label: 'Supplies', amount: '100.00' }],
  part2_total: line9 === '0.00' ? '100.00' : '110.00',
  part3: [{ line: '33', label: 'Method used to value closing inventory', value: 'Cost' }, { line: '42', label: 'Cost of goods sold', amount: '0.00' }],
  part4: null, part5: [{ label: 'Software subscriptions', amount: '5.00' }], home_office: null, mileage: null,
  equipment: { items: [], depreciation: '0.00', section_179: '0.00', section_179_carryover: '0.00', de_minimis: '0.00' },
  form_1099k: { forms: [], comparison: [], total: '0.00' }, sales: { count: 2, by_platform: [{ platform: 'eBay', gross: '1000.00', count: 2 }] },
  expenses: { pending: 0, missing_receipts: 0 }, payments: [], reconciliation: {}, year_end_cutoff: { count: 0, total: '0.00' }, notes: ['A note'],
});
let snapshots; let live; let calls;
beforeEach(() => {
  snapshots = []; live = report(); calls = [];
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(async (path, options = {}) => {
    if (options.method) calls.push({ path, body: JSON.parse(options.body) });
    if (path === '/api/schedule-c/years/2025/finalize') {
      const body = JSON.parse(options.body);
      if (snapshots.length && !body.reason) return json({ error: 'Say what changed.' }, false, 400);
      snapshots = [{ id: `s${snapshots.length + 1}`, revision: snapshots.length + 1, reason: body.reason, created_at: '2026-02-01T12:00:00Z', net_profit: live.part1.at(-1).amount, report: structuredClone(live) }, ...snapshots];
      return json(snapshots[0], true, 201);
    }
    if (path === '/api/schedule-c/years/2025/report') {
      const latest = snapshots[0];
      const changed = latest ? latest.report.part2[0].amount !== live.part2[0].amount : null;
      return json({ report: live, hash: 'h', rules: {}, finalized: latest || null, changed, changes: changed ? [{ part: 'II', line: '9', label: 'Car and truck expenses', before: latest.report.part2[0].amount, after: live.part2[0].amount }] : [], rulesChanged: [] });
    }
    if (path === '/api/schedule-c/years/2024/report') return json({ report: { ...report(), year: 2024, sales: { count: 0, by_platform: [] }, part1: report().part1.map((l) => ({ ...l, amount: '0.00' })) } });
    if (path === '/api/schedule-c/years/2025/snapshots') return json({ snapshots });
    if (path.startsWith('/api/schedule-c/snapshots/')) return json(snapshots.find((s) => path.endsWith(s.id)));
    throw new Error(`Unexpected ${path}`);
  });
});
afterEach(cleanup);

describe('TaxReports', () => {
  it('finalizes, shows what changed later, and needs a reason to revise', async () => {
    render(<TaxReports year={2025} onDrill={() => {}} />);
    expect(await screen.findByRole('heading', { name: 'Not finalized' })).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Schedule C 2025, current numbers' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finalize 2025' }));
    expect(await screen.findByRole('heading', { name: /Finalized .* · revision 1/ })).toBeInTheDocument();
    expect(calls[0].body).toEqual({ expected_revision: 0, reason: null });
    expect(screen.getByText(/Nothing has changed since\. Line 31 is \$900\.00/)).toBeInTheDocument();

    // A trip is added elsewhere; the tab reloads.
    live = report('10.00', '890.00');
    cleanup();
    render(<TaxReports year={2025} onDrill={() => {}} />);
    expect(await screen.findByText('Your records changed since revision 1.')).toBeInTheDocument();
    expect(screen.getByText(/Line 9 Car and truck expenses:/)).toHaveTextContent('$0.00 → $10.00');
    fireEvent.click(screen.getByRole('button', { name: 'Save revision 2' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Say what changed');
    fireEvent.change(screen.getByLabelText('What changed?'), { target: { value: 'Added a trip' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save revision 2' }));
    await waitFor(() => expect(calls.at(-1).body).toEqual({ expected_revision: 1, reason: 'Added a trip' }));
    expect(await screen.findByRole('heading', { name: /Finalized .* · revision 2/ })).toBeInTheDocument();
  });

  it('opens an earlier revision and drills into the worksheet from a line', async () => {
    snapshots = [{ id: 's1', revision: 1, reason: null, created_at: '2026-02-01T12:00:00Z', net_profit: '900.00', report: report() }];
    live = report('10.00', '890.00');
    const onDrill = vi.fn();
    render(<TaxReports year={2025} onDrill={onDrill} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Supplies' }));
    expect(onDrill).toHaveBeenCalledWith('SUPPLIES');
    fireEvent.click(screen.getByText('Revision history (1)'));
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    const packet = await screen.findByRole('article', { name: /revision 1 \(finalized/ });
    expect(within(packet).getByText('Car and truck expenses').closest('tr')).toHaveTextContent('$0.00');
    // Old revisions are read-only: no drill-down.
    expect(within(packet).queryByRole('button', { name: 'Supplies' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back to the current numbers' }));
    expect(screen.getByRole('article', { name: /current numbers/ })).toBeInTheDocument();
  });

  it('compares with last year, and says when last year is empty', async () => {
    render(<TaxReports year={2025} onDrill={() => {}} />);
    fireEvent.click(await screen.findByText('Compared with 2024'));
    expect(screen.getByText('ProfitTracker has no sales or expenses for 2024.')).toBeInTheDocument();
  });

  it('writes every line to the CSV', () => {
    const csv = reportCsv(report('10.00'));
    expect(csv.split(/\r?\n/)[0]).toBe('"tax_year","part","line","label","amount"');
    expect(csv).toContain('"2025","II","9","Car and truck expenses","10.00"');
    expect(csv).toContain('"2025","II","28","Total expenses","110.00"');
    expect(csv).toContain('"2025","V","48","Software subscriptions","5.00"');
  });
});
