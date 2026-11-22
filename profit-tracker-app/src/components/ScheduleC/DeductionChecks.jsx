import { useState } from 'react';
import { discoverDeductions } from '../../../../shared/tax/index.mjs';

const STORE_KEY = 'pt.taxDeductionChecks.hidden';
const readHidden = () => { try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; } };
const writeHidden = (ids) => { try { localStorage.setItem(STORE_KEY, JSON.stringify(ids)); } catch { /* only a convenience */ } };

/**
 * Deductions worth looking into, from what the records show. Never claimed:
 * each says why, what to keep, the limits and where the IRS explains it. A
 * check can be hidden on this device.
 */
export function DeductionChecks({ year, worksheet, saleCount, profit, records = null, pendingExpenses = 0, missingReceipts = 0, onShowWorksheet }) {
  const [hidden, setHidden] = useState(readHidden);
  const categoryCounts = Object.fromEntries((worksheet?.groups || []).map((g) => [g.id, g.count]));
  const expenseNames = (worksheet?.rows || []).filter((r) => r.source !== 'sale').map((r) => r.name);
  const recorded = { mileage: (records?.mileage?.trips || 0) > 0, homeOffice: Boolean(records?.homeOffice?.claimed), equipment: (records?.assets?.count || 0) > 0 };
  const checks = discoverDeductions({ year, categoryCounts, expenseNames, saleCount, profit, recorded });
  const shown = checks.filter((c) => !hidden.includes(c.id));
  const hide = (id) => { const next = [...hidden, id]; setHidden(next); writeHidden(next); };
  const showAll = () => { setHidden([]); writeHidden([]); };

  return <div className="mt-3 space-y-3 text-sm">
    <ul className="space-y-2 text-gray-300">
      <li>{pendingExpenses > 0 ? <>{pendingExpenses} {pendingExpenses === 1 ? 'expense is' : 'expenses are'} waiting for review and not deducted yet. <button type="button" onClick={onShowWorksheet} className="underline">Review them</button></> : 'Every expense has been reviewed.'}</li>
      <li>{missingReceipts > 0 ? `${missingReceipts} deducted ${missingReceipts === 1 ? 'expense has' : 'expenses have'} no receipt attached. Keep records for each deduction.` : 'Every deducted expense has a receipt.'}</li>
    </ul>
    <p className="text-gray-400">Worth looking into. These are prompts, not claims: nothing is added to your return unless you record it.</p>
    <ul className="space-y-2">
      {shown.map((c) => <li key={c.id} className="rounded-lg border border-white/10 p-3">
        <details>
          <summary className="cursor-pointer text-white">{c.title} <span className="text-xs text-gray-500">· {c.where}</span></summary>
          <dl className="mt-2 space-y-1.5 text-gray-300">
            <div><dt className="inline text-gray-500">Why: </dt><dd className="inline">{c.why}</dd></div>
            <div><dt className="inline text-gray-500">Keep: </dt><dd className="inline">{c.docs}</dd></div>
            <div><dt className="inline text-gray-500">Limits: </dt><dd className="inline">{c.limits}</dd></div>
          </dl>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">
            {c.logOn && onShowWorksheet && <button type="button" onClick={onShowWorksheet} className="text-purple-300 underline">Add it on the worksheet ({c.logOn})</button>}
            <a href={c.source.url} target="_blank" rel="noreferrer" className="text-purple-300 underline">{c.source.label}</a>
            <button type="button" onClick={() => hide(c.id)} className="text-gray-400 underline">Doesn&apos;t apply to me</button>
          </div>
        </details>
      </li>)}
    </ul>
    {shown.length === 0 && <p className="text-gray-500">Nothing else to suggest right now.</p>}
    {hidden.length > 0 && <button type="button" onClick={showAll} className="text-xs text-gray-400 underline">Show {hidden.length} hidden {hidden.length === 1 ? 'suggestion' : 'suggestions'}</button>}
  </div>;
}
