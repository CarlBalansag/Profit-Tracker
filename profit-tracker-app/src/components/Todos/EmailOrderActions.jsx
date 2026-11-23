import React from 'react';
import { Plus, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailOrderMutations, useEmailRuleMutations } from '../../hooks/useApi';

// A store order with no matching purchase, answered on its To-Do: add it as a
// purchase, or set it aside as personal ("Not business" in Settings > Email,
// where it can be brought back).
export default function EmailOrderActions({ entry }) {
  const { addPurchase } = useEmailRuleMutations();
  const { dismiss } = useEmailOrderMutations();
  const busy = addPurchase.isPending || dismiss.isPending;
  const id = entry.email_order.id;
  const run = async (fn, done) => {
    try {
      await fn();
      toast.success(done);
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => run(() => addPurchase.mutateAsync(id), 'Added as a purchase')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Add purchase</span><span className="sr-only">Add purchase: {entry.title}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => run(() => dismiss.mutateAsync({ id }), 'Set aside as personal')} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
        <UserRound className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Personal</span><span className="sr-only">Personal: {entry.title}</span>
      </button>
    </>
  );
}
