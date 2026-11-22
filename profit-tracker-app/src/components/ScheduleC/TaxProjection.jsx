import { useState } from 'react';
import { FORECAST_LABELS } from '../../../../shared/tax/index.mjs';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const ORDER = ['run_rate', 'recent', 'seasonal', 'target', 'actual'];
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] py-2 pl-7 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';

/**
 * Every way of projecting the year's profit side by side, with the one the
 * estimate uses selected. onChoose({ forecast_method, profit_target }).
 */
export function TaxProjection({ o, target, busy, onChoose }) {
  const [draft, setDraft] = useState(target ?? '');
  const [error, setError] = useState('');
  const p = o.projection;
  const chosen = o.forecastChoice;
  const choose = (key) => {
    if (key === 'target') {
      const v = String(draft).trim();
      if (!/^\d+(\.\d{1,2})?$/.test(v)) { setError('Enter your full-year profit estimate in dollars, like 40000.'); return; }
      setError(''); onChoose({ forecast_method: 'target', profit_target: v });
      return;
    }
    setError(''); onChoose({ forecast_method: key, profit_target: target ?? null });
  };
  return <div className="mt-3 space-y-3 text-sm">
    <p className="text-gray-400">{p.status === 'current'
      ? `Your actual profit so far is ${usd(o.actualProfit)}. Taxes are owed on the whole year, so the estimate uses a projection. Pick the one that fits your business best.`
      : 'The year is over, so the estimate uses its actual profit.'}</p>
    {chosen.usedFallback && <p className="text-amber-300">The projection you chose has nothing to go on yet, so this uses &quot;{FORECAST_LABELS[chosen.key]}&quot; instead.</p>}
    <fieldset className="space-y-2">
      <legend className="sr-only">How to project the year</legend>
      {ORDER.map((key) => {
        const m = p.methods[key];
        const disabled = busy || (key !== 'target' && !m.available);
        return <div key={key} className={`rounded-lg border p-3 ${chosen.key === key ? 'border-purple-500/50' : 'border-white/10'}`}>
          <label className="flex items-start gap-2">
            <input type="radio" name="forecast" checked={chosen.key === key} disabled={disabled} onChange={() => choose(key)} className="mt-1" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap justify-between gap-2"><span className="text-white">{FORECAST_LABELS[key]}</span><span className="tabular-nums text-gray-200">{m.available ? usd(m.value) : '—'}</span></span>
              <span className="block text-xs text-gray-500">{m.note}</span>
            </span>
          </label>
          {key === 'target' && <div className="mt-2 flex flex-wrap items-end gap-2 pl-6">
            <div className="relative w-40"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
              <input aria-label="My full-year profit estimate" type="number" inputMode="decimal" min="0" step="0.01" value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} placeholder="0.00" className={inputCls} /></div>
            <button type="button" disabled={busy} onClick={() => choose('target')} className="rounded-lg border border-white/10 px-3 py-2 text-purple-300">Use my estimate</button>
          </div>}
        </div>;
      })}
    </fieldset>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    <p className="text-xs text-gray-500">Projections use your sales and deductible expenses by date; refunds to buyers only count in profit so far. They&apos;re estimates, not promises.</p>
  </div>;
}
