import { formatMoney } from '../utils/money';
import React, { useState } from 'react';
import { Trash2, Undo2 } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { toast } from 'sonner';
import { useInvalidate, useRefunds, useRefundMutations } from '../hooks/useApi';
import { toastWithUndo } from '../utils/undoToast';
import InfoTip from './UI/InfoTip';
import { localToday, toDateOnly } from '../utils/returnWindow';
import { fullRefundPrefill, refundUnitPrice } from '../utils/refundPrefill';

const LABEL = 'block text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label,var(--dp-text-secondary))] mb-1';
const INPUT = 'w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-sm text-[var(--dp-text-primary)] placeholder-[color:var(--dp-text-muted)] focus:outline-none focus:border-[var(--dp-accent)] transition-colors';
const SMALL_BTN = 'px-2.5 py-1 rounded-md text-xs font-medium transition-colors disabled:opacity-50';
const ICON_BTN = 'p-1 rounded-md text-[var(--dp-text-muted)] hover:text-[var(--dp-red-text)] hover:bg-[var(--dp-hover-bg)] transition-colors disabled:opacity-50';

const COPY = {
  purchase: {
    title: 'Refunds from the store',
    hint: 'Record money the store gave back, and any units you sent back.',
    amount: 'Money back ($)',
    amountName: 'money back',
    amountTip: 'How much money the store gave back to you. It lowers what this purchase cost, so your profit on what you sell goes up.',
    units: 'Units returned to store',
    unitsTip: 'How many units you physically sent back. They leave your stock. Leave it at 0 if you kept the item, e.g. a price adjustment.',
    full: 'Returning everything — full refund',
    fullBasis: 'item price + tax',
    keep: "I kept the item and I'm still selling it",
    keepHint: 'Units stay in stock to sell, and the refund comes off their cost.',
    price: (each) => `Paid $${each} each (item + tax)`,
  },
  sale: {
    title: 'Refunds to the buyer',
    hint: 'Record money you gave back to the buyer, and any units they sent back.',
    amount: 'Money refunded ($)',
    amountName: 'money refunded',
    amountTip: 'How much money you gave back to the buyer. Enter what you are actually out, after any fee credit. It lowers what you made on this sale.',
    units: 'Units buyer sent back',
    unitsTip: 'How many units the buyer sent back to you. They go back into your stock so you can sell them again.',
    full: 'Returning everything — full refund',
    fullBasis: 'what the buyer paid',
    keep: 'The buyer kept the item',
    keepHint: 'Nothing comes back into your stock.',
    price: (each) => `Sold for $${each} each`,
  },
};
const DATE_TIP = 'The day the refund happened.';
const NOTE_TIP = 'Optional. Anything you want to remember, like where you returned it.';
const MotionDiv = motion.div;
const EASE = [0.16, 1, 0.3, 1];
const CHECK = 'mt-0.5 w-4 h-4 shrink-0 accent-[var(--dp-accent)] cursor-pointer';

function FieldLabel({ htmlFor, label, name, tip, align }) {
  return (
    <div className="flex items-center gap-1 mb-1 min-w-0">
      <label className={`${LABEL.replace(' mb-1', '')} truncate`} htmlFor={htmlFor}>{label}</label>
      <InfoTip name={name} text={tip} align={align} />
    </div>
  );
}

const emptyDraft = () => ({ amount: '', quantity: '', date: localToday(), note: '' });

