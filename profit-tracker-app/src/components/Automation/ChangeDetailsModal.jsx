import React, { useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ExternalLink, Mail, X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { changeDetails } from '../../utils/changeDetails';

// Details of one automatic change: each field it wrote, before -> now, read
// from the change's own Activity snapshot. Read-only; Confirm / No stay on
// the row (and are repeated here for a phone, where the row is far away).

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');
const LINK = 'inline-flex min-h-[32px] shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--accent)] hover:bg-white/[0.05]';

// The emails this order came from, each opening in Gmail, and the store's
// order page when it has one.
function SourceEmails({ source }) {
  const emails = (source.emails || []).filter((m) => m.subject || m.url);
  if (!emails.length && !source.store_url) return null;
  return (
    <section aria-label="From your email">
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        From your email{source.order_number ? ` · ${source.store} ${source.order_number}` : ''}
      </h3>
      <ul className="divide-y divide-white/[0.05] rounded-xl bg-white/[0.03]">
        {emails.map((m, i) => (
          <li key={`${m.sent_at}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
            <Mail size={13} aria-hidden="true" className="shrink-0 text-gray-500" />
            <span className="min-w-0 flex-1 truncate text-sm text-gray-200" title={m.subject || undefined}>{m.subject || 'No subject'}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-gray-500">{day(m.sent_at)}</span>
            {m.url && <a href={m.url} target="_blank" rel="noopener noreferrer" className={LINK}>Open<span className="sr-only"> {m.subject} in Gmail (new tab)</span><ExternalLink size={11} aria-hidden="true" /></a>}
          </li>
        ))}
      </ul>
      {source.store_url && (
        <a href={source.store_url} target="_blank" rel="noopener noreferrer" className={`${LINK} mt-1.5 -ml-2`}>
          See the order on {source.store}<ExternalLink size={11} aria-hidden="true" />
        </a>
      )}
    </section>
  );
}

const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function ChangeDetailsModal({ entry, change, actions, onClose }) {
  const closeRef = useRef(null);
  const modalRef = useModalKeyboard(Boolean(entry), onClose, closeRef);
  if (!entry) return null;
  const { sections, note } = changeDetails(entry);

  // Into the workspace root (as Cashout's modals do), above the sidebar and
  // with the theme's variables.
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="change-details-title"
        className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] dp-elevated sm:max-w-lg sm:rounded-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-5 pb-4 pt-5">
          <div className="min-w-0">
            <h2 id="change-details-title" className="text-base font-semibold">{change.title}</h2>
            <p className="mt-0.5 truncate text-xs text-gray-500">{[change.subject, when(entry.created_at)].filter(Boolean).join(' · ')}</p>
          </div>
          <button ref={closeRef} type="button" aria-label="Close" onClick={onClose} className="-mr-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:text-[var(--dp-text-primary)]">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {sections.map((section) => (
            <section key={section.title} aria-label={section.title}>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{section.title}</h3>
              <dl className="divide-y divide-white/[0.05] rounded-xl bg-white/[0.03]">
                {section.rows.map((row) => (
                  <div key={row.label} className="grid grid-cols-[minmax(84px,auto)_1fr] items-baseline gap-x-3 px-3 py-2">
                    <dt className="text-xs text-gray-500">{row.label}</dt>
                    <dd className="min-w-0 text-sm">
                      {row.before !== undefined ? (
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                          <span className="break-words text-gray-500 line-through decoration-gray-600">{row.before}</span>
                          <ArrowRight size={12} aria-hidden="true" className="text-[var(--accent)]" />
                          <span className="break-words font-semibold text-[var(--dp-text-primary)]">{row.after}</span>
                          <span className="sr-only">(was {row.before}, now {row.after})</span>
                        </span>
                      ) : (
                        <span className={`whitespace-pre-line break-words ${section.removed ? 'text-gray-500 line-through' : 'text-gray-200'}`}>{row.after}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {!sections.length && <p className="text-sm text-gray-500">No field details were saved for this change.</p>}
          {entry.email_source && <SourceEmails source={entry.email_source} />}
          {note && <p className="text-xs text-gray-500">{note}</p>}
        </div>

        {actions && (
          <div className="flex justify-end gap-2 border-t border-[color:var(--dp-border)] px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {actions}
          </div>
        )}
      </div>
    </div>,
    host,
  );
}
