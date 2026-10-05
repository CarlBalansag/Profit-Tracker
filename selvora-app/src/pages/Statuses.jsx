import React, { useMemo, useState } from 'react';
import { ListChecks, Truck, Package, Send, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { useInventory, useSales } from '../hooks/useApi';
import StatusPipeline from '../components/UI/StatusPipeline';
import ContextualActions from '../components/UI/ContextualActions';
import MoreActionsMenu from '../components/UI/MoreActionsMenu';
import QuickStatusSelect from '../components/UI/QuickStatusSelect';
import {
  INVENTORY_RECEIVING_STATUSES,
  SALE_STATUS_ORDER,
  SALE_EXCEPTION_STATUSES,
  COMPLETED_AFTER_DAYS,
  displayLabel,
  formatStatusChangedAt,
  isFullyCompleted,
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
// PAID is a finished sale, not one "in flight" -- it eventually lives in the
// full-width Completed section below the board instead of Outbound, so it is
// excluded from Outbound's own status set here rather than appearing in both
// places. (The Outbound column's own `includes` below still shows a PAID sale
// for a few days after payment -- see COMPLETED_AFTER_DAYS.)
const OUTBOUND_STATUSES = SALE_STATUS_ORDER.filter((status) => status !== 'PAID');

// isFullyCompleted (imported above) gives a short window after payment
// (still visible in Outbound, tagged Paid) where a mistake is easy to catch
// and correct before the sale is filed away as finished business -- see
// data/statusWorkflow.js for the full rationale, shared with the quick
// status dropdown and the card's own label so all three agree by construction.

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
    // alike, plus PAID for its first few days (see COMPLETED_AFTER_DAYS) before
    // it moves to the Completed section below. Exceptions share this column
    // (the board is exactly three columns) and are flagged on the card instead
    // of being split out. PAID is included here (not in OUTBOUND_STATUSES
    // itself) purely so its filter tile can still appear -- membership is
    // decided by `includes`, not by this list.
    statuses: [...OUTBOUND_STATUSES, 'PAID'],
    includes: (record) => isSale(record) && (
      OUTBOUND_STATUSES.includes(record.workflow_status)
      || (record.workflow_status === 'PAID' && !isFullyCompleted(record))
    ),
  },
];

const statusKeyOf = (record) => (isInventory(record) ? record.receiving_status : record.workflow_status);

// When this record's status last changed. Null on a row created before the
// column existed, and on one whose only edits never touched its status.
const statusChangedAtOf = (record) => (isInventory(record)
  ? record.receiving_status_changed_at
  : record.workflow_status_changed_at);

// A fully sold on-hand batch is deliberately off the board, so it must not fall
// through into the "not in the workflow yet" list either.
const isSoldOutOnHand = (record) => isInventory(record)
  && record.receiving_status === 'ON_HAND'
  && !(Number(record.qty_on_hand) > 0);

const isCompletedSale = (record) => isFullyCompleted(record);

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

const PAGE_SIZE = 5;

const TAG = 'px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wide border';

function Tag({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'text-gray-400 border-white/10 bg-white/[0.03]',
    good: 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10',
    bad: 'text-red-300 border-red-500/40 bg-red-500/10',
  };
  return <span className={`${TAG} ${tones[tone]}`}>{children}</span>;
}

// `quickStatus` adds the inline status dropdown. Only the three board columns set
// it: a record under "Not in the workflow yet" has no status to change and no
// workflow to scope a list from, so it keeps its dedicated Set Status form alone.
function RecordCard({ record, quickStatus = false }) {
  const statusKey = statusKeyOf(record);
  const visual = statusVisual(statusKey);
  const exception = exceptionTagOf(record);
  const changedAt = formatStatusChangedAt(statusChangedAtOf(record));
  const hasSecondaryActions = (record.allowed_actions || []).some((entry) => entry.secondary);
  // The stored workflow_status never becomes anything but PAID -- Completed is
  // a displayed label over it (same principle as Sold Out over ON_HAND), so
  // the card's own label has to be computed the same way the board's column
  // membership is, or a fully-completed sale would still read "Paid".
  const statusLabel = isFullyCompleted(record) ? 'Completed' : (statusKey ? displayLabel(statusKey) : 'No status yet');

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
      <div className="min-w-0">
        {/* How long ago this card's status last changed, right-aligned on the
            name row. Rendered only when the record actually has a stamp -- an
            older row simply shows nothing there. */}
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-gray-100 truncate">{productNameOf(record)}</p>
          {changedAt && (
            <span data-status-changed className="text-[10px] text-gray-500 shrink-0 whitespace-nowrap">
              {changedAt}
            </span>
          )}
        </div>
        <p className="text-[11px] font-semibold" style={{ color: visual.color }}>
          {statusLabel}
        </p>
        <p className="text-xs text-gray-500 truncate">{counterpartOf(record)}</p>
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

      <div className="mt-2.5 pt-2.5 border-t border-white/5 space-y-2">
        <ContextualActions record={record} kind={record.__kind} />
        {/* The quick status dropdown and the More menu share one row so the
            dots never sit alone on their own line -- MoreActionsMenu renders
            nothing when there are no secondary actions, so this row is skipped
            entirely unless there is something in it. */}
        {(quickStatus || hasSecondaryActions) && (
          <div className="flex items-center gap-1.5">
            {quickStatus && <QuickStatusSelect record={record} kind={record.__kind} className="flex-1 min-w-0" />}
            <MoreActionsMenu record={record} kind={record.__kind} />
          </div>
        )}
      </div>
    </li>
  );
}

