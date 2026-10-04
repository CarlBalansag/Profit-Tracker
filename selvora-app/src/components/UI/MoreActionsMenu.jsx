import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import useRecordActions from '../../hooks/useRecordActions';
import ConfirmDialog from './ConfirmDialog';
import MarkPaidModal from './MarkPaidModal';
import ActionFormModal from './ActionFormModal';
import { actionNeedsFormFields, consequenceFor, NAVIGATE_ACTIONS, actionButtonLabel } from '../../data/statusActions';

// bg-[#16181d] is declared explicitly here (not just inherited from the panel
// behind it) so each item always has its own real, non-transparent background
// rather than `transparent`/`rgba(0,0,0,0)` -- some OS/browser accessibility
// tools read an element's own background-color (not what's actually painted
// through an ancestor) when deciding whether text needs a contrast fix, and a
// "transparent" reading on reddish text can trigger one even though the text
// already has plenty of real contrast against the panel it sits on.
const MENU_ITEM = 'w-full text-left px-3 py-2 text-xs font-medium text-gray-300 bg-[#16181d] hover:bg-white/5 disabled:opacity-50 transition-colors';

/**
 * The trigger + dropdown for a record's secondary actions -- corrections,
 * void/cancel, and anything else that doesn't earn a permanent button on the
 * card. A standalone sibling of ContextualActions (not a sub-part of it) so it
 * can be placed anywhere on a card independently, e.g. next to the quick
 * status dropdown rather than crammed into the primary button row.
 *
 * Props mirror ContextualActions: record, kind, actions (override), onSuccess.
 * Renders nothing when the record has no secondary actions.
 */
const MoreActionsMenu = ({ record, kind, actions, onSuccess, className = '' }) => {
  const descriptors = (actions || record?.allowed_actions || []).filter((entry) => entry.secondary);
  const { runAction, pendingAction } = useRecordActions({ kind, record, onSuccess });
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: 'confirm'|'form'|'paid', descriptor }
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const dismissOnOutsideClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const dismissOnEscape = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', dismissOnOutsideClick);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('mousedown', dismissOnOutsideClick);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  if (descriptors.length === 0) return null;

  const busy = (descriptor) => pendingAction === descriptor.action;

  const activate = (descriptor) => {
    setOpen(false);
    if (descriptor.action === 'mark_paid') {
      setDialog({ mode: 'paid', descriptor });
      return;
    }
    if (descriptor.requiresForm && actionNeedsFormFields(descriptor.action, kind, record, descriptor)) {
      setDialog({ mode: 'form', descriptor });
      return;
    }
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

  return (
    <div className={`relative shrink-0 ${className}`} ref={rootRef}>
      <button
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-center w-7 h-7 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 w-56 z-40 rounded-lg bg-[#16181d] border border-white/10 shadow-xl py-1 overflow-hidden"
        >
          {descriptors.map((descriptor) => {
            const to = NAVIGATE_ACTIONS[descriptor.action];
            if (to) {
              return (
                <Link
                  key={descriptor.action}
                  to={to}
                  role="menuitem"
                  className={`block ${MENU_ITEM}`}
                  onClick={() => setOpen(false)}
                >
                  {descriptor.label}
                </Link>
              );
            }
            return (
              <button
                key={descriptor.action}
                type="button"
                role="menuitem"
                disabled={pendingAction !== null}
                onClick={() => activate(descriptor)}
                className={`${MENU_ITEM} ${descriptor.destructive ? 'text-red-300 hover:bg-red-500/10' : ''}`}
              >
                {busy(descriptor) ? 'Working…' : actionButtonLabel(descriptor)}
              </button>
            );
          })}
        </div>
      )}

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

export default MoreActionsMenu;
