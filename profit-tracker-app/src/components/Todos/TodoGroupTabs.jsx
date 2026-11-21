import React from 'react';
import { GROUPS } from './todoMeta';

// All / Reminders / Cash-outs / ... with counts, the same pill control as the
// Dashboard's mode filter. Groups with nothing in them are left out. Scrolls
// sideways on a phone instead of wrapping.
export default function TodoGroupTabs({ items, active, onPick }) {
  const tabs = [{ id: 'all', label: 'All' }, ...GROUPS]
    .map((group) => ({ ...group, count: group.id === 'all' ? items.length : items.filter((entry) => entry.group === group.id).length }))
    .filter((group) => group.id === 'all' || group.count > 0);

  return (
    <div
      role="group"
      aria-label="Show"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 dp-no-native-scrollbar max-sm:[mask-image:linear-gradient(90deg,transparent_0,#000_16px,#000_calc(100%-24px),transparent_100%)]"
    >
      <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#12121A] p-1">
        {tabs.map(({ id, label, count, icon }) => {
          const Icon = icon;
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(id)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                selected ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-gray-400 hover:text-white'
              }`}
            >
              {Icon && <Icon size={13} aria-hidden="true" />}
              {label}
              <span className={`tabular-nums ${selected ? '' : 'text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
