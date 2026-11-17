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
// `onUndone` runs after a successful undo (refresh whatever the caller shows).
// `options` go to sonner, e.g. { id } to replace a "Saving…" loading toast.
export function toastWithUndo(message, activityId, onUndone, options = {}) {
  if (!activityId) {
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
        try {
          await undoActivity(activityId);
          onUndone?.();
          toast.success('Undone.');
        } catch (err) {
          toast.error(`Could not undo: ${err.message}`);
        }
      },
    },
  });
}
