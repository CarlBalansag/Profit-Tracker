// The one Undo used everywhere: the toast right after an action and the
// Activity page both call the server's POST /api/activity/:id/undo, which
// reverses the logged action exactly or refuses with a reason
// (profit-tracker-api/services/activityLog.js).
import { toast } from 'sonner';
import { apiFetch } from '../hooks/useApi';

export async function undoActivity(activityId) {
  const response = await apiFetch(`/api/activity/${encodeURIComponent(activityId)}/undo`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status})`);
  return body;
}

// A success toast with an Undo button when the action was logged.
// `activityId` is one entry id, or a list of them for a batch (e.g. several
// rows deleted at once): Undo reverses them newest first and stops at the
// first one the server refuses, saying how far it got.
// `onUndone` runs after an undo that changed anything (refresh what the caller
// shows). `options` go to sonner, e.g. { id } to replace a "Saving…" toast.
export function toastWithUndo(message, activityId, onUndone, options = {}) {
  const ids = (Array.isArray(activityId) ? activityId : [activityId]).filter(Boolean);
  if (!ids.length) {
    if (Object.keys(options).length) toast.success(message, options);
    else toast.success(message);
    return;
  }
  toast.success(message, {
    // Long enough to notice a mistake and reach the button (sonner's own
    // default is 4 s). The Activity page keeps the undo for 30 days anyway.
    duration: 10000,
    ...options,
    action: {
      label: 'Undo',
      onClick: async () => {
        let done = 0;
        try {
          for (const id of [...ids].reverse()) {
            await undoActivity(id);
            done += 1;
          }
          onUndone?.();
          toast.success('Undone.');
        } catch (err) {
          if (done) onUndone?.();
          const progress = ids.length > 1 ? ` (${done} of ${ids.length} undone)` : '';
          toast.error(`Could not undo${progress}: ${err.message}`);
        }
      },
    },
  });
}
