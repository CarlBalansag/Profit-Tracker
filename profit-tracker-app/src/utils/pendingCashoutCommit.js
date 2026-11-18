// A cashout purchase logged before it shipped has a "pending" commitment:
// nothing was sent to the cashout yet. This event asks the app shell's
// PendingCashoutCommit dialog to offer committing it now. apiFetch fires it
// when a sale save says its new tracking number belongs to one; the
// Commitments section fires it for a commit put off earlier with "Not now".
export const PENDING_COMMIT_EVENT = 'cashout-commit-pending';

export const offerPendingCommit = (commitmentId) => {
  if (!commitmentId) return;
  window.dispatchEvent(new CustomEvent(PENDING_COMMIT_EVENT, { detail: { commitment_id: commitmentId } }));
};
