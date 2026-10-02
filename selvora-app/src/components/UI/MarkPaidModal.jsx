import React, { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { saleEconomics } from '../../../../shared/finance.mjs';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

// The expected payout for this sale: gross price less commission and outbound
// shipping. Reuses shared/finance.mjs rather than restating the arithmetic;
// `revenue` there needs only the sale's own fields, so the inventory batch is
// not required (and may not be loaded on every screen).
const expectedAmount = (sale) => {
  if (!sale) return '';
  const { revenue } = saleEconomics({}, sale);
  return Number.isFinite(revenue) && revenue > 0 ? revenue.toFixed(2) : '';
};

/**
 * The only way to trigger `mark_paid`.
 *
 * The payment date is deliberately NOT pre-filled: the server rejects a
 * mark_paid without one (statusTransitions.REQUIRED_ACTION_PAYLOADS), and the
 * plan is explicit that there is no one-click Mark Paid anywhere. The amount is
 * pre-filled with the sale's expected payout purely as a convenience -- it is
 * still an editable field behind an explicit Submit.
 *
 * Submitting is the confirmation; there is no second "Are you sure?" after it.
 */
const MarkPaidModal = ({ open, sale, busy = false, onSubmit, onClose }) => {
  const dateRef = useRef(null);
  const modalRef = useModalKeyboard(open, () => { if (!busy) onClose?.(); }, dateRef);

  const [paidDate, setPaidDate] = useState('');
  const [amount, setAmount] = useState(() => expectedAmount(sale));
  const [reference, setReference] = useState('');

  if (!open) return null;

  const amountNumber = Number(amount);
  const amountValid = amount !== '' && Number.isFinite(amountNumber) && amountNumber >= 0;
  const canSubmit = Boolean(paidDate) && amountValid && !busy;

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({
      paid_date: paidDate,
      amount: amountNumber.toFixed(2),
      reference: reference.trim() || null,
    });
  };

  const field = 'w-full bg-[#0d0d18] border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-indigo-500/50';
  const labelClass = 'block text-[11px] uppercase font-semibold text-gray-500 tracking-wider mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!busy) onClose?.(); }} />
      <form
        ref={modalRef}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Mark Paid"
        className="relative w-full max-w-sm rounded-2xl bg-[#16181d] border border-white/10 shadow-2xl flex flex-col"
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/[0.06]">
          <h2 className="text-base font-semibold text-white">Mark Paid</h2>
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
          <div>
            <label className={labelClass} htmlFor="mark-paid-date">Payment date</label>
            <input
              id="mark-paid-date"
              ref={dateRef}
              type="date"
              value={paidDate}
              onChange={(e) => setPaidDate(e.target.value)}
              className={field}
            />
            <p className="text-[11px] text-gray-600 mt-1">Required — enter the date the money actually landed.</p>
          </div>

          <div>
            <label className={labelClass} htmlFor="mark-paid-amount">Amount received</label>
            <input
              id="mark-paid-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={field}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="mark-paid-reference">Reference (optional)</label>
            <input
              id="mark-paid-reference"
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Payout ID, transfer note…"
              className={field}
            />
          </div>
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
            {busy ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default MarkPaidModal;
