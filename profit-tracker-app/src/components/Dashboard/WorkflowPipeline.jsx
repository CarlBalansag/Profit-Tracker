import React, { useId, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ArrowRight } from 'lucide-react';
import CountUp from '../UI/CountUp';
import { useMatchMedia } from '../../hooks/useMatchMedia';
import { displayLabel } from '../../data/statusWorkflow';
import { formatWholeMoney } from '../../utils/money';

// Capitalised so the linter sees them used in JSX.
const MotionDiv = motion.div;
const MotionP = motion.p;

const dollars = (value) => `$${formatWholeMoney(value || 0)}`;

// One line per step, shown when a step is opened, so each step says what it holds.
const STEP_HELP = {
  PRE_ORDER: 'Ordered before release; the store has not sent it yet.',
  PURCHASED: 'Bought, not marked as shipped to you yet.',
  INBOUND: 'On its way to you.',
  ON_HAND: 'Received and unsold. Counted at what it cost you.',
  AWAITING_SHIPMENT: 'Sold and still needs to be shipped.',
  AWAITING_HANDOFF: 'Sold locally and waiting to be handed over.',
  OUTBOUND: 'Shipped and on its way to the buyer or provider.',
  HANDED_OVER: 'Handed to the buyer in person.',
  DELIVERED_TO_PROVIDER: 'Delivered to the cashout provider.',
  DELIVERED_TO_AUTHENTICATOR: 'Delivered to the marketplace for checking.',
  WAITING_FOR_SCAN_IN: 'Delivered; waiting for the provider to scan it in.',
  SCANNED_IN: 'The provider has confirmed it arrived.',
  ACCEPTED: 'The provider accepted it; payout comes next.',
  AUTHENTICATING: 'The marketplace is checking it is authentic.',
  WAITING_FOR_PAYMENT: 'Done on your side; the money has not arrived yet.',
  PAID: 'The payment or payout has arrived.',
};

