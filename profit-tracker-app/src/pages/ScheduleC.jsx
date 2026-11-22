import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { requireSuccessfulResponse } from '../hooks/apiResponse';
import { ExpenseTaxFields } from '../components/ScheduleC/ExpenseTaxFields';
import { ProfitTiles, LowerYourTax, BooksDetails } from '../components/ScheduleC/ScheduleCBooks';
import { NextSteps } from '../components/ScheduleC/NextSteps';
import { WorksheetExpenses } from '../components/ScheduleC/WorksheetExpenses';
import { Pill } from '../components/ScheduleC/Tile';
import InfoTip from '../components/UI/InfoTip';
import { TaxOverview } from '../components/ScheduleC/TaxOverview';
import { TaxReports } from '../components/ScheduleC/TaxReports';
import { emptyTaxDetails, taxReviewIssues, taxCategories } from '../../../shared/scheduleC.mjs';
import { csvText, downloadFile, downloadJSON } from '../utils/downloads';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { HelpCircle } from 'lucide-react';
import { useTutorial } from '../context/TutorialContext';

const categoryLabel = (id) => taxCategories.find((c) => c.id === id)?.label || id;
const VIEWS = [['overview', 'Tax estimate'], ['worksheet', 'Worksheet'], ['reports', 'Year-end report']];
// Without the app's tour provider (tests, embeds) the "?" button does nothing.
const NO_TOUR = { start: () => {}, onStep: () => () => {} };

