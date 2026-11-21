import React from 'react';
import { Boxes, HandCoins, Truck } from 'lucide-react';
import { PANEL, money } from './todoMeta';

// The money behind the list, by kind, so the expensive problems stand out:
// payouts still out, sales waiting to ship, stock sitting unlisted. Matches
// the Sunday weekly review notification (api services/notificationRun.js).
const KINDS = [
  { id: 'payouts', label: 'in late payouts', icon: HandCoins, types: ['payout_late', 'short_paid'], color: 'var(--dp-red-text)' },
  { id: 'ship', label: 'waiting to ship', icon: Truck, types: ['ship', 'send_tracking', 'commit_pending'], color: 'var(--dp-info-text)' },
  { id: 'stock', label: 'in unlisted stock', icon: Boxes, types: ['aging_stock'], color: 'var(--dp-text-label)' },
];

export default function MoneyWaiting({ items }) {
  const totals = KINDS.map((kind) => {
    const matching = items.filter((entry) => kind.types.includes(entry.type) && entry.amount != null);
    return { ...kind, count: matching.length, total: matching.reduce((sum, entry) => sum + entry.amount, 0) };
  }).filter((kind) => kind.total > 0);
  if (!totals.length) return null;

  return (
    <section aria-label="Money waiting" className={`${PANEL} flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3`}>
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Money waiting</h2>
      {totals.map(({ id, label, icon, total, count, color }) => {
        const Icon = icon;
        return (
          <p key={id} className="flex items-center gap-2 text-sm">
            <Icon size={15} style={{ color }} aria-hidden="true" />
            <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(total)}</span>
            <span className="text-gray-400">{label}</span>
            <span className="text-xs text-gray-500">({count})</span>
          </p>
        );
      })}
    </section>
  );
}
