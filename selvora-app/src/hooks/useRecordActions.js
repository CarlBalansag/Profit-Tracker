import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { apiFetch, useInvalidate } from './useApi';

// `kind` -> REST collection. Matches the two endpoints checkpoint 2 added:
// POST /api/inventory/:id/actions/:action and POST /api/sales/:id/actions/:action.
const BASE_PATH = { inventory: '/api/inventory', sale: '/api/sales' };

const STATUS_FIELD = { inventory: 'receiving_status', sale: 'workflow_status' };

// `check_tracking` is an allowed action but not a stored state transition (the
// registry deliberately leaves it out of INVENTORY_TRANSITIONS/SALE_TRANSITIONS):
// the user presses it, the carrier answers, and the normalized result decides the
// transition server-side. It therefore goes to the pre-existing /track endpoint
// that Shipping.jsx already uses, not to the action endpoint.
const TRACK_ACTION = 'check_tracking';

// ─── Undo ────────────────────────────────────────────────────────────────────
// The API has no dedicated undo endpoint, so Undo is only offered where an
// *exact* inverse already exists in the registry and nothing else was written:
//
//   * list_item / unlist   -- each other; one boolean field, nothing else.
//   * pure status steps    -- `correct_status` back to the status the record was
//                             in. These transitions write only the status field,
//                             so putting it back restores the row exactly.
//
// Anything that also writes a milestone date (mark_on_hand -> received_at,
// mark_paid -> paid_at/paid_amount, mark_handed_over, add_tracking) or moves
// quantity (cancel_sale, void_sale, mark_returned, restore_inventory) gets a
// plain toast with no Undo button, because `correct_status` would leave the date
// or the restored units behind and a button that silently half-works is worse
// than no button. Destructive actions are excluded as well -- those already went
// through an explicit confirmation, so an Undo affordance is not what they need.
//
// Judgment call flagged for checkpoint 4: a real general Undo needs the server to
// return the pre-transition row (or accept a compensating action), which is a
// backend change and out of this checkpoint's scope.
const OPPOSITE_ACTION = { list_item: 'unlist', unlist: 'list_item' };

const PURE_STATUS_ACTIONS = new Set([
  'mark_purchased',
  'mark_authenticating',
  'mark_authentication_passed',
  'mark_waiting_for_scan_in',
  'mark_scanned_in',
  'mark_accepted',
  'mark_waiting_for_payment',
]);

/**
 * The compensating call that would exactly reverse `action` on `record`, or null
 * when no safe inverse exists. Computed from the record as it was *before* the
 * action ran, which is the only place the previous status still exists.
 */
export function inverseFor(kind, record, action, descriptor = {}) {
  if (descriptor.destructive) return null;

  const opposite = OPPOSITE_ACTION[action];
  if (opposite) return { action: opposite, payload: {} };

  if (!PURE_STATUS_ACTIONS.has(action)) return null;

  const previous = record?.[STATUS_FIELD[kind]];
  if (!previous) return null;

  const payload = { [STATUS_FIELD[kind]]: previous };
  // Inventory's correct_status also rewrites correction_note, so carry the
  // existing note back rather than letting the undo blank it.
  if (kind === 'inventory') payload.correction_note = record.correction_note ?? null;
  return { action: 'correct_status', payload };
}

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

    const inverse = inverseFor(kind, record, action, descriptor);
    setPendingAction(action);
    setError(null);
    try {
      const updated = await post(action, payload);
      refresh();

      const label = descriptor.label || action;
      // Only attach Undo when the inverse is genuinely available *now*: the
      // response carries the recomputed allowed_actions, so this is the record's
      // own answer rather than an assumption.
      const undoAvailable = Boolean(
        inverse && (updated.allowed_actions || []).some((d) => d.action === inverse.action),
      );

      if (undoAvailable) {
        toast.success(`${label} — done.`, {
          action: {
            label: 'Undo',
            onClick: async () => {
              try {
                await post(inverse.action, inverse.payload);
                refresh();
                toast.success(`${label} undone.`);
              } catch (err) {
                toast.error(`Could not undo: ${err.message}`);
              }
            },
          },
        });
      } else {
        toast.success(`${label} — done.`);
      }

      onSuccess?.(updated);
      return updated;
    } catch (err) {
      setError(err.message);
      toast.error(`${descriptor.label || action} failed: ${err.message}`);
      return null;
    } finally {
      setPendingAction(null);
    }
  }, [kind, record, post, refresh, onSuccess]);

  return { runAction, loading: pendingAction !== null, pendingAction, error };
}

export default useRecordActions;
