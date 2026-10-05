import React, { useMemo, useState } from 'react';
import { ListChecks, Truck, Package, Send, CheckCircle2, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useInventory, useSales, useInvalidate, apiFetch } from '../hooks/useApi';
import useRecordActions from '../hooks/useRecordActions';
import StatusPipeline from '../components/UI/StatusPipeline';
import ContextualActions from '../components/UI/ContextualActions';
import MoreActionsMenu from '../components/UI/MoreActionsMenu';
import QuickStatusSelect from '../components/UI/QuickStatusSelect';
import { detectCarrier } from '../utils/carrier';
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
    // Records here are in transit, so several of them can be one physical
    // package -- see groupByTracking below. On Hand is not in transit (nothing
    // there is waiting on a carrier), so it deliberately does not group.
    group: true,
    // qty_on_hand === 0 leaves the board on purpose, same as On Hand below: a
    // purchase that sold out before ever being marked received (recorded via
    // the Transactions page, not the board's own Record Sale, which only
    // offers selling from On Hand) has nothing left to act on here either --
    // its story is told by the sale(s) that consumed it, already visible in
    // Outbound/Completed. Without this, a fully-sold purchase would sit here
    // forever showing stale "units to receive" actions for stock that no
    // longer exists.
    includes: (record) => isInventory(record)
      && INCOMING_STATUSES.includes(record.receiving_status)
      && Number(record.qty_on_hand) > 0,
  },
  {
    id: 'on-hand',
    title: 'On Hand',
    icon: Package,
    blurb: 'Units you are holding, ready to list or sell.',
    empty: 'Nothing on hand right now.',
    statuses: ON_HAND_STATUSES,
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
    // Same package rule as Incoming: sales shipped together under one tracking
    // number collapse into one card.
    group: true,
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

// purchase_date / sale_date -- required fields, set at creation, so every
// record has one. Used for sorting instead of statusChangedAtOf (the "X ago"
// text on the card): that field is only populated going forward from when it
// was added, so most existing records have none yet and a sort by it has
// nothing to reorder. This one works for every record immediately.
const transactionDateOf = (record) => (isInventory(record) ? record.purchase_date : record.sale_date);

// A record with no date (malformed data; never expected for a required field)
// always sorts last regardless of direction, rather than being placed
// arbitrarily by a NaN comparison.
const sortByDate = (records, direction) => {
  const withTime = records.map((record) => {
    const raw = transactionDateOf(record);
    const time = raw ? new Date(raw).getTime() : NaN;
    return { record, time: Number.isNaN(time) ? null : time };
  });
  withTime.sort((a, b) => {
    if (a.time === null && b.time === null) return 0;
    if (a.time === null) return 1;
    if (b.time === null) return -1;
    return direction === 'oldest' ? a.time - b.time : b.time - a.time;
  });
  return withTime.map((entry) => entry.record);
};

// ─── Tracking-number groups ──────────────────────────────────────────────────
// Several records can be one physical package: a vendor ships three purchases
// under one label, or three sales go out in one box. pages/Shipping.jsx already
// collapses those into a single row with one Check Status button; this is the
// same idea (and deliberately the same function name) for the board's cards,
// operating on board record objects instead of that page's flattened rows.
//
// Returns an array of groups, each an array of 1+ records -- one "visual unit".
//
// Only a *truthy* tracking_number groups. Two records that merely both lack a
// number are not the same package, so each stays its own group of 1 and renders
// exactly as an ungrouped card always has.
//
// The match is the exact stored string, deliberately not a trimmed or
// case-folded one: the server's shared refresh (refreshSharedTracking) matches
// the number exactly too, so a looser match here would collapse rows that one
// carrier check would then *not* all update.
//
// SORT POSITION. Called on the column's already-sorted records, so each group
// lands where its first sorted member sits: under "Newest" that is the group's
// most recent member, under "Oldest" its oldest. A group's sort key is therefore
// always the member the chosen direction actually asks about -- a package is as
// new as its newest item and as old as its oldest -- rather than one fixed end
// that would bury a group's oldest member behind a newer sibling's date when
// sorting oldest-first. Deterministic either way, and members keep the column's
// sort order inside the group too.
const groupByTracking = (records) => {
  const groups = [];
  const byNumber = new Map();
  for (const record of records) {
    const key = record.tracking_number || null;
    if (!key) { groups.push([record]); continue; }
    const existing = byNumber.get(key);
    if (existing) { existing.push(record); continue; }
    const group = [record];
    byNumber.set(key, group);
    groups.push(group);
  }
  return groups;
};

// The ungrouped shape: every record as its own visual unit, for the lists that
// never group (On Hand, Completed, and the no-status leftovers).
const asUnits = (records) => records.map((record) => [record]);

// A fully sold purchase -- whether it sold out after arriving (ON_HAND) or
// before (any other receiving status, sold via the Transactions page) -- is
// deliberately off the board, so it must not fall through into the "not in
// the workflow yet" list either.
const isSoldOutInventory = (record) => isInventory(record) && !(Number(record.qty_on_hand) > 0);

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

// The unit count a card shows for this record: a purchase's whole batch, a
// sale's quantity. Used to total a tracking-number group's combined units.
const unitCountOf = (record) => Number(isInventory(record) ? record.qty_purchased : record.quantity) || 0;

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

// ─── The card's tracking number, correctable in place ────────────────────────
// `kind` -> REST collection, for the plain record PUT below (the same mapping
// hooks/useRecordActions.js uses for the action endpoints).
const RECORD_PATH = { inventory: '/api/inventory', sale: '/api/sales' };

// The board never used to show a tracking number on a single card at all -- its
// presence was only implied by the `check_tracking` action being offered. Offering
// an edit affordance over an invisible value would be meaningless, so the number
// itself is now displayed, with the same carrier chip + monospace treatment
// GroupedRecordCard's collapsed header already uses for a shared number. The two
// therefore read identically, and an expanded group's members simply each show
// their own copy of the number they share.
//
// Rendered only when the record already HAS a number: putting a first one on is
// the `add_tracking` / `add_outbound_tracking` action's job, offered through
// ContextualActions and unchanged by this.
//
// The write is the ordinary PUT /api/{inventory,sales}/:id -- not an action
// endpoint. Both routes accept `tracking_number` and exempt *replacing* an
// existing value from the add-tracking status gate on purpose, so correcting a
// number stays possible at any point in the record's life and needs no new
// backend support. pages/Shipping.jsx saves through exactly the same call.
//
// Following QuickStatusSelect's rule rather than inventing a modal: an explicit
// apply press writes, never a raw input change, and the caches invalidated are
// the same three every other action on this board refreshes.
function TrackingNumberRow({ record }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(record.tracking_number || '');
  const [saving, setSaving] = useState(false);
  const invalidate = useInvalidate();

  const chip = detectCarrier(record.tracking_number);

  const startEdit = () => { setValue(record.tracking_number || ''); setEditing(true); };
  // Dismissing throws the draft away -- the card goes straight back to showing the
  // stored number, with nothing sent.
  const cancelEdit = () => { setValue(record.tracking_number || ''); setEditing(false); };

  const save = async () => {
    const next = value.trim();
    // An empty value is not a removal: clearing tracking entirely is a separate,
    // unbuilt feature, so this only ever swaps one number for another.
    if (!next || saving) return;
    setSaving(true);
    try {
      const response = await apiFetch(`${RECORD_PATH[record.__kind]}/${record.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: next }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || body.message || `Request failed (${response.status})`);
      }
      invalidate.inventory();
      invalidate.sales();
      invalidate.dashboard();
      toast.success('Tracking number updated.');
      setEditing(false);
    } catch (err) {
      // The typed value is deliberately kept so the apply press can simply be
      // repeated, same as QuickStatusSelect does on a failed status change.
      toast.error(`Could not update the tracking number: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (!record.tracking_number) return null;

  if (editing) {
    return (
      <div className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          aria-label="Tracking number"
          value={value}
          disabled={saving}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter tracking number…"
          className="min-w-0 flex-1 h-7 rounded-lg bg-[#0d0d18] border border-white/10 px-2 text-xs text-gray-200 font-mono focus:outline-none focus:border-indigo-500/50 disabled:opacity-50 transition-colors"
        />
        <button
          type="button"
          aria-label="Save tracking number"
          title="Save tracking number"
          disabled={saving || !value.trim()}
          onClick={save}
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          aria-label="Cancel tracking number edit"
          title="Cancel"
          disabled={saving}
          onClick={cancelEdit}
          className="flex items-center justify-center w-7 h-7 shrink-0 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-50 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {chip && (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${chip.color}`}>
          {chip.label}
        </span>
      )}
      <span className="text-xs text-gray-400 font-mono break-all">{record.tracking_number}</span>
      <button
        type="button"
        aria-label="Edit tracking number"
        title="Edit tracking number"
        onClick={startEdit}
        className="flex items-center justify-center w-5 h-5 shrink-0 rounded text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </div>
  );
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

      {/* Its own row under the tags, not squeezed in beside them: a tracking number
          is long enough to wrap, and the edit control needs to stay next to it. */}
      <TrackingNumberRow record={record} />

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

// ─── One collapsed card for a tracking-number group ──────────────────────────
// Shows only what the whole package shares -- product (or "N items" when they
// differ), combined units, the tracking number with its carrier chip -- plus one
// Check Tracking button and a chevron. Expanding reveals each member as a normal
// RecordCard, with its own full ContextualActions / MoreActionsMenu /
// QuickStatusSelect: nothing about an individual record changes by being in a
// group, only the collapsed summary above it is new.
//
// THE ONE CHECK. The button runs the ordinary per-record `check_tracking` action
// (the same descriptor path ContextualActions uses on a single card) for ONE
// representative member. The server's /track route does a single carrier lookup
// and applies the result to every purchase and sale of this user sharing that
// exact number -- refreshSharedTracking in selvora-api/services/tracking.js --
// and useRecordActions already invalidates the inventory/sales/dashboard caches,
// so the other members pick up the same tracking_info on the refetch. Firing one
// request per member would be the same carrier answer bought several times over.
function GroupedRecordCard({ records, quickStatus = false }) {
  const [expanded, setExpanded] = useState(false);
  const first = records[0];
  const chip = detectCarrier(first.tracking_number);
  const combinedUnits = records.reduce((sum, record) => sum + unitCountOf(record), 0);
  const productNames = new Set(records.map(productNameOf));
  const title = productNames.size === 1 ? productNameOf(first) : `${records.length} items`;
  // An exception inside a collapsed group would otherwise be invisible until the
  // group is opened, so the header carries the same accent and tag a single card
  // would -- it is the reason to open it. The first member's tag wins ("Exception"
  // for a sale, "Cancelled" for a purchase); the members themselves each still
  // carry their own once expanded.
  const exception = records.map((record) => exceptionTagOf(record)).find(Boolean) || null;

  // The check runs against the first member that actually offers the action: a
  // PRE_ORDER purchase sharing the number has no check_tracking of its own, so
  // it cannot represent the group. No member offering it means no button.
  const representative = records.find((record) => (record.allowed_actions || [])
    .some((entry) => entry.action === 'check_tracking')) || null;
  const descriptor = (representative?.allowed_actions || [])
    .find((entry) => entry.action === 'check_tracking');
  const { runAction, pendingAction } = useRecordActions({
    kind: representative?.__kind,
    record: representative,
  });
  const checking = pendingAction === 'check_tracking';

  return (
    <li
      data-group={first.tracking_number}
      data-exception={exception ? 'true' : undefined}
      className={[
        'rounded-xl border transition-colors',
        exception
          ? 'border-red-500/40 bg-red-500/[0.06]'
          : 'border-white/[0.08] bg-white/[0.02]',
      ].join(' ')}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="w-full text-left px-3 pt-3 pb-2 flex items-start gap-2 hover:bg-white/[0.03] rounded-t-xl transition-colors"
      >
        <ChevronRight
          className={`w-3.5 h-3.5 mt-0.5 text-gray-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-100 truncate">{title}</p>
          <p className="text-[11px] text-gray-500">
            {`${records.length} records · ${units(combinedUnits)} combined`}
          </p>
        </div>
      </button>

      <div className="px-3 pb-3 space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {exception && <Tag tone="bad">{exception}</Tag>}
          {chip && (
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider border ${chip.color}`}>
              {chip.label}
            </span>
          )}
          <span className="text-xs text-gray-400 font-mono break-all">{first.tracking_number}</span>
        </div>

        {descriptor && (
          <button
            type="button"
            disabled={checking}
            onClick={() => runAction('check_tracking', {}, descriptor)}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            {checking ? 'Checking…' : descriptor.label}
          </button>
        )}
      </div>

      {/* Each member is the exact same RecordCard an ungrouped record gets --
          same actions, same quick status dropdown, same More menu -- only
          nested and indented under the summary above. */}
      {expanded && (
        <ul className="pl-5 pr-3 pb-3 pt-3 space-y-2.5 border-t border-white/5">
          {records.map((record) => (
            <RecordCard key={`${record.__kind}-${record.id}`} record={record} quickStatus={quickStatus} />
          ))}
        </ul>
      )}
    </li>
  );
}

// Each entry in `units` is one visual unit: a lone record, or 2+ records sharing
// a tracking number. A unit of 1 renders exactly as every card always has, so
// the lists that never group simply pass asUnits(records).
function CardList({ units: visualUnits, empty, quickStatus = false }) {
  return (
    <ul className="px-3 pb-3 pt-3 space-y-2.5">
      {visualUnits.length === 0 ? (
        <li className="px-1 py-6 text-center text-xs text-gray-500">{empty}</li>
      ) : visualUnits.map((unit) => (unit.length === 1
        ? (
          <RecordCard
            key={`${unit[0].__kind}-${unit[0].id}`}
            record={unit[0]}
            quickStatus={quickStatus}
          />
        ) : (
          <GroupedRecordCard
            key={`group-${unit[0].__kind}-${unit[0].tracking_number}`}
            records={unit}
            quickStatus={quickStatus}
          />
        )))}
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

// Toggles which end of sortByDate a column reads from -- one button,
// not a two-option picker, since there are only ever two directions.
function SortToggle({ direction, onToggle }) {
  const next = direction === 'newest' ? 'oldest' : 'newest';
  return (
    <button
      type="button"
      onClick={() => onToggle(next)}
      title={`Showing ${direction} first. Switch to ${next} first.`}
      className="flex items-center gap-1 px-2 h-6 rounded-lg border border-white/10 text-[11px] font-medium text-gray-300 hover:bg-white/5 transition-colors shrink-0"
    >
      <ArrowUpDown className="w-3 h-3" />
      {direction === 'newest' ? 'Newest' : 'Oldest'}
    </button>
  );
}

function BoardColumn({ column, records }) {
  const [activeKey, setActiveKey] = useState(null);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState('newest');
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
  const filtered = effectiveKey ? records.filter((record) => statusKeyOf(record) === effectiveKey) : records;
  const shown = useMemo(() => sortByDate(filtered, sort), [filtered, sort]);

  // filter -> sort -> GROUP -> page. Grouping before paging is what keeps a
  // tracking-number group whole: the page size counts visual units, so a
  // 7-record package fills one of the page's 5 slots exactly as a single card
  // would, instead of spilling its last members onto the next page.
  const visualUnits = useMemo(
    () => (column.group ? groupByTracking(shown) : asUnits(shown)),
    [shown, column.group],
  );

  const pageCount = Math.max(1, Math.ceil(visualUnits.length / PAGE_SIZE));
  // Clamped rather than reset via an effect: if a card leaves the column (an
  // action moved it, or a filter changed) and the current page no longer
  // exists, this falls back to the new last page on the very next render
  // instead of showing a stale, out-of-range blank page.
  const currentPage = Math.min(page, pageCount - 1);
  const paged = visualUnits.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  const selectStatus = (key) => { setActiveKey(key); setPage(0); };
  const clearFilter = () => { setActiveKey(null); setPage(0); };
  const changeSort = (next) => { setSort(next); setPage(0); };

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
          <div className="flex items-center gap-1.5 shrink-0">
            <SortToggle direction={sort} onToggle={changeSort} />
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
        units={paged}
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
  const [sort, setSort] = useState('newest');
  const sorted = useMemo(() => sortByDate(records, sort), [records, sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const paged = sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const changeSort = (next) => { setSort(next); setPage(0); };

  if (records.length === 0) return null;

  return (
    <section aria-label="Completed" className="card bg-[#0f1115] rounded-xl border border-white/6">
      <div className="px-4 py-3.5 border-b border-white/6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            Completed
            <span className="text-xs font-medium text-gray-500">{records.length}</span>
          </h2>
          <SortToggle direction={sort} onToggle={changeSort} />
        </div>
        <p className="text-xs text-gray-500 mt-1">Sales paid {COMPLETED_AFTER_DAYS}+ days ago, with nothing left to do.</p>
      </div>
      {/* Completed is not "in transit", so it never groups by tracking number --
          every record stays its own card. */}
      <CardList units={asUnits(paged)} empty="" quickStatus />
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
      else if (!isSoldOutInventory(record)) leftover.push(record);
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
                <CardList units={asUnits(unassigned)} empty="" />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
