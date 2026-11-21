import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PANEL, PANEL_TITLE, foldByType, foldTitle } from './todoMeta';
import TodoItem, { GroupIcon } from './TodoItem';

// Three or more of one kind ("Ship it" x3) as one row that opens to show each.
function FoldedItem({ row, busy, onAct, onEdit }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3.5 sm:pl-5">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 text-left">
        <GroupIcon group={row.group} urgency={row.urgency} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[var(--dp-text-primary)]">
            {foldTitle(row)} <span className="font-normal text-gray-400">({row.items.length})</span>
          </span>
          <span className="block truncate text-xs text-gray-400">{row.items.map((entry) => entry.detail.split(' · ')[0]).join(', ')}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mt-2 divide-y divide-white/[0.06] pl-12">
          {row.items.map((entry) => <TodoItem key={entry.key} entry={entry} busy={busy} onAct={onAct} onEdit={onEdit} nested />)}
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
          ? <FoldedItem key={`fold:${row.type}`} row={row} busy={busy} onAct={onAct} onEdit={onEdit} />
          : <TodoItem key={row.key} entry={row} busy={busy} onAct={onAct} onEdit={onEdit} />))}
      </ul>
    </section>
  );
}
