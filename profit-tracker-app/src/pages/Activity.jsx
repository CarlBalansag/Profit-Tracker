import React, { useState } from 'react';
import { toast } from 'sonner';
import { Bot, Undo2, History, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { useActivity, useInvalidate } from '../hooks/useApi';
import { undoActivity } from '../utils/undoToast';
import { describeActivity } from '../utils/activityText';
import { statusVisual } from '../data/statusWorkflow';
import LoadError from '../components/UI/LoadError';
import { useMatchMedia } from '../hooks/useMatchMedia';

// Everything the user did that can be undone, newest first, grouped by day.
// Undo asks the server to reverse that exact entry; it refuses with a reason
// when something changed since (services/activityLog.js), shown as a toast.

const dayKey = (iso) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

function groupByDay(entries) {
  const groups = [];
  for (const entry of entries) {
    const key = dayKey(entry.created_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else groups.push({ key, label: dayLabel(entry.created_at), entries: [entry] });
  }
  return groups;
}

const CHANGE_ICON = { create: Plus, edit: Pencil, delete: Trash2 };

function EntryIcon({ entry }) {
  if (entry.kind === 'event') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-[var(--dp-hover-bg)] text-[var(--dp-text-label)]">
        <Info className="w-4 h-4" />
      </span>
    );
  }
  if (entry.kind === 'change') {
    const Icon = CHANGE_ICON[entry.detail?.action] || Pencil;
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-sky-500/10 text-sky-400">
        <Icon className="w-4 h-4" />
      </span>
    );
  }
  if (entry.kind !== 'status') {
    return (
      <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0 bg-emerald-500/10 text-emerald-400">
        <Undo2 className="w-4 h-4" />
      </span>
    );
  }
  const { icon: Icon, color } = statusVisual(entry.detail?.to);
  return (
    <span className="flex items-center justify-center w-8 h-8 rounded-full shrink-0" style={{ color, background: `color-mix(in srgb, ${color} 12%, transparent)` }}>
      <Icon className="w-4 h-4" />
    </span>
  );
}

