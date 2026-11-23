import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { ORDER_FIELDS, finishOrderMapping, missingOrderColumns } from '../../utils/orderCsv';

// Opens when an order file isn't Amazon's own export: the user says which
// column holds each detail, sees the first rows read that way, and the file
// goes on as if it were Amazon's. Opens above the import review, so it sits a
// layer higher.
const selectClass = 'w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 h-9 text-sm text-gray-200 focus:outline-none focus:border-[var(--accent)]';

export function OrderColumnMap({ mapping, onDone, onCancel }) {
  const [columns, setColumns] = useState(mapping.guess);
  const [error, setError] = useState(null);
  const modalRef = useModalKeyboard(true, onCancel);
  const missing = missingOrderColumns(columns);
  const cell = (row, key) => (columns[key] === '' ? '' : String(row[Number(columns[key])] ?? '').trim());

  const confirm = () => {
    try {
      onDone(finishOrderMapping(mapping, columns));
    } catch (err) {
      setError(err.message);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onCancel} />
      <div ref={modalRef} className="relative flex w-full sm:w-[min(760px,94vw)] max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-4 sm:px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-white">Match the columns</h2>
            <p className="mt-0.5 text-xs text-gray-500 break-words">
              {mapping.name} isn&apos;t Amazon&apos;s own export. Pick the column that holds each detail. Only these columns are sent.
            </p>
          </div>
          <button type="button" aria-label="Close" onClick={onCancel} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5 theme-scrollbar">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {ORDER_FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={`order-col-${f.key}`} className="block text-xs text-gray-400 mb-1">
                  {f.label}{f.required ? <span className="text-amber-300"> (needed)</span> : <span className="text-gray-500"> (optional)</span>}
                </label>
                <select
                  id={`order-col-${f.key}`}
                  className={selectClass}
                  value={columns[f.key]}
                  aria-invalid={f.required && columns[f.key] === '' ? 'true' : undefined}
                  onChange={(e) => { setError(null); setColumns((c) => ({ ...c, [f.key]: e.target.value })); }}
                >
                  <option value="">Not in this file</option>
                  {mapping.headers.map((h, i) => <option key={`${h}-${i}`} value={String(i)}>{h || `Column ${i + 1}`}</option>)}
                </select>
                {f.hint && <p className="text-xs text-gray-500 mt-1">{f.hint}</p>}
              </div>
            ))}
          </div>

          <section aria-labelledby="order-col-preview" className="space-y-2">
            <h3 id="order-col-preview" className="text-sm font-semibold text-white">First rows, read this way</h3>
            <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
              {mapping.sample.map((row, i) => (
                <li key={i} className="px-3 py-2 text-xs">
                  <div className="text-gray-200 line-clamp-2 break-words">{cell(row, 'name') || <span className="text-amber-300">No item name</span>}</div>
                  <div className="text-gray-500 break-words">
                    {[cell(row, 'orderId') || 'no order number', cell(row, 'orderDate') || 'no date', `${cell(row, 'qty') || '?'} × ${cell(row, 'unitPrice') || '?'}`, cell(row, 'tracking')].filter(Boolean).join(' · ')}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="shrink-0 border-t border-[color:var(--dp-border)] px-4 sm:px-6 py-3 space-y-2">
          {(error || missing.length > 0) && (
            <p role={error ? 'alert' : undefined} className={`text-sm sm:text-right ${error ? 'text-red-400' : 'text-gray-400'}`}>
              {error || `Still needed: ${missing.map((f) => f.label.toLowerCase()).join(', ')}.`}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <button type="button" onClick={onCancel} className="page-btn px-4 h-10 sm:h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5">
              Cancel
            </button>
            <button type="button" onClick={confirm} disabled={missing.length > 0} className="page-btn px-4 h-10 sm:h-9 rounded-lg bg-[var(--accent)] text-sm font-medium text-white disabled:opacity-50">
              Use these columns
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.querySelector('.carbon-workspace, .glass-workspace') || document.body,
  );
}

export default OrderColumnMap;
