import React from 'react';
import { CircleCheckBig } from 'lucide-react';
import { PANEL, money } from './todoMeta';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

// What got done in the last 7 days (api services/todos.js clearedThisWeek):
// payouts that came in, sales whose status moved on, and card bills marked
// paid. Most to-dos clear by fixing the record, so this counts the records.
export default function ClearedWeek({ week }) {
  if (!week) return null;
  const rows = [
    week.payouts > 0 && { id: 'paid', label: plural(week.payouts, 'payout in', 'payouts in'), value: money(week.paid_total) },
    week.sales_moved > 0 && { id: 'moved', label: plural(week.sales_moved, 'sale moved on', 'sales moved on') },
    week.bills_paid > 0 && { id: 'bills', label: plural(week.bills_paid, 'card bill paid', 'card bills paid') },
  ].filter(Boolean);

  return (
    <section aria-label="Done this week" className={`${PANEL} px-4 py-3`}>
      <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        <CircleCheckBig size={13} aria-hidden="true" style={{ color: 'var(--dp-green-text)' }} /> Done this week
      </h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-xs text-gray-400">Nothing yet. Payouts, shipped sales and paid card bills from the last 7 days show up here.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-[var(--dp-text-primary)]">{row.label}</span>
              {row.value && <span className="shrink-0 font-semibold tabular-nums text-[var(--dp-text-primary)]">{row.value}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
