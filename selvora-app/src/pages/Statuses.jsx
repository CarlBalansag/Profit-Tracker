import React, { useMemo, useState } from 'react';
import { ListChecks } from 'lucide-react';
import { useInventory, useSales } from '../hooks/useApi';
import StatusPipeline from '../components/UI/StatusPipeline';
import ContextualActions from '../components/UI/ContextualActions';
import {
  STATUS_ORDER,
  displayLabel,
  availabilityLabel,
} from '../data/statusWorkflow';

// Legacy rows that the status-workflow backfill has not reached yet have no
// receiving_status/workflow_status at all. They get their own bucket so they are
// visible (and fixable) rather than silently missing from every tile.
const UNASSIGNED = '__UNASSIGNED__';

const statusKeyOf = (record) => record.__kind === 'inventory'
  ? (record.receiving_status || UNASSIGNED)
  : (record.workflow_status || UNASSIGNED);

const productNameOf = (record) => record.__kind === 'inventory'
  ? (record.product_name || 'Item')
  : (record.inventory?.product_name || 'Item');

const counterpartOf = (record) => record.__kind === 'inventory'
  ? (record.vendor?.name || 'Direct')
  : (record.platform?.name || record.buyer?.name || '—');

const detailOf = (record) => {
  if (record.__kind === 'inventory') {
    const onHand = Number(record.qty_on_hand) || 0;
    const purchased = Number(record.qty_purchased) || 0;
    return `${onHand} of ${purchased} on hand · ${availabilityLabel(record)}${record.is_listed ? ' · Listed' : ''}`;
  }
  const qty = Number(record.quantity) || 0;
  return `${qty} unit${qty === 1 ? '' : 's'}`;
};

const ROW_CLASS = 'block md:table-row mb-3 last:mb-0 md:mb-0 rounded-xl md:rounded-none border border-white/10 md:border-0 md:border-b md:border-white/5 overflow-hidden hover:bg-white/2 transition-colors';
const CELL_FIRST = 'block md:table-cell px-4 pt-3 md:py-3 align-top';
const CELL_MID = 'block md:table-cell px-4 py-2 md:py-3 align-top';
const CELL_LAST = 'block md:table-cell px-4 pb-3 md:py-3 align-top';

function CellLabel({ children }) {
  return <span className="md:hidden text-[10px] uppercase font-semibold text-gray-500 tracking-wider mr-2">{children}</span>;
}

function StatusRow({ record }) {
  const statusKey = statusKeyOf(record);
  return (
    <tr className={ROW_CLASS}>
      <td className={CELL_FIRST}>
        <p className="text-sm font-medium text-gray-100 md:truncate md:max-w-60">{productNameOf(record)}</p>
        <p className="text-xs text-gray-500">{counterpartOf(record)}</p>
      </td>
      <td className={CELL_MID}>
        <CellLabel>Type</CellLabel>
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${
          record.__kind === 'inventory'
            ? 'text-sky-300 border-sky-500/30 bg-sky-500/10'
            : 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10'
        }`}>
          {record.__kind === 'inventory' ? 'PURCHASE' : 'SALE'}
        </span>
      </td>
      <td className={CELL_MID}>
        <CellLabel>Status</CellLabel>
        <p className="text-xs font-semibold text-gray-200">
          {statusKey === UNASSIGNED ? 'No status yet' : displayLabel(statusKey)}
        </p>
        <p className="text-[11px] text-gray-500">{detailOf(record)}</p>
        {record.__kind === 'inventory' && record.cancelled_at && (
          <p className="text-[11px] text-red-400">Cancelled</p>
        )}
      </td>
      <td className={CELL_LAST}>
        <CellLabel>Actions</CellLabel>
        <ContextualActions record={record} kind={record.__kind} />
      </td>
    </tr>
  );
}

export default function Statuses() {
  const { data: inventory = [], isLoading: loadingInventory } = useInventory();
  const { data: sales = [], isLoading: loadingSales } = useSales();
  const [activeKey, setActiveKey] = useState(null);

  const loading = loadingInventory || loadingSales;

  // One combined list: inventory receiving statuses and sale workflow statuses
  // are disjoint vocabularies, so a selected tile already implies which kind of
  // record it filters to.
  const records = useMemo(() => [
    ...inventory.map((item) => ({ ...item, __kind: 'inventory' })),
    ...sales.map((sale) => ({ ...sale, __kind: 'sale' })),
  ], [inventory, sales]);

  const statuses = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      const key = statusKeyOf(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    // Known statuses in the canonical pipeline order, then the unassigned
    // bucket, and only the ones that actually have records.
    const ordered = STATUS_ORDER.filter((key) => counts.has(key)).map((key) => ({ key, count: counts.get(key) }));
    if (counts.has(UNASSIGNED)) ordered.push({ key: UNASSIGNED, label: 'No status yet', count: counts.get(UNASSIGNED) });
    return ordered;
  }, [records]);

  const visible = useMemo(
    () => (activeKey ? records.filter((record) => statusKeyOf(record) === activeKey) : records),
    [records, activeKey],
  );

  // A tile can disappear between renders (the last record in it moved on), which
  // would otherwise leave the page stuck on an empty filter with no way back.
  const activeStillExists = activeKey && statuses.some((status) => status.key === activeKey);
  const effectiveKey = activeStillExists ? activeKey : null;
  const shown = effectiveKey ? visible : records;

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-indigo-400" /> Statuses
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Everything waiting on you, grouped by where it is in the workflow. Pick a tile to narrow the list.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-gray-500">Loading…</div>
      ) : records.length === 0 ? (
        <div className="card bg-[#0f1115] rounded-xl border border-white/6 px-4 py-12 text-center">
          <p className="text-sm text-gray-400">Nothing to track yet.</p>
          <p className="text-xs text-gray-600 mt-1">Add a purchase or record a sale and it will show up here.</p>
        </div>
      ) : (
        <>
          <StatusPipeline statuses={statuses} activeKey={effectiveKey} onSelect={setActiveKey} />

          <div className="card bg-[#0f1115] rounded-xl border border-white/6">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 border-b border-white/6">
              <div>
                <h2 className="text-base font-semibold text-white">
                  {effectiveKey
                    ? (effectiveKey === UNASSIGNED ? 'No status yet' : displayLabel(effectiveKey))
                    : 'All records'}
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">
                  {shown.length} record{shown.length === 1 ? '' : 's'}
                </p>
              </div>
              {effectiveKey && (
                <button
                  type="button"
                  onClick={() => setActiveKey(null)}
                  className="px-3 h-7 rounded-lg border border-white/10 text-xs font-medium text-gray-300 hover:bg-white/5 transition-colors"
                >
                  Clear filter
                </button>
              )}
            </div>

            <div className="overflow-x-auto px-3 py-3 md:p-0">
              <table className="w-full text-left block md:table">
                <thead className="hidden md:table-header-group">
                  <tr className="text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
                    <th className="px-4 py-2.5">Item</th>
                    <th className="px-4 py-2.5">Type</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Actions</th>
                  </tr>
                </thead>
                <tbody className="block md:table-row-group">
                  {shown.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="block md:table-cell px-4 py-8 text-center text-sm text-gray-500">
                        Nothing in this status right now.
                      </td>
                    </tr>
                  ) : shown.map((record) => (
                    <StatusRow key={`${record.__kind}-${record.id}`} record={record} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
