import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const signed = (value) => (Number(value) > 0 ? `+${usd(value)}` : usd(value));
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';
const OTHER = '';

// Add or edit one form. `form` is null for a new one.
function FormEditor({ year, form, platforms, onDone, onCancel }) {
  const [values, setValues] = useState({
    platform_id: form ? (form.platform_id ?? OTHER) : (platforms[0]?.id ?? OTHER),
    payer_name: form ? form.payer_name : (platforms[0]?.name ?? ''),
    gross_amount: form?.gross_amount ?? '',
    transaction_count: form?.transaction_count ?? '',
  });
  // Whether the payer name came from the person (or the saved form) rather
  // than from picking a platform. Clearing the box hands it back.
  const [payerTyped, setPayerTyped] = useState(Boolean(form));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));
  const pickPlatform = (id) => {
    const name = platforms.find((p) => p.id === id)?.name;
    setValues((v) => ({ ...v, platform_id: id, payer_name: payerTyped && v.payer_name ? v.payer_name : (name || '') }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    const payer = values.payer_name.trim();
    const gross = String(values.gross_amount).trim();
    const count = String(values.transaction_count).trim();
    if (!payer) { setError('Enter who sent the form.'); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(gross)) { setError('Enter the box 1a amount in dollars and cents, like 1250.00.'); return; }
    if (count && !/^\d+$/.test(count)) { setError('Enter the number of transactions as a whole number, or leave it blank.'); return; }
    setSaving(true); setError('');
    try {
      const body = JSON.stringify({ payer_name: payer, platform_id: values.platform_id || null, gross_amount: gross, transaction_count: count || null });
      await requireSuccessfulResponse(await apiFetch(form ? `/api/schedule-c/1099-k/${form.id}` : `/api/schedule-c/years/${year}/1099-k`, {
        method: form ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body,
      }));
      onDone();
    } catch (err) {
      setError(err.message || 'Could not save. Try again.');
      setSaving(false);
    }
  };

  const id = (key) => `f1099k-${form?.id || 'new'}-${key}`;
  return <form onSubmit={save} noValidate aria-label={form ? `Edit 1099-K from ${form.payer_name}` : 'Add a 1099-K'} className="space-y-3 rounded-lg border border-white/10 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor={id('platform')} className="block text-sm text-gray-300">Which platform is it for?</label>
        <select id={id('platform')} value={values.platform_id} disabled={saving} onChange={(e) => pickPlatform(e.target.value)} className={`mt-1 ${inputCls}`}>
          {platforms.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          <option value={OTHER}>Not one of these (a payment app, for example)</option>
        </select>
      </div>
      <div>
        <label htmlFor={id('payer')} className="block text-sm text-gray-300">Who sent it (filer&apos;s name)</label>
        <input id={id('payer')} value={values.payer_name} disabled={saving} maxLength={100} onChange={(e) => { set('payer_name', e.target.value); setPayerTyped(e.target.value !== ''); }} placeholder="e.g. eBay, PayPal" className={`mt-1 ${inputCls}`} />
      </div>
      <div>
        <label htmlFor={id('gross')} className="block text-sm text-gray-300">Gross amount (box 1a)</label>
        <div className="relative mt-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
          <input id={id('gross')} type="number" inputMode="decimal" min="0" step="0.01" value={values.gross_amount} disabled={saving} onChange={(e) => set('gross_amount', e.target.value)} placeholder="0.00" className={`${inputCls} pl-7`} />
        </div>
      </div>
      <div>
        <label htmlFor={id('count')} className="block text-sm text-gray-300">Number of transactions (box 3, optional)</label>
        <input id={id('count')} type="number" inputMode="numeric" min="0" step="1" value={values.transaction_count} disabled={saving} onChange={(e) => set('transaction_count', e.target.value)} className={`mt-1 ${inputCls}`} />
      </div>
    </div>
    <p className="text-xs text-gray-500">Only these amounts are saved. Don&apos;t enter tax ID or account numbers.</p>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : form ? 'Save changes' : 'Add 1099-K'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300">Cancel</button>
    </div>
  </form>;
}

function FormRow({ form, onEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/1099-k/${form.id}`, { method: 'DELETE' }));
      onDeleted();
    } catch (err) { setError(err.message || 'Could not delete. Try again.'); setBusy(false); }
  };
  return <li className="rounded-lg border border-white/10 p-3 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <span className="text-white">{form.payer_name}{form.platform_name && form.platform_name !== form.payer_name ? <span className="text-gray-500"> · for {form.platform_name}</span> : null}{!form.platform_id ? <span className="text-gray-500"> · no platform</span> : null}</span>
      <span className="tabular-nums text-gray-300">{usd(form.gross_amount)}{form.transaction_count !== null ? <span className="text-gray-500"> · {form.transaction_count} {form.transaction_count === 1 ? 'transaction' : 'transactions'}</span> : null}</span>
    </div>
    <div className="mt-2 flex flex-wrap gap-3">
      {!confirming ? <>
        <button type="button" onClick={onEdit} className="text-purple-300 underline">Edit</button>
        <button type="button" onClick={() => setConfirming(true)} className="text-gray-400 underline">Delete</button>
      </> : <>
        <span className="text-gray-400">Delete this 1099-K?</span>
        <button type="button" disabled={busy} onClick={remove} className="text-red-300 underline">{busy ? 'Deleting…' : 'Yes, delete'}</button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="text-gray-400 underline">Keep it</button>
      </>}
    </div>
    {error && <p role="alert" className="mt-2 text-red-400">{error}</p>}
  </li>;
}

// Sales by platform next to the 1099-K forms the user entered for the year.
export function Forms1099K({ year, data, onSaved }) {
  const [editing, setEditing] = useState(null); // 'new' | form id | null
  const { forms, platforms, comparison } = data;
  const hasForms = forms.length > 0;
  const done = () => { setEditing(null); onSaved(); };
  return <details className="rounded-xl border border-white/10 p-4" open={hasForms || undefined}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Sales by platform and 1099-K forms{hasForms ? ` (${forms.length} ${forms.length === 1 ? 'form' : 'forms'}, ${usd(data.total)})` : ''}</summary>
    {comparison.length > 0 && <div className="mt-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500"><th className="pb-2 pr-2 font-normal">Platform</th><th className="pb-2 pr-2 text-right font-normal">Your sales</th><th className="pb-2 pr-2 text-right font-normal">1099-K</th><th className="pb-2 text-right font-normal">Difference</th></tr></thead>
        <tbody>{comparison.map((r) => <tr key={r.platform_id || r.platform} className="border-t border-white/5 text-gray-300">
          <td className="py-2 pr-2">{r.platform}<span className="block text-xs text-gray-500">{r.recordedCount} {r.recordedCount === 1 ? 'sale' : 'sales'}{r.formCount !== null ? ` · form: ${r.formCount}` : ''}</span></td>
          <td className="py-2 pr-2 text-right tabular-nums">{usd(r.recordedGross)}</td>
          <td className="py-2 pr-2 text-right tabular-nums">{r.formGross === null ? <span className="text-gray-500">None</span> : usd(r.formGross)}</td>
          <td className={`py-2 text-right tabular-nums ${r.difference !== null && Number(r.difference) !== 0 ? 'text-amber-300' : ''}`}>{r.difference === null ? '' : signed(r.difference)}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {Number(data.unlinkedTotal) > 0 && <p className="mt-2 text-xs text-gray-500">{usd(data.unlinkedTotal)} on forms not tied to a platform isn&apos;t in the table.</p>}
    <p className="mt-3 text-xs text-gray-500">A 1099-K shows the gross the platform processed, which can include shipping the buyer paid and sales tax, before fees and refunds. Platforms send one when you have more than $20,000 and more than 200 sales; all sales count as income either way. Your gross receipts (line 1) always come from your sales records. <a className="underline" href="https://www.irs.gov/businesses/understanding-your-form-1099-k" target="_blank" rel="noreferrer">IRS: Understanding your 1099-K</a></p>

    <div className="mt-4 space-y-3">
      <h3 className="text-sm font-medium text-white">Your {year} 1099-K forms</h3>
      {hasForms ? <ul className="space-y-2">{forms.map((f) => editing === f.id
        ? <li key={f.id}><FormEditor year={year} form={f} platforms={platforms} onDone={done} onCancel={() => setEditing(null)} /></li>
        : <FormRow key={f.id} form={f} onEdit={() => setEditing(f.id)} onDeleted={done} />)}</ul>
        : <p className="text-sm text-gray-400">None entered. Add each 1099-K you received to see how it compares with your sales.</p>}
      {editing === 'new'
        ? <FormEditor year={year} form={null} platforms={platforms} onDone={done} onCancel={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-purple-300">Add a 1099-K</button>}
    </div>
  </details>;
}