const sinceLabel = (since) => {
  if (!since) return null;
  const date = new Date(since);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Smooth, quick and settling: used for steps appearing and leaving, and the
// item list opening and closing.
const EASE = [0.16, 1, 0.3, 1];

// Steps come and go in order instead of all at once: leaving steps go first,
// one after another from the right, each shrinking its width to nothing so
// the gap closes smoothly; then new steps come in one after another from the
// left, each growing to its share of the row and fading in. Steps that stay
// just resize as the others grow and shrink around them.
const STEP_MIN_WIDTH = 130;
const EXIT_STAGGER = 0.09;
const ENTER_STAGGER = 0.14;
const ENTER_AFTER_EXITS = 0.45; // when steps also left, new ones wait for them
const STEP_VARIANTS = {
  hidden: { opacity: 0, flexGrow: 0, minWidth: '0px', y: 6 },
  shown: ({ enterDelay }) => ({
    opacity: 1, flexGrow: 1, minWidth: `${STEP_MIN_WIDTH}px`, y: 0,
    transition: {
      delay: enterDelay, duration: 0.6, ease: EASE,
      // Fade in once it has some width, so its text never shows squeezed.
      opacity: { delay: enterDelay + 0.2, duration: 0.42, ease: 'easeOut' },
    },
  }),
  gone: ({ exitDelay }) => ({
    opacity: 0, flexGrow: 0, minWidth: '0px', y: -4,
    transition: {
      delay: exitDelay, duration: 0.45, ease: EASE,
      opacity: { delay: exitDelay, duration: 0.22, ease: 'easeIn' },
    },
  }),
};
const MESSAGE_MOTION = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { delay: 0.2, duration: 0.3 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

// The step row is always this tall, steps or not, so switching tabs or filters
// never changes the card's height.
const ROW_CLASS = '-mx-2 flex h-[148px] items-stretch overflow-x-auto px-2 pb-4 pt-2 dp-scrollbar';
// Phones: every step visible in two columns, no sideways scrolling or cut-off names.
const PHONE_GRID_CLASS = 'grid grid-cols-2 gap-2 pb-1';

/**
 * The dashboard's Status Pipeline as steps (All, Cash-out or Marketplace), from
 * `workflowPipelines`: each step shows how many units sit in it and the money
 * they hold. Click a step to list its most recent items; an item opens the
 * Statuses page, where it can be moved along. Steps slide in, out and along
 * when the data or the tab changes.
 */
export default function WorkflowPipeline({ pipeline, pending = false, onNavigate, hideEmpty = false }) {
  const [openStatus, setOpenStatus] = useState(null);
  const itemsId = useId();
  const isPhone = useMatchMedia('(max-width: 639px)');
  // With hideEmpty (the All tab), only the steps that have something in them,
  // so the strip fits what's actually going on; otherwise every step of the
  // workflow, 0 or not. Always in workflow order.
  const stages = (pipeline?.stages || []).filter((stage) => !hideEmpty || stage.count > 0);
  const hiddenCount = (pipeline?.stages || []).length - stages.length;
  const open = stages.find((stage) => stage.status === openStatus);

  // Which steps just arrived (to bring them in left to right) and whether any
  // left (so the new ones wait their turn). Kept from the previous render.
  const statusKey = stages.map((stage) => stage.status).join('|');
  const [shown, setShown] = useState({ key: statusKey, list: stages.map((stage) => stage.status), entering: [], anyLeft: false });
  if (shown.key !== statusKey) {
    const now = stages.map((stage) => stage.status);
    const before = new Set(shown.list);
    setShown({
      key: statusKey,
      list: now,
      entering: now.filter((status) => !before.has(status)),
      anyLeft: shown.list.some((status) => !now.includes(status)),
    });
  }
  const stepTiming = (status, index) => {
    const enterIndex = shown.entering.indexOf(status);
    return {
      enterDelay: enterIndex < 0 ? 0 : (shown.anyLeft ? ENTER_AFTER_EXITS : 0.05) + enterIndex * ENTER_STAGGER,
      exitDelay: (stages.length - 1 - index) * EXIT_STAGGER, // rightmost leaves first
    };
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Padding inside the scroll box so the cards' shadows, and their lift
          on hover, aren't cut off. */}
      <div className={isPhone ? PHONE_GRID_CLASS : ROW_CLASS} data-stagger-cards>
        <AnimatePresence initial={false}>
          {stages.length === 0 ? (
            <MotionP
              key="empty"
              {...MESSAGE_MOTION}
              className="col-span-2 flex flex-1 items-center justify-center py-6 text-[12px] text-[var(--dp-text-secondary)]"
            >
              Nothing in any step right now.
            </MotionP>
          ) : stages.map((stage, index) => {
            const active = openStatus === stage.status;
            const empty = stage.count === 0;
            return (
              // A step and the arrow before it come and go as one.
              <MotionDiv
                key={stage.status}
                custom={stepTiming(stage.status, index)}
                variants={STEP_VARIANTS}
                initial="hidden"
                animate="shown"
                exit="gone"
                style={isPhone ? undefined : { flexBasis: 0, flexShrink: 1 }}
                className="flex items-stretch"
              >
                {index > 0 && !isPhone && <ChevronRight size={14} aria-hidden="true" className="mx-0.5 flex-shrink-0 self-center text-[var(--dp-text-label)]" />}
                <button
                  type="button"
                  // Opens the item list below: announced as expanded/collapsed.
                  aria-expanded={active}
                  aria-controls={active ? itemsId : undefined}
                  onClick={() => setOpenStatus(active ? null : stage.status)}
                  // Raised and clickable like the KPI cards: card surface, their
                  // shadow, and the same hover (lift, accent tint, accent number).
                  className={`flex min-w-0 flex-1 flex-col justify-center rounded-[18px] border p-4 text-left cursor-pointer dp-elevated dp-clickable-card focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] ${
                    // Selected gets a solid ring as well, so it never looks
                    // like the hover tint.
                    active
                      ? 'border-[color:var(--dp-accent)] bg-[var(--dp-accent-bg)] ring-2 ring-[var(--dp-accent)]'
                      : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]'
                  }`}
                >
                  {/* Room for two lines, so a long step name never makes its card taller. */}
                  <span className="dp-card-title line-clamp-2 min-h-[32px] text-[11px] font-medium uppercase leading-4 tracking-[0.08em] text-[var(--dp-text-label)] transition-colors duration-300">
                    {/* Phones lose the arrows between steps, so the order is numbered. */}
                    {isPhone && <span aria-hidden="true">{index + 1}. </span>}
                    {displayLabel(stage.status)}
                  </span>
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

      {hideEmpty && hiddenCount > 0 && stages.length > 0 && (
        <p className="-mt-2 text-[12px] text-[var(--dp-text-secondary)]">
          {hiddenCount} {hiddenCount === 1 ? 'step has' : 'steps have'} nothing in {hiddenCount === 1 ? 'it' : 'them'} right now and {hiddenCount === 1 ? 'is' : 'are'} hidden.
        </p>
      )}

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
            <div id={itemsId} className="rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-bg)] p-4">
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
              {STEP_HELP[open.status] && (
                <p className="mt-1 text-[12px] text-[var(--dp-text-secondary)]">{STEP_HELP[open.status]}</p>
              )}
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
