import React, { useEffect, useState } from 'react';
import { useInventory, useSales, useInvalidate, apiFetch } from '../hooks/useApi';
import { detectCarrier, carrierTrackingUrl } from '../utils/carrier';
import { toast } from 'sonner';
import { Truck, RefreshCw, ExternalLink, Save } from 'lucide-react';

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
      <span className="text-[10px] text-gray-600">checked {timeAgo(trackingInfo.checkedAt)}</span>
    </div>
  );
}

// ─── One row in the "Tracked" view ───────────────────────────────────────────────
function TrackedRow({ row, onCheck, checking, checkDisabled }) {
  const chip = detectCarrier(row.trackingNumber);
  const url = carrierTrackingUrl(chip?.label, row.trackingNumber);
  return (
    <tr className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-gray-100 truncate max-w-60">{row.product}</p>
        <p className="text-xs text-gray-500">{row.counterpart}</p>
      </td>
      <td className="px-4 py-3">
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
        <p className="text-xs text-gray-400 mt-1 font-mono">{row.trackingNumber}</p>
      </td>
      <td className="px-4 py-3">
        <TrackingStatusCell trackingNumber={row.trackingNumber} trackingInfo={row.trackingInfo} />
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-2">
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

// ─── One row in the "Needs Tracking #" view ──────────────────────────────────────
function UntrackedRow({ row, onSave, saving }) {
  const [value, setValue] = useState('');
  return (
    <tr className="border-b border-white/5 last:border-0 hover:bg-white/2 transition-colors">
      <td className="px-4 py-3">
        <p className="text-sm font-medium text-gray-100 truncate max-w-60">{row.product}</p>
        <p className="text-xs text-gray-500">{row.counterpart}</p>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-gray-400">{row.date ? new Date(row.date).toLocaleDateString() : '—'}</span>
      </td>
      <td className="px-4 py-3" colSpan={2}>
        <div className="flex items-center gap-2 max-w-sm">
          <input
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder="Enter tracking number…"
            className="flex-1 bg-[#0d0d18] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500/50"
          />
          <button
            onClick={() => onSave(row.id, value)}
            disabled={saving || !value.trim()}
            className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors shrink-0"
          >
            <Save className="w-3.5 h-3.5" /> Save
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── One Inbound/Outbound section ────────────────────────────────────────────────
function ShippingSection({ title, subtitle, rows, onSave, onCheck, checkingId, savingId, checkDisabled }) {
  const [view, setView] = useState('tracked');
  const tracked = rows.filter(r => r.trackingNumber);
  const untracked = rows.filter(r => !r.trackingNumber);
  const current = view === 'tracked' ? tracked : untracked;

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

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
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
                  <th className="px-4 py-2.5" colSpan={2}>Add Tracking Number</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {current.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500">
                  {view === 'tracked' ? 'No tracked shipments yet.' : 'Everything here has a tracking number.'}
                </td>
              </tr>
            )}
            {view === 'tracked'
              ? current.map(row => <TrackedRow key={row.id} row={row} onCheck={onCheck} checking={checkingId === row.id} checkDisabled={checkDisabled} />)
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
  const [checkingId, setCheckingId] = useState(null);
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
    trackingNumber: inv.tracking_number || null,
    trackingInfo: inv.tracking_info || null,
  }));

  const outboundRows = sales.map(sale => ({
    id: sale.id,
    product: sale.inventory?.product_name || 'Item',
    counterpart: sale.platform?.name || sale.buyer?.name || '—',
    date: sale.sale_date,
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

  const checkTracking = async (endpoint, id, invalidateFn) => {
    setCheckingId(id);
    try {
      const res = await apiFetch(`${endpoint}/${id}/track`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        setRateLimit({ remaining: 0, resetAt: new Date(Date.now() + (data.retryAfterSeconds || 3600) * 1000).toISOString() });
        toast.error(data.error || 'Too many tracking checks. Please try again later.');
        return;
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.rate_limit) setRateLimit(data.rate_limit);
      invalidateFn();
    } catch (err) {
      toast.error('Failed to check status: ' + err.message);
    } finally {
      setCheckingId(null);
    }
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
          <ShippingSection
            title="Inbound Shipping"
            subtitle="Items being shipped to you from vendors"
            rows={inboundRows}
            onCheck={id => checkTracking('/api/inventory', id, invalidate.inventory)}
            onSave={(id, trackingNumber) => saveTracking('/api/inventory', id, invalidate.inventory, trackingNumber)}
            checkingId={checkingId}
            savingId={savingId}
            checkDisabled={rateLimited}
          />
          <ShippingSection
            title="Outbound Shipping"
            subtitle="Items you've shipped out to buyers"
            rows={outboundRows}
            onCheck={id => checkTracking('/api/sales', id, invalidate.sales)}
            onSave={(id, trackingNumber) => saveTracking('/api/sales', id, invalidate.sales, trackingNumber)}
            checkingId={checkingId}
            savingId={savingId}
            checkDisabled={rateLimited}
          />
        </div>
      )}
    </div>
  );
}
