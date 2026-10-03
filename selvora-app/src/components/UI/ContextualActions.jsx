import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import useRecordActions from '../../hooks/useRecordActions';
import ConfirmDialog from './ConfirmDialog';
import MarkPaidModal from './MarkPaidModal';
import ActionFormModal from './ActionFormModal';
import { actionNeedsFormFields, consequenceFor } from '../../data/statusActions';

// `record_sale` is an allowed action but has no transition of its own -- creating
// a sale has its own route and quantity accounting, which is the Record Sale
// page. So it links there instead of POSTing to the action endpoint.
const NAVIGATE_ACTIONS = { record_sale: '/add-sale' };

const BUTTON_PRIMARY = 'px-2.5 h-7 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors whitespace-nowrap';
const BUTTON_DESTRUCTIVE = 'px-2.5 h-7 rounded-lg border border-red-500/40 text-red-300 hover:bg-red-500/10 disabled:opacity-50 text-xs font-medium transition-colors whitespace-nowrap';
const MENU_ITEM = 'w-full text-left px-3 py-2 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50 transition-colors';

/**
 * Primary action buttons for a record plus a "More" menu for the secondary ones.
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: 'confirm'|'form'|'paid', descriptor }
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const primary = descriptors.filter((d) => !d.secondary);
  const secondary = descriptors.filter((d) => d.secondary);

  // Nothing is ever fired straight from a click unless the registry says the
  // action needs neither a form nor a confirmation.
  const activate = (descriptor) => {
    setMenuOpen(false);
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

  // "Mark Paid…" / "Add Tracking…" — the ellipsis is what tells the user a form
  // opens rather than the action firing. There is never a bare one-click
  // "Mark Paid" button anywhere.
  const buttonLabel = (descriptor) =>
    (descriptor.requiresForm && !NAVIGATE_ACTIONS[descriptor.action] ? `${descriptor.label}…` : descriptor.label);

  const busy = (descriptor) => pendingAction === descriptor.action;

  if (descriptors.length === 0) {
    return <span className={`text-xs text-gray-600 ${className}`}>No action needed</span>;
  }

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
            {busy(descriptor) ? 'Working…' : buttonLabel(descriptor)}
          </button>
        );
      })}

      {secondary.length > 0 && (
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex items-center justify-center w-7 h-7 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1 w-56 z-40 rounded-lg bg-[#16181d] border border-white/10 shadow-xl py-1 overflow-hidden"
            >
              {secondary.map((descriptor) => {
                const to = NAVIGATE_ACTIONS[descriptor.action];
                if (to) {
                  return (
                    <Link key={descriptor.action} to={to} role="menuitem" className={`block ${MENU_ITEM}`} onClick={() => setMenuOpen(false)}>
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
                    {buttonLabel(descriptor)}
                  </button>
                );
              })}
            </div>
          )}
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

export default ContextualActions;
