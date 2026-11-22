import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { STATE_NAMES } from '../../../../shared/tax/index.mjs';
import { localToday } from '../../utils/returnWindow';
import { ResponsiveTable } from './ResponsiveTable';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';
const STATUS = {
  paid: ['Paid', 'text-emerald-300'],
  partly_paid: ['Partly paid', 'text-amber-300'],
  overdue: ['Overdue', 'text-red-300'],
  upcoming: ['Upcoming', 'text-gray-400'],
};
const PERIOD_LABEL = { Q1: 'Q1', Q2: 'Q2', Q3: 'Q3', Q4: 'Q4', extension: 'Extension', other: 'Other' };
const PAY_LINKS = {
  US: { label: 'Pay the IRS (IRS Direct Pay and other ways)', url: 'https://www.irs.gov/payments' },
};
const nameOf = (code) => (code === 'US' ? 'Federal (IRS)' : STATE_NAMES[code] || code);

function Installments({ plan, installments }) {
  if (!plan) return null;
  if (!plan.supported) return <p className="text-gray-400">{plan.limitations?.[0]}</p>;
  if (!(plan.requiredFromEstimatedPayments > 0)) return <ul className="list-disc space-y-1 pl-5 text-xs text-gray-500">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>;
  return <>
    <p className="text-gray-400">{usd(plan.requiredFromEstimatedPayments)} for the year from estimated payments{plan.basis?.startsWith('prior') ? ', based on last year\'s tax' : ''}. {usd(plan.remaining)} still to pay.</p>
    <ResponsiveTable className="mt-2" rows={installments} rowKey={(i) => i.period} columns={[
      { label: 'Quarter', cell: (i) => <>{i.period}<span className="block text-xs font-normal text-gray-500">{i.covers}</span></> },
      { label: 'Due', align: 'right', cell: (i) => day(i.due) },
      { label: 'Left to pay', align: 'right', cell: (i) => <>{usd(i.remaining)}<span className="block text-xs text-gray-500">of {usd(i.amount)}</span></> },
      { label: 'Status', align: 'right', cell: (i) => <span className={STATUS[i.status][1]}>{STATUS[i.status][0]}</span> },
    ]} />
    {plan.notes.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-500">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
  </>;
}

function PaymentRow({ payment, onChanged }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(`/api/tax/payments/entry/${payment.id}`, { method: 'DELETE' }));
      onChanged((await res.json()).payments);
    } catch (err) { setError(err.message || 'Could not delete. Try again.'); setBusy(false); }
  };
  return <li className="rounded-lg border border-white/10 p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-gray-200">{nameOf(payment.jurisdiction)} · {PERIOD_LABEL[payment.period]} · {day(payment.paid_date)}{payment.reference ? <span className="text-gray-500"> · {payment.reference}</span> : null}</span>
      <span className="tabular-nums text-gray-200">{usd(payment.amount)}</span>
    </div>
    <div className="mt-1 flex flex-wrap gap-3 text-xs">
      {!confirming
        ? <button type="button" onClick={() => setConfirming(true)} className="text-gray-400 underline">Delete</button>
        : <><span className="text-gray-400">Delete this payment record?</span><button type="button" onClick={() => setConfirming(false)} className="text-gray-400 underline">Keep it</button><button type="button" disabled={busy} onClick={remove} className="text-red-300 underline">{busy ? 'Deleting…' : 'Yes, delete'}</button></>}
    </div>
    {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
  </li>;
}

