import React, { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, ListChecks, X } from 'lucide-react';
import { useTodos } from '../../hooks/useApi';
import useTodoActions from '../../hooks/useTodoActions';
import { openTodoLink } from '../../utils/todoLink';
import { GroupIcon } from '../Todos/TodoItem';
import EmailAttentionModal from '../Todos/EmailAttentionModal';
import WaitingPayments from '../Todos/WaitingPayments';
import { URGENCIES, money } from '../Todos/todoMeta';

const ROWS = 4;
const MotionLi = motion.li;
const EASE = [0.16, 1, 0.3, 1];

// The most urgent to-dos as rows, with repeats of the same thing ("Add
// tracking to commit" x3) folded into one row that names each.
function topRows(items) {
  const rows = [];
  const byId = new Map();
  for (const entry of items) {
    const id = `${entry.type}|${entry.title}`;
    let row = byId.get(id);
    if (!row) {
      if (rows.length === ROWS) continue;
      row = { id, entries: [] };
      byId.set(id, row);
      rows.push(row);
    }
    row.entries.push(entry);
  }
  return rows.map(({ id, entries }) => {
    const [first] = entries;
    const amounts = entries.map((entry) => entry.amount).filter((value) => value != null);
    return {
      id,
      first,
      entries,
      count: entries.length,
      detail: entries.length === 1 ? first.detail : entries.map((entry) => entry.detail.split(' · ')[0]).join(', '),
      amount: amounts.length ? amounts.reduce((sum, value) => sum + value, 0) : null,
    };
  });
}

// What a row's amount is, so it isn't mistaken for profit or for the
// pipeline's totals.
const AMOUNT_LABELS = {
  sales: 'sale value',
  cashout: 'sale value',
  purchases: 'at cost',
  cards: 'due',
  bookkeeping: 'due',
  reminders: 'amount',
};

// How a to-do is marked complete from the row, when it can be: the reminder is
// done, the card bill is paid, the store's email is dealt with. Everything else
// clears once its record is fixed.
const COMPLETE = [['complete', 'complete', 'Done'], ['handled', 'handled', 'Done'], ['mark_paid', 'done', 'Mark paid']];

// Done and Dismiss on a row: words on phones and wide screens, icons in between.
function RowActions({ row, busy, onAct, muted }) {
  const { first, entries, count } = row;
  const complete = count === 1 && COMPLETE.find(([has]) => first.actions?.includes(has));
  const canDismiss = entries.every((entry) => entry.actions?.includes('dismiss'));
  if (!complete && !canDismiss) return null;
  // Icons beside the row below xl (phones included), so Dismiss stays a small
  // secondary target instead of a full button under every to-do.
  const button = `page-btn page-btn-secondary !h-8 !px-2.5 !text-xs max-xl:!w-8 max-xl:!px-0 max-xl:pointer-coarse:!w-11 ${muted}`;
  const word = 'max-xl:hidden';
  return (
    <div className="flex shrink-0 items-center gap-2">
      {complete && (
        <button type="button" disabled={busy} onClick={() => onAct(first, complete[1])} className={button}>
          <Check className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true" className={word}>{complete[2]}</span>
          <span className="sr-only">{complete[2]}: {first.title}</span>
        </button>
      )}
      {canDismiss && (
        <button type="button" disabled={busy} onClick={() => onAct(count > 1 ? { fold: true, items: entries } : first, 'dismiss')} className={button}>
          <X className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true" className={word}>{count > 1 ? 'Dismiss all' : 'Dismiss'}</span>
          <span className="sr-only">{count > 1 ? `Dismiss all ${count}` : 'Dismiss'}: {first.title}</span>
        </button>
      )}
    </div>
  );
}

// The Dashboard's "Needs attention" card: urgency counts, the most urgent
// few to-dos, and who owes the user money. Renders nothing when there's
// nothing to show or it's still loading.
export default function TodoSummary({ isGlass = false }) {
  const { data } = useTodos();
  const items = data?.items ?? [];
  const payers = data?.waiting_payments ?? [];
  if (!items.length && !payers.length) return null;
  return <SummaryCard items={items} payers={payers} isGlass={isGlass} />;
}

