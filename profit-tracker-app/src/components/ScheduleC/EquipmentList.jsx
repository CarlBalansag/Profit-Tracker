import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { ASSET_METHODS, inputCls, isDay, isMoney, shortDate, todayIn, usd } from '../../utils/taxLogs';

const card = 'rounded-xl border border-white/10 p-4';
const METHOD_HELP = {
  de_minimis: 'For items up to $2,500 each. Deducted in full the year you start using it (line 22). You elect it with a statement on that year\'s return.',
  section_179: 'Deducted in full the year you start using it (line 13, Form 4562). Needs more than 50% business use, and can\'t be more than your business income plus wages.',
  macrs: 'Spread over 5 years (computers, printers, cameras) or 7 years (furniture, shelving), on line 13 through Form 4562.',
};

function AssetForm({ year, asset, onDone, onCancel }) {
  const [v, setV] = useState({
    name: asset?.name || '', placed_in_service: asset?.placed_in_service || todayIn(year), cost: asset?.cost || '',
    business_percent: asset ? String(asset.business_percent) : '100', method: asset?.method || 'de_minimis',
    recovery_years: asset?.recovery_years ? String(asset.recovery_years) : '5', disposed_date: asset?.disposed_date || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    const pct = Number(v.business_percent);
    if (!v.name.trim()) { setError('Enter what it is, like "Label printer".'); return; }
    if (!isDay(v.placed_in_service)) { setError('Enter the date you started using it for the business.'); return; }
    if (!isMoney(v.cost) || !(Number(v.cost) > 0)) { setError('Enter what it cost in dollars and cents.'); return; }
    if (!/^\d+$/.test(v.business_percent) || pct < 1 || pct > 100) { setError('Enter the business-use percentage, from 1 to 100.'); return; }
    if (v.method === 'de_minimis' && Number(v.cost) > 2500) { setError('The de minimis safe harbor is for items up to $2,500. Choose Section 179 or depreciation.'); return; }
    if (v.method === 'section_179' && pct <= 50) { setError('Section 179 needs more than 50% business use. Choose depreciation instead.'); return; }
    if (v.disposed_date && (!isDay(v.disposed_date) || v.disposed_date < v.placed_in_service)) { setError('The date it was sold or thrown out has to be on or after the date you started using it.'); return; }
    setSaving(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(asset ? `/api/schedule-c/assets/${asset.id}?year=${year}` : `/api/schedule-c/assets?year=${year}`, {
        method: asset ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, name: v.name.trim(), cost: String(v.cost).trim(), business_percent: pct, recovery_years: v.method === 'macrs' ? Number(v.recovery_years) : null, disposed_date: v.disposed_date || null }),
      }));
      onDone(await res.json());
    } catch (err) { setError(err.message || 'Could not save. Try again.'); setSaving(false); }
  };
  const id = (k) => `asset-${asset?.id || 'new'}-${k}`;
  return <form onSubmit={save} noValidate aria-label={asset ? `Edit ${asset.name}` : 'Add equipment'} className="space-y-3 rounded-lg border border-white/10 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label htmlFor={id('name')} className="block text-sm text-gray-300">What it is</label>
        <input id={id('name')} value={v.name} maxLength={100} disabled={saving} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Label printer, shelving" className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('start')} className="block text-sm text-gray-300">Started using it for the business</label>
        <input id={id('start')} type="date" value={v.placed_in_service} disabled={saving} onChange={(e) => set('placed_in_service', e.target.value)} className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('cost')} className="block text-sm text-gray-300">What it cost (with tax and shipping)</label>
        <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
          <input id={id('cost')} type="text" inputMode="decimal" value={v.cost} disabled={saving} onChange={(e) => set('cost', e.target.value)} placeholder="0.00" className={`${inputCls} pl-7`} /></div></div>
      <div><label htmlFor={id('pct')} className="block text-sm text-gray-300">Business use</label>
        <div className="relative mt-1"><input id={id('pct')} type="text" inputMode="numeric" value={v.business_percent} disabled={saving} onChange={(e) => set('business_percent', e.target.value)} className={`${inputCls} pr-8`} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span></div></div>
      <div className="sm:col-span-2"><label htmlFor={id('method')} className="block text-sm text-gray-300">How to deduct it</label>
        <select id={id('method')} value={v.method} disabled={saving} onChange={(e) => set('method', e.target.value)} className={`mt-1 ${inputCls}`}>
          {Object.entries(ASSET_METHODS).map(([key, m]) => <option key={key} value={key}>{m.label}</option>)}
        </select>
        <p className="mt-1 text-xs text-gray-500">{METHOD_HELP[v.method]}</p></div>
      {v.method === 'macrs' && <div><label htmlFor={id('years')} className="block text-sm text-gray-300">Spread over</label>
        <select id={id('years')} value={v.recovery_years} disabled={saving} onChange={(e) => set('recovery_years', e.target.value)} className={`mt-1 ${inputCls}`}>
          <option value="5">5 years (computer, printer, camera)</option>
          <option value="7">7 years (furniture, shelving)</option>
        </select></div>}
      <div><label htmlFor={id('gone')} className="block text-sm text-gray-300">Sold or thrown out (optional)</label>
        <input id={id('gone')} type="date" value={v.disposed_date} disabled={saving} onChange={(e) => set('disposed_date', e.target.value)} className={`mt-1 ${inputCls}`} /></div>
    </div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : asset ? 'Save changes' : 'Add equipment'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300">Cancel</button>
    </div>
  </form>;
}

