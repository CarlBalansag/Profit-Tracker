import React, { useState } from 'react';
import { Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailOrderMutations } from '../../hooks/useApi';
import LinkReviewModal from '../Settings/LinkReviewModal';

// Yes / no on an order from email, right on its To-Do. Review & link shows
// what linking fills in on the record first (Undo is on the Automation page).
export default function EmailMatchActions({ entry }) {
  const { accept, reject } = useEmailOrderMutations();
  const [reviewing, setReviewing] = useState(false);
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
      <button type="button" disabled={busy} onClick={() => setReviewing(true)} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Review &amp; link</span><span className="sr-only">Review and link: {entry.title}</span>
      </button>
      <button type="button" disabled={busy} onClick={() => run(reject, 'Marked as not a match')} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
        <X className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Not this</span><span className="sr-only">Not this: {entry.title}</span>
      </button>
      {reviewing && <LinkReviewModal matchId={entry.email_match.id} onClose={() => setReviewing(false)} />}
    </>
  );
}
