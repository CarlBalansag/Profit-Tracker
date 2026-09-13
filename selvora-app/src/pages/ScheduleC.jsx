import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';
import { requireSuccessfulResponse } from '../hooks/apiResponse';
import { ExpenseTaxFields } from '../components/ScheduleC/ExpenseTaxFields';
import { emptyTaxDetails, taxReviewIssues } from '../../../shared/scheduleC.mjs';
import { csvText, downloadFile, downloadJSON } from '../utils/downloads';

function TaxEditor({ expense, onClose, onSaved }) {
  const [tax, setTax] = useState(() => ({ ...emptyTaxDetails(), ...expense.tax_details }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);
  const close = () => { if (!busy.current) onClose(); };
  const save = async e => {
    e.preventDefault(); if (busy.current) return;
    if (tax.reviewed && tax.business_use !== 'personal' && taxReviewIssues(tax).length) { setError('Complete business details before marking reviewed.'); return; }
    busy.current = true; setSaving(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/expenses/${expense.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tax_details: tax, expected_tax_version: expense.tax_version ?? 0 }) }));
      onSaved();
    } catch (error) { setError(error.message); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black/70" onClick={close} />
    <form role="dialog" aria-modal="true" aria-label="Review expense tax details" onSubmit={save} className="relative max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-white/10 bg-[#16181d] p-5">
      <h2 className="text-lg font-semibold text-white">{expense.name} · ${expense.amount}</h2>
      <ExpenseTaxFields value={tax} onChange={setTax} disabled={saving} />
      <p className="text-xs text-gray-400">Attach supporting receipts through <Link to="/receipts" className="underline">Receipts</Link>. Keep the payment evidence referenced here.</p>
      {error && <div><p role="alert" className="text-sm text-red-400">{error}</p><button type="button" disabled={saving} onClick={onSaved} className="mt-2 text-sm underline">Discard draft and reload worksheet</button></div>}
      <div className="flex justify-end gap-3"><button type="button" disabled={saving} onClick={close} className="rounded-lg border border-white/10 px-4 py-2 text-gray-300">Cancel</button><button disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-white">{saving ? 'Saving…' : 'Save tax details'}</button></div>
    </form>
  </div>;
}

