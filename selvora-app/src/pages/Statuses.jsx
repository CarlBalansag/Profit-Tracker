import React, { useMemo, useState } from 'react';
import { ListChecks, Truck, Package, Send } from 'lucide-react';
import { useInventory, useSales } from '../hooks/useApi';
import StatusPipeline from '../components/UI/StatusPipeline';
import ContextualActions from '../components/UI/ContextualActions';
import {
  INVENTORY_RECEIVING_STATUSES,
  SALE_STATUS_ORDER,
  SALE_EXCEPTION_STATUSES,
  displayLabel,
  statusVisual,
} from '../data/statusWorkflow';

// ─── Board columns ───────────────────────────────────────────────────────────
// A column is purely a filter over the record's *current* stored status. There
// is no "move" mechanism and no drag-and-drop: an action POSTs to the action
// endpoint, useRecordActions invalidates the inventory/sales/dashboard caches,
// and the record re-renders under whichever column its new status matches.

// Derived rather than retyped, so a receiving status added to the registry (and
// mirrored in statusWorkflow.js) lands in the Incoming column automatically.
const INCOMING_STATUSES = INVENTORY_RECEIVING_STATUSES.filter((status) => status !== 'ON_HAND');
const ON_HAND_STATUSES = ['ON_HAND'];

const isInventory = (record) => record.__kind === 'inventory';
const isSale = (record) => record.__kind === 'sale';

const COLUMNS = [
  {
    id: 'incoming',
    title: 'Incoming',
    icon: Truck,
    blurb: 'Purchases working their way toward you.',
    empty: 'Nothing incoming right now.',
    statuses: INCOMING_STATUSES,
    includes: (record) => isInventory(record) && INCOMING_STATUSES.includes(record.receiving_status),
  },
  {
    id: 'on-hand',
    title: 'On Hand',
    icon: Package,
    blurb: 'Units you are holding, ready to list or sell.',
    empty: 'Nothing on hand right now.',
    statuses: ON_HAND_STATUSES,
    // qty_on_hand === 0 leaves the board on purpose: a fully sold batch has
    // nothing left to act on here, and the rest of those units' story is told by
    // the sales that consumed them, which are already in Outbound.
    includes: (record) => isInventory(record)
      && record.receiving_status === 'ON_HAND'
      && Number(record.qty_on_hand) > 0,
  },
  {
    id: 'outbound',
    title: 'Outbound',
    icon: Send,
    blurb: 'Sales in flight, waiting on payment, or needing attention.',
    empty: 'Nothing outbound right now.',
    // Every sale status across every workflow_type, forward path and exceptions
    // alike. Exceptions share this column (the board is exactly three columns)
    // and are flagged on the card instead of being split out.
    statuses: SALE_STATUS_ORDER,
    includes: (record) => isSale(record) && SALE_STATUS_ORDER.includes(record.workflow_status),
  },
];

const statusKeyOf = (record) => (isInventory(record) ? record.receiving_status : record.workflow_status);

// A fully sold on-hand batch is deliberately off the board, so it must not fall
// through into the "not in the workflow yet" list either.
const isSoldOutOnHand = (record) => isInventory(record)
  && record.receiving_status === 'ON_HAND'
  && !(Number(record.qty_on_hand) > 0);

const productNameOf = (record) => (isInventory(record)
  ? (record.product_name || 'Item')
  // GET /api/sales includes the linked inventory row, so the product name is
  // already on the sale -- no client-side join is needed.
  : (record.inventory?.product_name || 'Item'));

const counterpartOf = (record) => (isInventory(record)
  ? (record.vendor?.name || 'Direct')
  : (record.platform?.name || record.buyer?.name || '—'));

const units = (count) => `${count} unit${Number(count) === 1 ? '' : 's'}`;

// Sales in an exception status, and purchases that were cancelled, get the same
// red accent plus a tag. One treatment for both keeps "this one is off the happy
// path" readable at a glance anywhere on the board.
const exceptionTagOf = (record) => {
  if (isSale(record) && SALE_EXCEPTION_STATUSES.includes(record.workflow_status)) return 'Exception';
  if (isInventory(record) && record.cancelled_at) return 'Cancelled';
  return null;
};

const TAG = 'px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border';

function Tag({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'text-gray-400 border-white/10 bg-white/[0.03]',
    good: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    bad: 'text-red-300 border-red-500/40 bg-red-500/10',
  };
  return <span className={`${TAG} ${tones[tone]}`}>{children}</span>;
}

