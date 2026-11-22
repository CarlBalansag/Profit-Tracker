import React, { useMemo, useRef, useState } from 'react';
import { Download, FileUp, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { useCashoutConnections, useCashoutImport, usePaymentMethods, usePlatforms } from '../../hooks/useApi';
import { useMatchMedia } from '../../hooks/useMatchMedia';

// Settings > Data > Import from cashouts. Brings items already sold to a
// cashout into Profit Tracker as purchases + sales: preview first (nothing is
// saved), then import the rows that are new. The server does the parsing and
// matching (profit-tracker-api/services/cashouts/importSold.js).
const SOURCES = [
  {
    id: 'eb',
    label: 'EB',
    name: 'ElectronicsBuyer',
    match: /electronics ?buyer|\beb\b/i,
    howTo: 'On ElectronicsBuyer, open Balance Summary > Items Sold, pick a date range and export the CSV.',
  },
  {
    id: 'la',
    label: 'LA',
    name: 'EarnFromBuying (LA)',
    match: /earn ?from ?buying|\bla\b/i,
    howTo: 'On EarnFromBuying, open Receiving analytics and export the received items CSV.',
  },
  {
    id: 'p4d',
    label: 'P4D',
    name: 'Points4Days',
    match: /points ?4 ?days|\bp4d\b/i,
    howTo: 'On Points4Days, open Receiving analytics and export the received items CSV.',
  },
];

const MATCH_LABELS = {
  new: { text: 'New', tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  partial: { text: 'Partly new', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  existing: { text: 'Already in Profit Tracker', tone: 'text-gray-400 border-gray-700 bg-white/5' },
  imported: { text: 'Imported before', tone: 'text-gray-400 border-gray-700 bg-white/5' },
};

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isNew = (g) => g.newQty > 0;
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const readText = (file) => (typeof file.text === 'function'
  ? file.text()
  : new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.readAsText(file);
  }));

const inputClass = 'w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 h-9 text-sm text-gray-200 focus:outline-none focus:border-[var(--accent)]';
const labelClass = 'block text-xs text-gray-400 mb-1';

export function CashoutImport() {
  const { data: connections = [] } = useCashoutConnections();
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { preview, commit } = useCashoutImport();
  const isPhone = useMatchMedia('(max-width: 767px)');
  const fileRef = useRef(null);

  const today = new Date();
  const monthAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30);
  const [source, setSource] = useState('eb');
  const [mode, setMode] = useState('file');
  const [range, setRange] = useState({ from: dayIso(monthAgo), to: dayIso(today) });
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState({});
  const [costs, setCosts] = useState({});
  const [platformId, setPlatformId] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const sourceInfo = SOURCES.find((s) => s.id === source);
  const connection = connections.find((c) => c.provider === source) || null;
  // Only the parsefile cashouts can be pulled with the saved login.
  const canPull = Boolean(connection) && source !== 'eb';
  const cashouts = platforms.filter((p) => p.type === 'Cashout');
  const vendors = platforms.filter((p) => p.type === 'Vendor');

  const reset = () => {
    setResult(null);
    setSelected({});
    setCosts({});
    setError(null);
    preview.reset();
  };

  const pickSource = (id) => {
    setSource(id);
    setMode(id !== 'eb' && connections.some((c) => c.provider === id) ? 'pull' : 'file');
    setDone(null);
    reset();
  };

  const showPreview = (data) => {
    setResult(data);
    setSelected(Object.fromEntries(data.groups.map((g) => [g.key, isNew(g)])));
    setCosts({});
    setError(null);
    // The cashout these sales go to: the connection's own group, else one named like it.
    const linked = connection?.platformId;
    const guess = cashouts.find((p) => p.id === linked) || cashouts.find((p) => sourceInfo.match.test(p.name));
    setPlatformId((current) => current && cashouts.some((p) => p.id === current) ? current : (guess?.id || (cashouts.length === 1 ? cashouts[0].id : '')));
  };

  const readFile = async (file) => {
    setDone(null);
    reset();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is too big. Export a shorter date range and try again.');
      return;
    }
    try {
      const csv = await readText(file);
      showPreview(await preview.mutateAsync({ source, csv }));
    } catch (err) {
      setError(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const pull = async () => {
    setDone(null);
    reset();
    try {
      showPreview(await preview.mutateAsync({ connectionId: connection.id, ...range }));
    } catch (err) {
      setError(err.message);
    }
  };

  // Typing a cost fills the same item on other rows that don't have one yet.
  const setCost = (group, value) => {
    setCosts((current) => {
      const next = { ...current, [group.key]: value };
      for (const other of result.groups) {
        if (other.key !== group.key && other.name === group.name && !current[other.key]) next[other.key] = value;
      }
      return next;
    });
  };

  const chosen = useMemo(
    () => (result ? result.groups.filter((g) => isNew(g) && selected[g.key]) : []),
    [result, selected],
  );
  const chosenUnits = chosen.reduce((n, g) => n + g.newQty, 0);
  const missingCost = chosen.filter((g) => !String(costs[g.key] ?? '').trim()).length;

  const runImport = async () => {
    setError(null);
    if (!platformId) {
      setError('Pick which cashout these sales go to.');
      return;
    }
    try {
      const res = await commit.mutateAsync({
        source,
        platform_id: platformId,
        vendor_id: vendorId || null,
        payment_method_id: paymentMethodId || null,
        groups: chosen.map((g) => ({ ...g, qty: g.newQty, unitCost: String(costs[g.key] ?? '').trim() || null })),
      });
      setDone(res);
      toast.success(`Imported ${res.created} purchase${res.created === 1 ? '' : 's'} (${res.units} unit${res.units === 1 ? '' : 's'}).`);
      reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const busy = preview.isPending || commit.isPending;

  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold text-white mb-2">Import from cashouts</h2>
        <p className="text-xs text-gray-500">
          Bring in items you've already sold to a cashout. Each one becomes a purchase and a sale. Items already in Profit Tracker are skipped, and nothing is saved until you confirm.
        </p>
      </div>

      <div role="radiogroup" aria-label="Cashout" className="flex flex-wrap gap-2">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={source === s.id}
            onClick={() => pickSource(s.id)}
            disabled={busy}
            className={`px-3 h-9 rounded-lg border text-sm font-medium transition-colors ${
              source === s.id
                ? 'border-transparent bg-[var(--accent-bg)] text-[var(--dp-accent-text,var(--accent))]'
                : 'border-gray-800 text-gray-400 hover:text-white hover:bg-white/5'
            }`}
          >
            {s.label}
            <span className="sr-only"> ({s.name})</span>
          </button>
        ))}
      </div>

      {canPull && (
        <div role="radiogroup" aria-label="How to import" className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-300">
          {[['pull', 'Pull with saved login'], ['file', 'Upload CSV']].map(([id, label]) => (
            <label key={id} className="inline-flex items-center gap-2 min-h-9 cursor-pointer">
              <input type="radio" name="cashout-import-mode" checked={mode === id} onChange={() => { setMode(id); reset(); }} disabled={busy} />
              {label}
            </label>
          ))}
        </div>
      )}

      {mode === 'pull' && canPull ? (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label htmlFor="cashout-import-from" className={labelClass}>From</label>
            <input id="cashout-import-from" type="date" className={inputClass} value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="min-w-[9rem] flex-1 sm:flex-none">
            <label htmlFor="cashout-import-to" className={labelClass}>To</label>
            <input id="cashout-import-to" type="date" className={inputClass} value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
          <button type="button" onClick={pull} disabled={busy || !range.from || !range.to} className="page-btn inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50 w-full sm:w-auto">
            <RefreshCw size={14} className={preview.isPending ? 'animate-spin' : ''} /> {preview.isPending ? 'Reading…' : `Read from ${sourceInfo.label}`}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">{sourceInfo.howTo}</p>
          <input ref={fileRef} id="cashout-import-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} disabled={busy} />
          <label htmlFor="cashout-import-file" className={`page-btn inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg border border-gray-700 text-sm text-gray-200 hover:bg-white/5 cursor-pointer w-full sm:w-auto ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
            <FileUp size={14} /> {preview.isPending ? 'Reading…' : `Choose ${sourceInfo.label} CSV`}
          </label>
        </div>
      )}

      {error && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {done && (
        <p role="status" className="text-sm text-emerald-400">
          Imported {done.created} purchase{done.created === 1 ? '' : 's'} ({done.units} unit{done.units === 1 ? '' : 's'}).
          {done.costNeeded > 0 && <span className="text-amber-300"> {done.costNeeded} {done.costNeeded === 1 ? 'has' : 'have'} no cost yet: their notes say "Cost needed".</span>}
          {done.skipped > 0 && <span className="text-gray-400"> {done.skipped} skipped because they were already imported.</span>}
        </p>
      )}

      {result && (
        <ImportPreview
          result={result}
          isPhone={isPhone}
          selected={selected}
          setSelected={setSelected}
          costs={costs}
          setCost={setCost}
          cashouts={cashouts}
          vendors={vendors}
          paymentMethods={paymentMethods}
          platformId={platformId}
          setPlatformId={setPlatformId}
          vendorId={vendorId}
          setVendorId={setVendorId}
          paymentMethodId={paymentMethodId}
          setPaymentMethodId={setPaymentMethodId}
          chosen={chosen}
          chosenUnits={chosenUnits}
          missingCost={missingCost}
          busy={busy}
          committing={commit.isPending}
          onImport={runImport}
          onCancel={reset}
        />
      )}
    </div>
  );
}

function ImportPreview({
  result, isPhone, selected, setSelected, costs, setCost,
  cashouts, vendors, paymentMethods, platformId, setPlatformId, vendorId, setVendorId, paymentMethodId, setPaymentMethodId,
  chosen, chosenUnits, missingCost, busy, committing, onImport, onCancel,
}) {
  const { summary, groups, problems } = result;
  const skipped = summary.imported + summary.existing;
  const toggle = (key) => setSelected((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="space-y-4 border-t border-gray-800 pt-4">
      <p className="text-sm text-gray-300">
        {summary.rows} row{summary.rows === 1 ? '' : 's'} from {result.sourceName}:{' '}
        <span className="text-white font-medium">{summary.new} new</span>
        {skipped > 0 && <>, {skipped} already in Profit Tracker</>}
        {summary.problems > 0 && <>, <span className="text-amber-300">{summary.problems} can't be imported</span></>}.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-500">No sold items in this report.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="cashout-import-platform" className={labelClass}>Sales go to</label>
              <select id="cashout-import-platform" className={inputClass} value={platformId} onChange={(e) => setPlatformId(e.target.value)}>
                <option value="">Pick a cashout…</option>
                {cashouts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {cashouts.length === 0 && <p className="text-xs text-amber-300 mt-1">Add this cashout under Data Setup &gt; Cashouts first.</p>}
            </div>
            <div>
              <label htmlFor="cashout-import-vendor" className={labelClass}>Bought from (optional)</label>
              <select id="cashout-import-vendor" className={inputClass} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">Not set</option>
                {vendors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cashout-import-card" className={labelClass}>Paid with (optional)</label>
              <select id="cashout-import-card" className={inputClass} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">Not set</option>
                {paymentMethods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <p className="text-xs text-gray-500">
            Cashout reports don't include what you paid. Enter a cost per unit where you know it; typing one fills the same item on other rows. Rows left blank are saved at $0 with a "Cost needed" note.
          </p>

          {isPhone ? (
            <ul className="space-y-2" aria-label="Purchases to import">
              {groups.map((g) => <GroupCard key={g.key} group={g} checked={Boolean(selected[g.key])} onToggle={() => toggle(g.key)} cost={costs[g.key] ?? ''} onCost={(v) => setCost(g, v)} />)}
            </ul>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 bg-[#16161E]">
                  <tr>
                    <th className="px-3 py-2 w-10"><span className="sr-only">Import</span></th>
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Item</th>
                    <th className="px-3 py-2 text-right font-medium">Qty</th>
                    <th className="px-3 py-2 text-right font-medium">Payout / unit</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                    <th className="px-3 py-2 text-left font-medium w-32">Cost / unit</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const importable = isNew(g);
                    return (
                      <tr key={g.key} className={`border-t border-gray-800 ${importable ? '' : 'text-gray-500'}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" aria-label={`Import ${g.name}`} checked={importable && Boolean(selected[g.key])} disabled={!importable} onChange={() => toggle(g.key)} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{g.date}</td>
                        <td className="px-3 py-2 min-w-[12rem]">
                          <div className="line-clamp-2 text-gray-200">{g.name}</div>
                          {g.tracking.length > 0 && <div className="text-xs text-gray-500 truncate max-w-[18rem]">{g.tracking.join(', ')}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{importable && g.newQty !== g.qty ? `${g.newQty} of ${g.qty}` : g.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(g.unitPrice)}</td>
                        <td className="px-3 py-2"><StatusPills group={g} /></td>
                        <td className="px-3 py-2">
                          {importable && (
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label={`Cost per unit for ${g.name}`}
                              placeholder="$0.00"
                              value={costs[g.key] ?? ''}
                              onChange={(e) => setCost(g, e.target.value)}
                              className={`${inputClass} h-8`}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {problems.length > 0 && (
        <details className="text-xs text-gray-400">
          <summary className="cursor-pointer min-h-9 flex items-center">Rows that can't be imported ({problems.length})</summary>
          <ul className="mt-2 space-y-1">
            {problems.slice(0, 200).map((p) => (
              <li key={p.ref}>{p.date || 'No date'} · {p.name || 'No name'}: <span className="text-amber-300">{p.problem}</span></li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={committing} className="page-btn px-4 h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={onImport}
          disabled={busy || chosen.length === 0}
          className="page-btn inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50"
        >
          <Download size={14} />
          {committing ? 'Importing…' : chosen.length === 0 ? 'Nothing new to import' : `Import ${chosen.length} purchase${chosen.length === 1 ? '' : 's'} (${chosenUnits} unit${chosenUnits === 1 ? '' : 's'})`}
        </button>
      </div>
      {chosen.length > 0 && missingCost > 0 && (
        <p className="text-xs text-amber-300 sm:text-right">{missingCost} without a cost will be saved at $0 and marked "Cost needed".</p>
      )}
    </div>
  );
}

function StatusPills({ group }) {
  const match = MATCH_LABELS[group.match] || MATCH_LABELS.new;
  return (
    <div className="flex flex-wrap gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs whitespace-nowrap ${match.tone}`}>{match.text}</span>
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-gray-700 text-xs text-gray-400 whitespace-nowrap">{group.paid ? 'Paid' : 'Not paid yet'}</span>
    </div>
  );
}

function GroupCard({ group: g, checked, onToggle, cost, onCost }) {
  const importable = isNew(g);
  const id = `cashout-import-${g.key.replace(/[^a-z0-9]/gi, '').slice(-24)}-${g.refs[0]?.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  return (
    <li className={`rounded-lg border border-gray-800 bg-[#16161E] p-3 space-y-2 ${importable ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-1" checked={importable && checked} disabled={!importable} onChange={onToggle} />
        <label htmlFor={id} className="flex-1 min-w-0">
          <span className="block text-sm text-gray-200 line-clamp-2">{g.name}</span>
          <span className="block text-xs text-gray-500">
            {g.date} · {importable && g.newQty !== g.qty ? `${g.newQty} of ${g.qty}` : g.qty} × {money(g.unitPrice)}
          </span>
        </label>
      </div>
      <StatusPills group={g} />
      {importable && (
        <div>
          <label htmlFor={`${id}-cost`} className={labelClass}>Cost per unit</label>
          <input id={`${id}-cost`} type="text" inputMode="decimal" placeholder="$0.00" value={cost} onChange={(e) => onCost(e.target.value)} className={inputClass} />
        </div>
      )}
    </li>
  );
}

export default CashoutImport;
