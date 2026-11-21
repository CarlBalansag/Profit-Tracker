import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  BadgeDollarSign, Boxes, CalendarClock, ChevronDown, CircleCheck, Clock, CreditCard, HandCoins, ListChecks, RotateCcw,
} from 'lucide-react';
import { useTodos, useTodoState } from '../hooks/useApi';
import { addDays, localToday } from '../utils/returnWindow';
import LoadError from '../components/UI/LoadError';
import { openTodoLink } from '../utils/todoLink';

// Things that need the user, worked out from their records by the API
// (services/todos.js). An item clears on its own once its record is fixed;
// Snooze and Dismiss only hide it, and a card bill's "Mark paid" closes that
// one cycle.

const GROUPS = [
  { id: 'cashout', label: 'Cash-outs', icon: HandCoins, color: 'text-violet-400 bg-violet-500/10' },
  { id: 'cards', label: 'Cards', icon: CreditCard, color: 'text-sky-400 bg-sky-500/10' },
  { id: 'sales', label: 'Sales', icon: BadgeDollarSign, color: 'text-emerald-400 bg-emerald-500/10' },
  { id: 'purchases', label: 'Purchases', icon: Boxes, color: 'text-amber-400 bg-amber-500/10' },
  { id: 'bookkeeping', label: 'Bookkeeping', icon: CalendarClock, color: 'text-gray-300 bg-white/5' },
];
const GROUP_BY_ID = Object.fromEntries(GROUPS.map((group) => [group.id, group]));

// Theme status colors (inline, so the light theme's soft remap of bg-* tints
// doesn't wash the dots out).
const URGENCY_COLOR = {
  overdue: 'var(--dp-red-text)',
  today: 'var(--dp-warning-text)',
  soon: 'var(--dp-info-text)',
  info: 'var(--dp-text-label)',
};
const URGENCIES = [
  { id: 'overdue', label: 'Overdue' },
  { id: 'today', label: 'Today' },
  { id: 'soon', label: 'This week' },
  { id: 'info', label: 'For your info' },
];

// Three or more of one kind in one section fold into a single expandable row.
const FOLD_AT = 3;

const SNOOZES = [
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
];

function foldByType(items) {
  const counts = {};
  for (const entry of items) counts[entry.type] = (counts[entry.type] || 0) + 1;
  const rows = [];
  const folded = {};
  for (const entry of items) {
    if (counts[entry.type] >= FOLD_AT) {
      if (!folded[entry.type]) {
        folded[entry.type] = { fold: true, type: entry.type, group: entry.group, title: entry.title, items: [] };
        rows.push(folded[entry.type]);
      }
      folded[entry.type].items.push(entry);
    } else {
      rows.push(entry);
    }
  }
  return rows;
}

// A folded row's title: the shared part of its items' titles ("Ship it",
// "Send tracking"), or the first one's when they differ.
const foldTitle = (row) => (row.items.every((entry) => entry.title === row.items[0].title) ? row.items[0].title : row.items[0].title.replace(/\s+\d.*$/, ''));

function GroupIcon({ group }) {
  const { icon: Icon, color } = GROUP_BY_ID[group] || GROUP_BY_ID.bookkeeping;
  return (
    <span className={`flex items-center justify-center w-9 h-9 rounded-full shrink-0 ${color}`}>
      <Icon className="w-4 h-4" aria-hidden="true" />
    </span>
  );
}

