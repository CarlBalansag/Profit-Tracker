import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { localToday } from '../../utils/returnWindow';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';

function Entry({ entry, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(`/api/tax/reserves/entry/${entry.id}`, { method: 'DELETE' }));
      onChanged(await res.json());
    } catch (err) { setError(err.message || 'Could not delete. Try again.'); setBusy(false); }
  };
  return <li className="rounded-lg border border-white/10 p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-gray-200">{entry.kind === 'set_aside' ? 'Set aside' : 'Took back'} · {day(entry.date)}{entry.note ? <span className="text-gray-500"> · {entry.note}</span> : null}</span>
      <span className={`tabular-nums ${entry.kind === 'set_aside' ? 'text-emerald-300' : 'text-gray-300'}`}>{entry.kind === 'set_aside' ? '+' : '−'}{usd(entry.amount)}</span>
    </div>
    <div className="mt-1 flex flex-wrap gap-3 text-xs">
      {!confirming
        ? <button type="button" onClick={() => setConfirming(true)} className="text-gray-400 underline">Delete</button>
        : <><span className="text-gray-400">Delete this entry?</span><button type="button" onClick={() => setConfirming(false)} className="text-gray-400 underline">Keep it</button><button type="button" disabled={busy} onClick={remove} className="text-red-300 underline">{busy ? 'Deleting…' : 'Yes, delete'}</button></>}
    </div>
    {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
  </li>;
}

/** The year's tax savings: what was moved aside or taken back, and the balance. */
export function TaxReserve({ year, ledger, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState({ kind: 'set_aside', amount: '', date: localToday(), note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setValues((v) => ({ ...v, [key]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    const amount = String(values.amount).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { setError('Enter an amount in dollars and cents, like 250.00.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) { setError('Choose a date.'); return; }
    setBusy(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(`/api/tax/reserves/${year}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, amount }) }));
      onChanged(await res.json());
      setAdding(false); setValues({ kind: 'set_aside', amount: '', date: localToday(), note: '' });
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-gray-400">Money you&apos;ve moved somewhere safe for your {year} taxes, like a separate savings account. It&apos;s your own record: it never counts as an expense or changes your profit.</p>
    {ledger.entries.length > 0 && <ul className="space-y-2">{ledger.entries.map((entry) => <Entry key={entry.id} entry={entry} onChanged={onChanged} />)}</ul>}
    {adding ? <form onSubmit={save} noValidate aria-label="Add to tax savings" className="space-y-3 rounded-lg border border-white/10 p-3">
      <fieldset className="flex flex-wrap gap-4"><legend className="sr-only">Set aside or take back</legend>
        <label className="flex items-center gap-2"><input type="radio" name="reserve-kind" value="set_aside" checked={values.kind === 'set_aside'} onChange={set('kind')} /> I set money aside</label>
        <label className="flex items-center gap-2"><input type="radio" name="reserve-kind" value="released" checked={values.kind === 'released'} onChange={set('kind')} /> I took some back</label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="reserve-amount" className="block text-gray-300">Amount</label><div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span><input id="reserve-amount" type="number" inputMode="decimal" min="0" step="0.01" value={values.amount} disabled={busy} onChange={set('amount')} placeholder="0.00" className={`${inputCls} pl-7`} /></div></div>
        <div><label htmlFor="reserve-date" className="block text-gray-300">Date</label><input id="reserve-date" type="date" value={values.date} disabled={busy} onChange={set('date')} className={`mt-1 ${inputCls}`} /></div>
        <div><label htmlFor="reserve-note" className="block text-gray-300">Note (optional)</label><input id="reserve-note" value={values.note} maxLength={200} disabled={busy} onChange={set('note')} placeholder="e.g. moved to savings" className={`mt-1 ${inputCls}`} /></div>
      </div>
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" disabled={busy} onClick={() => { setAdding(false); setError(''); }} className="rounded-lg border border-white/10 px-4 py-2 text-gray-300">Cancel</button>
      </div>
    </form> : <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-purple-300">Record money set aside</button>}
  </div>;
}
