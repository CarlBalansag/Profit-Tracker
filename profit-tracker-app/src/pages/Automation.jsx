import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeDollarSign, ChevronDown, Link2, Mail, PenLine, Plus, Settings2, Truck, Zap } from 'lucide-react';
import { useActivity, useEmailAccounts, useEmailAutomation, useInvalidate } from '../hooks/useApi';
import { undoActivity } from '../utils/undoToast';
import { AUTOMATION_KINDS, describeAutomation } from '../utils/automationText';
import { AUTOMATIONS } from '../data/emailAutomations';
import { formatMoney } from '../utils/money';
import LoadError from '../components/UI/LoadError';

// What ProfitTracker changed on its own from the user's email, newest first,
// in plain words, with Undo. The same entries are in Activity ("From email");
// this page is just the automatic ones (GET /api/activity?source=email).

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A]';
const KIND_LOOK = {
  paid: { icon: BadgeDollarSign, color: 'var(--dp-green-text)', bg: 'var(--dp-green-bg)' },
  shipping: { icon: Truck, color: 'var(--dp-info-text)', bg: 'var(--dp-info-bg)' },
  link: { icon: Link2, color: 'var(--dp-neutral-text)', bg: 'var(--dp-neutral-bg)' },
  created: { icon: Plus, color: 'var(--dp-accent-text)', bg: 'var(--dp-accent-bg)' },
  details: { icon: PenLine, color: 'var(--dp-neutral-text)', bg: 'var(--dp-neutral-bg)' },
};

const dayKey = (iso) => new Date(iso).toDateString();
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

