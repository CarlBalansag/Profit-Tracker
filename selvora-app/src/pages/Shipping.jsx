import React, { useEffect, useState } from 'react';
import { useInventory, useSales, useInvalidate, apiFetch } from '../hooks/useApi';
import { detectCarrier, carrierTrackingUrl } from '../utils/carrier';
import { toast } from 'sonner';
import { Truck, RefreshCw, ExternalLink, Save, ChevronRight } from 'lucide-react';

// ─── Helpers ────────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function formatEta(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const STATUS_COLORS = {
  'Delivered': 'text-emerald-400',
  'Out for Delivery': 'text-sky-400',
  'In Transit': 'text-blue-400',
  'Pre-Transit': 'text-indigo-400',
  'Exception': 'text-red-400',
  'Unknown': 'text-gray-400',
};

const NOT_TRACKABLE_MESSAGE = {
  not_configured: 'Carrier API not set up',
  restricted: 'Carrier restricts this number',
  unrecognized: 'Unrecognized carrier format',
  error: 'Check failed — try again',
};

// ─── Status cell ────────────────────────────────────────────────────────────────
function TrackingStatusCell({ trackingNumber, trackingInfo }) {
  const carrier = trackingInfo?.carrier ?? detectCarrier(trackingNumber)?.label ?? null;
  const url = carrierTrackingUrl(carrier, trackingNumber);

  if (!trackingInfo) {
    return <span className="text-xs text-gray-600">Not checked yet</span>;
  }

  if (!trackingInfo.trackable) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{NOT_TRACKABLE_MESSAGE[trackingInfo.reason] || 'Unavailable'}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
            Open on {carrier} <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <span className={`text-xs font-semibold ${STATUS_COLORS[trackingInfo.status] || 'text-gray-300'}`}>{trackingInfo.status}</span>
      {trackingInfo.estimatedDelivery && trackingInfo.status !== 'Delivered' && (
        <span className="text-[10px] text-gray-500">Est. arrival {formatEta(trackingInfo.estimatedDelivery)}</span>
      )}
      <span className="text-[10px] text-gray-600">checked {timeAgo(trackingInfo.checkedAt)}</span>
    </div>
  );
}

// ─── Inline field label shown only in the stacked mobile card layout ─────────────
function CellLabel({ children }) {
  return <span className="md:hidden text-[10px] uppercase font-semibold text-gray-500 tracking-wider mr-2">{children}</span>;
}

// Shared responsive classes: a bordered card block below md, a plain table row at md+.
const ROW_CLASS = 'block md:table-row mb-3 last:mb-0 md:mb-0 rounded-xl md:rounded-none border border-white/10 md:border-0 md:border-b md:border-white/5 overflow-hidden hover:bg-white/2 transition-colors';
const CELL_FIRST = 'block md:table-cell px-4 pt-3 md:py-3';
const CELL_MID = 'block md:table-cell px-4 py-2 md:py-3';
const CELL_LAST = 'block md:table-cell px-4 pb-3 md:py-3 md:text-right';

