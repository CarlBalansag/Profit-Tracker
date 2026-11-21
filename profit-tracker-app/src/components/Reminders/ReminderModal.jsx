import React, { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { usePaymentMethods, useReminderMutations } from '../../hooks/useApi';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { localToday } from '../../utils/returnWindow';

const REPEAT_OPTIONS = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'weekly', label: 'Every week' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Every month' },
  { value: 'yearly', label: 'Every year' },
];

const blank = () => ({ title: '', due_date: localToday(), due_time: '', repeat: 'none', payment_method_id: '', notes: '' });

// 16px text on phones so iOS doesn't zoom into the field; compact from sm up.
const FIELD = 'w-full rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)]';
const LABEL = 'block text-xs font-medium text-[var(--dp-text-secondary)] mb-1.5';

const fromReminder = (reminder) => ({
  title: reminder.title ?? '',
  due_date: reminder.due_date ?? localToday(),
  due_time: reminder.due_time ?? '',
  repeat: reminder.repeat ?? 'none',
  payment_method_id: reminder.payment_method_id ?? '',
  notes: reminder.notes ?? '',
});

// New or edit reminder. `reminder` (with an id) edits; without, it's a new one.
// Mounted only while open (keyed by the reminder), so it starts from it fresh.
export default function ReminderModal({ reminder, onClose }) {
  const { create, update, remove } = useReminderMutations();
  const { data: paymentMethods = [] } = usePaymentMethods();
  const isEdit = Boolean(reminder?.id);
  const [form, setForm] = useState(() => (reminder?.id ? fromReminder(reminder) : blank()));
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = create.isPending || update.isPending || remove.isPending;
  const modalRef = useModalKeyboard(true, () => { if (!pending) onClose(); });

  const set = (field) => (event) => setForm((current) => ({ ...current, [field]: event.target.value }));

  const save = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) { setError('Give the reminder a title.'); return; }
    if (!form.due_date) { setError('Pick a date.'); return; }
    setError('');
    const payload = {
      title: form.title.trim(),
      due_date: form.due_date,
      due_time: form.due_time || null,
      repeat: form.repeat,
      payment_method_id: form.payment_method_id || null,
      notes: form.notes.trim() || null,
    };
    try {
      if (isEdit) await update.mutateAsync({ id: reminder.id, ...payload });
      else await create.mutateAsync(payload);
      toast.success(isEdit ? 'Reminder saved.' : 'Reminder added.');
      onClose();
    } catch (err) {
      setError(err.message || 'Could not save the reminder.');
    }
  };

  const destroy = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      await remove.mutateAsync(reminder.id);
      toast.success('Reminder deleted.');
      onClose();
    } catch (err) {
      setError(err.message || 'Could not delete the reminder.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={() => { if (!pending) onClose(); }} />
      <form
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reminder-modal-title"
        onSubmit={save}
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] dp-elevated"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[color:var(--dp-border)] px-5 py-3">
          <h2 id="reminder-modal-title" className="text-base font-semibold">{isEdit ? 'Edit reminder' : 'New reminder'}</h2>
          <button type="button" aria-label="Close" onClick={onClose} disabled={pending} className="rounded-lg p-1.5 text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {error && (
            <p role="alert" className="rounded-lg border border-[color:var(--dp-red-text)]/20 bg-[var(--dp-red-bg)] px-3 py-2 text-sm text-[var(--dp-red-text)]">{error}</p>
          )}

          <div>
            <label htmlFor="reminder-title" className={LABEL}>What</label>
            <input id="reminder-title" type="text" value={form.title} onChange={set('title')} maxLength={200} placeholder="e.g. Call Amex about the credit" className={FIELD} autoFocus={!isEdit} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="reminder-date" className={LABEL}>Date</label>
              <input id="reminder-date" type="date" value={form.due_date} onChange={set('due_date')} className={FIELD} />
            </div>
            <div>
              <label htmlFor="reminder-time" className={LABEL}>Time <span className="text-[var(--dp-text-muted)]">(optional)</span></label>
              <input id="reminder-time" type="time" value={form.due_time} onChange={set('due_time')} className={FIELD} />
            </div>
          </div>

          <div>
            <label htmlFor="reminder-repeat" className={LABEL}>Repeat</label>
            <select id="reminder-repeat" value={form.repeat} onChange={set('repeat')} className={FIELD}>
              {REPEAT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="reminder-card" className={LABEL}>About a card <span className="text-[var(--dp-text-muted)]">(optional)</span></label>
            <select id="reminder-card" value={form.payment_method_id} onChange={set('payment_method_id')} className={FIELD}>
              <option value="">No card</option>
              {paymentMethods.map((card) => (
                <option key={card.id} value={card.id}>{card.last4 ? `${card.name} ••${card.last4}` : card.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="reminder-notes" className={LABEL}>Notes <span className="text-[var(--dp-text-muted)]">(optional)</span></label>
            <textarea id="reminder-notes" value={form.notes} onChange={set('notes')} rows={3} maxLength={1000} className={`${FIELD} resize-none`} />
          </div>

          <p className="text-xs text-[var(--dp-text-muted)]">
            Shows on your To-Do list from 3 days before, and on the Calendar. If you subscribed to the calendar feed, your phone's calendar can alert you{form.due_time ? ' at this time' : ' at 9 AM that day'}.
          </p>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[color:var(--dp-border)] px-5 py-3">
          <div>
            {isEdit && (
              <button type="button" onClick={destroy} disabled={pending} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-[var(--dp-red-text)] hover:opacity-80 disabled:opacity-50">
                <Trash2 size={14} aria-hidden="true" /> {confirmDelete ? 'Delete for good?' : 'Delete'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="page-btn page-btn-secondary">Cancel</button>
            <button type="submit" disabled={pending} className="page-btn page-btn-primary">
              {pending ? 'Saving…' : isEdit ? 'Save' : 'Add reminder'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