/** The year's payment plans with each quarter's status, and recorded payments. */
export function TaxPayments({ year, o, profile, payments, onChanged }) {
  // Prefill with what's next: the earliest quarter not yet paid.
  const suggest = (code) => {
    const list = code === 'US' ? o.federalInstallments : code === profile?.state ? o.stateInstallments : [];
    const next = list.find((i) => i.remaining > 0);
    return { period: next?.period || 'other', amount: next ? String(next.remaining) : '' };
  };
  const blank = () => ({ jurisdiction: 'US', ...suggest('US'), paid_date: localToday(), reference: '' });
  const [adding, setAdding] = useState(false);
  const [values, setValues] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => {
    const value = e.target.value;
    setValues((v) => (key === 'jurisdiction' ? { ...v, jurisdiction: value, ...suggest(value) } : { ...v, [key]: value }));
  };
  const save = async (e) => {
    e.preventDefault();
    const amount = String(values.amount).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) { setError('Enter the amount you paid, like 1250.00.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paid_date)) { setError('Choose the date you paid.'); return; }
    setBusy(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(`/api/tax/payments/${year}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, amount }) }));
      onChanged((await res.json()).payments);
      setAdding(false);
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  const stateCodes = Object.keys(STATE_NAMES).sort((a, b) => STATE_NAMES[a].localeCompare(STATE_NAMES[b]));

  return <div className="mt-3 space-y-4 text-sm">
    {o.impact ? <>
      <div><p className="font-medium text-white">Federal (IRS)</p><Installments plan={o.federalPlan} installments={o.federalInstallments} /></div>
      {profile?.state && o.statePlan && <div><p className="font-medium text-white">{STATE_NAMES[profile.state]}</p><Installments plan={o.statePlan} installments={o.stateInstallments} /></div>}
    </> : <p className="text-gray-400">Add your filing status to see a payment plan. You can still record payments.</p>}

    <div className="space-y-2">
      <p className="font-medium text-white">Payments you&apos;ve made for {year}</p>
      {payments.length ? <ul className="space-y-2">{payments.map((p) => <PaymentRow key={p.id} payment={p} onChanged={onChanged} />)}</ul>
        : <p className="text-gray-400">None recorded yet.</p>}
      {adding ? <form onSubmit={save} noValidate aria-label="Record a tax payment" className="space-y-3 rounded-lg border border-white/10 p-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="pay-to" className="block text-gray-300">Paid to</label>
            <select id="pay-to" value={values.jurisdiction} disabled={busy} onChange={set('jurisdiction')} className={`mt-1 ${inputCls}`}>
              <option value="US">Federal (IRS)</option>
              {stateCodes.map((c) => <option key={c} value={c}>{STATE_NAMES[c]}</option>)}
            </select></div>
          <div><label htmlFor="pay-period" className="block text-gray-300">For</label>
            <select id="pay-period" value={values.period} disabled={busy} onChange={set('period')} className={`mt-1 ${inputCls}`}>
              {['Q1', 'Q2', 'Q3', 'Q4'].map((q) => <option key={q} value={q}>{q} estimated payment</option>)}
              <option value="extension">Extension payment</option>
              <option value="other">Other payment toward {year}</option>
            </select></div>
          <div><label htmlFor="pay-amount" className="block text-gray-300">Amount</label>
            <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">$</span><input id="pay-amount" type="number" inputMode="decimal" min="0" step="0.01" value={values.amount} disabled={busy} onChange={set('amount')} placeholder="0.00" className={`${inputCls} pl-7`} /></div></div>
          <div><label htmlFor="pay-date" className="block text-gray-300">Date paid</label>
            <input id="pay-date" type="date" value={values.paid_date} disabled={busy} onChange={set('paid_date')} className={`mt-1 ${inputCls}`} /></div>
          <div className="sm:col-span-2"><label htmlFor="pay-ref" className="block text-gray-300">Confirmation number (optional)</label>
            <input id="pay-ref" value={values.reference} maxLength={100} disabled={busy} onChange={set('reference')} className={`mt-1 ${inputCls}`} aria-describedby="pay-ref-why" />
            <p id="pay-ref-why" className="mt-1 text-xs text-gray-500">Only if you want it for your records. Never enter your SSN or bank details.</p></div>
        </div>
        {error && <p role="alert" className="text-red-400">{error}</p>}
        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save payment'}</button>
          <button type="button" disabled={busy} onClick={() => { setAdding(false); setError(''); }} className="rounded-lg border border-white/10 px-4 py-2 text-gray-300">Cancel</button>
        </div>
      </form> : <button type="button" onClick={() => { setValues(blank()); setAdding(true); }} className="rounded-lg border border-white/10 px-3 py-1.5 text-purple-300">Record a payment</button>}
      <p className="text-xs text-gray-500">Recording a payment here doesn&apos;t send money anywhere. <a className="underline" href={PAY_LINKS.US.url} target="_blank" rel="noreferrer">{PAY_LINKS.US.label}</a></p>
    </div>
  </div>;
}