// Records refunds on one purchase or one sale. Each add/delete saves
// immediately (independently of the edit window's Update button) and then
// calls onChanged so the window can pick up the new totals and stock.
//
// variant="modal" is the Statuses quick-refund popup (UI/RefundModal): the
// popup's own header already names it, so the panel drops its title row, and
// the narrower popup gets a two-column form with the save button on its own
// footer row instead of four cramped columns.
//
// `record` is the purchase or sale itself. With it the panel can show what was
// paid per unit and offer the "Returning everything" prefill; without it both
// are simply left out.
export default function RefundsPanel({ kind, id, maxUnits = 0, disabledReason = '', onChanged, variant = 'inline', record = null }) {
  const modal = variant === 'modal';
  const [full, setFull] = useState(false);
  const [keep, setKeep] = useState(false);
  const reduceMotion = useReducedMotion();
  const copy = COPY[kind];
  const { data: refunds = [], isLoading } = useRefunds(kind, id);
  const { add, remove } = useRefundMutations(kind, id);
  const invalidate = useInvalidate();
  // After an Undo from the toast: refresh everything (stock, totals, this list)
  // and let the window holding this panel pick up the new totals too.
  const afterUndo = () => { invalidate.all(); onChanged?.(); };
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
      const saved = await add.mutateAsync({ amount, quantity, date: draft.date || localToday(), note: draft.note.trim() || null });
      setDraft(emptyDraft());
      setFull(false);
      setKeep(false);
      toastWithUndo('Refund recorded.', saved?.activity_id, afterUndo);
      onChanged?.();
    } catch (err) {
      setError(err.message || 'Could not record the refund.');
    }
  };

  const confirmDelete = async (refundId) => {
    try {
      const removed = await remove.mutateAsync(refundId);
      setConfirmId(null);
      toastWithUndo('Refund removed.', removed?.activity_id, afterUndo);
      onChanged?.();
    } catch (err) {
      setConfirmId(null);
      toast.error(err.message || 'Could not remove the refund.');
    }
  };

  // Only a prefill: the fields stay editable after it runs.
  const applyFull = (nextFull, nextKeep) => {
    setFull(nextFull);
    setKeep(nextFull && nextKeep);
    setDraft((prev) => (nextFull
      ? { ...prev, ...fullRefundPrefill(kind, record, maxUnits, { keep: nextKeep }) }
      : { ...prev, amount: '', quantity: '' }));
  };
  const canPrefill = !!record && maxUnits > 0;
  const unitPrice = record ? formatMoney(refundUnitPrice(kind, record)) : null;
  const preview = canPrefill ? fullRefundPrefill(kind, record, maxUnits) : null;
  const unitWord = (n) => `${n} unit${n === 1 ? '' : 's'}`;
  const footerText = `${unitPrice ? `${copy.price(unitPrice)} · ` : ''}Up to ${unitWord(maxUnits)} can come back. Saved right away.`;

  const total = refunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const units = refunds.reduce((sum, r) => sum + (Number(r.quantity) || 0), 0);

  return (
    <section className={modal ? 'space-y-4' : 'space-y-3'} aria-label={copy.title}>
      {modal ? (
        refunds.length > 0 && (
          <div className="flex items-center gap-2">
            <h4 className={LABEL.replace(' mb-1', '')}>Recorded</h4>
            <span className="ml-auto text-xs text-emerald-400">
              −${formatMoney(total)}{units > 0 ? ` · ${units} unit${units === 1 ? '' : 's'} back` : ''}
            </span>
          </div>
        )
      ) : (
        <div className="flex items-center gap-2">
          <Undo2 className="w-3.5 h-3.5 text-[var(--dp-text-secondary)]" />
          <h4 className="text-xs font-semibold text-[var(--dp-text-primary)]">{copy.title}</h4>
          {refunds.length > 0 && (
            <span className="ml-auto text-xs text-emerald-400">
              −${formatMoney(total)}{units > 0 ? ` · ${units} unit${units === 1 ? '' : 's'} back` : ''}
            </span>
          )}
        </div>
      )}

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

      {kind === 'purchase' && refunds.length > 0 && (
        <p className="text-xs text-[var(--dp-text-secondary)]">
          {maxUnits} unit{maxUnits === 1 ? '' : 's'} still available to sell · {units} sent back
        </p>
      )}

      {disabledReason ? (
        <p className="text-xs text-[var(--dp-text-muted)]">{disabledReason}</p>
      ) : (
        <div className={modal ? 'space-y-3' : 'space-y-2'}>
          <p className={modal ? 'text-xs leading-relaxed text-[var(--dp-text-secondary)]' : 'text-[11px] text-[var(--dp-text-muted)]'}>{copy.hint}</p>
          {canPrefill && (
            <div className="rounded-lg border border-[color:var(--dp-border)] px-3 py-2.5">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input type="checkbox" checked={full} onChange={(e) => applyFull(e.target.checked, keep)} className={CHECK} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-[var(--dp-text-primary)]">{copy.full}</span>
                  <span className="block text-xs text-[var(--dp-text-muted)]">
                    Fills in {unitWord(maxUnits)} and ${formatMoney(Number(preview.amount))} ({copy.fullBasis}). You can still change anything.
                  </span>
                </span>
              </label>
              {/* Grows open instead of popping in and making the popup jump.
                  Same motion pattern as the Dashboard pipeline's item list:
                  like the rest of the app it still animates under reduced
                  motion, just shorter. */}
              <AnimatePresence initial={false}>
                {full && (
                  <MotionDiv
                    key="keep"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: reduceMotion ? 0.15 : 0.3, ease: EASE }}
                    className="overflow-hidden"
                  >
                    <label className="flex items-start gap-2.5 pl-6 pt-2.5 cursor-pointer">
                      <input type="checkbox" checked={keep} onChange={(e) => applyFull(true, e.target.checked)} className={CHECK} />
                      <span className="min-w-0">
                        <span className="block text-sm text-[var(--dp-text-primary)]">{copy.keep}</span>
                        <span className="block text-xs text-[var(--dp-text-muted)]">{copy.keepHint}</span>
                      </span>
                    </label>
                  </MotionDiv>
                )}
              </AnimatePresence>
            </div>
          )}
          {/* Two columns at most: the labels are full phrases now, and four
              columns in the 640px detail window cut them off. */}
          <div className={modal ? 'grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-3' : 'grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2'}>
            <div className="min-w-0">
              <FieldLabel htmlFor={`refund-amount-${id}`} label={copy.amount} name={copy.amountName} tip={copy.amountTip} />
              <input id={`refund-amount-${id}`} type="number" min="0" step="0.01" placeholder="0.00" value={draft.amount} onChange={e => set('amount', e.target.value)} className={INPUT} />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`refund-units-${id}`} label={copy.units} name={copy.units.toLowerCase()} tip={copy.unitsTip} align="right" />
              <input id={`refund-units-${id}`} type="number" min="0" max={maxUnits} step="1" placeholder="0" value={draft.quantity} onChange={e => set('quantity', e.target.value)} className={INPUT} />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`refund-date-${id}`} label="Date" name="the date" tip={DATE_TIP} />
              <input id={`refund-date-${id}`} type="date" value={draft.date} onChange={e => set('date', e.target.value)} className={INPUT} />
            </div>
            <div className="min-w-0">
              <FieldLabel htmlFor={`refund-note-${id}`} label="Note" name="the note" tip={NOTE_TIP} align="right" />
              <input id={`refund-note-${id}`} type="text" placeholder="e.g. price match" value={draft.note} onChange={e => set('note', e.target.value)} className={INPUT} />
            </div>
          </div>
          {error && <p role="alert" className="text-xs text-[var(--dp-red-text,#f87171)]">{error}</p>}
          {modal ? (
            <div className="flex items-center justify-between gap-3 pt-3 border-t border-[color:var(--dp-border)]">
              <span className="text-xs text-[var(--dp-text-muted)]">{footerText}</span>
              <button type="button" disabled={busy} onClick={submit} className="shrink-0 px-4 h-9 rounded-lg text-sm font-semibold bg-[var(--dp-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
                {add.isPending ? 'Saving…' : 'Add refund'}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" disabled={busy} onClick={submit} className={`${SMALL_BTN} bg-[var(--dp-accent)] text-white hover:opacity-90`}>
                {add.isPending ? 'Saving…' : 'Add refund'}
              </button>
              <span className="text-[11px] text-[var(--dp-text-muted)]">{footerText}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
