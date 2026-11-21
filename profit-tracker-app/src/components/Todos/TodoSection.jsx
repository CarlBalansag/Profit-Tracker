import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PANEL, PANEL_TITLE, foldAmount, foldByType, foldTitle, money } from './todoMeta';
import TodoItem, { GroupIcon } from './TodoItem';
import SnoozeMenu from './SnoozeMenu';

const SALE_TYPES = new Set(['ship', 'payout_late', 'not_scanned_in', 'short_paid', 'sale_delivered']);

// What a folded row sums up: for look-alikes, the shared detail and how many
// ("2 sales"); otherwise the first part of each item's detail.
function foldSummary(row) {
  if (row.alike) {
    const noun = SALE_TYPES.has(row.type) ? 'sales' : 'items';
    return `${row.items.length} ${noun} · ${row.items[0].detail}`;
  }
  return row.items.map((entry) => entry.detail.split(' · ')[0]).join(', ');
}

// Several items as one row that opens to show each. Later on the row hides
// all of them at once.
function FoldedItem({ row, busy, onAct, onEdit }) {
  const [open, setOpen] = useState(false);
  const title = foldTitle(row);
  const amount = foldAmount(row);
  const every = (action) => row.items.every((entry) => entry.actions?.includes(action));
  const canSnooze = every('snooze');
  const canDismiss = every('dismiss');
  return (
    <li className="px-4 py-3.5 sm:pl-5">
      {/* On phones the All later button drops under the title. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex min-w-0 flex-1 basis-full items-center gap-3 text-left sm:basis-0">
          <GroupIcon group={row.group} urgency={row.urgency} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-semibold text-[var(--dp-text-primary)]">
                {title} <span className="font-normal text-gray-400">({row.items.length})</span>
              </span>
              {amount != null && (
                <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-300">
                  {money(amount)}{row.type === 'aging_stock' ? ' tied up' : ''}
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-gray-400">{foldSummary(row)}</span>
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
        {(canSnooze || canDismiss) && (
          <div className="shrink-0 pl-12 sm:pl-0">
            <SnoozeMenu
              entry={{ title: `all ${row.items.length}: ${title}` }}
              label="All later"
              canSnooze={canSnooze}
              canDismiss={canDismiss}
              canHold={every('hold')}
              busy={busy}
              onAct={(_entry, action, days) => onAct(row, action, days)}
            />
          </div>
        )}
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-white/[0.06] pl-12 max-sm:pl-0">
          {row.items.map((entry) => <TodoItem key={entry.key} entry={entry} busy={busy} onAct={onAct} onEdit={onEdit} nested alike={row.alike} />)}
        </ul>
      )}
    </li>
  );
}

// One urgency's panel: "OVERDUE · 3" and its items.
export default function TodoSection({ urgency, items, busy, onAct, onEdit }) {
  return (
    <section aria-label={urgency.label} className={`${PANEL} overflow-visible`}>
      <h2 className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3 sm:px-5">
        <span className="h-2 w-2 rounded-full" style={{ background: urgency.color }} aria-hidden="true" />
        <span className={PANEL_TITLE}>{urgency.label}</span>
        <span className="text-[12px] font-semibold tabular-nums text-gray-500">{items.length}</span>
      </h2>
      <ul className="divide-y divide-white/[0.06]">
        {foldByType(items).map((row) => (row.fold
          ? <FoldedItem key={row.id} row={row} busy={busy} onAct={onAct} onEdit={onEdit} />
          : <TodoItem key={row.key} entry={row} busy={busy} onAct={onAct} onEdit={onEdit} />))}
      </ul>
    </section>
  );
}
