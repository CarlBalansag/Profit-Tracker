import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { BadgeDollarSign, Check, CheckCheck, ExternalLink, Link2, ListTree, Mail, PenLine, Plus, Settings2, Truck, UserRound, X, Zap } from 'lucide-react';
import { useActivity, useAutomationReview, useAutomationReviewMutations, useEmailAccounts, useEmailAutomation } from '../hooks/useApi';
import { AUTOMATION_KINDS, describeAutomation } from '../utils/automationText';
import { AUTOMATIONS } from '../data/emailAutomations';
import { formatMoney } from '../utils/money';
import LoadError from '../components/UI/LoadError';
import ChangeDetailsModal from '../components/Automation/ChangeDetailsModal';

// What ProfitTracker changed on its own from the user's email, newest first,
// in plain words. The changes already happened; Confirm is a double check that
// moves one to Completed, and No takes it back (api services/email/review.js:
// undo, plus unlinking the order so it isn't done again). Details shows each
// field before and after. The same entries are in Activity ("From email").

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A]';
const KIND_LOOK = {
  paid: { icon: BadgeDollarSign, color: 'var(--dp-green-text)', bg: 'var(--dp-green-bg)' },
  shipping: { icon: Truck, color: 'var(--dp-info-text)', bg: 'var(--dp-info-bg)' },
  link: { icon: Link2, color: 'var(--dp-neutral-text)', bg: 'var(--dp-neutral-bg)' },
  created: { icon: Plus, color: 'var(--dp-accent-text)', bg: 'var(--dp-accent-bg)' },
  details: { icon: PenLine, color: 'var(--dp-neutral-text)', bg: 'var(--dp-neutral-bg)' },
  sorted: { icon: UserRound, color: 'var(--dp-neutral-text)', bg: 'var(--dp-neutral-bg)' },
};

// What "No" does, said before it happens.
const REJECT_TEXT = {
  link: "Unlink this order and put back anything it filled in? It won't be linked again on its own.",
  created: "Delete this record made from the email? It won't be added again on its own.",
  sorted: 'Bring this order back as business? It goes back to your orders, and your To-Do can add it.',
};
const rejectText = (kind) => REJECT_TEXT[kind] || 'Put back what this change replaced?';
const isOpen = (entry) => !entry.review_state && !entry.undone_at;
const canReject = (entry) => isOpen(entry) && (entry.kind === 'event' || entry.undo_state === 'available');
const noLabel = (change) => (change.kind === 'sorted' ? "No, it's business" : 'No');

const SMALL = '!h-8 !px-2.5 !text-xs';
const GHOST = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-400 transition-colors hover:bg-white/[0.05] hover:text-gray-100';

// The email a change came from (Gmail opens that one message), else the
// store's order page. Opens in a new tab; nothing here changes the record.
function SourceLink({ source, what }) {
  const email = source?.email;
  if (email?.url) {
    return (
      <a href={email.url} target="_blank" rel="noopener noreferrer" className={GHOST} title={email.subject || undefined}>
        <Mail size={13} aria-hidden="true" /><span aria-hidden="true">Open email</span><span className="sr-only">Open the email for {what} (new tab)</span>
      </a>
    );
  }
  if (source?.store_url) {
    return (
      <a href={source.store_url} target="_blank" rel="noopener noreferrer" className={GHOST}>
        <ExternalLink size={13} aria-hidden="true" /><span aria-hidden="true">Order on {source.store}</span><span className="sr-only">Open the {source.store} order page for {what} (new tab)</span>
      </a>
    );
  }
  return null;
}

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

function ReviewTabs({ view, toConfirm, onPick }) {
  const tabs = [['open', 'To confirm', toConfirm], ['done', 'Completed', 0]];
  return (
    <div role="tablist" aria-label="Review" className="inline-flex rounded-lg border border-white/10 bg-[#12121A] p-1">
      {tabs.map(([id, label, count]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => onPick(id)}
          className={`flex min-h-[36px] items-center gap-1.5 rounded-md px-3.5 text-[13px] font-semibold transition-colors ${view === id ? 'bg-white/[0.1] text-[var(--dp-text-primary)] shadow-sm' : 'text-gray-500 hover:text-white'}`}
        >
          {label}
          {count > 0 && <span className="min-w-[20px] rounded-full bg-[var(--dp-accent-solid)] px-1.5 text-center text-[11px] leading-5 text-white tabular-nums">{count > 99 ? '99+' : count}</span>}
        </button>
      ))}
    </div>
  );
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