export default function ScheduleC() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [result, setResult] = useState(null);
  const [revision, setRevision] = useState(0);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const validYear = /^\d{4}$/.test(year) && Number(year) >= 1900;
  useEffect(() => {
    if (!/^\d{4}$/.test(year) || Number(year) < 1900) return;
    let active = true;
    (async () => {
      try {
        const preference = await requireSuccessfulResponse(await apiFetch('/api/preferences/schedule-c'));
        const { enabled } = await preference.json();
        const data = enabled ? await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c?year=${year}`, { exactCurrency: true }))).json() : null;
        if (active) setResult({ year, revision, enabled, data });
      } catch (error) { if (active) setResult({ year, revision, error: error.message }); }
    })();
    return () => { active = false; };
  }, [year, revision]);
  const current = result?.year === year && result?.revision === revision ? result : null;
  const report = current?.data;
  const rows = report?.rows.filter(row => filter === 'all' || row.status === filter || row.tax_details.tax_category === filter) || [];
  const exportCSV = () => downloadFile(`schedule-c-${year}-expenses.csv`, csvText(report.rows.map(row => ({ tax_year: year, reference_mapping_year: report.mapping_year, planning: report.planning, expense_id: row.id, name: row.name, status: row.status, amount: row.amount, worksheet_amount: row.eligible, business_percent: row.tax_details.business_use === 'business' ? '100' : row.tax_details.business_percent, tax_category: row.tax_details.tax_category, reference_line: report.groups.find(group => group.id === row.tax_details.tax_category)?.line2025 || '', payee: row.tax_details.payee, purpose: row.tax_details.purpose, paid_date: row.tax_details.paid_date, payment_reference: row.tax_details.payment_reference, receipt_url: row.receipt_url, review_issues: row.issues.join('; '), receipt_missing: row.documentation_missing }))), 'text/csv;charset=utf-8');
  return <div className="schedule-c-page space-y-6 p-3 text-white sm:p-6">
    <style>{`@media print { aside, header, .schedule-c-actions, .schedule-c-page button { display:none!important; } .schedule-c-page section[aria-label="Schedule C categories"] button { display:block!important; } .schedule-c-page, .schedule-c-page * { color:#000!important; background:#fff!important; } main, main > div, .schedule-c-page { overflow:visible!important; height:auto!important; } body,#root {height:auto!important;} }`}</style>
    <div className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold">Schedule C expense worksheet</h1><p className="mt-1 text-sm text-gray-400">Tax year is the year of the records, even if you file the return the following year.</p></div>
      <label className="schedule-c-actions text-sm">Tax year<input aria-label="Tax year" type="number" min="1900" max="9999" step="1" value={year} onChange={e => { setYear(e.target.value); setFilter('all'); }} className="ml-3 w-24 rounded-lg border border-white/10 bg-[#16181d] p-2" /></label></div>
    <p className="rounded-xl border border-white/10 p-4 text-sm text-gray-400">Cash-method expense preparation only; accrual reporting is not supported here. Totals contain paid, reviewed business expenses; they are not your complete Schedule C or a tax calculation. Sales, inventory, equipment, vehicle and home-office deductions require separate treatment. <a href="https://www.irs.gov/instructions/i1040sc" target="_blank" rel="noreferrer" className="underline">IRS instructions</a></p>
    {!validYear ? <p role="alert">Choose a four-digit tax year from 1900 to 9999.</p> : !current ? <p role="status">Loading worksheet…</p> : current.error ? <div><p role="alert" className="text-red-400">{current.error}</p><button onClick={() => setRevision(value => value + 1)} className="mt-3 underline">Retry loading</button></div> : !current.enabled ? <div className="rounded-xl border border-white/10 p-6"><p>Enable Schedule C preparation in Settings to use this worksheet.</p><Link to="/settings" state={{ tab: 'tax' }} className="mt-3 inline-block text-purple-300 underline">Open Schedule C settings</Link></div> : <>
      <p className="font-medium">Tax year {report.year} · USD · paid-expense worksheet</p>
      {report.planning && <p className="rounded-xl border border-amber-500/30 p-4 text-sm text-amber-300">Planning worksheet for {year}. Line references use the verified 2025 form; mappings for {year} have not been verified. These figures are not filing-ready.</p>}
      <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-white/10 p-4"><p className="text-sm text-gray-400">Reviewed expense total</p><p className="mt-2 text-2xl">${report.total}</p></div><button onClick={() => setFilter('pending')} className="rounded-xl border border-white/10 p-4 text-left"><p className="text-sm text-gray-400">Needs review</p><p className="mt-2 text-2xl">{report.pending}</p></button><div className="rounded-xl border border-white/10 p-4"><p className="text-sm text-gray-400">Missing receipt attachments</p><p className="mt-2 text-2xl">{report.documentation_gaps}</p></div></div>
      <p className="text-sm text-gray-400">Unknown payment dates remain in the review queue across all years until assigned. Personal and unpaid entries are excluded. Missing receipts remain flagged even when other details are reviewed.</p>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Schedule C categories">{report.groups.map(group => <button key={group.id} onClick={() => setFilter(group.id)} className="rounded-xl border border-white/10 p-4 text-left"><p className="text-sm text-gray-400">{report.planning ? '2025 reference line' : 'Line'} {group.line2025}{group.detail ? ` — ${group.detail}` : ''}</p><h2 className="mt-1 font-medium">{group.label}</h2><p className="mt-2 text-xl">${group.total}</p><p className="text-xs text-gray-500">{group.count} reviewed expenses · view records</p></button>)}</section>
      <p className="rounded-xl border border-white/10 p-4">Other expenses combined ({report.planning ? '2025 reference line' : 'line'} 27b): <strong>${report.lines?.find(line => line.line === '27b')?.total || '0.00'}</strong>. This combines the itemized postage, software and other expense categories above.</p>
      <div className="schedule-c-actions flex flex-wrap gap-3"><button className="rounded-lg border border-white/10 px-3 py-2" onClick={exportCSV} disabled={!report.rows.length}>Export supporting CSV</button><button className="rounded-lg border border-white/10 px-3 py-2" onClick={() => downloadJSON(`schedule-c-${year}-expenses.json`, report)}>Export worksheet JSON</button><button className="rounded-lg border border-white/10 px-3 py-2" onClick={() => window.print()}>Print / save PDF</button><Link className="rounded-lg border border-white/10 px-3 py-2" to="/expenses">Manage expenses</Link></div>
      <section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Supporting records and review queue</h2><label className="schedule-c-actions text-sm">Show<select aria-label="Show records" value={filter} onChange={e => setFilter(e.target.value)} className="ml-2 rounded-lg border border-white/10 bg-[#16181d] p-2"><option value="all">All records</option><option value="pending">Needs review</option><option value="reviewed">Reviewed</option><option value="excluded">Excluded</option>{report.groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}</select></label></div>
        {!rows.length && <p className="rounded-xl border border-white/10 p-5 text-gray-400">No expenses match this view.</p>}
        {rows.map(row => <article key={row.id} className="space-y-2 rounded-xl border border-white/10 p-4"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-medium">{row.name}</h3><span>${row.amount} · worksheet ${row.eligible}</span></div><p className="text-sm text-gray-400">{row.status} · {row.tax_details.payee || 'Payee missing'} · {row.tax_details.paid_date || 'Payment date unknown'}{row.tax_details.business_use === 'mixed' ? ` · ${row.tax_details.business_percent}% business` : ''}</p><p className="break-words text-sm text-gray-400">{row.tax_details.purpose || 'Business purpose missing'}</p>{row.tax_details.payment_reference && <p className="break-words text-xs text-gray-400">Payment evidence: {row.tax_details.payment_reference}</p>}{row.issues.length > 0 && <p className="text-sm text-amber-300">{row.issues.join(' · ')}</p>}{row.documentation_missing ? <p className="text-xs text-amber-300">Receipt attachment missing — review supporting documentation.</p> : /^https:\/\//i.test(row.receipt_url) && <a href={row.receipt_url} target="_blank" rel="noreferrer" className="text-sm text-purple-300 underline">View receipt</a>}<button onClick={() => setEditing(row)} className="text-sm text-purple-300 underline">Review {row.name}</button></article>)}
      </section>
    </>}
    {editing && <TaxEditor key={editing.id} expense={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRevision(value => value + 1); }} />}
  </div>;
}