function ago(iso) {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function KindTabs({ counts, total, active, onPick }) {
  const tabs = [{ id: 'all', label: 'All', count: total }, ...AUTOMATION_KINDS.map((k) => ({ ...k, count: counts[k.id] || 0 })).filter((k) => k.count > 0)];
  return (
    <div role="group" aria-label="Show" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0 dp-no-native-scrollbar max-sm:[mask-image:linear-gradient(90deg,transparent_0,#000_16px,#000_calc(100%-24px),transparent_100%)]">
      <div className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-[#12121A] p-1">
        {tabs.map(({ id, label, count }) => {
          const selected = active === id;
          const Icon = KIND_LOOK[id]?.icon;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(id)}
              className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${selected ? 'bg-[var(--accent-bg)] text-[var(--accent)]' : 'text-gray-400 hover:text-white'}`}
            >
              {Icon && <Icon size={13} aria-hidden="true" />}
              {label}
              <span className={`tabular-nums ${selected ? '' : 'text-gray-500'}`}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AutomationRow({ entry, change, busy, onUndo }) {
  const [open, setOpen] = useState(false);
  const look = KIND_LOOK[change.kind] || KIND_LOOK.details;
  const Icon = look.icon;
  const undone = entry.undo_state === 'undone';
  return (
    <li data-activity={entry.id} className={`flex gap-3 px-4 py-3.5 ${undone ? 'opacity-60' : ''}`}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: look.bg }}>
        <Icon size={16} style={{ color: look.color }} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`min-w-0 text-sm font-semibold ${undone ? 'text-gray-400 line-through decoration-gray-600' : 'text-[var(--dp-text-primary)]'}`}>
            {change.title}
            {change.amount != null && <span className="ml-2 font-semibold tabular-nums" style={{ color: undone ? undefined : look.color }}>${formatMoney(change.amount)}</span>}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{timeOf(entry.created_at)}</span>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-gray-300" title={change.subject}>{change.subject}</p>
        {change.facts.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
            {change.facts.map((fact, i) => (
              <span key={fact} className="min-w-0 break-all">{i > 0 && <span aria-hidden="true" className="mr-2">·</span>}{fact}</span>
            ))}
          </p>
        )}
        {open && change.details.map((line) => <p key={line} className="mt-1.5 break-words rounded-lg bg-white/[0.03] px-2.5 py-1.5 text-xs text-gray-400">{line}</p>)}
        {(change.details.length > 0 || entry.undo_state !== 'not_undoable') && (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          {change.details.length > 0 && (
            <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex h-7 items-center gap-1 rounded-md text-xs font-medium text-gray-400 hover:text-gray-200">
              {open ? 'Hide' : 'Show'} serials <ChevronDown size={12} aria-hidden="true" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          )}
          {entry.undo_state === 'available' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onUndo(entry)}
              className="inline-flex h-7 items-center rounded-md px-2 -ml-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/[0.05] hover:text-gray-100 disabled:opacity-50"
            >
              <span aria-hidden="true">Undo</span><span className="sr-only">Undo {change.title}, {change.subject}</span>
            </button>
          )}
          {undone && <span className="text-xs text-gray-500">Undone</span>}
          {entry.undo_state === 'expired' && <span className="text-xs text-gray-600">Older than 30 days</span>}
        </div>
        )}
      </div>
    </li>
  );
}

function RunningPanel() {
  const { data: settings } = useEmailAutomation();
  const { data: accounts = [] } = useEmailAccounts();
  const connected = Array.isArray(accounts) ? accounts.filter((a) => a.status !== 'disconnected') : [];
  const lastSync = connected.map((a) => a.last_synced_at).filter(Boolean).sort().pop();
  return (
    <section aria-labelledby="automation-running" className={`${PANEL} px-4 py-3.5`}>
      <h2 id="automation-running" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
        <Zap size={13} aria-hidden="true" style={{ color: 'var(--dp-accent-text)' }} /> Runs on its own
      </h2>
      {settings ? (
        <ul className="mt-2.5 space-y-2">
          {AUTOMATIONS.map(([key, label]) => (
            <li key={key} className="flex items-start justify-between gap-3 text-[13px]">
              <span className={settings[key] ? 'text-[var(--dp-text-primary)]' : 'text-gray-500'}>{label}</span>
              <span className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${settings[key] ? 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]' : 'bg-white/5 text-gray-500'}`}>
                {settings[key] ? 'On' : 'Off'}
              </span>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-xs text-gray-500">Loading…</p>}
      <Link to="/settings" state={{ tab: 'email' }} className="page-btn page-btn-secondary mt-3.5 w-full justify-center !h-9 !text-xs">
        <Settings2 size={14} aria-hidden="true" /> Change in Settings
      </Link>
      <p className="mt-3 flex items-center gap-1.5 border-t border-white/[0.06] pt-3 text-xs text-gray-500">
        <Mail size={12} aria-hidden="true" />
        {connected.length === 0 ? 'No email connected' : lastSync ? `Email checked ${ago(lastSync)}` : 'Email not checked yet'}
      </p>
    </section>
  );
}

export default function Automation() {
  const { data, isLoading, isError, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useActivity(undefined, 'email');
  const invalidate = useInvalidate();
  const [pendingId, setPendingId] = useState(null);
  const [kind, setKind] = useState('all');

  const rows = useMemo(() => (data?.pages.flatMap((page) => page.entries) ?? []).map((entry) => ({ entry, change: describeAutomation(entry) })), [data]);
  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.change.kind]: (acc[r.change.kind] || 0) + 1 }), {}), [rows]);
  const visible = kind === 'all' ? rows : rows.filter((r) => r.change.kind === kind);
  const days = [];
  for (const row of visible) {
    const key = dayKey(row.entry.created_at);
    if (days.at(-1)?.key === key) days.at(-1).rows.push(row);
    else days.push({ key, label: dayLabel(row.entry.created_at), rows: [row] });
  }

  const handleUndo = async (entry) => {
    setPendingId(entry.id);
    try {
      await undoActivity(entry.id);
      invalidate.all();
      toast.success('Undone.');
    } catch (err) {
      toast.error(`Could not undo: ${err.message}`);
    } finally {
      setPendingId(null);
    }
  };

  if (isError && !data) return <LoadError title="Email automation" what="the automatic changes" onRetry={refetch} retrying={isRefetching} />;

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 pb-10 sm:px-6">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-white">Email automation</h1>
          <p className="mt-1 text-sm text-gray-400">
            What ProfitTracker changed on its own from your email, newest first. Each change is also in Activity, and most can be undone for 30 days.
          </p>
        </div>

        {rows.length > 0 && <KindTabs counts={counts} total={rows.length} active={kind} onPick={setKind} />}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="min-w-0 space-y-5">
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : rows.length === 0 ? (
              <div className={`${PANEL} px-6 py-14 text-center`}>
                <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--dp-neutral-bg)' }}>
                  <Zap className="h-7 w-7" style={{ color: 'var(--dp-neutral-text)' }} aria-hidden="true" />
                </span>
                <p className="text-lg font-semibold text-white">Nothing changed on its own yet</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">
                  When ProfitTracker reads your email and links an order, adds tracking, marks a sale paid or adds an expense, it shows up here.
                </p>
              </div>
            ) : (
              days.map((day) => (
                <section key={day.key} aria-labelledby={`day-${day.key}`}>
                  <h2 id={`day-${day.key}`} className="mb-2 flex items-baseline justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {day.label}<span className="normal-case tracking-normal font-medium tabular-nums">{day.rows.length} {day.rows.length === 1 ? 'change' : 'changes'}</span>
                  </h2>
                  <ul className={`${PANEL} divide-y divide-white/[0.06]`}>
                    {day.rows.map(({ entry, change }) => (
                      <AutomationRow key={entry.id} entry={entry} change={change} busy={pendingId !== null} onUndo={handleUndo} />
                    ))}
                  </ul>
                </section>
              ))
            )}
            {hasNextPage && (
              <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="page-btn page-btn-secondary">
                {isFetchingNextPage ? 'Loading…' : 'Show older'}
              </button>
            )}
          </div>
          <aside aria-label="Automatic actions" className="min-w-0 space-y-4 lg:sticky lg:top-0">
            <RunningPanel />
          </aside>
        </div>
      </div>
    </div>
  );
}
