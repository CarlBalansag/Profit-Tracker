import React from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { CHANGELOG } from '../data/changelog';

const formatDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const VersionHistoryModal = ({ open, onClose }) => {
  const modalRef = useModalKeyboard(open, onClose);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div ref={modalRef} className="relative w-full max-w-sm rounded-2xl bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated max-h-[80vh] flex flex-col text-[var(--dp-text-primary)]">

        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-[color:var(--dp-border)]">
          <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">What's New</h2>
          <button onClick={onClose} className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto dp-scrollbar">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--dp-accent)]">v{entry.version}</span>
                <span className="text-[11px] text-[var(--dp-text-muted)]">{formatDate(entry.date)}</span>
              </div>
              <p className="text-xs text-[var(--dp-text-secondary)] mt-0.5">{entry.notes}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default VersionHistoryModal;
