import React from 'react';
import { AlertTriangle, HandCoins } from 'lucide-react';
import { money } from './todoMeta';

const SHOWN = 4;
const LATE_DAYS = 7;

const ageText = (days) => (days <= 0 ? 'today' : days === 1 ? '1 day' : `${days} days`);

// Money owed to the user, by who owes it (api services/todos.js
// waitingPayments): every sale that reached the buyer and isn't paid yet,
// late or not. A payer with sales owed three weeks or more gets a warning
// line: they may have stopped paying. Shared by the To-Do page and the
// Dashboard card, which pass their own text colors (`tone`).
export default function WaitingPayments({ payers, tone = {}, className = '', headingLevel = 2 }) {
  if (!payers?.length) return null;
  const strong = tone.strong || 'text-[var(--dp-text-primary)]';
  const muted = tone.muted || 'text-gray-400';
  const total = payers.reduce((sum, payer) => sum + payer.total, 0);
  const Heading = `h${headingLevel}`;
  const shown = payers.slice(0, SHOWN);
  const more = payers.length - shown.length;

  return (
    <section aria-label="Waiting on payment" className={className}>
      <div className="flex items-baseline justify-between gap-2">
        <Heading className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider ${muted}`}>
          <HandCoins size={13} aria-hidden="true" /> Waiting on payment
        </Heading>
        <span className={`text-sm font-semibold tabular-nums ${strong}`}>{money(total)}</span>
      </div>
      <ul className="mt-2 space-y-2">
        {shown.map((payer) => {
          const late = payer.oldest_days >= LATE_DAYS;
          return (
            <li key={payer.platform_id || payer.name} className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className={`block truncate text-[13px] font-medium ${strong}`}>{payer.name}</span>
                <span className={`block text-xs ${muted}`}>
                  {payer.sales} {payer.sales === 1 ? 'sale' : 'sales'} · oldest{' '}
                  <span style={late ? { color: 'var(--dp-warning-text)' } : undefined}>{ageText(payer.oldest_days)}</span>
                </span>
                {payer.overdue_sales > 0 && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--dp-red-text)' }}>
                    <AlertTriangle size={12} className="shrink-0" aria-hidden="true" />
                    {money(payer.overdue_total)} owed 3+ weeks
                  </span>
                )}
              </span>
              <span className={`shrink-0 text-[13px] font-semibold tabular-nums ${strong}`}>{money(payer.total)}</span>
            </li>
          );
        })}
      </ul>
      {more > 0 && <p className={`mt-2 text-xs ${muted}`}>and {more} more</p>}
    </section>
  );
}
