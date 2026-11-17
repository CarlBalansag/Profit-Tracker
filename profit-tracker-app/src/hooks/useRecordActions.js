import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, useInvalidate } from './useApi';
import { toastWithUndo } from '../utils/undoToast';

// `kind` -> REST collection. Matches the two endpoints checkpoint 2 added:
// POST /api/inventory/:id/actions/:action and POST /api/sales/:id/actions/:action.
const BASE_PATH = { inventory: '/api/inventory', sale: '/api/sales' };

// `check_tracking` is an allowed action but not a stored state transition (the
// registry deliberately leaves it out of INVENTORY_TRANSITIONS/SALE_TRANSITIONS):
// the user presses it, the carrier answers, and the normalized result decides the
// transition server-side. It therefore goes to the pre-existing /track endpoint
// that Shipping.jsx already uses, not to the action endpoint.
const TRACK_ACTION = 'check_tracking';

// ─── Undo ────────────────────────────────────────────────────────────────────
// Every stored action is logged server-side (services/activityLog.js) and the
// response carries its `activity_id`, so the toast's Undo asks the server to
// reverse exactly that action -- including the ones that move stock or write
// dates (Cancel, Void, Mark Paid, Mark Return Received...). The server refuses
// with a reason if something changed since, which the toast shows.

const errorMessage = async (response) => {
  const body = await response.json().catch(() => ({}));
  return body.error || body.message || `Request failed (${response.status})`;
};

/**
 * Performs one contextual action against the status-workflow endpoints.
 *
 * Uses the app's existing HTTP conventions: `apiFetch` from hooks/useApi (which
 * adds the X-Requested-With CSRF header and credentials) and `useInvalidate` to
 * refresh the react-query caches, the same pattern pages/Shipping.jsx uses.
 *
 * Returns { runAction, loading, error, pendingAction }:
 *   runAction(action, payload, descriptor) -> the updated record, or null on
 *     failure (the error is surfaced via a toast and on `error`).
 *   loading       true while any action is in flight.
 *   pendingAction the action name in flight, so a caller can spin one button.
 */
export function useRecordActions({ kind, record, onSuccess } = {}) {
  const invalidate = useInvalidate();
  const [pendingAction, setPendingAction] = useState(null);
  const [error, setError] = useState(null);

  const post = useCallback(async (action, payload) => {
    const base = BASE_PATH[kind];
    if (!base) throw new Error(`Unknown record kind "${kind}"`);
    const path = action === TRACK_ACTION
      ? `${base}/${record.id}/track`
      : `${base}/${record.id}/actions/${action}`;

    const response = await apiFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json().catch(() => ({}));
  }, [kind, record?.id]);

  // A status change can move money and inventory quantity at once (a void
  // restores units and drops the sale out of realized revenue), so every action
  // refreshes both record caches and the dashboard rather than guessing.
  const refresh = useCallback(() => {
    invalidate.inventory();
    invalidate.sales();
    invalidate.dashboard();
  }, [invalidate]);

  const runAction = useCallback(async (action, payload, descriptor = {}) => {
    if (!record?.id) {
      setError('No record to act on');
      return null;
    }

    setPendingAction(action);
    setError(null);
    try {
      const updated = await post(action, payload);
      refresh();

      const label = descriptor.label || action;
      // Undo refreshes everything: it can move stock and money as well.
      toastWithUndo(`${label} — done.`, updated?.activity_id, invalidate.all);

      onSuccess?.(updated);
      return updated;
    } catch (err) {
      setError(err.message);
      toast.error(`${descriptor.label || action} failed: ${err.message}`);
      return null;
    } finally {
      setPendingAction(null);
    }
  }, [record, post, refresh, invalidate, onSuccess]);

  return { runAction, loading: pendingAction !== null, pendingAction, error };
}

export default useRecordActions;
