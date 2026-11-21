import React, { useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { PANEL, PANEL_TITLE } from './todoMeta';

const until = (date) => new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

// What the user snoozed or dismissed, closed by default, with Bring back.
export default function HiddenPanel({ items, busy, onRestore }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <section aria-label="Snoozed and dismissed" className={PANEL}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className={PANEL_TITLE}>
          Snoozed and dismissed <span className="text-[12px] font-semibold tabular-nums text-gray-500">({items.length})</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="divide-y divide-white/[0.06] border-t border-white/[0.06]">
          {items.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm text-gray-200">{entry.title}</p>
                <p className="break-words text-xs text-gray-500">
                  {entry.state === 'snoozed' ? `Snoozed until ${until(entry.until)}` : 'Dismissed'} · {entry.detail}
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => onRestore(entry)} className="page-btn page-btn-secondary !h-9 shrink-0 !px-3 !text-xs">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Bring back
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
