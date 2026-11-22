import { useState } from 'react';
import { Link } from 'react-router-dom';
import { taxCategories } from '../../../../shared/scheduleC.mjs';
import { Panel } from '../Analytics/Motion';
import InfoTip from '../UI/InfoTip';
import { Pill } from './Tile';

const usd = (value) => `$${Math.abs(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const categoryLabel = (id) => taxCategories.find((c) => c.id === id)?.label || id;
const STATUS = {
  reviewed: ['good', 'Counts'],
  automatic: ['good', 'From a sale'],
  pending: ['warn', 'To review'],
  excluded: ['muted', 'Not counted'],
};
// Documentation is a flag, never a reason to leave an expense out.
const DOC_PILL = {
  missing: ['muted', 'No receipt'],
  insufficient: ['warn', 'Receipt not enough'],
  external: ['muted', 'Kept elsewhere'],
  email: ['good', 'Email receipt'],
};
const FILTERS = [['all', 'All records'], ['pending', 'Needs review'], ['reviewed', 'Reviewed'], ['excluded', 'Excluded'], ['automatic', 'From sales (automatic)'], ['duplicates', 'Possible duplicates'], ['receipts', 'Missing receipts']];

function Stat({ label, value, sub, onClick }) {
  const inner = <>
    <dt className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">{label}</dt>
    <dd className="mt-1 text-lg font-bold tabular-nums text-[var(--dp-text-primary)]">{value}</dd>
    {sub && <dd className="text-xs text-[var(--dp-text-muted)]">{sub}</dd>}
  </>;
  return onClick
    ? <div className="min-w-0"><button type="button" onClick={onClick} className="w-full rounded-lg text-left hover:bg-[var(--dp-hover-bg)]"><dl>{inner}</dl></button></div>
    : <dl className="min-w-0">{inner}</dl>;
}

function ExpenseRow({ row, onReview }) {
  const [tone, label] = STATUS[row.status] || STATUS.excluded;
  const fromSale = row.source === 'sale';
  const missing = row.status === 'pending' ? row.issues.length : 0;
  const meta = [row.tax_details.paid_date || 'Date not set', fromSale ? row.tax_details.payee : (row.tax_details.payee || null), missing ? `${missing} ${missing === 1 ? 'detail' : 'details'} missing` : null].filter(Boolean).join(' · ');
  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="break-words text-sm font-medium text-[var(--dp-text-primary)]">{row.name}</h3>
          <Pill tone={tone}>{label}</Pill>
          {row.status === 'pending' && row.suggestion?.fields.tax_category && <Pill tone="accent">Suggested: {categoryLabel(row.suggestion.fields.tax_category)}</Pill>}
          {row.status !== 'excluded' && !fromSale && DOC_PILL[row.documentation] && <Pill tone={DOC_PILL[row.documentation][0]}>{DOC_PILL[row.documentation][1]}</Pill>}
        </div>
        <p className="mt-0.5 break-words text-xs text-[var(--dp-text-muted)]">{meta}</p>
        {row.possible_duplicate_of && <p className="mt-1 text-xs text-[var(--dp-warning-text)]">
          {row.possible_duplicate_source === 'expense'
            ? <>Possible duplicate of the expense “{row.possible_duplicate_of}”, same amount within a day.</>
            : <>Possible duplicate of “{row.possible_duplicate_of}”, already counted from the sale.</>}
          {' '}Delete the extra one on <Link to="/expenses" className="underline">Expenses</Link>.</p>}
      </div>
      <div className="flex items-center justify-between gap-3 sm:justify-end">
        <span className="text-right tabular-nums">
          <span className="block text-sm font-semibold text-[var(--dp-text-primary)]">{usd(row.amount)}</span>
          {row.eligible !== row.amount && <span className="block text-[11px] text-[var(--dp-text-muted)]">counts {usd(row.eligible)}</span>}
        </span>
        {fromSale
          ? <Link to="/transactions" state={{ openTransaction: { inventoryId: row.inventory_id, saleId: row.sale_id } }} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">Open sale</Link>
          : <div className="flex gap-2">
            {/^https:\/\//i.test(row.receipt_url || '') && <a href={row.receipt_url} target="_blank" rel="noreferrer" className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">View receipt</a>}
            <button type="button" onClick={() => onReview(row)} className={`page-btn !h-9 !px-3 !text-xs ${row.status === 'pending' ? 'page-btn-primary' : 'page-btn-secondary'}`}><span aria-hidden="true">{row.status === 'pending' ? 'Review' : 'Edit'}</span><span className="sr-only">Review {row.name}</span></button>
          </div>}
      </div>
    </li>
  );
}

/**
 * Part II on the worksheet: what counts, the IRS categories in use, and every
 * expense with its status. The fine print sits under "How expenses are counted".
 */
export function WorksheetExpenses({ report, rows, filter, setFilter, onReview, actions, onMarkDocumentation }) {
  const [allCategories, setAllCategories] = useState(false);
  const used = report.groups.filter((g) => g.count > 0 || Number(g.total) !== 0);
  const categories = allCategories ? report.groups : used;
  const ref = (line) => `${report.planning ? '2025 form ' : ''}line ${line}`;
  return (
    <Panel title="Expenses" right={actions}>
      <div data-tutorial-id="sc-expense-cards" className="grid grid-cols-3 gap-3">
        <Stat label="Counted so far" value={usd(report.total)} sub={report.automatic?.count ? `Includes ${usd(report.automatic.total)} from ${report.automatic.count} sale ${report.automatic.count === 1 ? 'cost' : 'costs'}` : null} />
        <Stat label="To review" value={report.pending} onClick={() => setFilter('pending')} />
        <Stat label="No receipt" value={report.documentation_gaps} onClick={() => setFilter('receipts')} />
      </div>

      <section data-tutorial-id="sc-categories" aria-label="Schedule C categories" className="mt-5">
        <h3 className="mb-1 text-xs font-semibold text-[var(--dp-text-secondary)]">By IRS category</h3>
        {categories.length ? <ul className="divide-y divide-[color:var(--dp-border)]">{categories.map((g) => <li key={g.id}>
          <button type="button" onClick={() => setFilter(g.id)} className="flex w-full items-baseline justify-between gap-3 rounded-lg px-1 py-2 text-left hover:bg-[var(--dp-hover-bg)]">
            <span className="min-w-0 text-sm text-[var(--dp-text-primary)]">{g.label} <span className="text-xs text-[var(--dp-text-muted)]">· {ref(g.line2025)} · {g.count} {g.count === 1 ? 'record' : 'records'}</span></span>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-[var(--dp-text-primary)]">{usd(g.total)}</span>
          </button>
        </li>)}</ul> : <p className="py-2 text-sm text-[var(--dp-text-muted)]">Nothing counted yet. Review an expense and its category shows up here.</p>}
        {used.length < report.groups.length && <button type="button" onClick={() => setAllCategories((v) => !v)} className="mt-1 text-xs text-[var(--dp-text-secondary)] underline">{allCategories ? 'Only the ones in use' : `Show all ${report.groups.length} categories`}</button>}
      </section>

      <section id="schedule-c-records" className="mt-6">
        <div data-tutorial-id="sc-queue" className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-[var(--dp-text-secondary)]">Every expense</h3>
          <label className="schedule-c-actions flex min-w-0 max-w-full items-center gap-2 text-xs text-[var(--dp-text-secondary)]">Show
            <select aria-label="Show records" value={filter} onChange={(e) => setFilter(e.target.value)} className="min-w-0 max-w-full flex-1 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-2 py-1.5 text-sm text-[var(--dp-text-primary)]">
              {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              {report.groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
        </div>
        {filter === 'receipts' && onMarkDocumentation && rows.some((r) => r.source !== 'sale' && r.documentation === 'missing') && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--dp-text-secondary)]">
            <span>Have the receipts somewhere else, like paper or another app?</span>
            <button type="button" className="page-btn page-btn-secondary !h-9 !px-3 !text-xs"
              onClick={() => onMarkDocumentation(rows.filter((r) => r.source !== 'sale' && r.documentation === 'missing').map((r) => r.id))}>
              Mark these as kept elsewhere
            </button>
          </div>
        )}
        {rows.length
          ? <ul className="mt-1 divide-y divide-[color:var(--dp-border)]">{rows.map((row) => <ExpenseRow key={row.id} row={row} onReview={onReview} />)}</ul>
          : <p className="py-6 text-center text-sm text-[var(--dp-text-muted)]">No expenses match this view.</p>}
      </section>

      <details className="mt-4 text-xs text-[var(--dp-text-muted)]">
        <summary className="cursor-pointer text-[var(--dp-text-secondary)]">How expenses are counted <InfoTip name="expense counting" text="Only reviewed, paid expenses count, plus shipping labels and selling fees taken from your sales." /></summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Only reviewed, paid expenses count, plus the shipping labels and selling fees from your sales. Personal and unpaid ones are left out.</li>
          <li>An expense with no payment date stays in the list every year until you set one.</li>
          {report.inventory_costs_excluded && Number(report.inventory_costs_excluded.total) !== 0 && <li>Purchase tax, inbound shipping and purchase fees ({usd(report.inventory_costs_excluded.total)} this year) are part of what your items cost, so they&apos;re in cost of goods sold, not here.</li>}
          {report.returns_and_allowances?.count > 0 && <li>Refunds to buyers ({usd(report.returns_and_allowances.total)}, {report.returns_and_allowances.count} {report.returns_and_allowances.count === 1 ? 'refund' : 'refunds'}) are returns and allowances ({ref(report.returns_and_allowances.line)}). They lower your sales instead.</li>}
          <li>Postage, software and other expenses are added together on {ref('27b')}: {usd(report.lines?.find((l) => l.line === '27b')?.total || 0)}.</li>
        </ul>
      </details>
    </Panel>
  );
}
