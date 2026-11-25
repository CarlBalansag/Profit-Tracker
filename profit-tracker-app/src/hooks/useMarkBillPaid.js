import { toast } from 'sonner';
import { useTodoState } from './useApi';

// Marks one card bill paid (or not paid again), with Undo. A bill is the To-Do
// list's own item, so this clears it there too.
// Awaited rather than passed as mutate callbacks, which are dropped when the
// page is left (or another bill is marked) before the save comes back.
export function useMarkBillPaid() {
  const mutation = useTodoState();
  const undo = async (key) => {
    try {
      await mutation.mutateAsync({ key, action: 'restore' });
    } catch (err) {
      toast.error(`Could not undo: ${err.message}`);
    }
  };
  const markPaid = async (key) => {
    try {
      await mutation.mutateAsync({ key, action: 'done' });
      toast.success('Marked paid.', { action: { label: 'Undo', onClick: () => undo(key) } });
    } catch (err) {
      toast.error(`Could not save: ${err.message}`);
    }
  };
  return { markPaid, undo, saving: Boolean(mutation.isPending) };
}