function CardList({ records, empty, quickStatus = false }) {
  return (
    <ul className="px-3 pb-3 pt-3 space-y-2.5">
      {records.length === 0 ? (
        <li className="px-1 py-6 text-center text-xs text-gray-500">{empty}</li>
      ) : records.map((record) => (
        <RecordCard key={`${record.__kind}-${record.id}`} record={record} quickStatus={quickStatus} />
      ))}
    </ul>
  );
}

// A column can hold far more than fits comfortably on screen, so each one pages
// independently at a fixed size rather than scrolling one long list.
function Pager({ page, pageCount, onPage }) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex items-center justify-between px-3 py-2 border-t border-white/5">
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        className="flex items-center gap-1 px-2 h-7 rounded-lg border border-white/10 text-[11px] font-medium text-gray-300 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        <ChevronLeft className="w-3.5 h-3.5" /> Previous
      </button>
      <span className="text-[11px] text-gray-500">Page {page + 1} of {pageCount}</span>
      <button
        type="button"
        disabled={page >= pageCount - 1}
        onClick={() => onPage(page + 1)}
        className="flex items-center gap-1 px-2 h-7 rounded-lg border border-white/10 text-[11px] font-medium text-gray-300 hover:bg-white/5 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
      >
        Next <ChevronRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function BoardColumn({ column, records }) {
  const [activeKey, setActiveKey] = useState(null);
  const [page, setPage] = useState(0);
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

  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  // Clamped rather than reset via an effect: if a card leaves the column (an
  // action moved it, or a filter changed) and the current page no longer
  // exists, this falls back to the new last page on the very next render
  // instead of showing a stale, out-of-range blank page.
  const currentPage = Math.min(page, pageCount - 1);
  const paged = shown.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const selectStatus = (key) => { setActiveKey(key); setPage(0); };
  const clearFilter = () => { setActiveKey(null); setPage(0); };

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
              onClick={clearFilter}
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
            onSelect={selectStatus}
            label={`${column.title} status filters`}
            gridClassName="grid grid-cols-2 gap-2"
          />
        </div>
      )}

      <CardList
        records={paged}
        empty={effectiveKey ? 'Nothing in this status right now.' : column.empty}
        quickStatus
      />
      <Pager page={currentPage} pageCount={pageCount} onPage={setPage} />
    </section>
  );
}

// A full-width log of every sale that has reached PAID -- the normal completed
// sale state. These are deliberately excluded from Outbound (see
// OUTBOUND_STATUSES above) so a finished sale doesn't linger in a column meant
// for things still in flight.
function CompletedSection({ records }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(records.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = records.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  if (records.length === 0) return null;

  return (
    <section aria-label="Completed" className="card bg-[#0f1115] rounded-xl border border-white/6">
      <div className="px-4 py-3.5 border-b border-white/6">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          Completed
          <span className="text-xs font-medium text-gray-500">{records.length}</span>
        </h2>
        <p className="text-xs text-gray-500 mt-1">Sales paid {COMPLETED_AFTER_DAYS}+ days ago, with nothing left to do.</p>
      </div>
      <CardList records={paged} empty="" quickStatus />
      <Pager page={currentPage} pageCount={pageCount} onPage={setPage} />
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

  const { byColumn, completed, unassigned } = useMemo(() => {
    const grouped = new Map(COLUMNS.map((column) => [column.id, []]));
    const completedList = [];
    const leftover = [];
    for (const record of records) {
      const column = COLUMNS.find((candidate) => candidate.includes(record));
      if (column) grouped.get(column.id).push(record);
      else if (isCompletedSale(record)) completedList.push(record);
      // Legacy rows the status-workflow backfill has not reached have no stored
      // status at all. They belong to no column, but hiding them would make them
      // unfixable, so they get a plain list under the board instead.
      else if (!isSoldOutOnHand(record)) leftover.push(record);
    }
    return { byColumn: grouped, completed: completedList, unassigned: leftover };
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

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5 items-start">
            <CompletedSection records={completed} />

            {unassigned.length > 0 && (
              <section aria-label="Not in the workflow yet" className="card bg-[#0f1115] rounded-xl border border-white/6">
                <div className="px-4 py-3.5 border-b border-white/6">
                  <h2 className="text-sm font-semibold text-white">
                    Not in the workflow yet
                    <span className="ml-2 text-xs font-medium text-gray-500">{unassigned.length}</span>
                  </h2>
                  <p className="text-xs text-gray-500 mt-1">
                    These records have no workflow status stored, so they belong to no column. Set one on the card and the record joins the board.
                  </p>
                </div>
                <CardList records={unassigned} empty="" />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
