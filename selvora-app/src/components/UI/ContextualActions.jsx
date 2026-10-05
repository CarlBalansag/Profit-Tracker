import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import useRecordActions from '../../hooks/useRecordActions';
import ConfirmDialog from './ConfirmDialog';
import MarkPaidModal from './MarkPaidModal';
import ActionFormModal from './ActionFormModal';
import { actionNeedsFormFields, consequenceFor, NAVIGATE_ACTIONS, actionButtonLabel } from '../../data/statusActions';

// inline-flex items-center justify-center: a <button> centers its text by
// default in most browsers, but the record_sale action renders as a <Link>
// (an <a> tag) with this same class -- without explicit centering, its text
// sits at the tag's normal line-height position instead, visibly misaligned
// next to a real <button> in the same row.
const BUTTON_PRIMARY = 'inline-flex items-center justify-center px-2.5 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap';
const BUTTON_DESTRUCTIVE = 'inline-flex items-center justify-center px-2.5 h-7 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50 text-xs font-medium transition-colors whitespace-nowrap';

/**
 * The primary action buttons for a record -- the 1-2 most relevant things to
 * do right now. Secondary (less-common, correction, or destructive) actions
 * live in the sibling MoreActionsMenu component instead, so a card's primary
 * row never grows past a couple of buttons.
 *
 * Takes the descriptors the API already attached to the record
 * (`record.allowed_actions`, added in checkpoint 2) -- it never derives them.
 *
 * Props:
 *   record     the inventory or sale row, including `allowed_actions`.
 *   kind       'inventory' | 'sale'.
 *   actions    optional override for record.allowed_actions.
 *   onSuccess  called with the updated record after any action succeeds.
 *
 * Requires a react-router context (the Record Sale action renders a <Link>).
 */
const ContextualActions = ({ record, kind, actions, onSuccess, className = '' }) => {
  const descriptors = actions || record?.allowed_actions || [];
  const { runAction, pendingAction } = useRecordActions({ kind, record, onSuccess });
  const [dialog, setDialog] = useState(null); // { mode: 'confirm'|'form'|'paid', descriptor }

  const primary = descriptors.filter((d) => !d.secondary);

  // Nothing is ever fired straight from a click unless the registry says the
  // action needs neither a form nor a confirmation.
  const activate = (descriptor) => {
    if (descriptor.action === 'mark_paid') {
      setDialog({ mode: 'paid', descriptor });
      return;
    }
    if (descriptor.requiresForm && actionNeedsFormFields(descriptor.action, kind, record, descriptor)) {
      setDialog({ mode: 'form', descriptor });
      return;
    }
    // A form-requiring action with no server-kept payload (e.g. report_return,
    // whose transition only stamps return_requested_at) must not show an empty
    // form. It falls back to the confirmation, which is what the plan asks for
    // anyway -- the consequence is stated and the confirm press is the commitment.
    if (descriptor.destructive || descriptor.requiresForm) {
      setDialog({ mode: 'confirm', descriptor });
      return;
    }
    runAction(descriptor.action, {}, descriptor);
  };

  const submitDialog = async (payload) => {
    const { descriptor } = dialog;
    const updated = await runAction(descriptor.action, payload, descriptor);
    if (updated) setDialog(null);
  };

  const busy = (descriptor) => pendingAction === descriptor.action;

  // Nothing at all for this record, anywhere -- not even behind the More menu.
  if (descriptors.length === 0) {
    return <span className={`text-xs text-gray-600 ${className}`}>No action needed</span>;
  }
  // Secondary-only: there is nothing to put in the primary row, but the record
  // does have actions available (MoreActionsMenu renders them elsewhere), so
  // this is not the same as "nothing at all" above.
  if (primary.length === 0) return null;

  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`}>
      {primary.map((descriptor) => {
        const to = NAVIGATE_ACTIONS[descriptor.action];
        if (to) {
          return (
            <Link key={descriptor.action} to={to} className={BUTTON_PRIMARY}>
              {descriptor.label}
            </Link>
          );
        }
        return (
          <button
            key={descriptor.action}
            type="button"
            disabled={pendingAction !== null}
            onClick={() => activate(descriptor)}
            className={descriptor.destructive ? BUTTON_DESTRUCTIVE : BUTTON_PRIMARY}
          >
            {busy(descriptor) ? 'Working…' : actionButtonLabel(descriptor)}
          </button>
        );
      })}

      {dialog?.mode === 'confirm' && (
        <ConfirmDialog
          open
          title={dialog.descriptor.label}
          consequence={consequenceFor(dialog.descriptor.action, kind, record)}
          confirmLabel={dialog.descriptor.label}
          busy={busy(dialog.descriptor)}
          onConfirm={() => submitDialog({})}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.mode === 'form' && (
        <ActionFormModal
          open
          action={dialog.descriptor.action}
          label={dialog.descriptor.label}
          kind={kind}
          record={record}
          descriptor={dialog.descriptor}
          consequence={dialog.descriptor.destructive ? consequenceFor(dialog.descriptor.action, kind, record) : null}
          busy={busy(dialog.descriptor)}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.mode === 'paid' && (
        <MarkPaidModal
          open
          sale={record}
          busy={busy(dialog.descriptor)}
          onSubmit={submitDialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};

export default ContextualActions;
