import React from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

/**
 * Shared confirmation dialog for destructive actions.
 *
 * This repo had no reusable confirm component before -- destructive paths used
 * `window.confirm` with a generic message (Settings/Accounts.jsx, Vendors.jsx,
 * Marketplaces.jsx, Cashouts.jsx, pages/Transactions.jsx). The status-workflow
 * plan requires a confirmation that states the concrete consequence, which
 * `window.confirm` cannot style or test, so this is new -- but it reuses
 * VersionHistoryModal.jsx's overlay/panel markup and the shared
 * useModalKeyboard hook so it looks and behaves like every other modal here.
 *
 * `consequence` is required and must describe what actually happens -- never
 * "Are you sure?".
 */
const ConfirmDialog = ({
  open,
  title,
  consequence,
  confirmLabel = 'Confirm',
  // "Go back", not "Cancel": the confirm button carries the action's own label,
  // and several of those labels *are* "Cancel"/"Cancel Sale" -- two buttons both
  // reading "Cancel" in one dialog is exactly the ambiguity this dialog exists
  // to remove.
  cancelLabel = 'Go back',
  busy = false,
  onConfirm,
  onClose,
}) => {
  // Block Escape-to-dismiss while the action is in flight, so a half-sent
  // request cannot lose its dialog.
  const modalRef = useModalKeyboard(open, () => { if (!busy) onClose?.(); });
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose?.(); }} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Confirm action'}
        className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl flex flex-col"
      >
        <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            {title || 'Confirm action'}
          </h2>
          <button
            type="button"
            aria-label="Close"
            disabled={busy}
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-sm text-gray-300 whitespace-pre-line">{consequence}</p>
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3 h-8 rounded-lg border border-white/10 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="px-3 h-8 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