function RecordCard({ record }) {
  const statusKey = statusKeyOf(record);
  const visual = statusVisual(statusKey);
  const exception = exceptionTagOf(record);

  return (
    <li
      data-record={`${record.__kind}-${record.id}`}
      data-exception={exception ? 'true' : undefined}
      className={[
        'rounded-xl border px-3 py-3 transition-colors',
        exception
          ? 'border-red-500/40 bg-red-500/[0.06]'
          : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">{productNameOf(record)}</p>
          <p className="text-xs text-gray-500 truncate">{counterpartOf(record)}</p>
        </div>
        <span className="text-[11px] font-semibold text-right shrink-0" style={{ color: visual.color }}>
          {statusKey ? displayLabel(statusKey) : 'No status yet'}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {exception && <Tag tone="bad">{exception}</Tag>}
        {isInventory(record) ? (
          record.receiving_status === 'ON_HAND' ? (
            <>
              <Tag>{`${Number(record.qty_on_hand) || 0} of ${Number(record.qty_purchased) || 0} on hand`}</Tag>
              <Tag tone={record.is_listed ? 'good' : 'neutral'}>{record.is_listed ? 'Listed' : 'Not listed'}</Tag>
            </>
          ) : (
            <Tag>{units(Number(record.qty_purchased) || 0)}</Tag>
          )
        ) : (
          <Tag>{units(Number(record.quantity) || 0)}</Tag>
        )}
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-white/5">
        <ContextualActions record={record} kind={record.__kind} />
      </div>
    </li>
  );
}

function CardList({ records, empty }) {
  return (
    <ul className="px-3 pb-3 pt-3 space-y-2.5">
      {records.length === 0 ? (
        <li className="px-1 py-6 text-center text-xs text-gray-500">{empty}</li>
      ) : records.map((record) => (
        <RecordCard key={`${record.__kind}-${record.id}`} record={record} />
      ))}
    </ul>
  );
}

function BoardColumn({ column, records }) {
  const [activeKey, setActiveKey] = useState(null);
  const Icon = column.icon;

  // Only the statuses this column actually holds, in the registry's order.
  const statuses = useMemo(() => {
    const counts = new Map();
    for (const record of records) {
      const key = statusKeyOf(record);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return column.statuses
      .filter((key) => counts.has(key))
      .map((key) => ({ key, count: counts.get(key) }));
  }, [records, column.statuses]);

  // A tile can disappear between renders (the last record in it moved on), which
  // would otherwise leave the column stuck on an empty filter with no way back.
  const effectiveKey = activeKey && statuses.some((status) => status.key === activeKey) ? activeKey : null;
  const shown = effectiveKey ? records.filter((record) => statusKeyOf(record) === effectiveKey) : records;

  return (
    <section
      aria-label={column.title}
      className="card bg-[#0f1115] rounded-xl border border-white/6 min-w-0 flex flex-col"
    >
      <div className="px-4 py-3.5 border-b border-white/6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <Icon className="w-4 h-4 text-indigo-400" />
            {column.title}
            <span className="text-xs font-medium text-gray-500">{records.length}</span>
          </h2>
          {effectiveKey && (
            <button
              type="button"
              onClick={() => setActiveKey(null)}
              className="px-2 h-6 rounded-lg border border-white/10 text-[11px] font-medium text-gray-300 hover:bg-white/5 transition-colors"
            >
              Clear filter
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {effectiveKey ? `${displayLabel(effectiveKey)} · ${shown.length} of ${records.length}` : column.blurb}
        </p>
      </div>

      {statuses.length > 0 && (
        <div className="px-3 pt-3">
          <StatusPipeline
            statuses={statuses}
            activeKey={effectiveKey}
            onSelect={setActiveKey}
            label={`${column.title} status filters`}
            gridClassName="grid grid-cols-2 gap-2"
          />
        </div>
      )}

      <CardList
        records={shown}
        empty={effectiveKey ? 'Nothing in this status right now.' : column.empty}
      />
    </section>
  );
}

export default function Statuses() {
  const { data: inventory = [], isLoading: loadingInventory } = useInventory();
  const { data: sales = [], isLoading: loadingSales } = useSales();

  const loading = loadingInventory || loadingSales;

  const records = useMemo(() => [
    ...inventory.map((item) => ({ ...item, __kind: 'inventory' })),
    ...sales.map((sale) => ({ ...sale, __kind: 'sale' })),
  ], [inventory, sales]);

  const { byColumn, unassigned } = useMemo(() => {
    const grouped = new Map(COLUMNS.map((column) => [column.id, []]));
    const leftover = [];
    for (const record of records) {
      const column = COLUMNS.find((candidate) => candidate.includes(record));
      if (column) grouped.get(column.id).push(record);
      // Legacy rows the status-workflow backfill has not reached have no stored
      // status at all. They belong to no column, but hiding them would make them
      // unfixable, so they get a plain list under the board instead.
      else if (!isSoldOutOnHand(record)) leftover.push(record);
    }
    return { byColumn: grouped, unassigned: leftover };
  }, [records]);

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <ListChecks className="w-5 h-5 text-indigo-400" /> Statuses
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          Everything waiting on you, from purchase to payout. Act on a card and it moves to the column its new status belongs to.
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
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-5 items-start">
            {COLUMNS.map((column) => (
              <BoardColumn key={column.id} column={column} records={byColumn.get(column.id)} />
            ))}
          </div>

          {unassigned.length > 0 && (
            <section aria-label="Not in the workflow yet" className="card bg-[#0f1115] rounded-xl border border-white/6">
              <div className="px-4 py-3.5 border-b border-white/6">
                <h2 className="text-sm font-semibold text-white">
                  Not in the workflow yet
                  <span className="ml-2 text-xs font-medium text-gray-500">{unassigned.length}</span>
                </h2>
                <p className="text-xs text-gray-500 mt-1">
                  These records have no workflow status stored, so they belong to no column. Set one from the record itself.
                </p>
              </div>
              <CardList records={unassigned} empty="" />
            </section>
          )}
        </>
      )}
    </div>
  );
}
