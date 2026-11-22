import { useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { inputCls, usd } from '../../utils/taxLogs';

const card = 'rounded-xl border border-white/10 p-4';
const whole = (v) => /^\d+$/.test(String(v).trim());

/** The simplified home office method for line 30: $5 a square foot, up to 300. */
export function HomeOffice({ year, homeOffice, onSaved }) {
  const [v, setV] = useState({
    home_office_sq_ft: homeOffice.claimed ? String(homeOffice.squareFeet) : '',
    home_office_months: homeOffice.claimed ? String(homeOffice.months) : '12',
    home_total_sq_ft: homeOffice.homeSquareFeet ? String(homeOffice.homeSquareFeet) : '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => { setV((o) => ({ ...o, [k]: x })); setMessage(''); };
  const [message, setMessage] = useState('');
  const send = async (body, done) => {
    setSaving(true); setError(''); setMessage('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/years/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
      done?.();
      onSaved();
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setSaving(false); }
  };
  const save = (e) => {
    e.preventDefault();
    if (saving) return;
    const office = String(v.home_office_sq_ft).trim();
    const home = String(v.home_total_sq_ft).trim();
    if (!whole(office) || Number(office) < 1) { setError('Enter the square feet of the space as a whole number.'); return; }
    if (!whole(v.home_office_months) || Number(v.home_office_months) < 1 || Number(v.home_office_months) > 12) { setError('Enter the months you used it, from 1 to 12.'); return; }
    if (home && (!whole(home) || Number(home) < 1)) { setError('Enter the home\'s square feet as a whole number, or leave it blank.'); return; }
    if (home && Number(office) > Number(home)) { setError('The space can\'t be bigger than the whole home.'); return; }
    send({ home_office_sq_ft: Number(office), home_office_months: Number(v.home_office_months), home_total_sq_ft: home ? Number(home) : null }, () => setMessage('Saved.'));
  };
  const preview = whole(v.home_office_sq_ft) && whole(v.home_office_months)
    ? 5 * Math.min(300, Number(v.home_office_sq_ft)) * Math.min(12, Number(v.home_office_months)) / 12 : null;

  return <details className={card}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Home office (line 30): {usd(homeOffice.total)}</summary>
    <form onSubmit={save} noValidate aria-label="Home office" className="mt-3 space-y-3 text-sm">
      <p className="text-gray-400">If part of your home is used regularly and only for the business, the simplified method gives $5 a square foot, up to 300 square feet ($1,500 for a full year). Space used regularly to store inventory counts even if it isn&apos;t used only for the business, when your home is the business&apos;s only fixed location.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div><label htmlFor="ho-sqft" className="block text-gray-300">Square feet used for the business</label>
          <input id="ho-sqft" type="text" inputMode="numeric" value={v.home_office_sq_ft} disabled={saving} onChange={(e) => set('home_office_sq_ft', e.target.value)} placeholder="e.g. 120" className={`mt-1 ${inputCls}`} /></div>
        <div><label htmlFor="ho-months" className="block text-gray-300">Months used in {year}</label>
          <input id="ho-months" type="text" inputMode="numeric" value={v.home_office_months} disabled={saving} onChange={(e) => set('home_office_months', e.target.value)} className={`mt-1 ${inputCls}`} /></div>
        <div><label htmlFor="ho-home" className="block text-gray-300">Whole home, square feet (optional)</label>
          <input id="ho-home" type="text" inputMode="numeric" value={v.home_total_sq_ft} disabled={saving} onChange={(e) => set('home_total_sq_ft', e.target.value)} placeholder="Asked on line 30" className={`mt-1 ${inputCls}`} /></div>
      </div>
      {preview !== null && Number(v.home_office_sq_ft) > 0 && <p className="text-gray-300">That&apos;s {usd(preview)} before the limit{Number(v.home_office_sq_ft) > 300 ? ' (only 300 square feet count)' : ''}. A month counts if you used the space at least 15 days of it.</p>}
      {homeOffice.limited && <p className="text-amber-300">Only {usd(homeOffice.total)} of {usd(homeOffice.beforeLimit)} counts: it can&apos;t be more than your profit before it, and with the simplified method the rest doesn&apos;t carry forward.</p>}
      {error && <p role="alert" className="text-red-400">{error}</p>}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save home office'}</button>
        {message && <span role="status" className="self-center text-gray-400">{message}</span>}
        {homeOffice.claimed && <button type="button" disabled={saving} onClick={() => send({ home_office_sq_ft: null, home_office_months: null }, () => { setV((o) => ({ ...o, home_office_sq_ft: '', home_office_months: '12' })); setMessage('Removed.'); })} className="rounded-lg border border-white/10 px-4 py-2 text-gray-300">Remove it</button>}
      </div>
      <p className="text-xs text-gray-500">Keep a note of the measurements and photos of the space. The regular method (Form 8829, actual home costs) isn&apos;t calculated here. <a href="https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction" target="_blank" rel="noreferrer" className="underline">IRS simplified method</a></p>
    </form>
  </details>;
}
