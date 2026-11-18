// A cashout purchase logged before it shipped has a "pending" commitment:
// nothing was sent to the cashout yet. This event asks the app shell's
// PendingCashoutCommit dialog to offer committing it now. apiFetch fires it
// when a sale save says its new tracking number belongs to one; the
// Commitments section fires it for a commit put off earlier with "Not now".
//
// askDirect ({ sale_id, tracking_number, cashout }) is set when the number was
// added to the purchase, not the sale: the dialog first asks whether that
// package is going straight to the cashout before using it.
export const PENDING_COMMIT_EVENT = 'cashout-commit-pending';

export const offerPendingCommit = (commitmentId, askDirect = null) => {
  if (!commitmentId) return;
  window.dispatchEvent(new CustomEvent(PENDING_COMMIT_EVENT, {
    detail: { commitment_id: commitmentId, ask_direct: askDirect || null },
  }));
};

// An active commitment whose sale has a tracking number the cashout doesn't
// have yet (it changed after committing, or the first send failed). The app
// shell asks whether to send it. detail: { commitment_id, tracking_number, cashout }
export const TRACKING_SEND_EVENT = 'cashout-tracking-send';

export const offerTrackingSend = (detail) => {
  if (!detail?.commitment_id) return;
  window.dispatchEvent(new CustomEvent(TRACKING_SEND_EVENT, { detail }));
};
