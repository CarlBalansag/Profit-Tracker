import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CircleCheckBig, Plus } from 'lucide-react';
import { useReminderMutations, useReminders, useTodos, useTodoState } from '../hooks/useApi';
import { addDays, localToday } from '../utils/returnWindow';
import LoadError from '../components/UI/LoadError';
import { PageLoader } from '../components/PageLoader';
import ReminderModal from '../components/Reminders/ReminderModal';
import TodoStats from '../components/Todos/TodoStats';
import TodoGroupTabs from '../components/Todos/TodoGroupTabs';
import TodoSection from '../components/Todos/TodoSection';
import RemindersPanel from '../components/Todos/RemindersPanel';
import HiddenPanel from '../components/Todos/HiddenPanel';
import PhoneAlertsCard from '../components/Todos/PhoneAlertsCard';
import { PANEL, URGENCIES, whenText } from '../components/Todos/todoMeta';

// Things that need the user, worked out from their records by the API
// (services/todos.js), plus reminders they write. An item clears on its own
// once its record is fixed; Later only hides it, a card bill's "Mark paid"
// closes that one cycle, and a reminder's "Done" finishes it (a repeating one
// moves to its next date).

const DONE_TEXT = { snooze: 'Snoozed.', dismiss: 'Dismissed.', done: 'Marked paid.' };
// A month or more is "Holding" (todoMeta HOLDS), and says so.
const doneText = (action, days) => (action === 'snooze' && days >= 30 ? 'On hold.' : DONE_TEXT[action]);

// Phones skip these: the urgency tiles right below say the same.
const PILL = 'hidden sm:inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em]';

export default function Todos() {
  const { data, isLoading, isError, refetch, isRefetching } = useTodos();
  const mutation = useTodoState();
  const reminderMutations = useReminderMutations();
  const { data: reminders = [] } = useReminders('open');
  // null = closed; {} = new reminder; a reminder = editing it.
  const [editing, setEditing] = useState(null);
  const [group, setGroup] = useState('all');
  const [urgency, setUrgency] = useState(null);
  const items = useMemo(() => data?.items ?? [], [data]);
  const busy = mutation.isPending || reminderMutations.complete.isPending;

  if (isError && !data) return <LoadError title="To-Do" what="your to-dos" onRetry={refetch} retrying={isRefetching} />;
  if (isLoading) return <PageLoader />;

  const inGroup = group === 'all' ? items : items.filter((entry) => entry.group === group);
  const visible = urgency ? inGroup.filter((entry) => entry.urgency === urgency) : inGroup;
  const overdue = items.filter((entry) => entry.urgency === 'overdue').length;
  const today = items.filter((entry) => entry.urgency === 'today').length;

  const completeReminder = (entry) => {
    const { id } = entry.reminder;
    reminderMutations.complete.mutate({ id, due_date: entry.reminder.due_date }, {
      onSuccess: ({ reminder, previous }) => toast.success(
        reminder.done_at ? 'Done.' : `Done. Next one ${whenText(reminder)}.`,
        { action: { label: 'Undo', onClick: () => reminderMutations.undoComplete.mutate({ id, due_date: previous.due_date }, { onError: (err) => toast.error(`Could not undo: ${err.message}`) }) } },
      ),
      onError: (err) => toast.error(`Could not save: ${err.message}`),
    });
  };

  // A folded row: the same choice for each of its items, one toast for all.
  const actOnAll = async (row, action, days) => {
    const until = action === 'snooze' ? addDays(localToday(), days) : undefined;
    const keys = row.items.map((entry) => entry.key);
    try {
      await Promise.all(keys.map((key) => mutation.mutateAsync({ key, action, until })));
      toast.success(`${keys.length} ${doneText(action, days).toLowerCase()}`, {
        action: { label: 'Undo', onClick: () => keys.forEach((key) => mutation.mutate({ key, action: 'restore' })) },
      });
    } catch (err) {
      toast.error(`Could not save all of them: ${err.message}`);
    }
  };

  const act = (entry, action, days) => {
    if (entry.fold) { actOnAll(entry, action, days); return; }
    if (action === 'complete') { completeReminder(entry); return; }
    const until = action === 'snooze' ? addDays(localToday(), days) : undefined;
    mutation.mutate({ key: entry.key, action, until }, {
      onSuccess: () => toast.success(doneText(action, days), {
        action: { label: 'Undo', onClick: () => mutation.mutate({ key: entry.key, action: 'restore' }) },
      }),
      onError: (err) => toast.error(`Could not save: ${err.message}`),
    });
  };

  const restore = (entry) => mutation.mutate({ key: entry.key, action: 'restore' }, {
    onSuccess: () => toast.success('Back on your list.'),
    onError: (err) => toast.error(`Could not bring it back: ${err.message}`),
  });

  const clearFilters = () => { setGroup('all'); setUrgency(null); };

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="h-full overflow-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 pb-10 sm:px-6">

        {/* ── Header ── */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-white">To-Do</h1>
            <p className="mt-1 text-sm text-gray-400">What needs you, worked out from your records, plus your reminders.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {overdue > 0 && <span className={`${PILL} border-red-500/30 bg-red-500/10 text-[var(--dp-red-text)]`}>{overdue} overdue</span>}
            {today > 0 && <span className={`${PILL} border-amber-500/30 bg-amber-500/10 text-[var(--dp-warning-text)]`}>{today} today</span>}
            <button type="button" onClick={() => setEditing({})} className="page-btn page-btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> New reminder
            </button>
          </div>
        </div>

        {items.length > 0 && (
          <>
            <TodoStats items={inGroup} active={urgency} onPick={setUrgency} />
            <TodoGroupTabs items={items} active={group} onPick={setGroup} />
          </>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          {/* ── The list ── */}
          <div className="min-w-0 space-y-4">
            {items.length === 0 ? (
              <div className={`${PANEL} px-6 py-14 text-center`}>
                <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl" style={{ background: 'var(--dp-green-bg)' }}>
                  <CircleCheckBig className="h-7 w-7" style={{ color: 'var(--dp-green-text)' }} aria-hidden="true" />
                </span>
                <p className="text-lg font-semibold text-white">All caught up</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-gray-400">
                  Nothing needs you right now. Unshipped sales, late payouts, cash-out tracking, card bills and your reminders show up here when they do.
                </p>
              </div>
            ) : (
              <>
                {visible.length === 0 ? (
                  <div className={`${PANEL} px-6 py-10 text-center`}>
                    <p className="text-sm text-gray-400">Nothing here with these filters.</p>
                    <button type="button" onClick={clearFilters} className="page-btn page-btn-secondary mt-3">Show everything</button>
                  </div>
                ) : URGENCIES.map((level) => {
                  const inSection = visible.filter((entry) => entry.urgency === level.id);
                  if (!inSection.length) return null;
                  return <TodoSection key={level.id} urgency={level} items={inSection} busy={busy} onAct={act} onEdit={setEditing} />;
                })}
              </>
            )}
          </div>

          {/* ── Side column (below the list on phones) ── */}
          <aside aria-label="Reminders and more" className="min-w-0 space-y-4 lg:sticky lg:top-0">
            <RemindersPanel reminders={reminders} onNew={() => setEditing({})} onEdit={setEditing} />
            <HiddenPanel items={data?.hidden_items ?? []} busy={busy} onRestore={restore} />
            <PhoneAlertsCard />
          </aside>
        </div>
      </div>

      {editing !== null && <ReminderModal key={editing.id || 'new'} reminder={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