function SummaryCard({ items, payers, isGlass }) {
  const navigate = useNavigate();
  const { act, busy } = useTodoActions();
  const reduceMotion = useReducedMotion();
  // Done/Dismiss folds the row away and the next one slides up into its
  // place (Undo slides it back). With reduced motion rows only fade.
  const rowMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.15 } }
    : {
      initial: { opacity: 0, height: 0, overflow: 'hidden' },
      animate: { opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } },
      exit: { opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.2, ease: 'easeIn' } },
      transition: { duration: 0.28, ease: EASE },
    };
  // The email to-do whose window is open; it closes when the item clears.
  const [reviewingKey, setReviewingKey] = useState(null);
  const reviewing = items.find((entry) => entry.key === reviewingKey && entry.email_attention);

  const card = isGlass
    ? 'rounded-[24px] border border-white/[0.06] bg-[#181a1c]/78 p-4 sm:p-5 text-[#e8e2d6]'
    : 'rounded-[24px] bg-[var(--dp-card-bg)] dp-elevated p-4 sm:p-5';
  const muted = isGlass ? 'text-white/45' : 'text-[var(--dp-text-secondary)]';
  const strong = isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]';
  const accent = isGlass ? 'text-[#d8a65a]' : 'text-[var(--dp-accent-text)]';
  const hover = isGlass ? 'hover:bg-white/[0.04]' : 'hover:bg-[var(--dp-hover-bg)]';
  const line = isGlass ? 'border-white/[0.06]' : 'border-[color:var(--dp-border)]';
  const counts = URGENCIES
    .map((urgency) => ({ ...urgency, count: items.filter((entry) => entry.urgency === urgency.id).length }))
    .filter((urgency) => urgency.count > 0 && urgency.id !== 'info');
  const rows = topRows(items);

  // A store's cancellation, refund or check email opens its own window; one to
  // answer (link it? add it?) opens the list, which has its buttons.
  const open = (row) => {
    if (row.count === 1 && row.first.email_attention) setReviewingKey(row.first.key);
    else if (row.count === 1 && row.first.link && !row.first.email_match && !row.first.email_order) openTodoLink(navigate, row.first.link);
    else navigate('/todos');
  };

  return (
    <section aria-label="Needs attention" className={card}>
      {/* Title and View all share the top line; the urgency pills sit beside
          the title when there's room, or under it on a phone. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
            <ListChecks className={`h-4 w-4 ${accent}`} aria-hidden="true" />
            Needs attention
            <span className={`text-xs font-medium tabular-nums ${muted}`}>{items.length}</span>
          </h2>
          {counts.length > 0 && (
            <ul aria-label="By urgency" className="flex flex-wrap gap-1.5">
              {counts.map((urgency) => (
                <li
                  key={urgency.id}
                  className="rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ background: urgency.bg, color: urgency.color }}
                >
                  {urgency.count} {urgency.label.toLowerCase()}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Link to="/todos" className={`-my-3 flex min-h-[44px] shrink-0 items-center gap-0.5 whitespace-nowrap text-xs font-medium sm:my-0 sm:min-h-0 ${accent}`}>
          View all <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className={`mt-3 grid gap-4 ${payers.length && rows.length ? 'lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-6' : ''}`}>
        {rows.length > 0 && (
          <ul className={`min-w-0 divide-y ${isGlass ? 'divide-white/[0.06]' : 'divide-[color:var(--dp-border)]'}`}>
            <AnimatePresence initial={false}>
            {rows.map((row) => (
              <MotionLi key={row.id} {...rowMotion} className="flex items-center gap-2 sm:gap-3">
                <button
                  type="button"
                  onClick={() => open(row)}
                  className={`-ml-2 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors ${hover}`}
                >
                  <GroupIcon group={row.first.group} urgency={row.first.urgency} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13px] font-medium ${strong}`}>
                      {row.first.title}
                      {row.count > 1 && <span className={`ml-1.5 font-normal ${muted}`}>×{row.count}</span>}
                    </span>
                    <span className={`block truncate text-xs ${muted}`}>{row.detail}</span>
                  </span>
                  {row.amount != null && (
                    <span className="shrink-0 text-right">
                      <span className={`block text-[13px] font-semibold tabular-nums ${strong}`}>{money(row.amount)}</span>
                      {AMOUNT_LABELS[row.first.group] && (
                        <span className={`block text-[12px] ${muted}`}>{AMOUNT_LABELS[row.first.group]}</span>
                      )}
                    </span>
                  )}
                  <ChevronRight className={`h-4 w-4 shrink-0 ${muted}`} aria-hidden="true" />
                </button>
                <RowActions row={row} busy={busy} onAct={act} muted={muted} />
              </MotionLi>
            ))}
            </AnimatePresence>
          </ul>
        )}
        <WaitingPayments
          payers={payers}
          headingLevel={3}
          tone={{ strong, muted }}
          className={rows.length ? `border-t pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-1 ${line}` : ''}
        />
      </div>
      {reviewing && <EmailAttentionModal entry={reviewing} busy={busy} onAct={act} onClose={() => setReviewingKey(null)} />}
    </section>
  );
}
