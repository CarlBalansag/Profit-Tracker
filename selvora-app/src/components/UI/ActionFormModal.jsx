import React, { useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { displayLabel } from '../../data/statusWorkflow';
import { fieldsForAction } from '../../data/statusActions';

/**
 * Small generic form for the `requiresForm: true` actions other than mark_paid
 * (which has its own dedicated MarkPaidModal).
 *
 * The field list per action comes from data/statusActions.js `fieldsForAction`,
 * which is derived from what the server actually accepts.
 *
 * Saving the form IS the confirmation (the plan forbids a second "Are you
 * sure?" after a form), so when the registry marks a form action destructive the
 * consequence is shown inside the form instead of in a separate dialog.
 */

const initialValues = (fields, record) => {
  const values = {};
  for (const field of fields) {
    if (field.name === 'quantity') values[field.name] = String(Number(record?.quantity) || 0);
    else if (field.name === 'qty_on_hand') values[field.name] = String(Number(record?.qty_on_hand) || 0);
    else if (field.type === 'select') values[field.name] = '';
    else values[field.name] = '';
  }
  return values;
};

const ActionFormModal = ({ open, action, label, kind, record, consequence, busy = false, onSubmit, onClose }) => {
  const firstRef = useRef(null);
  const modalRef = useModalKeyboard(open, () => { if (!busy) onClose?.(); }, firstRef);
  const fields = useMemo(() => fieldsForAction(action, kind, record), [action, kind, record]);
  const [values, setValues] = useState(() => initialValues(fields, record));

  if (!open) return null;

  const missing = fields.some((f) => f.required && String(values[f.name] ?? '').trim() === '');
  const canSubmit = !missing && !busy;

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    const payload = {};
    for (const field of fields) {
      const raw = String(values[field.name] ?? '').trim();
      if (raw === '') continue;
      payload[field.name] = field.type === 'number' ? Number(raw) : raw;
    }
    onSubmit?.(payload);
  };

  const fieldClass = 'w-full bg-[#0d0d18] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500/50';
  const labelClass = 'block text-[11px] uppercase font-semibold text-gray-500 tracking-wider mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose?.(); }} />
      <form
        ref={modalRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={label || action}
        className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white">{label || action}</h2>
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

        <div className="px-5 py-4 space-y-3">
          {consequence && (
            <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 whitespace-pre-line">
              {consequence}
            </p>
          )}
          {fields.map((field, index) => {
            const id = `action-field-${field.name}`;
            const common = {
              id,
              ref: index === 0 ? firstRef : undefined,
              value: values[field.name] ?? '',
              onChange: (e) => setValues((prev) => ({ ...prev, [field.name]: e.target.value })),
              className: fieldClass,
            };
            return (
              <div key={field.name}>
                <label className={labelClass} htmlFor={id}>{field.label}</label>
                {field.type === 'select' ? (
                  <select {...common}>
                    <option value="">Select…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>{displayLabel(option)}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    {...common}
                    type={field.type}
                    min={field.min}
                    max={field.max}
                    step={field.type === 'number' ? 1 : undefined}
                  />
                )}
                {field.hint && <p className="text-[11px] text-gray-600 mt-1">{field.hint}</p>}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-5">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="px-3 h-8 rounded-lg border border-white/10 text-xs font-medium text-gray-300 hover:bg-white/5 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold disabled:opacity-50 transition-colors"
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ActionFormModal;
