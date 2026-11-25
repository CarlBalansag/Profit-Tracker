import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CircleCheck, ExternalLink, Mail, X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import useRecordActions from '../../hooks/useRecordActions';
import { consequenceFor } from '../../data/statusActions';
import { openTodoLink } from '../../utils/todoLink';
import { orderRef } from '../../utils/emailRefs';
import { money } from './todoMeta';

// What the store's email said, and what it means for the linked purchases.
const SAID = {
  cancelled: 'The store emailed that this order was cancelled.',
  refund: 'The store emailed that this order was refunded or returned.',
  deposit_check: 'A check is waiting for you. It can only be printed once, so print it when you are ready to deposit it, then mark this done.',
};
const STEP = {
  cancelled: 'It is not marked cancelled in your records yet.',
  refund: 'Open your purchase and record the refund so your totals stay right.',
};
const NO_RECORD = 'It is not linked to a purchase in your records, so there is nothing to change. Mark it done when you have seen it.';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null);

// One linked purchase: Open, and Cancel (asked once more, in place) when the
// store cancelled the order and the purchase still can be.
function Purchase({ record, onOpen }) {
  const qc = useQueryClient();
  const [asking, setAsking] = useState(false);
  const askRef = useRef(null);
  // On a short screen the question opens below the fold.
  useEffect(() => {
    if (asking) askRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [asking]);
  const { runAction, pendingAction } = useRecordActions({
    kind: 'inventory',
    record,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos'] });
      qc.invalidateQueries({ queryKey: ['email'] });
    },
  });
  const busy = pendingAction !== null;
  const cancel = async () => {
    await runAction('cancel', {}, { ...record.cancel, label: 'Cancel purchase' });
    setAsking(false);
  };
  return (
    <li className="space-y-3 py-3 first:pt-0 last:pb-0">
      <div>
        <p className="break-words text-sm font-medium">{record.quantity > 1 && `${record.quantity} × `}{record.name}</p>
        <p className="mt-0.5 text-xs text-[var(--dp-text-secondary)]">
          {[money(record.amount), day(record.date) && `bought ${day(record.date)}`, record.cancelled && 'already cancelled'].filter(Boolean).join(' · ')}
        </p>
      </div>
      {asking ? (
        <div ref={askRef} role="group" aria-label={`Cancel ${record.name}?`} className="space-y-3 rounded-xl bg-[var(--dp-warning-bg)] px-3.5 py-3">
          <p className="text-sm text-[var(--dp-warning-text)]">{consequenceFor('cancel', 'inventory', record)}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={cancel} className="page-btn page-btn-primary">{busy ? 'Cancelling…' : 'Yes, cancel it'}</button>
            <button type="button" disabled={busy} onClick={() => setAsking(false)} className="page-btn page-btn-secondary">Go back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {record.cancel && (
            <button type="button" onClick={() => setAsking(true)} className="page-btn page-btn-primary">
              <span aria-hidden="true">Cancel purchase</span><span className="sr-only">{`Cancel purchase: ${record.name}`}</span>
            </button>
          )}
          <button type="button" onClick={() => onOpen(record)} className="page-btn page-btn-secondary">
            <ExternalLink size={14} aria-hidden="true" /><span aria-hidden="true">Open purchase</span><span className="sr-only">{`Open purchase: ${record.name}`}</span>
          </button>
        </div>
      )}
    </li>
  );
}

// An email to-do opened: what the store said, the purchase it is about, and
// the ways to clear it, without leaving the page.
export default function EmailAttentionModal({ entry, busy, onAct, onClose }) {
  const navigate = useNavigate();
  const modalRef = useModalKeyboard(true, onClose);
  const { kind, store, order_number: number, date, records } = entry.email_attention;
  const openPurchase = (record) => {
    onClose();
    openTodoLink(navigate, { kind: 'transaction', inventoryId: record.id, saleId: null });
  };
  const act = (action) => {
    onAct(entry, action);
    onClose();
  };

  // Into the workspace root, above the sidebar and with the theme's variables.
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-attention-title"
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] dp-elevated sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-5 pb-4 pt-5">
          <h2 id="email-attention-title" className="min-w-0 break-words text-base font-semibold">{entry.title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <section aria-label="From your email" className="flex gap-3 rounded-xl bg-[var(--dp-hover-bg)] px-3.5 py-3">
            <Mail size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--dp-text-secondary)]" />
            <div className="min-w-0">
              <p className="break-words text-xs text-[var(--dp-text-secondary)]">
                {[store, number && orderRef(number), entry.amount != null && money(entry.amount), day(date)].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-sm">{[SAID[kind], records.length > 0 && STEP[kind]].filter(Boolean).join(' ')}</p>
            </div>
          </section>

          {kind !== 'deposit_check' && (records.length ? (
            <section aria-labelledby="email-attention-records">
              <h3 id="email-attention-records" className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-secondary)]">
                {records.length > 1 ? 'Your purchases' : 'Your purchase'}
              </h3>
              <ul className="divide-y divide-[color:var(--dp-border)]">
                {records.map((record) => <Purchase key={record.id} record={record} onOpen={openPurchase} />)}
              </ul>
            </section>
          ) : <p className="text-sm text-[var(--dp-text-secondary)]">{NO_RECORD}</p>)}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-[color:var(--dp-border)] px-5 py-4">
          <button type="button" disabled={busy} onClick={() => act('dismiss')} className="page-btn page-btn-secondary">Dismiss</button>
          <button type="button" disabled={busy} onClick={() => act('handled')} className={`page-btn ${records.some((r) => r.cancel) ? 'page-btn-secondary' : 'page-btn-primary'}`}>
            <CircleCheck size={14} aria-hidden="true" /> Mark done
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
