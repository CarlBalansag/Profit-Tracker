import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';

export default function PlatformEditModal({ platform, onClose, onSave }) {
  const [form, setForm] = useState(() => ({
    name: platform.name, fee_pct: platform.fee_pct ?? 0,
    address: platform.address ?? '', notes: platform.notes ?? '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const isMarketplace = platform.type === 'Marketplace';
  const title = `Edit ${isMarketplace ? 'Marketplace' : 'Vendor'}`;

  useEffect(() => {
    const escape = event => { if (event.key === 'Escape' && !pending.current) onClose(); };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  const submit = async event => {
    event.preventDefault();
    if (pending.current) return;
    const fee = Number(form.fee_pct);
    if (!form.name.trim() || form.name.trim().length > 500) {
      setError('Enter a name between 1 and 500 characters.');
      return;
    }
    if (isMarketplace && (form.fee_pct === '' || !Number.isFinite(fee) || fee < 0 || fee > 100)) {
      setError('Enter a fee percentage from 0 to 100.');
      return;
    }
    pending.current = true;
    setSaving(true);
    setError('');
    try {
      const response = await apiFetch(`/api/platforms/${platform.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name.trim(), address: form.address, notes: form.notes,
          ...(isMarketplace ? { fee_pct: fee } : {}) }),
      });
      await requireSuccessfulResponse(response, 'Could not save changes');
      const updated = await response.json();
      onSave(updated);
      onClose();
    } catch (failure) {
      setError(failure.message || 'Could not save changes. Please retry.');
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const field = (key, value) => setForm(previous => ({ ...previous, [key]: value }));

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-labelledby="platform-edit-title"
        className="w-full max-w-md bg-[var(--bg-elevated)] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <h2 id="platform-edit-title" className="text-base font-semibold text-white">{title}</h2>
          <button type="button" aria-label="Close edit form" disabled={saving} onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <fieldset disabled={saving} className="px-6 py-5 space-y-4">
          <label className="block text-sm">Name
            <input autoFocus value={form.name} maxLength={500} onChange={event => field('name', event.target.value)}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
          </label>
          {isMarketplace && <label className="block text-sm">Fee percentage
            <input aria-label="Fee percentage" type="number" min="0" max="100" step="any" value={form.fee_pct} onChange={event => field('fee_pct', event.target.value)}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
            <span className="block text-xs text-gray-400 mt-1">Used for new sale suggestions. Existing sale commissions are preserved.</span>
          </label>}
          <label className="block text-sm">Address
            <input value={form.address} maxLength={1000} onChange={event => field('address', event.target.value)}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
          </label>
          <label className="block text-sm">Notes
            <textarea rows={3} value={form.notes} maxLength={1000} onChange={event => field('notes', event.target.value)}
              className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2" />
          </label>
        </fieldset>
        {error && <p role="alert" className="px-6 pb-3 text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3 px-6 py-4 border-t border-white/10">
          <button type="button" disabled={saving} onClick={onClose} className="px-4 py-2 rounded-lg border border-white/10">Cancel</button>
          <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg bg-indigo-600 disabled:opacity-50">{saving ? 'Saving…' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
  );
}