function AssetRow({ year, asset, limited = false, onEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try { onDeleted(await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/assets/${asset.id}?year=${year}`, { method: 'DELETE' }))).json()); }
    catch (err) { setError(err.message || 'Could not delete. Try again.'); setBusy(false); }
  };
  const m = ASSET_METHODS[asset.method];
  return <li className="py-2 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 break-words text-gray-200">{asset.name}</span>
      <span className="tabular-nums text-gray-300">{usd(asset.this_year)} in {year}{limited && Number(asset.this_year) > 0 ? ' before the limit' : ''}</span>
    </div>
    <p className="text-xs text-gray-500">{usd(asset.cost)} · {asset.business_percent}% business · {m?.short}{asset.method === 'macrs' ? `, ${asset.recovery_years} years` : ''} · since {shortDate(asset.placed_in_service)}{asset.disposed_date ? ` · gone ${shortDate(asset.disposed_date)}` : ''}</p>
    <div className="mt-1 flex flex-wrap gap-3 text-xs">
      {!confirming ? <>
        <button type="button" onClick={onEdit} className="text-purple-300 underline">Edit</button>
        <button type="button" onClick={() => setConfirming(true)} className="text-gray-400 underline">Delete</button>
      </> : <>
        <span className="text-gray-400">Delete {asset.name}? It comes off every year&apos;s worksheet.</span>
        <button type="button" disabled={busy} onClick={remove} className="text-red-300 underline">{busy ? 'Deleting…' : 'Yes, delete'}</button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="text-gray-400 underline">Keep it</button>
      </>}
    </div>
    {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
  </li>;
}

/** Equipment used in the business: lines 13 (depreciation and Section 179) and 22 (de minimis). */
export function EquipmentList({ year, assets: summary, onSaved }) {
  const [assets, setAssets] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/assets?year=${year}`))).json();
        if (active) setAssets(data.assets);
      } catch (err) { if (active) setLoadError(err.message || 'Could not load your equipment.'); }
    })();
    return () => { active = false; };
  }, [year, attempt]);
  const changed = (data) => { setAssets(data.assets); setEditing(null); onSaved(); };
  const total = Number(summary.line13) + Number(summary.deMinimis);
  // Only equipment in use (or bought) this year or before.
  const shown = (assets || []).filter((a) => Number(a.placed_in_service.slice(0, 4)) <= year);
  const later = (assets || []).length - shown.length;

  return <details className={card}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Equipment (lines 13 and 22): {usd(total)}</summary>
    <div className="mt-3 space-y-4 text-sm">
      <p className="text-gray-400">Things the business uses for more than a year: a label printer, scale, shelving, camera or computer. Not stock you sell, and not your car (use the mileage log for that).</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0"><p className="text-xs text-gray-500">Depreciation (line 13)</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{usd(summary.depreciation)}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-500">Section 179 (line 13)</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{usd(summary.section179)}</p>{Number(summary.section179Carryover) > 0 && <p className="mt-1 text-xs text-amber-300">{usd(summary.section179Carryover)} carries to next year</p>}</div>
        <div className="min-w-0"><p className="text-xs text-gray-500">De minimis (line 22)</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{usd(summary.deMinimis)}</p></div>
      </div>
      {summary.midQuarter && <p className="text-amber-300">More than 40% of the equipment you&apos;re depreciating started in October to December, so a different IRS rule (mid-quarter) applies. These amounts use the usual half-year rule; ask a tax preparer to check them.</p>}

      {editing === 'new' ? <AssetForm year={year} onDone={changed} onCancel={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} className="page-btn page-btn-primary">Add equipment</button>}

      {loadError ? <div><p role="alert" className="text-red-400">{loadError}</p><button type="button" onClick={() => { setLoadError(''); setAttempt((n) => n + 1); }} className="mt-1 underline">Try again</button></div>
        : assets === null ? <p role="status" className="text-gray-400">Loading equipment…</p>
          : shown.length === 0 ? <p className="text-gray-400">No equipment in use by {year} yet.</p>
            : <ul className="divide-y divide-white/5">{shown.map((a) => (editing === a.id
              ? <li key={a.id} className="py-2"><AssetForm year={year} asset={a} onDone={changed} onCancel={() => setEditing(null)} /></li>
              : <AssetRow key={a.id} year={year} asset={a} limited={a.method === 'section_179' && Number(summary.section179Carryover) > 0} onEdit={() => setEditing(a.id)} onDeleted={changed} />))}</ul>}
      {later > 0 && <p className="text-xs text-gray-500">{later} more {later === 1 ? 'item starts' : 'items start'} after {year}.</p>}
      <p className="text-xs text-gray-500">Not calculated here: bonus depreciation, the mid-quarter rule, Section 179 carried in from earlier years, and any gain when you sell equipment. Keep the receipt and the date you started using each item. <a href="https://www.irs.gov/publications/p946" target="_blank" rel="noreferrer" className="underline">IRS Publication 946</a></p>
    </div>
  </details>;
}
