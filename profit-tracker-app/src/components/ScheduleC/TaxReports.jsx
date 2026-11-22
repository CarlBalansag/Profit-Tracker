import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { taxCategories } from '../../../../shared/scheduleC.mjs';
import { downloadFile, downloadJSON } from '../../utils/downloads';
import { inputCls, reportCsv, usd } from '../../utils/taxLogs';
import { ReportPacket } from './ReportPacket';
import { ResponsiveTable } from './ResponsiveTable';

const card = 'rounded-xl border border-white/10 p-4';
const when = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const getJson = async (path) => (await requireSuccessfulResponse(await apiFetch(path))).json();

function Finalize({ year, data, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const latest = data.finalized;
  const revising = Boolean(latest);
  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (revising && !reason.trim()) { setError('Say what changed, like "Added a missed receipt".'); return; }
    setSaving(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/years/${year}/finalize`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_revision: latest ? latest.revision : 0, reason: reason.trim() || null }),
      }));
      setReason(''); onDone();
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setSaving(false); }
  };
  return <form onSubmit={save} noValidate aria-label={revising ? 'Save a revision' : `Finalize ${year}`} className="space-y-2">
    <label htmlFor="finalize-reason" className="block text-gray-300">{revising ? 'What changed?' : 'Note (optional)'}</label>
    <input id="finalize-reason" value={reason} maxLength={300} disabled={saving} onChange={(e) => setReason(e.target.value)} placeholder={revising ? 'e.g. Added a missed receipt' : 'e.g. Sent to my preparer'} className={inputCls} />
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : revising ? `Save revision ${latest.revision + 1}` : `Finalize ${year}`}</button>
  </form>;
}

function Status({ year, data, onDone }) {
  const latest = data.finalized;
  const yearNotOver = year >= new Date().getFullYear();
  if (!latest) {
    return <div className={`${card} space-y-3 text-sm`}>
      <h3 className="font-medium text-white">Not finalized</h3>
      <p className="text-gray-400">Finalizing saves a copy of these numbers as revision 1: what you hand to your preparer or file from. Your records stay editable, and this page will tell you if anything changes afterwards.</p>
      {yearNotOver && <p className="text-amber-300">{year} isn&apos;t over yet. Most people finalize after December 31, once every expense is reviewed.</p>}
      {data.report.expenses.pending > 0 && <p className="text-amber-300">{data.report.expenses.pending} {data.report.expenses.pending === 1 ? 'expense is' : 'expenses are'} still waiting for review and won&apos;t be included.</p>}
      <Finalize year={year} data={data} onDone={onDone} />
    </div>;
  }
  return <div className={`${card} space-y-3 text-sm`}>
    <h3 className="font-medium text-white">Finalized {when(latest.created_at)} · revision {latest.revision}</h3>
    {!data.changed && data.rulesChanged.length === 0 && <p className="text-gray-400">Nothing has changed since. Line 31 is {usd(latest.net_profit)}.</p>}
    {data.changed && <div className="space-y-2">
      <p className="text-amber-300">Your records changed since revision {latest.revision}.</p>
      {data.changes.length > 0
        ? <ul className="space-y-1 text-gray-300">{data.changes.map((c) => <li key={`${c.part}-${c.line}`}>Line {c.line} {c.label}: <span className="tabular-nums">{c.before === null ? 'none' : usd(c.before)} → {c.after === null ? 'none' : usd(c.after)}</span></li>)}</ul>
        : <p className="text-gray-400">No line amounts changed; supporting details did (for example the trip list, equipment details, payments or notes).</p>}
    </div>}
    {data.rulesChanged.length > 0 && <div className="space-y-1">
      <p className="text-amber-300">Tax rules ProfitTracker uses have been updated since revision {latest.revision}:</p>
      <ul className="space-y-0.5 text-gray-300">{data.rulesChanged.map((r) => <li key={r.key}>{r.label}</li>)}</ul>
      <p className="text-gray-400">Revision {latest.revision} keeps the numbers it was finalized with. The current numbers below use the new rules.</p>
    </div>}
    {(data.changed || data.rulesChanged.length > 0) && <><p className="text-gray-400">If you already filed, a change may mean an amended return (Form 1040-X); ask your preparer. Saving a revision keeps every earlier one.</p>
      <Finalize year={year} data={data} onDone={onDone} /></>}
  </div>;
}

function YearOverYear({ year, report, prior }) {
  if (!prior) return null;
  const pick = (r, part, line) => r[part].find((l) => l.line === line)?.amount;
  const rows = [
    ['1', 'Gross receipts', 'part1'], ['4', 'Cost of goods sold', 'part1'],
    ...report.part2.filter((l) => Number(l.amount) || Number(pick(prior, 'part2', l.line))).map((l) => [l.line, l.label, 'part2']),
    ['28', 'Total expenses', 'part1'], ['30', 'Business use of home', 'part1'], ['31', 'Net profit or (loss)', 'part1'],
  ];
  const empty = prior.sales.count === 0 && Number(pick(prior, 'part1', '28')) === 0;
  return <details className={card}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Compared with {year - 1}</summary>
    {empty ? <p className="mt-3 text-sm text-gray-400">ProfitTracker has no sales or expenses for {year - 1}.</p>
      : <ResponsiveTable className="mt-3" rows={rows} rowKey={([line, , part]) => `${part}-${line}`} strong={([line]) => line === '31'} columns={[
        { label: 'Line', cell: ([line, label]) => <><span className="text-gray-500">{line}</span> {label}</> },
        { label: String(year - 1), align: 'right', cell: ([line, , part]) => usd(Number(pick(prior, part, line) || 0)) },
        { label: String(year), align: 'right', cell: ([line, , part]) => usd(Number(pick(report, part, line) || 0)) },
        { label: 'Change', align: 'right', cell: ([line, , part]) => { const d = Math.round((Number(pick(report, part, line) || 0) - Number(pick(prior, part, line) || 0)) * 100) / 100; return `${d > 0 ? '+' : ''}${usd(d)}`; } },
      ]} />}
  </details>;
}

/**
 * The year-end report: finalize and revise, downloads, year-over-year, the
 * revision history, and the packet itself. onDrill(filter) opens the
 * worksheet on those records.
 */
export function TaxReports({ year, onDrill }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [viewing, setViewing] = useState(null);
  const [viewError, setViewError] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [data, history, prior] = await Promise.all([
          getJson(`/api/schedule-c/years/${year}/report`),
          getJson(`/api/schedule-c/years/${year}/snapshots`),
          year > 1900 ? getJson(`/api/schedule-c/years/${year - 1}/report`).catch(() => null) : null,
        ]);
        if (active) setState({ data, snapshots: history.snapshots, prior: prior?.report || null });
      } catch (err) { if (active) setState({ error: err.message || 'Could not load the report.' }); }
    })();
    return () => { active = false; };
  }, [year, attempt]);
  const reload = () => { setViewing(null); setAttempt((n) => n + 1); };
  const view = async (id) => {
    setViewError('');
    try { setViewing(await getJson(`/api/schedule-c/snapshots/${id}`)); }
    catch (err) { setViewError(err.message || 'Could not open that revision.'); }
  };

  if (!state) return <p role="status" className="text-gray-400">Loading the report…</p>;
  if (state.error) return <div><p role="alert" className="text-red-400">{state.error}</p><button type="button" onClick={() => { setState(null); reload(); }} className="mt-2 underline">Try again</button></div>;
  const { data, snapshots, prior } = state;
  const shown = viewing ? viewing.report : data.report;
  const label = viewing ? `revision-${viewing.revision}` : 'current';
  const drill = (line) => {
    if (viewing || !onDrill) return null;
    const cats = taxCategories.filter((c) => c.line2025 === line);
    if (['9', '13'].includes(line)) return () => onDrill('logs');
    if (line === '22') return () => onDrill('SUPPLIES');
    return cats.length ? () => onDrill(cats.length === 1 ? cats[0].id : 'all') : null;
  };

  return <section aria-label="Year-end report" className="space-y-4">
    <div className="no-print space-y-4">
      <Status year={year} data={data} onDone={reload} />
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" onClick={() => window.print()} className="rounded-lg border border-white/10 px-3 py-2">Print / save PDF</button>
        <button type="button" onClick={() => downloadFile(`schedule-c-${year}-${label}.csv`, reportCsv(shown), 'text/csv;charset=utf-8')} className="rounded-lg border border-white/10 px-3 py-2">Download lines (CSV)</button>
        <button type="button" onClick={() => downloadJSON(`schedule-c-${year}-${label}.json`, viewing ? { revision: viewing.revision, finalized: viewing.created_at, reason: viewing.reason, rules: viewing.rules, report: viewing.report } : { rules: data.rules, report: data.report })} className="rounded-lg border border-white/10 px-3 py-2">Download everything (JSON)</button>
      </div>
      <p className="text-xs text-gray-500">The CSV opens in Excel or Google Sheets. The PDF is the packet below: send it to your preparer with your receipts.</p>
      <YearOverYear year={year} report={data.report} prior={prior} />
      {snapshots.length > 0 && <details className={card}>
        <summary className="cursor-pointer text-sm font-medium text-purple-300">Revision history ({snapshots.length})</summary>
        <ul className="mt-3 space-y-2 text-sm">{snapshots.map((s) => <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-white/5 pt-2">
          <span className="min-w-0 text-gray-300">Revision {s.revision} · {when(s.created_at)}{s.reason ? ` · ${s.reason}` : ''}</span>
          <span className="flex flex-wrap items-baseline gap-3"><span className="tabular-nums text-gray-400">Line 31 {usd(s.net_profit)}</span><button type="button" onClick={() => view(s.id)} className="text-purple-300 underline">View</button></span>
        </li>)}</ul>
        {viewError && <p role="alert" className="mt-2 text-red-400">{viewError}</p>}
      </details>}
      {viewing && <p className="rounded-xl border border-purple-500/30 p-3 text-sm text-gray-200">Showing revision {viewing.revision}, finalized {when(viewing.created_at)}. <button type="button" onClick={() => setViewing(null)} className="underline">Back to the current numbers</button></p>}
    </div>
    <ReportPacket report={shown} heading={viewing ? `Schedule C ${year}, revision ${viewing.revision} (finalized ${when(viewing.created_at)})` : `Schedule C ${year}${data.finalized && !data.changed ? `, revision ${data.finalized.revision}` : ', current numbers'}`} onDrill={drill} />
  </section>;
}
