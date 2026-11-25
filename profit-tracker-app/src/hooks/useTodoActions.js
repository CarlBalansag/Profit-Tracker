import { toast } from 'sonner';
import { useEmailRuleMutations, useReminderMutations, useTodoState } from './useApi';
import { whenText } from '../components/Todos/todoMeta';
import { addDays, localToday } from '../utils/returnWindow';

const DONE_TEXT = { snooze: 'Snoozed.', dismiss: 'Dismissed.', done: 'Marked paid.', until_paid: "Hidden until it's paid." };
// A month or more is "Holding" (todoMeta HOLDS), and says so.
const doneText = (action, days) => (action === 'snooze' && days >= 30 ? 'On hold.' : DONE_TEXT[action]);

const failed = (what) => (err) => toast.error(`Could not ${what}: ${err.message}`);

// What can be done with a to-do, the same on the To-Do page and the Dashboard:
// snooze, dismiss, mark paid (a card bill), complete (a reminder) and handled
// (a store's cancellation, refund or check email). Each can be undone from its
// message. A folded row (`fold`, with its `items`) does all of them at once.
export default function useTodoActions() {
  const mutation = useTodoState();
  const { complete, undoComplete } = useReminderMutations();
  const { handled } = useEmailRuleMutations();

  const completeReminder = (entry) => {
    const { id } = entry.reminder;
    complete.mutate({ id, due_date: entry.reminder.due_date }, {
      onSuccess: ({ reminder, previous }) => toast.success(
        reminder.done_at ? 'Done.' : `Done. Next one ${whenText(reminder)}.`,
        { action: { label: 'Undo', onClick: () => undoComplete.mutate({ id, due_date: previous.due_date }, { onError: failed('undo') }) } },
      ),
      onError: failed('save'),
    });
  };

  const markHandled = async (entry) => {
    const id = entry.email_attention.order_id;
    try {
      await handled.mutateAsync(id);
      toast.success('Done.', {
        action: { label: 'Undo', onClick: () => { handled.mutateAsync({ id, undo: true }).catch(failed('undo')); } },
      });
    } catch (err) {
      failed('save')(err);
    }
  };

  // A folded row: the same choice for each of its items, one toast for all.
  const actOnAll = async (row, action, days) => {
    const until = action === 'snooze' ? addDays(localToday(), days) : undefined;
    const keys = row.items.map((entry) => entry.key);
    try {
      await Promise.all(keys.map((key) => mutation.mutateAsync({ key, action, until })));
      toast.success(`${keys.length} ${action === 'until_paid' ? 'hidden until paid.' : doneText(action, days).toLowerCase()}`, {
        action: { label: 'Undo', onClick: () => keys.forEach((key) => mutation.mutate({ key, action: 'restore' })) },
      });
    } catch (err) {
      toast.error(`Could not save all of them: ${err.message}`);
    }
  };

  const act = (entry, action, days) => {
    if (entry.fold) { actOnAll(entry, action, days); return; }
    if (action === 'complete') { completeReminder(entry); return; }
    if (action === 'handled') { markHandled(entry); return; }
    const until = action === 'snooze' ? addDays(localToday(), days) : undefined;
    mutation.mutate({ key: entry.key, action, until }, {
      onSuccess: () => toast.success(doneText(action, days), {
        action: { label: 'Undo', onClick: () => mutation.mutate({ key: entry.key, action: 'restore' }) },
      }),
      onError: failed('save'),
    });
  };

  const restore = (entry) => mutation.mutate({ key: entry.key, action: 'restore' }, {
    onSuccess: () => toast.success('Back on your list.'),
    onError: failed('bring it back'),
  });

  return { act, restore, busy: mutation.isPending || complete.isPending || handled.isPending };
}
