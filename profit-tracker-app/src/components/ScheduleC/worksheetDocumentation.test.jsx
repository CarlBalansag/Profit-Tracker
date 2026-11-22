import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WorksheetExpenses } from './WorksheetExpenses';

afterEach(cleanup);

const row = (id, documentation, extra = {}) => ({
  id, name: `Expense ${id}`, source: 'manual', status: 'reviewed', amount: '10.00', eligible: '10.00', issues: [],
  documentation, documentation_missing: documentation === 'missing' || documentation === 'insufficient',
  tax_details: { paid_date: '2026-03-01', payee: null }, ...extra,
});
const report = { total: '40.00', pending: 0, documentation_gaps: 2, groups: [], lines: [], planning: false };

describe('expense documentation on the worksheet', () => {
  it('labels each kind of documentation without hiding any expense', () => {
    const rows = [row('a', 'missing'), row('b', 'insufficient'), row('c', 'external'), row('d', 'email'), row('e', 'attached')];
    render(<MemoryRouter><WorksheetExpenses report={report} rows={rows} filter="all" setFilter={vi.fn()} onReview={vi.fn()} /></MemoryRouter>);
    expect(screen.getAllByText('No receipt')).toHaveLength(2); // the stat and the row
    expect(screen.getByText('Receipt not enough')).toBeInTheDocument();
    expect(screen.getByText('Kept elsewhere')).toBeInTheDocument();
    expect(screen.getByText('Email receipt')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });

  it('marks the missing ones as kept elsewhere in one go', () => {
    const onMark = vi.fn();
    const rows = [row('a', 'missing'), row('b', 'insufficient'), row('c', 'missing')];
    render(<MemoryRouter><WorksheetExpenses report={report} rows={rows} filter="receipts" setFilter={vi.fn()} onReview={vi.fn()} onMarkDocumentation={onMark} /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Mark these as kept elsewhere' }));
    expect(onMark).toHaveBeenCalledWith(['a', 'c']);
  });
});
