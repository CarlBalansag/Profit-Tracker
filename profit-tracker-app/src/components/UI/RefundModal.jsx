import React, { useRef } from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import RefundsPanel from '../RefundsPanel';
import { REFUND_KIND, refundableUnits } from '../../data/statusActions';

/**
 * The quick route to the same Refunds panel the transaction detail window
 * shows: past refunds on this record (removable) plus the add form. Each add or
 * remove saves right away and refreshes every screen (useRefundMutations
 * invalidates all queries), so the modal itself holds no state of its own.
 */
const RefundModal = ({ open, kind, record, title, onClose }) => {
  const closeRef = useRef(null);
  const modalRef = useModalKeyboard(open, () => onClose?.(), closeRef);

  if (!open || !record) return null;

  const productName = record.product_name || record.inventory?.product_name || '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={() => onClose?.()} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated flex flex-col text-[var(--dp-text-primary)]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-[color:var(--dp-border)]">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">{title}</h2>
            {productName && <p className="text-xs text-[var(--dp-text-secondary)] truncate">{productName}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="shrink-0 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-4">
          <RefundsPanel kind={REFUND_KIND[kind]} id={record.id} maxUnits={refundableUnits(kind, record)} />
        </div>
      </div>
    </div>
  );
};

export default RefundModal;