function TodoRow({ entry, onAct, busy, nested = false }) {
  const navigate = useNavigate();
  const [later, setLater] = useState(false);
  const canPay = entry.actions?.includes('mark_paid');
  const canSnooze = entry.actions?.includes('snooze');
  const canDismiss = entry.actions?.includes('dismiss');

  return (
    <li data-todo={entry.key} className={nested ? 'py-3' : 'px-4 py-3'}>
      <div className="flex items-start gap-3">
        {!nested && <GroupIcon group={entry.group} />}
        {/* Inside a folded group the shared title is the group's; each row
            leads with its own detail instead. */}
        <div className="flex-1 min-w-0">
          {nested
            ? <p className="text-sm text-gray-100 break-words">{entry.detail}</p>
            : (
              <>
                <p className="text-sm font-medium text-gray-100">{entry.title}</p>
                <p className="text-xs text-gray-400 break-words">{entry.detail}</p>
              </>
            )}
        </div>
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-2 ${nested ? '' : 'pl-12'}`}>
        {canPay && (
          <button type="button" disabled={busy} onClick={() => onAct(entry, 'done')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
            <CircleCheck className="w-3.5 h-3.5" aria-hidden="true" /> Mark paid
          </button>
        )}
        {/* Named by hidden text, not aria-label: touch screens give text
            buttons the full 44px height (index.css, pointer: coarse). */}
        {entry.link && (
          <button type="button" onClick={() => openTodoLink(navigate, entry.link)} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
            <span aria-hidden="true">Open</span><span className="sr-only">Open {entry.title}, {entry.detail}</span>
          </button>
        )}
        {(canSnooze || canDismiss) && (
          <button
            type="button"
            aria-expanded={later}
            onClick={() => setLater((open) => !open)}
            className="page-btn page-btn-secondary !h-9 !px-3 !text-xs"
          >
            <Clock className="w-3.5 h-3.5" aria-hidden="true" /> {canSnooze ? 'Later' : 'Hide'}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${later ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>
      {later && (
        <div role="group" aria-label={`Hide ${entry.title}`} className={`mt-2 flex flex-wrap gap-2 ${nested ? '' : 'pl-12'}`}>
          {canSnooze && SNOOZES.map(({ label, days }) => (
            <button key={days} type="button" disabled={busy} onClick={() => onAct(entry, 'snooze', days)} className="px-3 h-9 rounded-lg border border-white/10 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-50">
              {label}
            </button>
          ))}
          {canDismiss && (
            <button type="button" disabled={busy} onClick={() => onAct(entry, 'dismiss')} className="px-3 h-9 rounded-lg border border-white/10 text-xs font-medium text-gray-400 hover:bg-white/5 disabled:opacity-50">
              Dismiss
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function FoldedRow({ row, onAct, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-3 text-left">
        <GroupIcon group={row.group} />
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-100">{foldTitle(row)} <span className="text-gray-400">({row.items.length})</span></span>
          <span className="block text-xs text-gray-400 truncate">{row.items.map((entry) => entry.detail.split(' · ')[0]).join(', ')}</span>
        </span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <ul className="mt-1 pl-12 divide-y divide-white/[0.06]">
          {row.items.map((entry) => <TodoRow key={entry.key} entry={entry} onAct={onAct} busy={busy} nested />)}
        </ul>
      )}
    </li>
  );
}

function HiddenList({ items, onRestore, busy }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <section aria-label="Snoozed and dismissed">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-gray-200">
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
        Snoozed and dismissed ({items.length})
      </button>
      {open && (
        <ul className="mt-2 rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
          {items.map((entry) => (
            <li key={entry.key} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-300">{entry.title}</p>
                <p className="text-xs text-gray-500 break-words">
                  {entry.state === 'snoozed' ? `Snoozed until ${new Date(`${entry.until}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : 'Dismissed'} · {entry.detail}
                </p>
              </div>
              <button type="button" disabled={busy} onClick={() => onRestore(entry)} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs shrink-0">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Bring back
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const DONE_TEXT = { snooze: 'Snoozed.', dismiss: 'Dismissed.', done: 'Marked paid.' };

export default function Todos() {
  const { data, isLoading, isError, refetch, isRefetching } = useTodos();
  const mutation = useTodoState();
  const [filter, setFilter] = useState('all');
  const items = useMemo(() => data?.items ?? [], [data]);
  const visible = filter === 'all' ? items : items.filter((entry) => entry.group === filter);

  if (isError && !data) return <LoadError title="To-Do" what="your to-dos" onRetry={refetch} retrying={isRefetching} />;

  const act = (entry, action, days) => {
    const until = action === 'snooze' ? addDays(localToday(), days) : undefined;
    mutation.mutate({ key: entry.key, action, until }, {
      onSuccess: () => toast.success(DONE_TEXT[action], {
        action: { label: 'Undo', onClick: () => mutation.mutate({ key: entry.key, action: 'restore' }) },
      }),
      onError: (err) => toast.error(`Could not save: ${err.message}`),
    });
  };
  const restore = (entry) => mutation.mutate({ key: entry.key, action: 'restore' }, {
    onSuccess: () => toast.success('Back on your list.'),
    onError: (err) => toast.error(`Could not bring it back: ${err.message}`),
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white">To-Do</h1>
        <p className="text-sm text-gray-400 mt-1">
          What needs you, worked out from your records. Items clear on their own once you fix the record behind them.
        </p>
      </div>

      {!isLoading && items.length > 0 && (
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {[{ id: 'all', label: 'All' }, ...GROUPS].map((group) => {
            const count = group.id === 'all' ? items.length : items.filter((entry) => entry.group === group.id).length;
            if (group.id !== 'all' && count === 0) return null;
            const active = filter === group.id;
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(group.id)}
                className={`px-3 h-9 rounded-full text-xs font-medium border transition-colors ${active ? 'border-[var(--accent)] bg-[var(--accent-bg)] text-[var(--accent)]' : 'border-white/10 text-gray-300 hover:bg-white/5'}`}
              >
                {group.label} <span className="tabular-nums opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading your to-dos…</p>
      ) : items.length === 0 ? (
        <div className="mx-auto mt-12 max-w-sm text-center">
          <ListChecks className="mx-auto mb-3 h-8 w-8 text-gray-600" aria-hidden="true" />
          <p className="font-semibold text-gray-200">All caught up</p>
          <p className="mt-1 text-sm text-gray-400">Nothing needs you right now. Unshipped sales, late payouts, cash-out tracking and card bills show up here when they do.</p>
        </div>
      ) : (
        <div className="max-w-3xl space-y-5">
          {URGENCIES.map((urgency) => {
            const inSection = visible.filter((entry) => entry.urgency === urgency.id);
            if (!inSection.length) return null;
            return (
              <section key={urgency.id} aria-label={urgency.label}>
                <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: URGENCY_COLOR[urgency.id] }} aria-hidden="true" />
                  {urgency.label} <span className="tabular-nums">{inSection.length}</span>
                </h2>
                <ul className="rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
                  {foldByType(inSection).map((row) => (row.fold
                    ? <FoldedRow key={`fold:${urgency.id}:${row.type}`} row={row} onAct={act} busy={mutation.isPending} />
                    : <TodoRow key={row.key} entry={row} onAct={act} busy={mutation.isPending} />))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {!isLoading && (
        <div className="max-w-3xl">
          <HiddenList items={data?.hidden_items ?? []} onRestore={restore} busy={mutation.isPending} />
        </div>
      )}
    </div>
  );
}
