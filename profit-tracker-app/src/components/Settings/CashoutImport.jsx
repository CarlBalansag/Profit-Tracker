import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, FileUp, RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { useCashoutConnections, useCashoutImport, useCashoutProviders, usePaymentMethods, usePlatforms, useStoreOrderCosts } from '../../hooks/useApi';
import { useMatchMedia } from '../../hooks/useMatchMedia';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { AMAZON_HOW_TO, readOrderFile } from '../../utils/orderCsv';
import { OrderPicker } from './StoreOrderPicker';
import { StoreOrderImport } from './StoreOrderImport';

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
  const { data: providers = [] } = useCashoutProviders();
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { preview, commit } = useCashoutImport();
  const { match: matchOrders } = useStoreOrderCosts();
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
  // LA/P4D pay by payment request, not per item, so their reports never say
  // an item was paid. Items received on or before this date count as paid.
  const [paidThrough, setPaidThrough] = useState('');
  const isPaid = (g) => g.paid || Boolean(paidThrough && g.date <= paidThrough);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  // Store orders added in the review: the server's matches and, per group key,
  // the order line in use (null = none). A matched line fills that row's cost
  // and, on import, its tax, shipping, order number, date, store and card.
  const [orders, setOrders] = useState(null);
  const [orderPick, setOrderPick] = useState({});

  const sourceInfo = SOURCES.find((s) => s.id === source);
  const connection = connections.find((c) => c.provider === source) || null;
  // Pulling with the saved login works only where the server says it can.
  const pullable = (id) => connections.some((c) => c.provider === id)
    && providers.some((p) => p.id === id && p.supportsImportPull);
  const canPull = pullable(source);
  const cashouts = platforms.filter((p) => p.type === 'Cashout');
  const vendors = platforms.filter((p) => p.type === 'Vendor');

  const reset = () => {
    setResult(null);
    setSelected({});
    setCosts({});
    setError(null);
    setOrders(null);
    setOrderPick({});
    preview.reset();
  };

  const amazonVendorId = vendors.find((v) => /amazon/i.test(v.name))?.id || null;
  const orderLines = useMemo(() => new Map((orders?.lines || []).map((l) => [l.index, l])), [orders]);
  const cardNames = useMemo(() => new Map(paymentMethods.map((p) => [p.id, p.name])), [paymentMethods]);

  const addOrders = async (file) => {
    if (!file || !result) return;
    setError(null);
    try {
      const csv = await readOrderFile(file);
      const groups = result.groups.filter(isNew).map((g) => ({ key: g.key, name: g.name, date: g.date, qty: g.newQty, tracking: g.tracking }));
      const res = await matchOrders.mutateAsync({ source: 'amazon', csv, groups });
      const lines = new Map(res.lines.map((l) => [l.index, l]));
      setOrders(res);
      setOrderPick(Object.fromEntries(res.matches.map((m) => [m.key, m.lineIndex])));
      // Matched rows take the order's cost unless one was typed already.
      setCosts((current) => {
        const next = { ...current };
        for (const m of res.matches) {
          if (m.lineIndex !== null && !String(current[m.key] ?? '').trim()) next[m.key] = String(lines.get(m.lineIndex).perUnit.cost);
        }
        return next;
      });
    } catch (err) {
      setError(err.message);
    }
  };

  const removeOrders = () => {
    // Costs that came from an order go too; typed ones stay.
    setCosts((current) => {
      const next = { ...current };
      for (const [key, index] of Object.entries(orderPick)) {
        if (index !== null && next[key] === String(orderLines.get(index)?.perUnit.cost)) delete next[key];
      }
      return next;
    });
    setOrders(null);
    setOrderPick({});
  };

  const pickOrder = (key, index) => {
    setOrderPick((current) => ({ ...current, [key]: index }));
    const line = index === null ? null : orderLines.get(index);
    setCosts((current) => ({ ...current, [key]: line ? String(line.perUnit.cost) : '' }));
  };

  // What the import sends for a row's matched order.
  const orderFields = (g) => {
    const line = orderPick[g.key] !== null && orderPick[g.key] !== undefined ? orderLines.get(orderPick[g.key]) : null;
    if (!line) return {};
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      salesTax: r2(line.perUnit.tax * g.newQty),
      shipping: r2(line.perUnit.shipping * g.newQty),
      orderNumber: line.orderId,
      orderDate: line.orderDate,
      orderStore: orders.sourceName,
      vendorId: amazonVendorId,
      paymentMethodId: line.paymentMethodId,
    };
  };

  const pickSource = (id) => {
    setSource(id);
    setMode(pullable(id) ? 'pull' : 'file');
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
        groups: chosen.map((g) => ({ ...g, qty: g.newQty, paid: isPaid(g), unitCost: String(costs[g.key] ?? '').trim() || null, ...orderFields(g) })),
      });
      setDone(res);
      toast.success(`Imported ${res.created} purchase${res.created === 1 ? '' : 's'} (${res.units} unit${res.units === 1 ? '' : 's'}).`);
      reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const busy = preview.isPending || commit.isPending || matchOrders.isPending;

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

      {error && !result && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {done && (
        <p role="status" className="text-sm text-emerald-400">
          Imported {done.created} purchase{done.created === 1 ? '' : 's'} ({done.units} unit{done.units === 1 ? '' : 's'}).
          {done.costNeeded > 0 && <span className="text-amber-300"> {done.costNeeded} {done.costNeeded === 1 ? 'has' : 'have'} no cost yet: their notes say "Cost needed".</span>}
          {done.skipped > 0 && <span className="text-gray-400"> {done.skipped} skipped because they were already imported.</span>}
        </p>
      )}

      {result && (
        <ImportReview
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
          paidThrough={paidThrough}
          setPaidThrough={setPaidThrough}
          isPaid={isPaid}
          chosen={chosen}
          chosenUnits={chosenUnits}
          missingCost={missingCost}
          busy={busy}
          committing={commit.isPending}
          error={error}
          onImport={runImport}
          onCancel={reset}
          orders={orders}
          orderPick={orderPick}
          orderLines={orderLines}
          cardNames={cardNames}
          matching={matchOrders.isPending}
          onAddOrders={addOrders}
          onRemoveOrders={removeOrders}
          onPickOrder={pickOrder}
        />
      )}

      <details className="rounded-lg border border-gray-800 group">
        <summary className="cursor-pointer min-h-11 flex items-center px-3 text-sm font-semibold text-white">
          Fill in missing costs from Amazon orders
        </summary>
        <div className="border-t border-gray-800 p-3 sm:p-4">
          <StoreOrderImport embedded />
        </div>
      </details>
    </div>
  );
}

