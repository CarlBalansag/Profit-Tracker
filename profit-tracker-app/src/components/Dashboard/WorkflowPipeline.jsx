import React, { useState } from 'react';
import { ChevronRight, ArrowRight } from 'lucide-react';
import CountUp from '../UI/CountUp';
import { displayLabel } from '../../data/statusWorkflow';
import { formatWholeMoney } from '../../utils/money';

const dollars = (value) => `$${formatWholeMoney(value || 0)}`;

const sinceLabel = (since) => {
  if (!since) return null;
  const date = new Date(since);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/**
 * One sale workflow's Status Pipeline (Cash-out or Marketplace), from the
 * dashboard's `workflowPipelines`: each step shows how many units sit in it and
 * the money they hold. Click a step to list its most recent items; an item opens
 * the Statuses page, where it can be moved along.
 */
export default function WorkflowPipeline({ pipeline, pending = false, onNavigate, hideEmpty = false }) {
  const [openStatus, setOpenStatus] = useState(null);
  // With hideEmpty (the All tab), only the steps that have something in them,
  // so the strip fits what's actually going on; otherwise every step of the
  // workflow, 0 or not. Always in workflow order.
  const stages = (pipeline?.stages || []).filter((stage) => !hideEmpty || stage.count > 0);
  const open = stages.find((stage) => stage.status === openStatus);

  if (stages.length === 0) {
    return <p className="py-6 text-center text-[12px] text-[var(--dp-text-secondary)]">Nothing in any step right now.</p>;
  }

  return (
    // Fills whatever height the dashboard card gives it, so the step cards
    // stretch instead of leaving a gap.
    <div className="flex h-full flex-col gap-4">
      {/* Padding inside the scroll box so the cards' shadows, and their lift
          on hover, aren't cut off. */}
      <div className="-mx-2 flex min-h-[104px] flex-1 items-stretch gap-1.5 overflow-x-auto px-2 pb-4 pt-2 dp-scrollbar">
        {stages.map((stage, index) => {
          const active = openStatus === stage.status;
          const empty = stage.count === 0;
          return (
            <React.Fragment key={stage.status}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => setOpenStatus(active ? null : stage.status)}
                // Raised and clickable like the KPI cards: card surface, their
                // shadow, and the same hover (lift, accent tint, accent number).
                className={`flex min-w-[124px] flex-1 flex-col justify-center rounded-[18px] border p-4 text-left cursor-pointer dp-elevated dp-clickable-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] ${
                  active
                    ? 'border-[color:var(--dp-accent)] bg-[var(--dp-accent-bg)]'
                    : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]'
                }`}
              >
                <span className="dp-card-title text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--dp-text-label)] transition-colors duration-300">{displayLabel(stage.status)}</span>
                <span className={`dp-card-value mt-2 text-[28px] font-bold leading-none tabular-nums transition-colors duration-300 ${empty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-primary)]'}`}>
                  <CountUp value={stage.count} pending={pending} />
                </span>
                <span className={`dp-card-subtext mt-1.5 text-[13px] font-semibold tabular-nums transition-colors duration-300 ${empty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-primary)] opacity-80'}`}>
                  <CountUp value={dollars(stage.value)} pending={pending} />
                </span>
              </button>
              {index < stages.length - 1 && <ChevronRight size={14} aria-hidden="true" className="flex-shrink-0 self-center text-[var(--dp-text-label)]" />}
            </React.Fragment>
          );
        })}
      </div>

      {open && (
        <div className="flex-none rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-bg)] p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[13px] font-semibold text-[var(--dp-text-primary)]">
              {displayLabel(open.status)}
              <span className="font-normal text-[var(--dp-text-secondary)]">
                {' '}· {open.count} {open.count === 1 ? 'unit' : 'units'} · {dollars(open.value)}
              </span>
            </p>
            {open.itemCount > open.items.length && (
              <span className="text-[11px] text-[var(--dp-text-label)]">Newest {open.items.length} of {open.itemCount}</span>
            )}
          </div>
          <div className="mt-2 divide-y divide-[color:var(--dp-border)]">
            {open.items.length === 0 && <p className="py-2 text-[12px] text-[var(--dp-text-secondary)]">Nothing in this step.</p>}
            {open.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate?.('/statuses')}
                title="Open Statuses to move this item along"
                className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left text-[13px] hover:bg-[var(--dp-hover-bg)]"
              >
                <span className="min-w-0 flex-1 truncate text-[var(--dp-text-primary)]">
                  {item.name}{item.quantity > 1 ? ` ×${item.quantity}` : ''}
                </span>
                {item.party && <span className="hidden text-[12px] text-[var(--dp-text-secondary)] sm:inline">{item.party}</span>}
                {sinceLabel(item.since) && (
                  <span className="hidden w-14 text-right text-[12px] text-[var(--dp-text-label)] md:inline">{sinceLabel(item.since)}</span>
                )}
                <span className="w-20 text-right font-semibold tabular-nums text-[var(--dp-text-primary)]">{dollars(item.value)}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onNavigate?.('/statuses')}
            className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--dp-accent)] hover:underline"
          >
            Move items along on Statuses <ArrowRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