function TaxEditor({ expense, onClose, onSaved, hasNext = false }) {
  const [tax, setTax] = useState(() => ({ ...emptyTaxDetails(), ...expense.tax_details }));
  const nextAfterSave = useRef(false);
  const suggestion = expense.suggestion;
  // Only fields still blank in the form; nothing is saved until the user does.
  const applySuggestion = () => setTax((current) => {
    const out = { ...current };
    for (const [key, value] of Object.entries(suggestion.fields)) {
      const blank = key === 'business_use' ? current.business_use === 'unreviewed' : key === 'payment_status' ? current.payment_status === 'unknown' : !String(current[key] ?? '').trim();
      if (blank) out[key] = value;
    }
    return out;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const close = () => { if (!busy.current) onClose(); };
  const modalRef = useModalKeyboard(true, close);
  const save = async e => {
    e.preventDefault(); if (busy.current) return;
    if (tax.reviewed && tax.business_use !== 'personal' && taxReviewIssues(tax).length) { setError('Complete business details before marking reviewed.'); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/expenses/${expense.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tax_details: tax, expected_tax_version: expense.tax_version ?? 0 }) }));
      onSaved({ next: nextAfterSave.current });
    } catch (error) { setError(error.message); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/70" onClick={close} />
    <form ref={modalRef} role="dialog" aria-modal="true" aria-label="Review expense tax details" onSubmit={save} className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-[#16181d] p-5">
      <h2 className="text-lg font-semibold text-white">{expense.name} · ${expense.amount}</h2>
      {suggestion && <div className="rounded-lg border border-purple-500/30 p-3 text-sm">
        <p className="text-gray-200">Suggested from this expense{suggestion.fields.tax_category ? <>: <strong className="text-white">{categoryLabel(suggestion.fields.tax_category)}</strong></> : ''}.</p>
        {suggestion.reason && <p className="mt-1 text-xs text-gray-400">{suggestion.reason}</p>}
        <p className="mt-1 text-xs text-gray-400">Fills only blank fields. Check each one; nothing is saved until you save.</p>
        <button type="button" disabled={saving} onClick={applySuggestion} className="mt-2 rounded-lg border border-white/10 px-3 py-1.5 text-purple-300">Use suggestions</button>
      </div>}
      <ExpenseTaxFields value={tax} onChange={setTax} disabled={saving} />
      <p className="text-xs text-gray-400">Attach supporting receipts through <Link to="/receipts" className="underline">Receipts</Link>. Keep the payment evidence referenced here.</p>
      {error && <div><p role="alert" className="text-sm text-red-400">{error}</p><button type="button" disabled={saving} onClick={onSaved} className="mt-2 text-sm underline">Discard draft and reload worksheet</button></div>}
      <div className="flex justify-end gap-3"><button type="button" disabled={saving} onClick={close} className="rounded-lg border border-white/10 px-4 py-2 text-gray-300">Cancel</button>{hasNext && <button disabled={saving} onClick={() => { nextAfterSave.current = true; }} className="rounded-lg border border-purple-500/40 px-4 py-2 text-purple-200">Save and review next</button>}<button disabled={saving} onClick={() => { nextAfterSave.current = false; }} className="rounded-lg bg-purple-600 px-4 py-2 text-white">{saving ? 'Saving…' : 'Save tax details'}</button></div>
    </form>
  </div>;
}

export default function ScheduleC() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState('overview');
  // "Save and review next": open the next one when the worksheet reloads.
  const reviewNext = useRef(false);
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900;
  useEffect(() => {
    if (!/^\d{4}$/.test(year) || Number(year) < 1900) return;
    let active = true;
    (async () => {
      try {
        const preference = await requireSuccessfulResponse(await apiFetch('/api/preferences/schedule-c'));
        const { enabled } = await preference.json();
        const data = enabled ? await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c?year=${year}`))).json() : null;
        if (active) {
          setResult({ year, revision, enabled, data });
          if (reviewNext.current) {
            reviewNext.current = false;
            const next = data?.rows.find(row => row.status === 'pending');
            if (next) setEditing(next);
          }
        }
      } catch (error) { if (active) setResult({ year, revision, error: error.message }); }
    })();
    return () => { active = false; };
  }, [year, revision]);
  // After a save, keep showing the last result until the new one arrives so
  // open sections and scroll position stay put.
  const current = result?.year === year && (result.revision === revision || (!result.error && result.enabled)) ? result : null;
  const report = current?.data;
  // Expenses waiting for review first, then the rest in their usual order.
  const STATUS_ORDER = { pending: 0, reviewed: 1, automatic: 2, excluded: 3 };
  const rows = (report?.rows.filter(row => filter === 'all' || row.status === filter || row.tax_details.tax_category === filter || (filter === 'duplicates' && row.possible_duplicate_of) || (filter === 'receipts' && row.documentation_missing && row.status !== 'excluded')) || []).map((row, i) => [row, i]).sort(([a, i], [b, j]) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || i - j).map(([row]) => row);
  const pendingRows = report?.rows.filter(row => row.status === 'pending') || [];
  // The "?" tour switches to the tab each step is about.
  const tutorial = useTutorial() || NO_TOUR;
  const { onStep } = tutorial;
  useEffect(() => onStep((step, tour) => { if (tour === 'scheduleC' && step?.view) setView(step.view); }), [onStep]);
  // Arrow keys, Home and End move between the views (the tablist pattern).
  const moveTab = (e) => {
    const at = VIEWS.findIndex(([key]) => key === view);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: VIEWS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = VIEWS[(to + VIEWS.length) % VIEWS.length][0];
    setView(next);
    document.getElementById(`schedule-c-tab-${next}`)?.focus();
  };
  const exportCSV = () => downloadFile(`schedule-c-${year}-expenses.csv`, csvText(report.rows.map(row => ({ tax_year: year, reference_mapping_year: report.mapping_year, planning: report.planning, expense_id: row.id, source: row.source || 'manual', name: row.name, status: row.status, amount: row.amount, worksheet_amount: row.eligible, business_percent: row.tax_details.business_use === 'business' ? '100' : row.tax_details.business_percent, tax_category: row.tax_details.tax_category, reference_line: report.groups.find(group => group.id === row.tax_details.tax_category)?.line2025 || '', payee: row.tax_details.payee, purpose: row.tax_details.purpose, paid_date: row.tax_details.paid_date, payment_reference: row.tax_details.payment_reference, receipt_url: row.receipt_url, review_issues: row.issues.join('; '), possible_duplicate_of: row.possible_duplicate_of || '', receipt_missing: row.documentation_missing }))), 'text/csv;charset=utf-8');
  const reload = () => setRevision(value => value + 1);
  const showRecords = (f) => { setFilter(f); setTimeout(() => document.getElementById('schedule-c-records')?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 0); };
  const panel = !validYear ? <p role="alert" className="text-sm text-[var(--dp-red-text)]">Choose a four-digit tax year from 1900 to 9999.</p>
    : !current ? <p role="status" className="text-sm text-[var(--dp-text-muted)]">Loading worksheet…</p>
      : current.error ? <div className="card p-5"><p role="alert" className="text-sm text-[var(--dp-red-text)]">{current.error}</p><button onClick={reload} className="page-btn page-btn-secondary mt-3">Retry loading</button></div>
        : !current.enabled ? <div className="card p-6"><p className="text-sm text-[var(--dp-text-primary)]">Enable Schedule C preparation in Settings to use this worksheet.</p><Link to="/settings" state={{ tab: 'tax' }} className="page-btn page-btn-primary mt-4">Open Schedule C settings</Link></div>
          : null;
  return <div className="schedule-c-page h-full overflow-auto">
    <style>{`@media print { aside, header, .schedule-c-actions, .no-print, .schedule-c-page button { display:none!important; } .tax-packet { border:none!important; padding:0!important; } .schedule-c-page section[aria-label="Schedule C categories"] button { display:flex!important; } .schedule-c-page, .schedule-c-page * { color:#000!important; background:#fff!important; } main, main > div, .schedule-c-page { overflow:visible!important; height:auto!important; } body,#root {height:auto!important;} }`}</style>
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 pb-10 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--dp-text-primary)]">Schedule C</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-[var(--dp-text-secondary)]">Your reselling taxes, step by step.
            <InfoTip name="this page" width="w-72" text="A helper for your taxes, not a tax return. It works on the cash method: sales count on the sale date, expenses when they're paid. Nothing is sent to the IRS." /></p>
        </div>
        <div className="schedule-c-actions flex flex-wrap items-center gap-2">
          <label data-tutorial-id="sc-year" className="flex items-center gap-2 text-sm">Tax year<input aria-label="Tax year" type="number" min="1900" max="9999" step="1" value={year} onChange={e => { setYear(e.target.value); setFilter('all'); }} className="w-24 rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-[var(--dp-text-primary)]" /></label>
          <button type="button" onClick={() => tutorial.start('scheduleC')} aria-label="How this page works" className="page-btn page-btn-secondary"><HelpCircle size={15} aria-hidden="true" /><span aria-hidden="true">How it works</span></button>
        </div>
      </div>
      <div role="tablist" aria-label="Schedule C views" data-tutorial-id="sc-tabs" onKeyDown={moveTab} className="schedule-c-actions relative flex max-w-full gap-1 overflow-x-auto rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-1 sm:inline-flex">
        {VIEWS.map(([key, label]) => <button key={key} id={`schedule-c-tab-${key}`} type="button" role="tab" aria-selected={view === key} aria-controls="schedule-c-panel" tabIndex={view === key ? 0 : -1} onClick={() => setView(key)} style={{ flex: '1 0 auto' }}
          className={`whitespace-nowrap rounded-lg border px-2 py-2 text-[12.5px] font-medium transition-colors min-[360px]:px-2.5 min-[360px]:text-[13px] sm:px-4 sm:text-sm ${view === key ? 'border-[color:var(--accent)] bg-[var(--accent-bg)] text-[var(--dp-text-primary)]' : 'border-transparent text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'}`}>{label}</button>)}
      </div>
      {panel || <div id="schedule-c-panel" role="tabpanel" aria-labelledby={`schedule-c-tab-${view}`} className="space-y-6">
        <h2 className="sr-only">{VIEWS.find(([key]) => key === view)?.[1]}</h2>
        {view === 'reports' ? <TaxReports key={report.year} year={Number(report.year)} onDrill={(f) => {
          setView('worksheet'); if (f !== 'logs') setFilter(f);
          // After the worksheet renders, bring the records into view.
          setTimeout(() => document.getElementById(f === 'logs' ? 'schedule-c-logs' : 'schedule-c-records')?.scrollIntoView({ block: 'start' }), 0);
        }} /> : view === 'overview' ? <TaxOverview key={report.year} year={report.year} books={report.books} worksheet={report} pendingExpenses={report.pending} missingReceipts={report.documentation_gaps} onShowWorksheet={() => setView('worksheet')} /> : <>
          {report.planning && <p className="text-xs leading-6 text-[var(--dp-text-muted)]"><Pill tone="warn">Draft</Pill> The {report.year} form isn&apos;t out yet, so line numbers follow the 2025 form.{' '}
            <InfoTip name="draft line numbers" text={`The IRS publishes the ${report.year} Schedule C late in the year. Until then the totals are right but the line numbers come from the 2025 form, so these figures aren't filing-ready.`} /></p>}
          <ProfitTiles books={report.books} />
          <NextSteps report={report} books={report.books} onReview={() => pendingRows[0] && setEditing(pendingRows[0])} onShow={showRecords} />
          <WorksheetExpenses report={report} rows={rows} filter={filter} setFilter={setFilter} onReview={setEditing}
            onMarkDocumentation={async (ids) => {
              if (!window.confirm(`Mark ${ids.length} ${ids.length === 1 ? 'expense' : 'expenses'} as "receipt kept elsewhere"? You can undo this in Activity.`)) return;
              await requireSuccessfulResponse(await apiFetch('/api/expenses/documentation', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids, documentation: 'external' }) }));
              reload();
            }}
            actions={<Link className="tap-box text-xs text-[var(--dp-text-secondary)] underline" to="/expenses">Manage expenses</Link>} />
          <LowerYourTax books={report.books} year={report.year} onSettingsSaved={reload} />
          <BooksDetails books={report.books} year={report.year} onSettingsSaved={reload} />
          <div className="schedule-c-actions flex flex-wrap gap-2">
            <button type="button" className="page-btn page-btn-secondary" onClick={exportCSV} disabled={!report.rows.length}>Export supporting CSV</button>
            <button type="button" className="page-btn page-btn-secondary" onClick={() => downloadJSON(`schedule-c-${year}-expenses.json`, report)}>Export worksheet JSON</button>
            <button type="button" className="page-btn page-btn-secondary" onClick={() => window.print()}>Print / save PDF</button>
          </div>
        </>}
      </div>}
    </div>
    {editing && <TaxEditor key={editing.id} expense={editing} hasNext={pendingRows.some(row => row.id !== editing.id)} onClose={() => setEditing(null)} onSaved={({ next } = {}) => { setEditing(null); reviewNext.current = Boolean(next); reload(); }} />}
  </div>;
}