// Opens once a report is read: everything the import would add, what it
// skips and why, and what it can't import. Nothing is saved until Import.
function ImportReview({
  result, isPhone, selected, setSelected, costs, setCost,
  cashouts, vendors, paymentMethods, platformId, setPlatformId, vendorId, setVendorId, paymentMethodId, setPaymentMethodId,
  paidThrough, setPaidThrough, isPaid,
  chosen, chosenUnits, missingCost, busy, committing, error, onImport, onCancel,
  orders, orderPick, orderLines, cardNames, matching, onAddOrders, onRemoveOrders, onPickOrder,
}) {
  const ordersFileRef = useRef(null);
  const orderMatch = useMemo(() => new Map((orders?.matches || []).map((m) => [m.key, m])), [orders]);
  const pickerFor = (g, id) => (orders && orderMatch.get(g.key) ? (
    <OrderPicker
      id={id}
      name={g.name}
      qty={g.newQty}
      match={orderMatch.get(g.key)}
      picked={orderPick[g.key] ?? null}
      lines={orderLines}
      cardName={cardNames}
      onPick={(index) => onPickOrder(g.key, index)}
      disabled={!selected[g.key]}
    />
  ) : null);
  const close = () => { if (!committing) onCancel(); };
  const modalRef = useModalKeyboard(true, close);
  const { summary, groups, problems } = result;
  const adding = groups.filter(isNew);
  const skipped = groups.filter((g) => g.newQty < g.qty);
  const toggle = (key) => setSelected((s) => ({ ...s, [key]: !s[key] }));
  const payout = chosen.reduce((n, g) => n + g.newQty * g.unitPrice - (g.fee || 0), 0);
  const paidCount = chosen.filter(isPaid).length;
  const cashoutName = cashouts.find((p) => p.id === platformId)?.name;
  const vendorName = vendors.find((p) => p.id === vendorId)?.name;
  const cardName = paymentMethods.find((p) => p.id === paymentMethodId)?.name;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  // Portaled so the page's own layers (sidebar, bottom bar) can't sit on top of it.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={close} />
      <div ref={modalRef} className="relative flex w-full sm:w-[min(1000px,94vw)] max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Review import</h2>
            <p className="mt-0.5 text-xs text-gray-500">{result.sourceName} · {plural(summary.rows, 'row')} read. Nothing is saved until you press Import.</p>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={committing} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6 theme-scrollbar">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2" aria-label="Import summary">
            <SummaryTile label="Will be added" value={plural(chosen.length, 'purchase')} note={`${plural(chosenUnits, 'unit')}, each with its sale`} tone="text-emerald-400" />
            <SummaryTile label="Payout" value={money(payout)} note={paidCount ? `${paidCount} marked paid` : 'All waiting for payment'} />
            <SummaryTile label="Skipped" value={String(skipped.length)} note="Already in Profit Tracker" />
            <SummaryTile label="Can't import" value={String(problems.length)} note={problems.length ? 'See below' : 'None'} tone={problems.length ? 'text-amber-300' : undefined} />
          </dl>

          {adding.length > 0 && (
            <section className="space-y-3" aria-labelledby="cashout-import-settings">
              <h3 id="cashout-import-settings" className="text-sm font-semibold text-white">For every item added</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                <div>
                  <label htmlFor="cashout-import-paid-through" className={labelClass}>Paid through (optional)</label>
                  <input id="cashout-import-paid-through" type="date" className={inputClass} value={paidThrough} onChange={(e) => setPaidThrough(e.target.value)} />
                  <p className="text-xs text-gray-500 mt-1">Items received on or before this date are saved as paid.</p>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Each item adds a <span className="text-gray-200">purchase</span>
                {vendorName ? <> from {vendorName}</> : null}{cardName ? <>, paid with {cardName}</> : null}, at the cost you enter,
                and a <span className="text-gray-200">sale</span> to {cashoutName || 'the cashout you pick'}, marked Paid or Waiting for payment.
                Costs left blank are saved at $0 with a &quot;Cost needed&quot; note. Nothing already in Profit Tracker is changed.
              </p>
            </section>
          )}

          {adding.length > 0 && (
            <section className="space-y-3 rounded-lg border border-gray-800 p-3 sm:p-4" aria-labelledby="cashout-import-orders">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 id="cashout-import-orders" className="text-sm font-semibold text-white">Costs from Amazon orders <span className="font-normal text-gray-500">(optional)</span></h3>
                  {orders ? (
                    <p className="text-xs text-gray-400 mt-1">
                      {orders.summary.byTracking} matched by tracking{orders.summary.byName > 0 && <>, <span className="text-amber-300">{orders.summary.byName} by name and date (check these)</span></>}
                      {orders.summary.unmatched > 0 && <>, {orders.summary.unmatched} not found</>}. Matched rows get the order&apos;s cost, tax, shipping, order number, date and card.
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 mt-1">Bought these on Amazon? Add your Amazon order history and each item gets its real cost, tax, order number, order date and card, matched by tracking number, then by name and date. {AMAZON_HOW_TO}</p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 w-full sm:w-auto">
                  <input ref={ordersFileRef} id="cashout-import-orders-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { onAddOrders(e.target.files?.[0]); e.target.value = ''; }} disabled={busy} />
                  <label htmlFor="cashout-import-orders-file" className={`page-btn inline-flex flex-1 sm:flex-none items-center justify-center gap-2 px-3 h-9 rounded-lg border border-gray-700 text-sm text-gray-200 hover:bg-white/5 cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
                    <FileUp size={14} /> {matching ? 'Matching…' : orders ? 'Use another file' : 'Add Amazon orders CSV'}
                  </label>
                  {orders && (
                    <button type="button" onClick={onRemoveOrders} disabled={busy} className="page-btn flex-1 sm:flex-none px-3 h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}

          <section className="space-y-3" aria-labelledby="cashout-import-adding">
            <h3 id="cashout-import-adding" className="text-sm font-semibold text-white">Will be added ({adding.length})</h3>
            {adding.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing new in this report: everything in it is already in Profit Tracker.</p>
            ) : isPhone ? (
              <ul className="space-y-2" aria-label="Purchases to import">
                {adding.map((g) => <GroupCard key={g.key} group={g} paid={isPaid(g)} checked={Boolean(selected[g.key])} onToggle={() => toggle(g.key)} cost={costs[g.key] ?? ''} onCost={(v) => setCost(g, v)} picker={(id) => pickerFor(g, id)} />)}
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
                      <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Payout / unit</th>
                      <th className="px-3 py-2 text-left font-medium">Sale status</th>
                      {orders && <th className="px-3 py-2 text-left font-medium">Amazon order</th>}
                      <th className="px-3 py-2 text-left font-medium w-32 whitespace-nowrap">Cost / unit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {adding.map((g) => (
                      <tr key={g.key} className={`border-t border-gray-800 ${selected[g.key] ? '' : 'opacity-50'}`}>
                        <td className="px-3 py-2">
                          <input type="checkbox" aria-label={`Import ${g.name}`} checked={Boolean(selected[g.key])} onChange={() => toggle(g.key)} />
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">{g.date}</td>
                        <td className="px-3 py-2 min-w-[12rem]">
                          <div className="line-clamp-2 text-gray-200">{g.name}</div>
                          {g.tracking.length > 0 && <div className="text-xs text-gray-500 truncate max-w-[18rem]">{g.tracking.join(', ')}</div>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{g.newQty !== g.qty ? `${g.newQty} of ${g.qty}` : g.qty}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(g.unitPrice)}</td>
                        <td className="px-3 py-2"><StatusPills group={g} paid={isPaid(g)} /></td>
                        {orders && <td className="px-3 py-2 min-w-[14rem] max-w-[18rem]">{pickerFor(g)}</td>}
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            inputMode="decimal"
                            aria-label={`Cost per unit for ${g.name}`}
                            placeholder="$0.00"
                            value={costs[g.key] ?? ''}
                            onChange={(e) => setCost(g, e.target.value)}
                            disabled={!selected[g.key]}
                            className={`${inputClass} h-8`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {skipped.length > 0 && (
            <details className="rounded-lg border border-gray-800">
              <summary className="cursor-pointer min-h-11 flex items-center px-3 text-sm font-semibold text-white">
                Skipped, already in Profit Tracker ({skipped.length})
              </summary>
              <ul className="border-t border-gray-800 divide-y divide-gray-800" aria-label="Skipped items">
                {skipped.map((g) => (
                  <li key={g.key} className="px-3 py-2 text-xs flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-gray-300 line-clamp-2">{g.name} <span className="text-gray-500">· {g.date}</span></span>
                    <span className="text-gray-500">
                      {g.qty - g.newQty} of {g.qty} · {g.match === 'imported' ? 'imported before' : 'already logged with the same tracking number'}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {problems.length > 0 && (
            <details className="rounded-lg border border-amber-500/30">
              <summary className="cursor-pointer min-h-11 flex items-center px-3 text-sm font-semibold text-amber-300">
                Can&apos;t be imported ({problems.length})
              </summary>
              <ul className="border-t border-amber-500/20 divide-y divide-gray-800">
                {problems.slice(0, 200).map((p) => (
                  <li key={p.ref} className="px-3 py-2 text-xs text-gray-400">
                    {p.date || 'No date'} · {p.name || 'No name'}: <span className="text-amber-300">{p.problem}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="shrink-0 border-t border-[color:var(--dp-border)] px-4 sm:px-6 py-3 space-y-2">
          {error && <p role="alert" className="text-sm text-red-400">{error}</p>}
          {chosen.length > 0 && missingCost > 0 && (
            <p className="text-xs text-amber-300 sm:text-right">{missingCost} without a cost will be saved at $0 and marked &quot;Cost needed&quot;.</p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <button type="button" onClick={close} disabled={committing} className="page-btn px-4 h-10 sm:h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={onImport}
              disabled={busy || chosen.length === 0}
              className="page-btn inline-flex items-center justify-center gap-2 px-4 h-10 sm:h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50"
            >
              <Download size={14} />
              {committing ? 'Importing…' : chosen.length === 0 ? 'Nothing new to import' : `Import ${plural(chosen.length, 'purchase')} (${plural(chosenUnits, 'unit')})`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    // The app's workspace root: outside the page's own layers, but still inside
    // the container the light/dark theme styles apply to.
    document.querySelector('.carbon-workspace, .glass-workspace') || document.body,
  );
}

function SummaryTile({ label, value, note, tone }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-[#16161E] p-3 min-w-0">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${tone || 'text-white'}`}>{value}</dd>
      <dd className="text-xs text-gray-500 line-clamp-2">{note}</dd>
    </div>
  );
}

function StatusPills({ group, paid }) {
  const match = MATCH_LABELS[group.match] || MATCH_LABELS.new;
  return (
    <div className="flex flex-wrap gap-1">
      <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs whitespace-nowrap ${match.tone}`}>{match.text}</span>
      <span className="inline-flex items-center px-2 py-0.5 rounded border border-gray-700 text-xs text-gray-400 whitespace-nowrap">{paid ? 'Paid' : 'Not paid yet'}</span>
    </div>
  );
}

function GroupCard({ group: g, paid, checked, onToggle, cost, onCost, picker }) {
  const id = `cashout-import-${g.key.replace(/[^a-z0-9]/gi, '').slice(-24)}-${g.refs[0]?.replace(/[^a-z0-9]/gi, '').slice(-12)}`;
  return (
    <li className={`rounded-lg border border-gray-800 bg-[#16161E] p-3 space-y-2 ${checked ? '' : 'opacity-60'}`}>
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-1 h-5 w-5" checked={checked} onChange={onToggle} />
        <label htmlFor={id} className="flex-1 min-w-0">
          <span className="block text-sm text-gray-200 line-clamp-2">{g.name}</span>
          <span className="block text-xs text-gray-500">
            {g.date} · {g.newQty !== g.qty ? `${g.newQty} of ${g.qty}` : g.qty} × {money(g.unitPrice)}
          </span>
        </label>
      </div>
      <StatusPills group={g} paid={paid} />
      {picker(`${id}-order`)}
      <div>
        <label htmlFor={`${id}-cost`} className={labelClass}>Cost per unit</label>
        <input id={`${id}-cost`} type="text" inputMode="decimal" placeholder="$0.00" value={cost} onChange={(e) => onCost(e.target.value)} disabled={!checked} className={inputClass} />
      </div>
    </li>
  );
}

export default CashoutImport;
