import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import useRecordActions from '../../hooks/useRecordActions';
import ConfirmDialog from './ConfirmDialog';
import MarkPaidModal from './MarkPaidModal';
import ActionFormModal from './ActionFormModal';
import RefundModal from './RefundModal';
import {
  actionNeedsFormFields, consequenceFor, NAVIGATE_ACTIONS, actionButtonLabel, refundOffered, refundMenuLabel,
} from '../../data/statusActions';

const MENU_ITEM_BASE = 'w-full text-left px-3 py-2 text-xs font-medium disabled:opacity-50 transition-colors';
// Each variant declares its own full background + text color (not just a text
// tint over an inherited background) so every item always has a real,
// non-transparent, intentional background rather than relying on the panel
// behind it to show through.
const MENU_ITEM = `${MENU_ITEM_BASE} text-gray-300 bg-[#16181d] hover:bg-white/5`;
const MENU_ITEM_DESTRUCTIVE = `${MENU_ITEM_BASE} text-white bg-red-600 hover:bg-red-700`;

/**
 * The trigger + dropdown for a record's secondary actions -- corrections,
 * void/cancel, and anything else that doesn't earn a permanent button on the
 * card. A standalone sibling of ContextualActions (not a sub-part of it) so it
 * can be placed anywhere on a card independently, e.g. next to the quick
 * status dropdown rather than crammed into the primary button row.
 *
 * Props mirror ContextualActions: record, kind, actions (override), onSuccess.
 * Renders nothing when the record has no secondary actions and no refund can
 * be recorded on it.
 *
 * The first entry is a quick Refund (sales) / Return / Refund (purchases) that
 * opens the same Refunds panel as the detail window. It is not one of the
 * API's status actions, so it is added here rather than read from
 * allowed_actions -- see refundOffered in data/statusActions.js.
 */
const MoreActionsMenu = ({ record, kind, actions, onSuccess, className = '' }) => {
  const descriptors = (actions || record?.allowed_actions || []).filter((entry) => entry.secondary);
  const showRefund = refundOffered(kind, record);
  const { runAction, pendingAction } = useRecordActions({ kind, record, onSuccess });
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState(null); // { mode: 'confirm'|'form'|'paid'|'refund', descriptor }
  const rootRef = useRef(null);
  // Which side of the ⋮ button the menu opens on, picked as it opens so the
  // whole menu stays on screen (a button near the left edge of a phone opens
  // it to the right; one near the bottom opens it upward).
  const [placement, setPlacement] = useState({ x: 'right', y: 'down' });

  const toggle = () => {
    if (!open && rootRef.current) {
      const trigger = rootRef.current.getBoundingClientRect();
      const gap = 8;
      const menuWidth = 224; // w-56
      const menuHeight = 8 + 34 * (descriptors.length + (showRefund ? 1 : 0));
      const x = trigger.right - menuWidth < gap && trigger.left + menuWidth <= window.innerWidth - gap ? 'left' : 'right';
      const spaceBelow = window.innerHeight - trigger.bottom;
      const y = spaceBelow < menuHeight + gap && trigger.top > spaceBelow ? 'up' : 'down';
      setPlacement({ x, y });
    }
    setOpen((value) => !value);
  };

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

  if (descriptors.length === 0 && !showRefund) return null;

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
        onClick={toggle}
        className="flex items-center justify-center w-7 h-7 rounded-lg border border-white/10 text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
      >
        <MoreVertical className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          // select-none: menu items are controls to click, not text to select
          // -- without it, a click that drags even slightly can leave a text
          // selection highlighted across them (in whatever selection color the
          // browser/OS uses, which need not be the default blue).
          className={`absolute ${placement.x === 'left' ? 'left-0' : 'right-0'} ${placement.y === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} w-56 max-w-[calc(100vw-1rem)] z-40 rounded-lg bg-[#16181d] border border-white/10 shadow-xl py-1 overflow-hidden select-none`}
        >
          {showRefund && (
            <button
              type="button"
              role="menuitem"
              disabled={pendingAction !== null}
              onClick={() => { setOpen(false); setDialog({ mode: 'refund' }); }}
              className={MENU_ITEM}
            >
              {refundMenuLabel(kind)}
            </button>
          )}
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
                className={descriptor.destructive ? MENU_ITEM_DESTRUCTIVE : MENU_ITEM}
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

      {dialog?.mode === 'refund' && (
        <RefundModal
          open
          kind={kind}
          record={record}
          title={refundMenuLabel(kind).replace('…', '')}
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