function ActivityRow({ entry, busy, onUndo }) {
  const { title, change, product } = describeActivity(entry);
  const undone = entry.undo_state === 'undone';
  return (
    <li data-activity={entry.id} className="flex items-start gap-3 px-4 py-3">
      <EntryIcon entry={entry} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${undone ? 'text-gray-500 line-through decoration-gray-600' : 'text-gray-100'}`}>{title}</p>
        <p className="text-xs text-gray-400 truncate">{product}</p>
        {change && <p className="text-xs text-gray-500 mt-0.5">{change}</p>}
        <p className="flex items-center gap-1.5 text-[11px] text-gray-500 mt-1">
          <span>{timeOf(entry.created_at)}</span>
          {entry.undo_state === 'not_undoable' && (
            <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span>Can't be undone</span>
          )}
          {entry.source === 'assistant' && (
            <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><Bot className="w-3 h-3" /> AI assistant</span>
          )}
        </p>
      </div>
      <div className="shrink-0 pt-0.5">
        {entry.undo_state === 'available' && (
          <button
            type="button"
            onClick={() => onUndo(entry)}
            disabled={busy}
            aria-label={`Undo ${title}, ${product}`}
            className="px-3 h-8 rounded-lg border border-white/10 text-xs font-medium text-gray-200 hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        )}
        {undone && <span className="px-2 py-1 rounded-md text-[11px] font-medium text-gray-400 bg-white/5">Undone</span>}
        {entry.undo_state === 'expired' && <span className="text-[11px] text-gray-600">Older than 30 days</span>}
      </div>
    </li>
  );
}

// value -> API `group` (undefined = everything).
const FILTERS = [
  { value: 'all', label: 'All', group: undefined },
  { value: 'records', label: 'Buys & sales', group: 'records' },
  { value: 'setup', label: 'Setup', group: 'setup' },
];

const EMPTY_TEXT = {
  all: 'When you add or edit a purchase, sale, expense, card or platform, record a refund, or press a status button, it shows up here so you can undo it.',
  records: 'When you add or edit a purchase, sale, expense or note, record a refund, press a status button, or commit to a cashout deal, it shows up here.',
  setup: 'When you add, edit or remove a card, store account, platform, buyer, goal, recurring expense, cashout connection or calendar event, or change an API key or setting, it shows up here.',
};

function FilterBar({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] p-0.5">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          role="radio"
          aria-checked={value === f.value}
          onClick={() => onChange(f.value)}
          className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${value === f.value ? 'bg-[var(--dp-card-bg)] text-[var(--dp-accent-text)] shadow-sm' : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]'}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// One list of entries (a filter's, or one column's): its own query, day
// groups and "Show older". Undo is handled by the page, one at a time.
function ActivityFeed({ group, emptyText, heading, headingId, pendingId, onUndo }) {
  const { data, isLoading, isError, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useActivity(group);

  if (isError && !data) return <LoadError title={heading || 'Activity'} what="your activity" onRetry={refetch} retrying={isRefetching} />;

  const entries = data?.pages.flatMap((page) => page.entries) ?? [];
  const DayHeading = heading ? 'h3' : 'h2';

  return (
    <div className="min-w-0 space-y-4">
      {heading && <h2 id={headingId} className="text-sm font-semibold text-gray-200">{heading}</h2>}
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading activity…</p>
      ) : entries.length === 0 ? (
        <div className={`mx-auto max-w-sm text-center ${heading ? 'mt-6' : 'mt-12'}`}>
          <History className="mx-auto mb-3 h-8 w-8 text-gray-600" aria-hidden="true" />
          <p className="font-semibold text-gray-200">Nothing here yet</p>
          <p className="mt-1 text-sm text-gray-400">{emptyText}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupByDay(entries).map((day) => (
            <section key={day.key} aria-label={day.label}>
              <DayHeading className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">{day.label}</DayHeading>
              <ul className="rounded-xl border border-white/[0.08] bg-white/[0.02] divide-y divide-white/[0.06]">
                {day.entries.map((entry) => (
                  <ActivityRow key={entry.id} entry={entry} busy={pendingId !== null} onUndo={onUndo} />
                ))}
              </ul>
            </section>
          ))}
          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="page-btn page-btn-secondary"
            >
              {isFetchingNextPage ? 'Loading…' : 'Show older'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Wide screens show buys and sales and setup side by side; below 1024px one
// list with a filter (one layout per breakpoint, see AGENTS.md).
export default function Activity() {
  const wide = useMatchMedia('(min-width: 1024px)');
  const [filter, setFilter] = useState('all');
  const { group } = FILTERS.find((f) => f.value === filter);
  const invalidate = useInvalidate();
  const [pendingId, setPendingId] = useState(null);

  const handleUndo = async (entry) => {
    setPendingId(entry.id);
    try {
      await undoActivity(entry.id);
      // Stock, totals and every list here change.
      invalidate.all();
      toast.success('Undone.');
    } catch (err) {
      toast.error(`Could not undo: ${err.message}`);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity</h1>
        <p className="text-sm text-gray-400 mt-1">
          Everything you added, edited or removed, newest first, from purchases and sales to your cards, platforms and cashouts. Most of it can be undone for 30 days, as long as nothing changed it since.
        </p>
      </div>

      {wide ? (
        <div className="grid grid-cols-2 gap-6 items-start">
          <section aria-labelledby="activity-records">
            <ActivityFeed group="records" heading="Buys & sales" headingId="activity-records" emptyText={EMPTY_TEXT.records} pendingId={pendingId} onUndo={handleUndo} />
          </section>
          <section aria-labelledby="activity-setup">
            <ActivityFeed group="setup" heading="Data setup" headingId="activity-setup" emptyText={EMPTY_TEXT.setup} pendingId={pendingId} onUndo={handleUndo} />
          </section>
        </div>
      ) : (
        <>
          <FilterBar value={filter} onChange={setFilter} />
          <div className="max-w-3xl">
            <ActivityFeed key={filter} group={group} emptyText={EMPTY_TEXT[filter]} pendingId={pendingId} onUndo={handleUndo} />
          </div>
        </>
      )}
    </div>
  );
}
