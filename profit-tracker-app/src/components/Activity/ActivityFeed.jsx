import React from 'react';
import { Bot, Mail, Undo2, History, Info, Pencil, Plus, Trash2 } from 'lucide-react';
import { useActivity } from '../../hooks/useApi';
import { describeActivity } from '../../utils/activityText';
import { statusVisual } from '../../data/statusWorkflow';
import LoadError from '../UI/LoadError';

// The Activity list (one filter's or one column's entries, by day, with Undo
// buttons), shared by the Activity and Automation pages. Undo itself is the
// page's (one at a time).
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
          {entry.source === 'email' && (
            <span className="inline-flex items-center gap-1"><span aria-hidden="true">·</span><Mail className="w-3 h-3" /> From email</span>
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

// One list of entries (a filter's, or one column's): its own query, day
// groups and "Show older". Undo is handled by the page, one at a time.
export default function ActivityFeed({ group, source, emptyText, heading, headingId, pendingId, onUndo }) {
  const { data, isLoading, isError, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useActivity(group, source);

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
