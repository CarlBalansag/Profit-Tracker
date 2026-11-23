import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { inputCls, isDay, isMiles, isMoney, shortDate, todayIn, usd } from '../../utils/taxLogs';

const card = 'rounded-xl border border-white/10 p-4';

function TripForm({ year, trip, onDone, onCancel }) {
  const [v, setV] = useState({
    date: trip?.date || todayIn(year), miles: trip?.miles || '', destination: trip?.destination || '',
    purpose: trip?.purpose || '', parking_tolls: trip?.parking_tolls || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, x) => setV((o) => ({ ...o, [k]: x }));
  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!isDay(v.date)) { setError('Enter the date of the trip.'); return; }
    if (!isMiles(v.miles) || !(Number(v.miles) > 0)) { setError('Enter the miles, like 12 or 12.5.'); return; }
    if (!v.destination.trim()) { setError('Enter where you went.'); return; }
    if (!v.purpose.trim()) { setError('Enter why you went, like "Ship orders".'); return; }
    if (String(v.parking_tolls).trim() && !isMoney(v.parking_tolls)) { setError('Enter parking and tolls in dollars and cents, or leave it blank.'); return; }
    setSaving(true); setError('');
    try {
      const res = await requireSuccessfulResponse(await apiFetch(trip ? `/api/schedule-c/mileage/${trip.id}` : '/api/schedule-c/mileage', {
        method: trip ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...v, miles: String(v.miles).trim(), parking_tolls: String(v.parking_tolls).trim() || null }),
      }));
      onDone(await res.json());
    } catch (err) { setError(err.message || 'Could not save. Try again.'); setSaving(false); }
  };
  const id = (k) => `trip-${trip?.id || 'new'}-${k}`;
  return <form onSubmit={save} noValidate aria-label={trip ? 'Edit trip' : 'Add a trip'} className="space-y-3 rounded-lg border border-white/10 p-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <div><label htmlFor={id('date')} className="block text-sm text-gray-300">Date</label>
        <input id={id('date')} type="date" value={v.date} disabled={saving} onChange={(e) => set('date', e.target.value)} className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('miles')} className="block text-sm text-gray-300">Business miles (round trip)</label>
        <input id={id('miles')} type="text" inputMode="decimal" value={v.miles} disabled={saving} onChange={(e) => set('miles', e.target.value)} placeholder="0" className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('where')} className="block text-sm text-gray-300">Where you went</label>
        <input id={id('where')} value={v.destination} maxLength={200} disabled={saving} onChange={(e) => set('destination', e.target.value)} placeholder="e.g. Post office, Target" className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('why')} className="block text-sm text-gray-300">Why (business purpose)</label>
        <input id={id('why')} value={v.purpose} maxLength={200} disabled={saving} onChange={(e) => set('purpose', e.target.value)} placeholder="e.g. Ship orders, buy stock" className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor={id('parking')} className="block text-sm text-gray-300">Parking and tolls (optional)</label>
        <div className="relative mt-1"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
          <input id={id('parking')} type="text" inputMode="decimal" value={v.parking_tolls} disabled={saving} onChange={(e) => set('parking_tolls', e.target.value)} placeholder="0.00" className={`${inputCls} pl-7`} /></div></div>
    </div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <button type="submit" disabled={saving} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : trip ? 'Save trip' : 'Add trip'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-300">Cancel</button>
    </div>
  </form>;
}

