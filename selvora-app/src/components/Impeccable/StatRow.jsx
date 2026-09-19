import React from 'react';

/**
 * The Dashboard KPI strip for Impeccable: one flat row of stat values with
 * vertical dividers between them, replacing the individual StatCard grid.
 * items: [{ id, label, value, sublabel?, color? }]
 */
export function StatRow({ items }) {
  return (
    <div className="flex flex-wrap divide-x divide-[color:var(--border-default)]">
      {items.map((item) => (
        <div key={item.id} className="flex-1 min-w-[130px] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.7px] text-[var(--text-muted)] truncate">
            {item.label}
          </p>
          <p
            className="mt-1 text-[18px] font-semibold tabular-nums truncate"
            style={{ color: item.color || 'var(--text-primary)', fontFamily: "'Geist Mono', ui-monospace, monospace" }}
          >
            {item.value}
          </p>
          {item.sublabel && (
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)] truncate">{item.sublabel}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default StatRow;
