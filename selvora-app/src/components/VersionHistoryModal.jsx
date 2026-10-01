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
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div ref={modalRef} className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl max-h-[80vh] flex flex-col">

        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white">What's New</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          {CHANGELOG.map((entry) => (
            <div key={entry.version}>
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--accent)]">v{entry.version}</span>
                <span className="text-[11px] text-gray-500">{formatDate(entry.date)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

export default VersionHistoryModal;
