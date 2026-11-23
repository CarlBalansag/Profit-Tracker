import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight, Check, Mail, X } from 'lucide-react';
import { toast } from 'sonner';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { useEmailMatchPreview, useEmailOrderMutations } from '../../hooks/useApi';
import { orderRef } from '../../utils/emailRefs';

// "Review & link": the record an email order would be linked to, laid out
// like the record itself, with the blanks linking fills in highlighted
// (api services/email/linkPreview.js). Nothing is written until Link.

const RECORD = { purchase: 'Your purchase', sale: 'Your sale', expense: 'Your expense' };
const usd = (v) => (v == null ? null : Number(v).toLocaleString(undefined, { style: 'currency', currency: 'USD' }));
const shortDay = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : null);
const DATE_KEYS = new Set(['purchase_date', 'sale_date', 'date']);
const show = (field, value) => (value && DATE_KEYS.has(field.key) ? shortDay(value) : value);

function FieldRow({ field }) {
  const fills = field.fill !== undefined;
  if (field.conflict) {
    return (
      <div className="grid grid-cols-[minmax(84px,auto)_1fr] items-baseline gap-x-3 rounded-lg border-l-2 border-[color:var(--dp-warning-text)] bg-[var(--dp-warning-bg)] px-3 py-2">
        <dt className="text-xs font-semibold text-[var(--dp-warning-text)]">{field.label}</dt>
        <dd className="min-w-0 text-sm">
          <span className="break-all text-gray-200">{field.value}</span>
          <span className="block break-all text-xs text-[var(--dp-warning-text)]">Email says {orderRef(field.conflict)}</span>
        </dd>
      </div>
    );
  }
  return (
    <div className={`grid grid-cols-[minmax(84px,auto)_1fr] items-baseline gap-x-3 rounded-lg border-l-2 px-3 py-2 ${fills ? 'border-[color:var(--accent)] bg-[var(--accent-bg)]' : 'border-transparent'}`}>
      <dt className={`text-xs ${fills ? 'font-semibold text-[var(--accent)]' : 'text-gray-500'}`}>{field.label}</dt>
      <dd className="min-w-0 text-sm">
        {fills ? (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
            <span className="text-xs italic text-gray-500">blank</span>
            <ArrowRight size={12} aria-hidden="true" className="text-[var(--accent)]" />
            <span className="break-all font-semibold text-[var(--dp-text-primary)]">{field.fill}</span>
            <span className="sr-only">(filled in by linking)</span>
          </span>
        ) : (
          <span className={field.value ? 'break-words text-gray-200' : 'text-gray-600'}>{show(field, field.value) || '—'}</span>
        )}
      </dd>
    </div>
  );
}

export default function LinkReviewModal({ matchId, onClose, onLinked }) {
  const linkRef = useRef(null);
  const cancelRef = useRef(null);
  const { data, isLoading, isError, error } = useEmailMatchPreview(matchId);
  const { accept } = useEmailOrderMutations();
  const busy = accept.isPending;
  const modalRef = useModalKeyboard(Boolean(matchId), () => { if (!busy) onClose(); }, linkRef);
  const warned = Boolean(data?.warnings?.length);
  // A likely wrong match: start on Cancel so Enter doesn't link it.
  useEffect(() => { if (warned) cancelRef.current?.focus(); }, [warned]);
  if (!matchId) return null;

  const fills = data ? data.records.reduce((t, r) => t + r.fields.filter((f) => f.fill !== undefined).length, 0) : 0;
  const link = async () => {
    try {
      await accept.mutateAsync(matchId);
      toast.success(fills ? `Linked. Filled in ${fills} ${fills === 1 ? 'field' : 'fields'}.` : 'Linked.');
      onLinked?.();
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  const order = data?.order;

  // Into the workspace root (as Cashout's modals do), above the sidebar and
  // with the theme's variables.
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={() => { if (!busy) onClose(); }} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-review-title"
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] dp-elevated sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id="link-review-title" className="text-base font-semibold">Link this order</h2>
            <p className="mt-0.5 text-xs text-gray-500">Highlighted fields are blank now and get filled in. Nothing you typed changes.</p>
          </div>
          <button type="button" aria-label="Close" disabled={busy} onClick={onClose} className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-[var(--dp-text-primary)] disabled:opacity-40">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
          {isError && <p className="text-sm text-[var(--dp-red-text)]">{error?.message || 'Could not load this match.'}</p>}
          {data && (
            <>
              <section aria-label="From your email" className="flex gap-3 rounded-xl bg-white/[0.03] px-3.5 py-3">
                <Mail size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-100">
                    {order.store}
                    <span className="ml-2 text-xs font-normal text-gray-500">{[order.order_number && orderRef(order.order_number), usd(order.total), shortDay(order.date)].filter(Boolean).join(' · ')}</span>
                  </p>
                  {order.items.length > 0 && <p className="mt-0.5 truncate text-xs text-gray-400" title={order.items.join(', ')}>{order.items.join(', ')}</p>}
                </div>
              </section>

              {warned && (
                <div role="alert" className="flex gap-2.5 rounded-xl bg-[var(--dp-warning-bg)] px-3.5 py-3 text-sm text-[var(--dp-warning-text)]">
                  <AlertTriangle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    {data.warnings.map((w) => <p key={w.code}>{w.text}</p>)}
                  </div>
                </div>
              )}

              {data.records.map((record) => (
                <section key={record.id} aria-label={record.title || RECORD[data.match.record_type]}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    {data.records.length > 1 ? record.title : RECORD[data.match.record_type]}
                  </h3>
                  <dl className="space-y-0.5">
                    {record.fields.map((field) => <FieldRow key={field.key} field={field} />)}
                  </dl>
                </section>
              ))}

              {data.also.length > 0 && (
                <ul className="space-y-1 border-t border-white/[0.06] pt-3 text-xs text-gray-400">
                  {data.also.map((line) => (
                    <li key={line} className="flex gap-2"><Check size={13} aria-hidden="true" className="mt-px shrink-0 text-gray-500" />{line}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-[color:var(--dp-border)] px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
          <button ref={cancelRef} type="button" disabled={busy} onClick={onClose} className="page-btn page-btn-secondary">Cancel</button>
          <button ref={linkRef} type="button" disabled={busy || !data} onClick={link} className={`page-btn ${warned ? 'page-btn-secondary' : 'page-btn-primary'}`}>
            <Check size={14} aria-hidden="true" /> {busy ? 'Linking…' : warned ? 'Link anyway' : fills ? `Link and fill ${fills}` : 'Link'}
          </button>
        </div>
      </div>
    </div>,
    host,
  );
}