function Outcome({ entry }) {
  if (entry.review_state === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--dp-green-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--dp-green-text)]">
        <Check size={11} aria-hidden="true" />Confirmed
      </span>
    );
  }
  if (entry.review_state === 'rejected') return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-gray-400">You said no</span>;
  if (entry.undone_at) return <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-gray-400">Undone</span>;
  return null;
}

function AutomationRow({ entry, change, busy, onConfirm, onReject, onDetails }) {
  const look = KIND_LOOK[change.kind] || KIND_LOOK.details;
  const Icon = look.icon;
  const open = isOpen(entry);
  const takenBack = entry.review_state === 'rejected' || Boolean(entry.undone_at);
  const what = `${change.title}, ${change.subject}`;
  return (
    <li data-activity={entry.id} className="flex gap-3 px-4 py-3.5">
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${takenBack ? 'opacity-60' : ''}`} style={{ background: look.bg }}>
        <Icon size={16} style={{ color: look.color }} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className={`min-w-0 text-sm font-semibold ${takenBack ? 'text-gray-400 line-through decoration-gray-600' : 'text-[var(--dp-text-primary)]'}`}>
            {change.title}
            {change.amount != null && <span className="ml-2 font-semibold tabular-nums" style={{ color: takenBack ? undefined : look.color }}>${formatMoney(change.amount)}</span>}
          </p>
          <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{timeOf(entry.created_at)}</span>
        </div>
        <p className="mt-0.5 truncate text-[13px] text-gray-300" title={change.subject}>{change.subject}</p>
        {entry.email_source?.email?.subject && (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-gray-500">
            <Mail size={11} aria-hidden="true" className="shrink-0" />
            <span className="truncate" title={entry.email_source.email.subject}>{entry.email_source.email.subject}</span>
          </p>
        )}
        {change.facts.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-gray-500">
            {change.facts.map((fact, i) => (
              <span key={fact} className="min-w-0 break-all">{i > 0 && <span aria-hidden="true" className="mr-2">·</span>}{fact}</span>
            ))}
          </p>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {open && (
            <button type="button" disabled={busy} onClick={() => onConfirm(entry)} className={`page-btn page-btn-secondary ${SMALL}`}>
              <Check size={13} aria-hidden="true" /><span aria-hidden="true">Confirm</span><span className="sr-only">Confirm: {what}</span>
            </button>
          )}
          {canReject(entry) && (
            <button type="button" disabled={busy} onClick={() => onReject(entry, change)} className={`page-btn page-btn-secondary ${SMALL}`}>
              <X size={13} aria-hidden="true" /><span aria-hidden="true">{noLabel(change)}</span><span className="sr-only">No, take back: {what}</span>
            </button>
          )}
          <button type="button" onClick={() => onDetails(entry, change)} className={GHOST}>
            <ListTree size={13} aria-hidden="true" /><span aria-hidden="true">Details</span><span className="sr-only">Details: {what}</span>
          </button>
          <SourceLink source={entry.email_source} what={what} />
          {open && !canReject(entry) && entry.undo_state === 'expired' && <span className="text-xs text-gray-600">Too old to take back</span>}
          <Outcome entry={entry} />
        </div>
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
  const [view, setView] = useState('open');
  const { data, isLoading, isError, refetch, isRefetching, hasNextPage, fetchNextPage, isFetchingNextPage } = useActivity(undefined, 'email', view);
  const { data: review } = useAutomationReview();
  const { confirm, reject } = useAutomationReviewMutations();
  const [pendingId, setPendingId] = useState(null);
  const [kind, setKind] = useState('all');
  const [details, setDetails] = useState(null);
  const toConfirm = review?.to_confirm ?? 0;
  const pickView = (next) => { setView(next); setKind('all'); };

  const rows = useMemo(() => (data?.pages.flatMap((page) => page.entries) ?? []).map((entry) => ({ entry, change: describeAutomation(entry) })), [data]);
  const counts = useMemo(() => rows.reduce((acc, r) => ({ ...acc, [r.change.kind]: (acc[r.change.kind] || 0) + 1 }), {}), [rows]);
  const visible = kind === 'all' ? rows : rows.filter((r) => r.change.kind === kind);
  const openVisible = visible.filter((r) => isOpen(r.entry)).map((r) => r.entry);
  const days = [];
  for (const row of visible) {
    const key = dayKey(row.entry.created_at);
    if (days.at(-1)?.key === key) days.at(-1).rows.push(row);
    else days.push({ key, label: dayLabel(row.entry.created_at), rows: [row] });
  }

  const handleConfirm = async (entries) => {
    const list = Array.isArray(entries) ? entries : [entries];
    setPendingId(list.length === 1 ? list[0].id : 'all');
    try {
      const { confirmed } = await confirm.mutateAsync(list.map((e) => e.id));
      if (list.length > 1) toast.success(`Confirmed ${confirmed}. They're in Completed.`);
      setDetails(null);
    } catch (err) {
      toast.error(`Could not confirm: ${err.message}`);
    } finally {
      setPendingId(null);
    }
  };

  const handleReject = async (entry, change) => {
    if (!window.confirm(rejectText(change.kind))) return;
    setPendingId(entry.id);
    try {
      await reject.mutateAsync(entry.id);
      toast.success(change.kind === 'sorted' ? 'Brought back as business.' : 'Taken back.');
      setDetails(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPendingId(null);
    }
  };

  if (isError && !data) return <LoadError title="Email automation" what="the automatic changes" onRetry={refetch} retrying={isRefetching} />;

  const detailOpen = details && isOpen(details.entry);
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 pb-10 sm:px-6">
        <div className="min-w-0 max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-white">Email automation</h1>
          <p className="mt-1 text-sm text-gray-400">
            What ProfitTracker already did on its own from your email. Confirm the ones that look right; No takes a change back (within 30 days). Each change is also in Activity.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ReviewTabs view={view} toConfirm={toConfirm} onPick={pickView} />
          {view === 'open' && openVisible.length > 1 && (
            <button type="button" disabled={pendingId !== null} onClick={() => handleConfirm(openVisible)} className="page-btn page-btn-secondary">
              <CheckCheck size={15} aria-hidden="true" /> Confirm all {openVisible.length} shown
            </button>
          )}
        </div>

        {rows.length > 0 && <KindTabs counts={counts} total={rows.length} active={kind} onPick={setKind} />}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
          <div className="min-w-0 space-y-5">
            {isLoading ? (
              <p className="text-sm text-gray-500">Loading…</p>
            ) : rows.length === 0 ? (
              <div className={`${PANEL} px-6 py-14 text-center`}>
                <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: view === 'open' ? 'var(--dp-green-bg)' : 'var(--dp-neutral-bg)' }}>
                  {view === 'open'
                    ? <CheckCheck className="h-7 w-7" style={{ color: 'var(--dp-green-text)' }} aria-hidden="true" />
                    : <Zap className="h-7 w-7" style={{ color: 'var(--dp-neutral-text)' }} aria-hidden="true" />}
                </span>
                <p className="text-lg font-semibold text-white">{view === 'open' ? 'Nothing to confirm' : 'Nothing completed yet'}</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">
                  {view === 'open'
                    ? 'When ProfitTracker reads your email and links an order, adds tracking, marks a sale paid or adds a purchase, it shows up here to confirm.'
                    : 'Changes you confirm or say no to move here, so you can still look them up.'}
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
                      <AutomationRow
                        key={entry.id}
                        entry={entry}
                        change={change}
                        busy={pendingId !== null}
                        onConfirm={handleConfirm}
                        onReject={handleReject}
                        onDetails={(e, c) => setDetails({ entry: e, change: c })}
                      />
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

      {details && (
        <ChangeDetailsModal
          entry={details.entry}
          change={details.change}
          onClose={() => setDetails(null)}
          actions={detailOpen ? (
            <>
              {canReject(details.entry) && (
                <button type="button" disabled={pendingId !== null} onClick={() => handleReject(details.entry, details.change)} className="page-btn page-btn-secondary">
                  <X size={14} aria-hidden="true" /> {details.change.kind === 'sorted' ? "No, it's business" : 'No, take it back'}
                </button>
              )}
              <button type="button" disabled={pendingId !== null} onClick={() => handleConfirm(details.entry)} className="page-btn page-btn-primary">
                <Check size={14} aria-hidden="true" /> Confirm
              </button>
            </>
          ) : null}
        />
      )}
    </div>
  );
}
