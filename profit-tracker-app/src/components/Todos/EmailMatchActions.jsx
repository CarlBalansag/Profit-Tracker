import React from 'react';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailOrderMutations } from '../../hooks/useApi';

// Yes / no on an order from email, right on its To-Do: linking fills blank
// fields on the record (Undo is on the Automation and Activity pages).
export default function EmailMatchActions({ entry }) {
  const { accept, reject } = useEmailOrderMutations();
  const busy = accept.isPending || reject.isPending;
  const run = async (mutation, done) => {
    try {
      await mutation.mutateAsync(entry.email_match.id);
      toast.success(done);
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <>
      <button type="button" disabled={busy} onClick={() => run(accept, 'Linked')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
        <Check className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Yes, link</span><span className="sr-only">Yes, link: {entry.title}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => run(reject, 'Marked as not a match')} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
        <X className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Not this</span><span className="sr-only">Not this: {entry.title}</span>
      </button>
    </>
  );
}
