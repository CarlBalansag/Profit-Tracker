import React from 'react';
import { URGENCIES } from './todoMeta';

// The four urgency tiles across the top. Each is a filter: tap one to show
// only that urgency, tap it again for everything.
export default function TodoStats({ items, active, onPick }) {
  return (
    <div role="group" aria-label="Filter by urgency" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {URGENCIES.map(({ id, label, caption, icon, color, bg }) => {
        const Icon = icon;
        const count = items.filter((entry) => entry.urgency === id).length;
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(selected ? null : id)}
            className={`dp-clickable-card relative min-w-0 rounded-xl border border-white/10 bg-[#12121A] p-3 text-left sm:p-4 transition-all ${selected ? 'dp-card-selected' : ''} ${count === 0 ? 'opacity-60' : ''}`}
          >
            <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-lg sm:right-3 sm:top-3 sm:h-7 sm:w-7" style={{ background: bg }}>
              <Icon size={14} style={{ color }} aria-hidden="true" />
            </span>
            <span className="block truncate pr-8 text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:pr-9">{label}</span>
            <span className="mt-1 block text-xl font-bold tabular-nums sm:mt-2 sm:text-2xl" style={{ color: count ? color : undefined }}>{count}</span>
            <span className="mt-0.5 hidden truncate text-[11px] text-gray-500 sm:block">{caption}</span>
          </button>
        );
      })}
    </div>
  );
}