// ─── One row in the "Tracked" view ───────────────────────────────────────────────
function TrackedRow({ row, onCheck, checking, checkDisabled }) {
  const chip = detectCarrier(row.trackingNumber);
  const url = carrierTrackingUrl(chip?.label, row.trackingNumber);
  return (
    <tr className={ROW_CLASS}>
      <td className={CELL_FIRST}>
        <p className="text-sm font-medium text-gray-100 md:truncate md:max-w-60">{row.product}</p>
        <p className="text-xs text-gray-500">{row.counterpart}</p>
      </td>
      <td className={CELL_MID}>
        <CellLabel>Tracking #</CellLabel>
        {chip && (
          <button
            type="button"
            title={`Copy: ${row.trackingNumber}`}
            onClick={() => { navigator.clipboard.writeText(row.trackingNumber); toast.success('Tracking number copied'); }}
            className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border cursor-pointer hover:opacity-80 transition-opacity ${chip.color}`}
          >
            {chip.label}
          </button>
        )}
        <p className="text-xs text-gray-400 mt-1 font-mono break-all">{row.trackingNumber}</p>
      </td>
      <td className={CELL_MID}>
        <CellLabel>Status</CellLabel>
        <TrackingStatusCell trackingNumber={row.trackingNumber} trackingInfo={row.trackingInfo} />
      </td>
      <td className={CELL_LAST}>
        <div className="flex items-center md:justify-end gap-2">
          <button
            onClick={() => onCheck(row.id)}
            disabled={checking || checkDisabled}
            title={checkDisabled ? 'Tracking check limit reached — try again later' : undefined}
            className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : 'Check Status'}
          </button>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors" title={`View on ${chip.label}.com`}>
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Group rows that share a tracking number (same physical package) ─────────────
function groupByTracking(rows) {
  const order = [];
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.trackingNumber)) { map.set(row.trackingNumber, []); order.push(row.trackingNumber); }
    map.get(row.trackingNumber).push(row);
  }
  return order.map(key => map.get(key));
}

// ─── A collapsible row for multiple entries sharing one tracking number ──────────
function GroupedTrackedRow({ items, onCheck, checkingIds, checkDisabled }) {
  const [expanded, setExpanded] = useState(false);
  const first = items[0];
  const chip = detectCarrier(first.trackingNumber);
  const url = carrierTrackingUrl(chip?.label, first.trackingNumber);
  const combinedQty = items.reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
  const sameProduct = items.every(r => r.product === first.product);
  const label = sameProduct ? first.product : `${items.length} items`;
  const anyChecking = items.some(r => checkingIds.has(r.id));

  return (
    <>
      <tr className={`${ROW_CLASS} cursor-pointer`} onClick={() => setExpanded(e => !e)}>
        <td className={CELL_FIRST}>
          <div className="flex items-center gap-2">
            <ChevronRight className={`w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            <div>
              <p className="text-sm font-medium text-gray-100 md:truncate md:max-w-60">{label}</p>
              <p className="text-xs text-gray-500">{items.length} entries{combinedQty ? ` · ${combinedQty} units combined` : ''}</p>
            </div>
          </div>
        </td>
        <td className={CELL_MID}>
          <CellLabel>Tracking #</CellLabel>
          {chip && (
            <button
              type="button"
              title={`Copy: ${first.trackingNumber}`}
              onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(first.trackingNumber); toast.success('Tracking number copied'); }}
              className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border cursor-pointer hover:opacity-80 transition-opacity ${chip.color}`}
            >
              {chip.label}
            </button>
          )}
          <p className="text-xs text-gray-400 mt-1 font-mono break-all">{first.trackingNumber}</p>
        </td>
        <td className={CELL_MID}>
          <CellLabel>Status</CellLabel>
          <TrackingStatusCell trackingNumber={first.trackingNumber} trackingInfo={first.trackingInfo} />
        </td>
        <td className={CELL_LAST}>
          <div className="flex items-center md:justify-end gap-2" onClick={e => e.stopPropagation()}>
            <button
              onClick={() => onCheck(items.map(i => i.id))}
              disabled={anyChecking || checkDisabled}
              title={checkDisabled ? 'Tracking check limit reached — try again later' : undefined}
              className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${anyChecking ? 'animate-spin' : ''}`} />
              {anyChecking ? 'Checking…' : 'Check Status'}
            </button>
            {url && (
              <a href={url} target="_blank" rel="noreferrer" className="p-1.5 rounded-lg hover:bg-white/10 text-gray-500 hover:text-white transition-colors" title={`View on ${chip.label}.com`}>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </td>
      </tr>
      {expanded && items.map(item => (
        <tr key={item.id} className="block md:table-row mb-2 last:mb-3 md:mb-0 md:border-b md:border-white/5 bg-white/[0.015]">
          <td className="block md:table-cell pl-10 pr-4 py-2" colSpan={4}>
            <p className="text-xs text-gray-300">{item.product}</p>
            <p className="text-[11px] text-gray-600">{item.counterpart}{item.qty ? ` · ${item.qty} units` : ''}</p>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── One row in the "Needs Tracking #" view ──────────────────────────────────────
function UntrackedRow({ row, onSave, saving }) {
  const [value, setValue] = useState('');
  return (
    <tr className={ROW_CLASS}>
      <td className={CELL_FIRST}>
        <p className="text-sm font-medium text-gray-100 md:truncate md:max-w-60">{row.product}</p>
        <p className="text-xs text-gray-500">{row.counterpart}</p>
      </td>
      <td className={CELL_MID}>
        <CellLabel>Date</CellLabel>
        <span className="text-xs text-gray-400">{row.date ? new Date(row.date).toLocaleDateString() : '—'}</span>
      </td>
      <td className="block md:table-cell px-4 pb-3 md:py-3" colSpan={2}>
        <CellLabel>Add Tracking #</CellLabel>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-1 md:mt-0 md:max-w-sm">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Enter tracking number…"
            className="flex-1 min-w-0 bg-[#0d0d18] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
          />
          <button
            onClick={() => onSave(row.id, value)}
            disabled={saving || !value.trim()}
            className="flex items-center justify-center gap-1.5 px-3 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors shrink-0"
          >
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── One Inbound/Outbound section ────────────────────────────────────────────────
function ShippingSection({ title, subtitle, rows, onSave, onCheck, checkingIds, savingId, checkDisabled }) {
  const [view, setView] = useState('tracked');
  const tracked = rows.filter(r => r.trackingNumber);
  const untracked = rows.filter(r => !r.trackingNumber);
  const current = view === 'tracked' ? tracked : untracked;
  const trackedGroups = view === 'tracked' ? groupByTracking(tracked) : [];

  return (
    <div className="card bg-[#0f1115] rounded-xl border border-white/6">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 border-b border-white/6">
        <div>
          <h2 className="text-base font-semibold text-white">{title}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
        </div>
        <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5">
          {[
            { key: 'tracked', label: 'Tracked', count: tracked.length },
            { key: 'needs', label: 'Needs Tracking #', count: untracked.length },
          ].map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setView(key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === key
                  ? 'text-white bg-white/8 border border-white/10 shadow-sm'
                  : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
              }`}
            >
              {label}
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                view === key ? 'bg-white/10 text-white' : 'bg-white/5 text-gray-500'
              }`}>{count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto px-3 py-3 md:p-0">
        <table className="w-full text-left block md:table">
          <thead className="hidden md:table-header-group">
            <tr className="text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
              <th className="px-4 py-2.5">Item</th>
              {view === 'tracked' ? (
                <>
                  <th className="px-4 py-2.5">Tracking #</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </>
              ) : (
                <>
                  <th className="px-4 py-2.5">Date</th>
                  <th className="px-4 py-2.5" colSpan={2}>Add Tracking #</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="block md:table-row-group">
            {current.length === 0 && (
              <tr>
                <td colSpan={4} className="block md:table-cell px-4 py-8 text-center text-sm text-gray-500">
                  {view === 'tracked' ? 'No tracked shipments yet.' : 'Everything here has a tracking number.'}
                </td>
              </tr>
            )}
            {view === 'tracked'
              ? trackedGroups.map(items => items.length === 1
                  ? <TrackedRow key={items[0].id} row={items[0]} onCheck={onCheck} checking={checkingIds.has(items[0].id)} checkDisabled={checkDisabled} />
                  : <GroupedTrackedRow key={items[0].trackingNumber} items={items} onCheck={onCheck} checkingIds={checkingIds} checkDisabled={checkDisabled} />)
              : current.map(row => <UntrackedRow key={row.id} row={row} onSave={onSave} saving={savingId === row.id} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────────
export default function Shipping() {
  const { data: inventory = [], isLoading: loadingInventory } = useInventory();
  const { data: sales = [], isLoading: loadingSales } = useSales();
  const invalidate = useInvalidate();
  const [checkingIds, setCheckingIds] = useState(() => new Set());
  const [savingId, setSavingId] = useState(null);
  const [rateLimit, setRateLimit] = useState(null); // { remaining, resetAt } | null

  // Once the limit is hit, automatically re-enable checks when the window resets.
  useEffect(() => {
    if (!rateLimit || rateLimit.remaining > 0) return;
    const ms = new Date(rateLimit.resetAt).getTime() - Date.now();
    if (ms <= 0) { setRateLimit(null); return; }
    const timer = setTimeout(() => setRateLimit(null), ms);
    return () => clearTimeout(timer);
  }, [rateLimit]);

  const rateLimited = Boolean(rateLimit && rateLimit.remaining <= 0);
  const rateLimitMinutes = rateLimited ? Math.max(1, Math.ceil((new Date(rateLimit.resetAt).getTime() - Date.now()) / 60000)) : null;

  const inboundRows = inventory.map(inv => ({
    id: inv.id,
    product: inv.product_name,
    counterpart: inv.vendor?.name || 'Direct',
    date: inv.purchase_date,
    qty: inv.qty_purchased,
    trackingNumber: inv.tracking_number || null,
    trackingInfo: inv.tracking_info || null,
  }));

  const outboundRows = sales.map(sale => ({
    id: sale.id,
    product: sale.inventory?.product_name || 'Item',
    counterpart: sale.platform?.name || sale.buyer?.name || '—',
    date: sale.sale_date,
    qty: sale.quantity,
    trackingNumber: sale.tracking_number || null,
    trackingInfo: sale.tracking_info || null,
  }));

  const saveTracking = async (endpoint, id, invalidateFn, trackingNumber) => {
    setSavingId(id);
    try {
      const res = await apiFetch(`${endpoint}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: trackingNumber.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      invalidateFn();
      toast.success('Tracking number saved');
    } catch (err) {
      toast.error('Failed to save tracking number: ' + err.message);
    } finally {
      setSavingId(null);
    }
  };

  const checkTrackingOne = async (endpoint, id) => {
    setCheckingIds(prev => new Set(prev).add(id));
    try {
      const res = await apiFetch(`${endpoint}/${id}/track`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setRateLimit({ remaining: 0, resetAt: new Date(Date.now() + (data.retryAfterSeconds || 3600) * 1000).toISOString() });
        toast.error(data.error || 'Too many tracking checks. Please try again later.');
        return false; // stop checking further ids in this batch
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.rate_limit) setRateLimit(data.rate_limit);
      return true;
    } catch (err) {
      toast.error('Failed to check status: ' + err.message);
      return true; // already surfaced — keep going for the rest of the group
    } finally {
      setCheckingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  };

  // Accepts either a single record id or an array (a group sharing one
  // tracking number checks every member, since they're the same package).
  const checkTracking = async (endpoint, idOrIds, invalidateFn) => {
    const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
    for (const id of ids) {
      const shouldContinue = await checkTrackingOne(endpoint, id);
      if (!shouldContinue) break;
    }
    invalidateFn();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2"><Truck className="w-5 h-5 text-indigo-400" /> Shipping</h1>
        <p className="text-sm text-gray-400 mt-1">Track packages coming in from vendors and going out to buyers.</p>
      </div>

      {rateLimited && (
        <div className="px-4 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
          Tracking check limit reached — try again in {rateLimitMinutes}m.
        </div>
      )}

      {(loadingInventory || loadingSales) ? (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
          <ShippingSection
            title="Inbound Shipping"
            subtitle="Items being shipped to you from vendors"
            rows={inboundRows}
            onCheck={idOrIds => checkTracking('/api/inventory', idOrIds, invalidate.inventory)}
            onSave={(id, trackingNumber) => saveTracking('/api/inventory', id, invalidate.inventory, trackingNumber)}
            checkingIds={checkingIds}
            savingId={savingId}
            checkDisabled={rateLimited}
          />
          <ShippingSection
            title="Outbound Shipping"
            subtitle="Items you've shipped out to buyers"
            rows={outboundRows}
            onCheck={idOrIds => checkTracking('/api/sales', idOrIds, invalidate.sales)}
            onSave={(id, trackingNumber) => saveTracking('/api/sales', id, invalidate.sales, trackingNumber)}
            checkingIds={checkingIds}
            savingId={savingId}
            checkDisabled={rateLimited}
          />
        </div>
      )}
    </div>
  );
}
