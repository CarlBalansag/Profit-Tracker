import { useState, useEffect } from 'react';
import { X, Trash2 } from 'lucide-react';
import { useCalendarMutations } from '../../hooks/useApi';

const COLOR_OPTIONS = [
  { value: 'purple', label: 'Purple', hex: '#a855f7' },
  { value: 'blue',   label: 'Blue',   hex: '#3b82f6' },
  { value: 'green',  label: 'Green',  hex: '#22c55e' },
  { value: 'amber',  label: 'Amber',  hex: '#f59e0b' },
  { value: 'red',    label: 'Red',    hex: '#ef4444' },
];

const defaultForm = {
  title: '',
  date: '',
  end_date: '',
  color: 'purple',
  notes: '',
};

export default function CalendarEventModal({ open, event, defaultDate, onClose }) {
  const { create, update, remove } = useCalendarMutations();
  const isEdit = !!event;

  const [form, setForm] = useState(defaultForm);
  const [error, setError] = useState('');

  // Sync form when modal opens
  useEffect(() => {
    if (!open) return;
    if (event) {
      setForm({
        title:    event.title ?? '',
        date:     event.date ?? '',
        end_date: event.end_date ?? '',
        color:    event.color ?? 'purple',
        notes:    event.notes ?? '',
      });
    } else {
      setForm({ ...defaultForm, date: defaultDate ?? '' });
    }
    setError('');
  }, [open, event, defaultDate]);

  if (!open) return null;

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSave = async () => {
    if (!form.title.trim()) { setError('Title is required'); return; }
    if (!form.date)         { setError('Date is required');  return; }
    setError('');

    const payload = {
      title:    form.title.trim(),
      date:     form.date,
      end_date: form.end_date || null,
      color:    form.color || null,
      notes:    form.notes || null,
    };

    try {
      if (isEdit) {
        await update.mutateAsync({ id: event.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save');
    }
  };

  const handleDelete = async () => {
    try {
      await remove.mutateAsync(event.id);
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  };

  const isPending = create.isPending || update.isPending || remove.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-md bg-[#15171d] border border-white/[0.08] rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-gray-100">
            {isEdit ? 'Edit Event' : 'New Event'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-white/[0.06] transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Title <span className="text-red-400">*</span></label>
            <input
              type="text"
              value={form.title}
              onChange={set('title')}
              placeholder="e.g. Drop day, Restock trip..."
              maxLength={200}
              className="w-full bg-[#1e2028] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">Date <span className="text-red-400">*</span></label>
              <input
                type="date"
                value={form.date}
                onChange={set('date')}
                className="w-full bg-[#1e2028] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">End Date <span className="text-gray-600">(optional)</span></label>
              <input
                type="date"
                value={form.end_date}
                onChange={set('end_date')}
                min={form.date}
                className="w-full bg-[#1e2028] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors"
              />
            </div>
          </div>

          {/* Color */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">Color</label>
            <div className="flex gap-2">
              {COLOR_OPTIONS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, color: c.value }))}
                  title={c.label}
                  className="w-7 h-7 rounded-full transition-all focus:outline-none"
                  style={{
                    backgroundColor: c.hex,
                    boxShadow: form.color === c.value ? `0 0 0 2px #15171d, 0 0 0 4px ${c.hex}` : 'none',
                    transform: form.color === c.value ? 'scale(1.15)' : 'scale(1)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1.5">Notes <span className="text-gray-600">(optional)</span></label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={3}
              maxLength={1000}
              placeholder="Any notes about this event..."
              className="w-full bg-[#1e2028] border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]/30 transition-colors resize-none"
            />
            <p className="text-xs text-gray-600 mt-1 text-right">{form.notes.length}/1000</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
          <div>
            {isEdit && (
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={isPending}
              className="px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 hover:bg-white/[0.05] rounded-lg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isPending}
              className="px-4 py-1.5 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {isPending ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Event'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
