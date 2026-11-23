import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';

const usd = (value) => `$${(Number(value) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] py-2 pl-7 pr-3 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';

// Stock the person owns but hasn't entered as purchases. One amount is stored
// per December 31; January 1 of this year is last year's December 31, so the
// first field saves to the previous tax year.
export function UntrackedStock({ year, untracked, onSaved }) {
  const initial = { start: untracked.startEntered ?? '', end: untracked.endEntered ?? '' };
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const prevYear = year - 1;
  const canEditStart = prevYear >= 1900;
  const changed = ['start', 'end'].filter((key) => String(values[key]).trim() !== String(initial[key]));
  const hasAmounts = Number(untracked.start) > 0 || Number(untracked.end) > 0;

  const save = async (e) => {
    e.preventDefault();
    if (!changed.length || saving) return;
    if (changed.some((key) => { const v = String(values[key]).trim(); return v !== '' && !/^\d+(\.\d{1,2})?$/.test(v); })) {
      setError('Enter an amount in dollars and cents, like 250.00, or leave it blank.');
      return;
    }
    setSaving(true); setError('');
    try {
      for (const key of changed) {
        const target = key === 'start' ? prevYear : year;
        await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/years/${target}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ untracked_inventory_end: String(values[key]).trim() }),
        }));
      }
      onSaved();
    } catch (err) {
      setError(err.message || 'Could not save. Try again.');
    } finally { setSaving(false); }
  };

  const field = (key, label, hint, disabled = false) => (
    <div>
      <label htmlFor={`untracked-${key}`} className="block text-sm text-gray-300">{label}</label>
      <div className="relative mt-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
        <input id={`untracked-${key}`} type="number" inputMode="decimal" min="0" step="0.01" disabled={disabled || saving}
          value={values[key]} placeholder={key === 'end' && initial.end === '' ? Number(untracked.start).toFixed(2) : '0.00'}
          onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} className={inputCls} aria-describedby={`untracked-${key}-hint`} />
      </div>
      <p id={`untracked-${key}-hint`} className="mt-1 text-xs text-gray-500">{hint}</p>
    </div>
  );

  return <details className="rounded-xl border border-white/10 p-4" open={hasAmounts || undefined}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Stock not in ProfitTracker{hasAmounts ? ` (${usd(untracked.start)} on January 1)` : ''}</summary>
    <form onSubmit={save} noValidate className="mt-3 space-y-4">
      <p className="text-sm text-gray-400">Inventory you own that isn&apos;t entered as purchases, such as stock you bought before you started using ProfitTracker. Enter what it cost you, not what it would sell for. If you later enter a purchase for some of it (to record selling it, for example), lower these amounts by that cost so it isn&apos;t counted twice.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {field('start', `On hand January 1, ${year}`,
          canEditStart
            ? `Same as December 31, ${prevYear}. Line 35 is ${usd(untracked.trackedBeginning)} from your purchases plus this, and should match line 41 on your ${prevYear} return.`
            : 'Not available for this year.',
          !canEditStart)}
        {field('end', `Still on hand December 31, ${year}`,
          initial.end === ''
            ? `Left blank, the January 1 amount (${usd(untracked.start)}) is treated as still on hand. Enter 0 if you sold or used all of it.`
            : 'Carries into next year as its January 1 amount.')}
      </div>
      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={!changed.length || saving} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save amounts'}</button>
        {changed.length > 0 && !saving && <button type="button" onClick={() => { setValues(initial); setError(''); }} className="text-sm text-gray-400 underline">Undo changes</button>}
      </div>
    </form>
  </details>;
}