function TripRow({ trip, onEdit, onDeleted }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const remove = async () => {
    setBusy(true); setError('');
    try { onDeleted(await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/mileage/${trip.id}`, { method: 'DELETE' }))).json()); }
    catch (err) { setError(err.message || 'Could not delete. Try again.'); setBusy(false); }
  };
  return <li className="py-2 text-sm">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <span className="min-w-0 break-words text-gray-200">{shortDate(trip.date)} · {trip.destination}</span>
      <span className="tabular-nums text-gray-300">{Number(trip.miles).toLocaleString('en-US')} mi{trip.parking_tolls ? ` · ${usd(trip.parking_tolls)} parking/tolls` : ''}</span>
    </div>
    <p className="break-words text-xs text-gray-500">{trip.purpose}</p>
    <div className="mt-1 flex flex-wrap gap-3 text-xs">
      {!confirming ? <>
        <button type="button" onClick={onEdit} className="text-purple-300 underline">Edit</button>
        <button type="button" onClick={() => setConfirming(true)} className="text-gray-400 underline">Delete</button>
      </> : <>
        <span className="text-gray-400">Delete this trip?</span>
        <button type="button" disabled={busy} onClick={remove} className="text-red-300 underline">{busy ? 'Deleting…' : 'Yes, delete'}</button>
        <button type="button" disabled={busy} onClick={() => setConfirming(false)} className="text-gray-400 underline">Keep it</button>
      </>}
    </div>
    {error && <p role="alert" className="mt-1 text-red-400">{error}</p>}
  </li>;
}

// Schedule C Part IV: the vehicle's start date and the year's other miles.
function VehicleDetails({ year, vehicle, onSaved }) {
  const [v, setV] = useState({ vehicle_in_service: vehicle.inService || '', vehicle_commuting_miles: vehicle.commutingMiles ?? '', vehicle_other_miles: vehicle.otherMiles ?? '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const set = (k, x) => { setV((o) => ({ ...o, [k]: x })); setMessage(''); };
  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (v.vehicle_in_service && !isDay(v.vehicle_in_service)) { setError('Enter the date, or leave it blank.'); return; }
    for (const k of ['vehicle_commuting_miles', 'vehicle_other_miles']) if (String(v[k]).trim() && !isMiles(v[k])) { setError('Enter miles like 1200 or 1200.5, or leave it blank.'); return; }
    setSaving(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/years/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vehicle_in_service: v.vehicle_in_service || null, vehicle_commuting_miles: String(v.vehicle_commuting_miles).trim() || null, vehicle_other_miles: String(v.vehicle_other_miles).trim() || null }) }));
      setMessage('Saved.'); onSaved();
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setSaving(false); }
  };
  return <form onSubmit={save} noValidate aria-label="Vehicle details" className="space-y-3">
    <p className="text-sm text-gray-300">Schedule C also asks about the vehicle (Part IV). Business miles come from your trips: <span className="tabular-nums">{Number(vehicle.businessMiles).toLocaleString('en-US')}</span> in {year}.</p>
    <div className="grid gap-3 sm:grid-cols-3">
      <div><label htmlFor="veh-start" className="block text-sm text-gray-300">First used for the business</label>
        <input id="veh-start" type="date" value={v.vehicle_in_service} disabled={saving} onChange={(e) => set('vehicle_in_service', e.target.value)} className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor="veh-commute" className="block text-sm text-gray-300">Commuting miles in {year}</label>
        <input id="veh-commute" type="text" inputMode="decimal" value={v.vehicle_commuting_miles} disabled={saving} onChange={(e) => set('vehicle_commuting_miles', e.target.value)} placeholder="0" className={`mt-1 ${inputCls}`} /></div>
      <div><label htmlFor="veh-other" className="block text-sm text-gray-300">Other personal miles in {year}</label>
        <input id="veh-other" type="text" inputMode="decimal" value={v.vehicle_other_miles} disabled={saving} onChange={(e) => set('vehicle_other_miles', e.target.value)} placeholder="0" className={`mt-1 ${inputCls}`} /></div>
    </div>
    {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    <div className="flex items-center gap-3"><button type="submit" disabled={saving} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-200">{saving ? 'Saving…' : 'Save vehicle details'}</button>{message && <span role="status" className="text-sm text-gray-400">{message}</span>}</div>
  </form>;
}

/** The mileage log for line 9: trips at the IRS standard rate, plus parking and tolls. */
export function MileageLog({ year, mileage, vehicle, onSaved }) {
  const [trips, setTrips] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null); // 'new' or a trip id
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const data = await (await requireSuccessfulResponse(await apiFetch(`/api/schedule-c/mileage?year=${year}`))).json();
        if (active) setTrips(data.trips);
      } catch (err) { if (active) setLoadError(err.message || 'Could not load your trips.'); }
    })();
    return () => { active = false; };
  }, [year, attempt]);
  const changed = (data) => { setTrips(data.year === year ? data.trips : trips); setEditing(null); onSaved(); };

  return <details className={card}>
    <summary className="cursor-pointer text-sm font-medium text-purple-300">Driving for the business (line 9): {usd(mileage.total)}</summary>
    <div className="mt-3 space-y-4 text-sm">
      <p className="text-gray-400">Log trips to stores, the post office or buyers as you go. Each one counts at the IRS standard mileage rate for its date, which covers gas, wear and insurance, so don&apos;t also deduct gas. Commuting doesn&apos;t count.</p>
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <div className="min-w-0"><p className="text-xs text-gray-500">Trips</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{mileage.trips}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-500">Business miles</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{Number(mileage.miles).toLocaleString('en-US')}</p></div>
        <div className="min-w-0"><p className="text-xs text-gray-500">Deduction</p><p className="mt-1 break-words text-base tabular-nums sm:text-lg">{usd(mileage.total)}</p></div>
      </div>
      {mileage.byRate.length > 0 && <p className="text-xs text-gray-500">{mileage.byRate.map((r) => `${Number(r.miles).toLocaleString('en-US')} mi at ${r.cents}¢ = ${usd(r.amount)}`).join(' · ')}{Number(mileage.parkingTolls) ? ` · parking and tolls ${usd(mileage.parkingTolls)}` : ''}</p>}
      {mileage.rateMissing && <p className="text-amber-300">The IRS rate for {year} isn&apos;t in ProfitTracker yet, so trips in {year} count $0 for now. Parking and tolls still count.</p>}

      {editing === 'new' ? <TripForm year={year} onDone={changed} onCancel={() => setEditing(null)} />
        : <button type="button" onClick={() => setEditing('new')} className="page-btn page-btn-primary">Add a trip</button>}

      {loadError ? <div><p role="alert" className="text-red-400">{loadError}</p><button type="button" onClick={() => { setLoadError(''); setAttempt((n) => n + 1); }} className="mt-1 underline">Try again</button></div>
        : trips === null ? <p role="status" className="text-gray-400">Loading trips…</p>
          : trips.length === 0 ? <p className="text-gray-400">No trips logged for {year} yet.</p>
            : <ul className="divide-y divide-white/5">{trips.map((t) => (editing === t.id
              ? <li key={t.id} className="py-2"><TripForm year={year} trip={t} onDone={changed} onCancel={() => setEditing(null)} /></li>
              : <TripRow key={t.id} trip={t} onEdit={() => setEditing(t.id)} onDeleted={changed} />))}</ul>}

      <div className="border-t border-white/5 pt-3"><VehicleDetails key={`${vehicle.inService}-${vehicle.commutingMiles}-${vehicle.otherMiles}`} year={year} vehicle={vehicle} onSaved={onSaved} /></div>
      <p className="text-xs text-gray-500">Keep the log as you go: the IRS expects the date, where, why and the miles for each trip. Using the standard rate means you can&apos;t also deduct actual car costs like gas, repairs or insurance. <a href="https://www.irs.gov/tax-professionals/standard-mileage-rates" target="_blank" rel="noreferrer" className="underline">IRS mileage rates</a></p>
    </div>
  </details>;
}
