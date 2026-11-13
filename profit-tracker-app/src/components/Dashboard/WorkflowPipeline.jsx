import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ArrowRight } from 'lucide-react';
import CountUp from '../UI/CountUp';
import { displayLabel } from '../../data/statusWorkflow';
import { formatWholeMoney } from '../../utils/money';

// Capitalised so the linter sees them used in JSX.
const MotionDiv = motion.div;
const MotionP = motion.p;

const dollars = (value) => `$${formatWholeMoney(value || 0)}`;

const sinceLabel = (since) => {
  if (!since) return null;
  const date = new Date(since);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Smooth, quick and settling: used for steps moving, appearing and leaving,
// and the item list opening and closing.
const EASE = [0.16, 1, 0.3, 1];
const STEP_MOTION = {
  layout: 'position',
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.96 },
  transition: { duration: 0.35, ease: EASE },
};

// The step row is always this tall, steps or not, so switching tabs or filters
// never changes the card's height.
const ROW_CLASS = '-mx-2 flex h-[148px] items-stretch overflow-x-auto px-2 pb-4 pt-2 dp-scrollbar';

/**
 * The dashboard's Status Pipeline as steps (All, Cash-out or Marketplace), from
 * `workflowPipelines`: each step shows how many units sit in it and the money
 * they hold. Click a step to list its most recent items; an item opens the
 * Statuses page, where it can be moved along. Steps slide in, out and along
 * when the data or the tab changes.
 */
export default function WorkflowPipeline({ pipeline, pending = false, onNavigate, hideEmpty = false }) {
  const [openStatus, setOpenStatus] = useState(null);
  // With hideEmpty (the All tab), only the steps that have something in them,
  // so the strip fits what's actually going on; otherwise every step of the
  // workflow, 0 or not. Always in workflow order.
  const stages = (pipeline?.stages || []).filter((stage) => !hideEmpty || stage.count > 0);
  const open = stages.find((stage) => stage.status === openStatus);

  return (
    <div className="flex flex-col gap-4">
      {/* Padding inside the scroll box so the cards' shadows, and their lift
          on hover, aren't cut off. */}
      <div className={ROW_CLASS}>
        <AnimatePresence initial={false} mode="popLayout">
          {stages.length === 0 ? (
            <MotionP
              key="empty"
              {...STEP_MOTION}
              className="flex flex-1 items-center justify-center text-[12px] text-[var(--dp-text-secondary)]"
            >
              Nothing in any step right now.
            </MotionP>
          ) : stages.map((stage, index) => {
            const active = openStatus === stage.status;
            const empty = stage.count === 0;
            return (
              // A step and the arrow before it move as one.
              <MotionDiv key={stage.status} {...STEP_MOTION} className="flex min-w-[130px] flex-1 items-stretch">
                {index > 0 && <ChevronRight size={14} aria-hidden="true" className="mx-0.5 flex-shrink-0 self-center text-[var(--dp-text-label)]" />}
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => setOpenStatus(active ? null : stage.status)}
                  // Raised and clickable like the KPI cards: card surface, their
                  // shadow, and the same hover (lift, accent tint, accent number).
                  className={`flex min-w-0 flex-1 flex-col justify-center rounded-[18px] border p-4 text-left cursor-pointer dp-elevated dp-clickable-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] ${
                    active
                      ? 'border-[color:var(--dp-accent)] bg-[var(--dp-accent-bg)]'
                      : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]'
                  }`}
                >
                  {/* Room for two lines, so a long step name never makes its card taller. */}
                  <span className="dp-card-title line-clamp-2 min-h-[32px] text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-[var(--dp-text-label)] transition-colors duration-300">{displayLabel(stage.status)}</span>
                  <span className={`dp-card-value mt-1.5 text-[28px] font-bold leading-none tabular-nums transition-colors duration-300 ${empty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-primary)]'}`}>
                    <CountUp value={stage.count} pending={pending} />
                  </span>
                  <span className={`dp-card-subtext mt-1.5 text-[13px] font-semibold tabular-nums transition-colors duration-300 ${empty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-primary)] opacity-80'}`}>
                    <CountUp value={dollars(stage.value)} pending={pending} />
                  </span>
                </button>
              </MotionDiv>
            );
          })}
        </AnimatePresence>
      </div>

      {/* The item list opens and closes by growing and shrinking, not a jump. */}
      <AnimatePresence initial={false}>
        {open && (
          <MotionDiv
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-bg)] p-4">
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
          </MotionDiv>
        )}
      </AnimatePresence>
    </div>
  );
}
