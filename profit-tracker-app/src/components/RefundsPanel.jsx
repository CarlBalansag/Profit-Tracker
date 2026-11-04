import { formatMoney } from '../utils/money';
import React, { useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useRefunds, useRefundMutations } from '../hooks/useApi';
import { localToday, toDateOnly } from '../utils/returnWindow';

const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label,var(--dp-text-secondary))] mb-1';
const INPUT = 'w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors';
const SMALL_BTN = 'px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50';
const ICON_BTN = 'p-1 rounded-md text-[var(--dp-text-muted)] hover:text-[var(--dp-red-text)] hover:bg-[var(--dp-hover-bg)] transition-colors disabled:opacity-50';

const COPY = {
  purchase: {
    title: 'Refunds from the store',
    hint: 'Money back on this purchase: a return, a price adjustment, a damaged-box credit. Units sent back leave your stock.',
    units: 'Units sent back',
  },
  sale: {
    title: 'Refunds to the buyer',
    hint: 'Money you gave back on this sale. Enter what you are actually out (after any fee credit). Units the buyer sent back return to your stock.',
    units: 'Units returned by buyer',
  },
};

const emptyDraft = () => ({ amount: '', quantity: '', date: localToday(), note: '' });

// Records refunds on one purchase or one sale. Each add/delete saves
// immediately (independently of the edit window's Update button) and then
// calls onChanged so the window can pick up the new totals and stock.
export default function RefundsPanel({ kind, id, maxUnits = 0, disabledReason = '', onChanged }) {
  const copy = COPY[kind];
  const { data: refunds = [], isLoading } = useRefunds(kind, id);
  const { add, remove } = useRefundMutations(kind, id);
  const [draft, setDraft] = useState(emptyDraft);
  const [error, setError] = useState('');
  const [confirmId, setConfirmId] = useState(null);
  const set = (key, value) => setDraft(prev => ({ ...prev, [key]: value }));
  const busy = add.isPending || remove.isPending;

  const submit = async (e) => {
    e?.preventDefault?.();
    const amount = draft.amount === '' ? 0 : Number(draft.amount);
    const quantity = draft.quantity === '' ? 0 : Number(draft.quantity);
    if (!Number.isFinite(amount) || amount < 0) return setError('Enter a refund amount of $0 or more.');
    if (!Number.isInteger(quantity) || quantity < 0) return setError('Units must be a whole number.');
    if (amount === 0 && quantity === 0) return setError('Enter a refund amount or the number of units returned.');
    if (quantity > maxUnits) return setError(`Only ${maxUnits} unit${maxUnits === 1 ? '' : 's'} can be returned here.`);
    setError('');
    try {
      await add.mutateAsync({ amount, quantity, date: draft.date || localToday(), note: draft.note.trim() || null });
      setDraft(emptyDraft());
      toast.success('Refund recorded.');
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not record the refund.');
    }
  };

  const confirmDelete = async (refundId) => {
    try {
      await remove.mutateAsync(refundId);
      setConfirmId(null);
      toast.success('Refund removed.');
      onChanged?.();
    } catch (err) {
      setConfirmId(null);
      toast.error(err.message || 'Could not remove the refund.');
    }
  };

  const total = refunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const units = refunds.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

  return (
    <section className="space-y-3" aria-label={copy.title}>
      <div className="flex items-center gap-2">
        <Undo2 className="w-3.5 h-3.5 text-[var(--dp-text-secondary)]" />
        <h4 className="text-xs font-semibold text-[var(--dp-text-primary)]">{copy.title}</h4>
        {refunds.length > 0 && (
          <span className="ml-auto text-xs text-emerald-400">
            −${formatMoney(total)}{units > 0 ? ` · ${units} unit${units === 1 ? '' : 's'} back` : ''}
          </span>
        )}
      </div>

      {isLoading ? (
        <p className="text-xs text-[var(--dp-text-muted)]">Loading refunds…</p>
      ) : refunds.length > 0 && (
        <ul className="space-y-1.5">
          {refunds.map(r => (
            <li key={r.id} className="flex items-start gap-2 rounded-lg px-3 py-2 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)]">
              <div className="flex-1 min-w-0 text-xs">
                <p className="text-[var(--dp-text-primary)]">
                  <span className="font-semibold text-emerald-400">−${formatMoney(Number(r.amount))}</span>
                  {r.quantity > 0 && <span className="text-[var(--dp-text-secondary)]"> · {r.quantity} unit{r.quantity === 1 ? '' : 's'} back</span>}
                  <span className="text-[var(--dp-text-muted)]"> · {toDateOnly(r.date)}</span>
                </p>
                {r.note && <p className="mt-0.5 text-[var(--dp-text-secondary)] break-words">{r.note}</p>}
              </div>
              {confirmId === r.id ? (
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-xs text-[var(--dp-text-secondary)] mr-1">Remove?</span>
                  <button type="button" disabled={busy} onClick={() => confirmDelete(r.id)} className={`${SMALL_BTN} text-[var(--dp-red-text)] bg-[var(--dp-red-bg)] hover:opacity-90`}>Remove</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmId(null)} className={`${SMALL_BTN} text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]`}>Keep</button>
                </div>
              ) : (
                <button type="button" disabled={busy || !!disabledReason} onClick={() => setConfirmId(r.id)} title="Remove refund" aria-label={`Remove refund of $${formatMoney(Number(r.amount))}`} className={ICON_BTN}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {disabledReason ? (
        <p className="text-xs text-[var(--dp-text-muted)]">{disabledReason}</p>
      ) : (
        <div className="space-y-2">
          <p className="text-[11px] text-[var(--dp-text-muted)]">{copy.hint}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className={LABEL} htmlFor={`refund-amount-${id}`}>Amount</label>
              <input id={`refund-amount-${id}`} type="number" min="0" step="0.01" placeholder="0.00" value={draft.amount} onChange={e => set('amount', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`refund-units-${id}`}>{copy.units}</label>
              <input id={`refund-units-${id}`} type="number" min="0" max={maxUnits} step="1" placeholder="0" value={draft.quantity} onChange={e => set('quantity', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`refund-date-${id}`}>Date</label>
              <input id={`refund-date-${id}`} type="date" value={draft.date} onChange={e => set('date', e.target.value)} className={INPUT} />
            </div>
            <div>
              <label className={LABEL} htmlFor={`refund-note-${id}`}>Note</label>
              <input id={`refund-note-${id}`} type="text" placeholder="e.g. price match" value={draft.note} onChange={e => set('note', e.target.value)} className={INPUT} />
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-[var(--dp-red-text,#f87171)]">{error}</p>}
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} onClick={submit} className={`${SMALL_BTN} bg-[var(--dp-accent)] text-white hover:opacity-90`}>
              {add.isPending ? 'Saving…' : 'Add refund'}
            </button>
            <span className="text-[11px] text-[var(--dp-text-muted)]">Up to {maxUnits} unit{maxUnits === 1 ? '' : 's'} can come back. Saved right away.</span>
          </div>
        </div>
      )}
    </section>
  );
}
