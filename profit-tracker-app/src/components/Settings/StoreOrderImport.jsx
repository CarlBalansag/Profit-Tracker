import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, Save, X } from 'lucide-react';
import { toast } from 'sonner';
import { usePaymentMethods, usePlatforms, useStoreOrderCosts } from '../../hooks/useApi';
import { useMatchMedia } from '../../hooks/useMatchMedia';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { trimOrderCsv } from '../../utils/orderCsv';

// Settings > Data > Fill in costs from store orders. The cashout import saves
// purchases at $0 ("Cost needed") because cashout reports have no purchase
// price. This reads the store's own order export and fills those costs in:
// review first in a modal like the cashout import's (nothing is saved), then
// save the pairs that look right. The server does the parsing and matching
// (profit-tracker-api/services/storeOrders/fillCosts.js).
const STORES = [
  {
    id: 'amazon',
    label: 'Amazon',
    match: /amazon/i,
    howTo: 'On Amazon, open Account > Request Your Data, choose "Your Orders" and submit. Amazon emails a download link (usually within a few hours). Unzip it and choose Retail.OrderHistory.1.csv.',
  },
];

const MATCH_LABELS = {
  tracking: { text: 'Same tracking', tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  name: { text: 'Name + date', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  none: { text: 'No match', tone: 'text-gray-400 border-gray-700 bg-white/5' },
};

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const round2 = (n) => Math.round(n * 100) / 100;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const costNumber = (text) => Number(String(text ?? '').replace(/[$,\s]/g, ''));
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
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
const lineLabel = (l) => `${l.orderId} · ${l.orderDate || 'no date'} · ${l.qty} × ${money(l.perUnit.cost)} · ${l.name.length > 48 ? `${l.name.slice(0, 47)}…` : l.name}`;

export function StoreOrderImport() {
  const { data: platforms = [] } = usePlatforms();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const { preview, commit } = useStoreOrderCosts();
  const isPhone = useMatchMedia('(max-width: 767px)');
  const fileRef = useRef(null);

  const [store] = useState('amazon');
  const [result, setResult] = useState(null);
  // Per purchase id: { checked, lineIndex, cost }
  const [rows, setRows] = useState({});
  const [vendorId, setVendorId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [useOrderDate, setUseOrderDate] = useState(true);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const storeInfo = STORES.find((s) => s.id === store);
  const vendors = platforms.filter((p) => p.type === 'Vendor');
  const cardName = useMemo(() => new Map(paymentMethods.map((p) => [p.id, p.name])), [paymentMethods]);
  const lines = useMemo(() => new Map((result?.lines || []).map((l) => [l.index, l])), [result]);

  const reset = () => {
    setResult(null);
    setRows({});
    setError(null);
    preview.reset();
  };

  const showPreview = (data) => {
    const byIndex = new Map(data.lines.map((l) => [l.index, l]));
    setResult(data);
    setRows(Object.fromEntries(data.purchases.map((p) => [p.id, {
      checked: p.lineIndex !== null,
      lineIndex: p.lineIndex,
      cost: p.lineIndex !== null ? String(byIndex.get(p.lineIndex).perUnit.cost) : '',
    }])));
    setVendorId((current) => (current && vendors.some((v) => v.id === current) ? current : (vendors.find((v) => storeInfo.match.test(v.name))?.id || '')));
  };

  const readFile = async (file) => {
    setDone(null);
    reset();
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError('That file is too big to read here.');
      return;
    }
    try {
      const csv = trimOrderCsv(await readText(file));
      if (new Blob([csv]).size > MAX_UPLOAD_BYTES) {
        setError('That order history is too long to read at once. Split the CSV into smaller files (by year) and import each one.');
        return;
      }
      showPreview(await preview.mutateAsync({ source: store, csv }));
    } catch (err) {
      setError(err.message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const update = (id, patch) => setRows((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const pickLine = (id, value) => {
    const index = value === '' ? null : Number(value);
    const line = index === null ? null : lines.get(index);
    update(id, { lineIndex: index, checked: Boolean(line), cost: line ? String(line.perUnit.cost) : '' });
  };

  const chosen = useMemo(
    () => (result ? result.purchases.filter((p) => rows[p.id]?.checked && rows[p.id].lineIndex !== null) : []),
    [result, rows],
  );

  const save = async () => {
    setError(null);
    const badCost = chosen.filter((p) => !(costNumber(rows[p.id].cost) > 0));
    if (badCost.length) {
      setError(`Enter a cost above $0 for ${badCost.length === 1 ? badCost[0].name : `${badCost.length} purchases`}.`);
      return;
    }
    try {
      const res = await commit.mutateAsync({
        source: store,
        vendor_id: vendorId || null,
        payment_method_id: paymentMethodId || null,
        use_order_date: useOrderDate,
        items: chosen.map((p) => {
          const line = lines.get(rows[p.id].lineIndex);
          return {
            inventory_id: p.id,
            unit_cost: String(rows[p.id].cost).replace(/[$,\s]/g, ''),
            sales_tax: round2(line.perUnit.tax * p.qty),
            shipping: round2(line.perUnit.shipping * p.qty),
            order_number: line.orderId,
            order_date: line.orderDate,
            payment_method_id: line.paymentMethodId,
          };
        }),
      });
      setDone(res);
      toast.success(`Filled in the cost on ${plural(res.updated, 'purchase')}.`);
      reset();
    } catch (err) {
      setError(err.message);
    }
  };

  const busy = preview.isPending || commit.isPending;

  return (
    <div className="rounded-xl border border-gray-800 bg-[#12121A] p-4 sm:p-6 space-y-5">
      <div>
        <h2 className="text-sm font-bold text-white mb-2">Fill in costs from store orders</h2>
        <p className="text-xs text-gray-500">
          Purchases imported from a cashout have no cost yet. Upload your store&apos;s order history to fill them in. Orders are matched by tracking number first, then by item name and date. Nothing is saved until you confirm.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-gray-500">{storeInfo.howTo}</p>
        <input ref={fileRef} id="store-order-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} disabled={busy} />
        <label htmlFor="store-order-file" className={`page-btn inline-flex items-center justify-center gap-2 px-4 h-9 rounded-lg border border-gray-700 text-sm text-gray-200 hover:bg-white/5 cursor-pointer w-full sm:w-auto ${busy ? 'opacity-50 pointer-events-none' : ''}`}>
          <FileUp size={14} /> {preview.isPending ? 'Reading…' : `Choose ${storeInfo.label} order CSV`}
        </label>
      </div>

      {error && !result && <p role="alert" className="text-sm text-red-400">{error}</p>}

      {done && (
        <p role="status" className="text-sm text-emerald-400">
          Filled in the cost on {plural(done.updated, 'purchase')}.
          {done.skipped > 0 && <span className="text-gray-400"> {done.skipped} skipped because their cost was already filled in.</span>}
          <span className="text-gray-400"> You can undo this from Activity.</span>
        </p>
      )}

      {result && (
        <CostReview
          result={result}
          isPhone={isPhone}
          rows={rows}
          lines={lines}
          cardName={cardName}
          update={update}
          pickLine={pickLine}
          vendors={vendors}
          paymentMethods={paymentMethods}
          vendorId={vendorId}
          setVendorId={setVendorId}
          paymentMethodId={paymentMethodId}
          setPaymentMethodId={setPaymentMethodId}
          useOrderDate={useOrderDate}
          setUseOrderDate={setUseOrderDate}
          chosen={chosen}
          busy={busy}
          committing={commit.isPending}
          error={error}
          onSave={save}
          onCancel={reset}
        />
      )}
    </div>
  );
}

// Opens once an export is read: each purchase waiting for a cost and the order
// it was matched to. Nothing is saved until Save.
function CostReview({
  result, isPhone, rows, lines, cardName, update, pickLine,
  vendors, paymentMethods, vendorId, setVendorId, paymentMethodId, setPaymentMethodId, useOrderDate, setUseOrderDate,
  chosen, busy, committing, error, onSave, onCancel,
}) {
  const close = () => { if (!committing) onCancel(); };
  const modalRef = useModalKeyboard(true, close);
  const { summary, purchases } = result;
  // Purchases with an order to pick from are listed; the rest are summed up below.
  const listed = purchases.filter((p) => p.candidates.length > 0);
  const notFound = purchases.filter((p) => p.candidates.length === 0);
  const total = chosen.reduce((n, p) => {
    const line = lines.get(rows[p.id].lineIndex);
    const cost = costNumber(rows[p.id].cost);
    return n + (Number.isFinite(cost) ? cost * p.qty : 0) + line.perUnit.tax * p.qty + line.perUnit.shipping * p.qty;
  }, 0);
  const rowProps = (p) => ({
    purchase: p,
    row: rows[p.id],
    lines,
    cardName,
    onToggle: () => update(p.id, { checked: !rows[p.id].checked }),
    onLine: (v) => pickLine(p.id, v),
    onCost: (v) => update(p.id, { cost: v }),
  });

  // Portaled so the page's own layers (sidebar, bottom bar) can't sit on top of it.
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={close} />
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="store-order-review-title" className="relative flex w-full sm:w-[min(1000px,94vw)] max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <h2 id="store-order-review-title" className="text-base font-semibold text-white">Review costs</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              {result.sourceName} · {plural(summary.lines, 'order line')} read
              {summary.problems > 0 && ` (${summary.problems} skipped: cancelled or missing a price)`}. Nothing is saved until you press Save.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={committing} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6 theme-scrollbar">
          {summary.costNeeded === 0 ? (
            <p className="text-sm text-gray-400">No purchases are waiting for a cost. Purchases from the cashout import that still cost $0 show up here.</p>
          ) : (
            <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2" aria-label="Match summary">
              <SummaryTile label="Waiting for a cost" value={String(summary.costNeeded)} note="From the cashout import" />
              <SummaryTile label="Same tracking" value={String(summary.byTracking)} note="Shipped straight to the cashout" tone="text-emerald-400" />
              <SummaryTile label="Name + date" value={String(summary.byName)} note={summary.byName ? 'Check these' : 'None'} tone={summary.byName ? 'text-amber-300' : undefined} />
              <SummaryTile label="Will be saved" value={money(total)} note={`${plural(chosen.length, 'purchase')}, with tax and shipping`} />
            </dl>
          )}

          {listed.length > 0 && (
            <section className="space-y-3" aria-labelledby="store-order-settings">
              <h3 id="store-order-settings" className="text-sm font-semibold text-white">For every purchase saved</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="store-order-vendor" className={labelClass}>Store, where none is set</label>
                  <select id="store-order-vendor" className={inputClass} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                    <option value="">Leave empty</option>
                    {vendors.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="store-order-card" className={labelClass}>Card, where the order&apos;s card isn&apos;t recognized</label>
                  <select id="store-order-card" className={inputClass} value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                    <option value="">Leave empty</option>
                    {paymentMethods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm text-gray-300 cursor-pointer min-h-9">
                <input type="checkbox" className="mt-1" checked={useOrderDate} onChange={(e) => setUseOrderDate(e.target.checked)} />
                <span>
                  Use the order date as the purchase date
                  <span className="block text-xs text-gray-500">The cashout import used the date the cashout got the item.</span>
                </span>
              </label>
              <p className="text-xs text-gray-400">
                Cost is per unit, after the order&apos;s discounts. Tax and shipping are saved on the purchase too. A purchase that already has an order number, store or card keeps it, and nothing else is changed.
              </p>
            </section>
          )}

          {listed.length > 0 && (
            <section className="space-y-3" aria-labelledby="store-order-matches">
              <h3 id="store-order-matches" className="text-sm font-semibold text-white">Matched orders ({listed.length})</h3>
              {isPhone ? (
                <ul className="space-y-2" aria-label="Purchases waiting for a cost">
                  {listed.map((p) => <PurchaseCard key={p.id} {...rowProps(p)} />)}
                </ul>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-800">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 bg-[#16161E]">
                      <tr>
                        <th className="px-3 py-2 w-10"><span className="sr-only">Save</span></th>
                        <th className="px-3 py-2 text-left font-medium">Purchase</th>
                        <th className="px-3 py-2 text-left font-medium">Order</th>
                        <th className="px-3 py-2 text-left font-medium min-w-[7rem] whitespace-nowrap">Cost / unit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map((p) => <PurchaseRow key={p.id} {...rowProps(p)} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {notFound.length > 0 && (
            <details className="rounded-lg border border-gray-800">
              <summary className="cursor-pointer min-h-11 flex items-center px-3 text-sm font-semibold text-white">
                No matching order ({notFound.length})
              </summary>
              <p className="border-t border-gray-800 px-3 pt-2 text-xs text-gray-500">No order in this file has their tracking number or a similar name. Bought somewhere else? Enter the cost on the purchase itself.</p>
              <ul className="divide-y divide-gray-800" aria-label="Purchases with no matching order">
                {notFound.map((p) => (
                  <li key={p.id} className="px-3 py-2 text-xs flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="min-w-0 text-gray-300 line-clamp-2">{p.name}</span>
                    <span className="text-gray-500">{p.date} · {plural(p.qty, 'unit')}{p.cashout ? ` · ${p.cashout}` : ''}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="shrink-0 border-t border-[color:var(--dp-border)] px-4 sm:px-6 py-3 space-y-2">
          {error && <p role="alert" className="text-sm text-red-400 sm:text-right">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <button type="button" onClick={close} disabled={committing} className="page-btn px-4 h-10 sm:h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={onSave} disabled={busy || chosen.length === 0} className="page-btn inline-flex items-center justify-center gap-2 px-4 h-10 sm:h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50">
              <Save size={14} />
              {committing ? 'Saving…' : chosen.length === 0 ? 'Nothing to save' : `Save costs for ${plural(chosen.length, 'purchase')}`}
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

function MatchPill({ match }) {
  const m = MATCH_LABELS[match] || MATCH_LABELS.none;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs whitespace-nowrap ${m.tone}`}>{m.text}</span>;
}

function OrderPicker({ purchase: p, row, lines, cardName, onLine, id }) {
  const line = row.lineIndex !== null ? lines.get(row.lineIndex) : null;
  // A line the user picked over the server's own pick needs no pill.
  const match = line ? (row.lineIndex === p.lineIndex ? p.match : 'picked') : 'none';
  return (
    <div className="space-y-1">
      <select id={id} aria-label={`Order for ${p.name}`} className={`${inputClass} h-8 text-xs`} value={row.lineIndex ?? ''} onChange={(e) => onLine(e.target.value)}>
        <option value="">Don&apos;t fill this one</option>
        {p.candidates.map((i) => lines.get(i)).filter(Boolean).map((l) => <option key={l.index} value={l.index}>{lineLabel(l)}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {match !== 'picked' && <MatchPill match={match} />}
        {line && (
          <span>
            Tax {money(line.perUnit.tax * p.qty)}{line.perUnit.shipping > 0 && ` · shipping ${money(line.perUnit.shipping * p.qty)}`}
            {' · '}{line.paymentMethodId ? cardName.get(line.paymentMethodId) || 'card' : line.payment || 'card not listed'}
          </span>
        )}
      </div>
      {p.review && row.lineIndex === p.lineIndex && <p className="text-xs text-amber-300">{p.review}</p>}
    </div>
  );
}

function PurchaseRow({ purchase: p, row, lines, cardName, onToggle, onLine, onCost }) {
  const line = row.lineIndex !== null ? lines.get(row.lineIndex) : null;
  return (
    <tr className={`border-t border-gray-800 align-top ${line && row.checked ? '' : 'opacity-60'}`}>
      <td className="px-3 py-2">
        <input type="checkbox" aria-label={`Save cost for ${p.name}`} checked={Boolean(line) && row.checked} disabled={!line} onChange={onToggle} />
      </td>
      <td className="px-3 py-2 min-w-[12rem]">
        <div className="line-clamp-2 text-gray-200">{p.name}</div>
        <div className="text-xs text-gray-500">{p.date} · {plural(p.qty, 'unit')}{p.cashout ? ` · ${p.cashout}` : ''}</div>
      </td>
      <td className="px-3 py-2 min-w-[16rem]">
        <OrderPicker purchase={p} row={row} lines={lines} cardName={cardName} onLine={onLine} />
      </td>
      <td className="px-3 py-2">
        {line && (
          <input type="text" inputMode="decimal" aria-label={`Cost per unit for ${p.name}`} value={row.cost} onChange={(e) => onCost(e.target.value)} disabled={!row.checked} className={`${inputClass} h-8 min-w-[6rem]`} />
        )}
      </td>
    </tr>
  );
}

function PurchaseCard({ purchase: p, row, lines, cardName, onToggle, onLine, onCost }) {
  const line = row.lineIndex !== null ? lines.get(row.lineIndex) : null;
  const id = `store-order-${p.id}`;
  return (
    <li className={`rounded-lg border border-gray-800 bg-[#16161E] p-3 space-y-2 ${line && row.checked ? '' : 'opacity-70'}`}>
      <div className="flex items-start gap-3">
        <input id={id} type="checkbox" className="mt-1" checked={Boolean(line) && row.checked} disabled={!line} onChange={onToggle} />
        <label htmlFor={id} className="flex-1 min-w-0">
          <span className="block text-sm text-gray-200 line-clamp-2">{p.name}</span>
          <span className="block text-xs text-gray-500">{p.date} · {plural(p.qty, 'unit')}{p.cashout ? ` · ${p.cashout}` : ''}</span>
        </label>
      </div>
      <OrderPicker purchase={p} row={row} lines={lines} cardName={cardName} onLine={onLine} id={`${id}-order`} />
      {line && (
        <div>
          <label htmlFor={`${id}-cost`} className={labelClass}>Cost per unit</label>
          <input id={`${id}-cost`} type="text" inputMode="decimal" value={row.cost} onChange={(e) => onCost(e.target.value)} disabled={!row.checked} className={inputClass} />
        </div>
      )}
    </li>
  );
}

export default StoreOrderImport;
