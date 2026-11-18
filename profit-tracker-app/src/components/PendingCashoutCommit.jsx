import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, useInvalidate } from '../hooks/useApi';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { formatMoney } from '../utils/money';
import { PENDING_COMMIT_EVENT } from '../utils/pendingCashoutCommit';

const readError = async (response) => {
  const body = await response.json().catch(() => ({}));
  return body.error || `Request failed (${response.status})`;
};

// Mounted once in the app shell. Shows nothing until an event arrives.
export default function PendingCashoutCommit() {
  const [commitmentId, setCommitmentId] = useState(null);

  useEffect(() => {
    const onPending = (event) => {
      const id = event.detail?.commitment_id;
      if (id) setCommitmentId(id);
    };
    window.addEventListener(PENDING_COMMIT_EVENT, onPending);
    return () => window.removeEventListener(PENDING_COMMIT_EVENT, onPending);
  }, []);

  if (!commitmentId) return null;
  return <CommitDialog key={commitmentId} commitmentId={commitmentId} onClose={() => setCommitmentId(null)} />;
}

function CommitDialog({ commitmentId, onClose }) {
  const invalidate = useInvalidate();
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [insuredValue, setInsuredValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Starts on "Not now", so pressing Enter can't commit by accident.
  const notNowRef = useRef(null);
  const modalRef = useModalKeyboard(true, () => !busy && onClose(), notNowRef);

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/cashouts/commitments/${commitmentId}/pending`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response));
        return response.json();
      })
      .then((body) => { if (!cancelled) setPreview(body); })
      .catch((err) => { if (!cancelled) setLoadError(err.message); });
    return () => { cancelled = true; };
  }, [commitmentId]);

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cashouts/commitments/${commitmentId}/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(insuredValue ? { insured_value: Number(insuredValue) } : {}),
      });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      invalidate.sales();
      invalidate.cashouts();
      invalidate.dashboard();
      const priceNote = result.previousPayout != null
        ? ` The sale's payout changed from $${formatMoney(result.previousPayout)} to $${formatMoney(result.payout)} each.`
        : '';
      if (result.trackingSubmitted) {
        toast.success(`Committed to ${preview.cashout}, and tracking sent.`, priceNote ? { description: priceNote.trim() } : undefined);
      } else {
        toast.success(`Committed to ${preview.cashout}, but tracking failed to send.`, {
          description: `${result.trackingError || 'Resubmit it from the Commitments section.'}${priceNote}`,
        });
      }
      onClose();
    } catch (err) {
      setError(err.message);
      // A closed deal is final for this commit; show it in place of the form.
      invalidate.cashouts();
    } finally {
      setBusy(false);
    }
  };

  const later = () => {
    toast.message('Not committed yet', { description: 'You can commit it any time from Cashout > Commitments.' });
    onClose();
  };

  const name = preview?.item_name || preview?.deal_name || 'this item';
  const qty = preview?.quantity || 0;
  const payout = preview?.current_payout;
  const payoutChanged = payout != null && preview?.logged_payout != null && payout !== preview.logged_payout;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`Commit to ${preview?.cashout || 'the cashout'} now?`}
        className="w-full max-w-lg rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <div className="min-w-0">
            <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Commit to {preview?.cashout || 'the cashout'} now?</h3>
            <p className="text-[11px] text-[var(--dp-text-secondary)] mt-0.5 truncate" title={name}>{name}</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>

        {loadError && <p role="alert" className="text-xs text-rose-400">{loadError}</p>}
        {!preview && !loadError && <p className="text-xs text-[var(--dp-text-secondary)]">Checking today's payout…</p>}

        {preview && !preview.available && (
          <p role="alert" className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {preview.reason} Nothing can be committed for it now. The tracking number is saved, and the sale stays marked not committed.
          </p>
        )}

        {preview?.available && (
          <>
            <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              You added a tracking number to a purchase you logged before it shipped. Committing is a real, binding pledge to {preview.cashout}, sent with this tracking number.
            </p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <dt className="text-[var(--dp-text-label)]">Quantity</dt>
              <dd className="text-[var(--dp-text-primary)] tabular-nums">{qty}</dd>
              <dt className="text-[var(--dp-text-label)]">Payout today</dt>
              <dd className="text-[var(--dp-text-primary)] tabular-nums">
                {payout != null ? `$${formatMoney(payout)} each, $${formatMoney(Math.round(payout * qty * 100) / 100)} total` : '—'}
                {payoutChanged && (
                  <span className="block text-[11px] text-[var(--dp-text-secondary)]">
                    Was ${formatMoney(preview.logged_payout)} when you logged it. The sale will update to today's payout.
                  </span>
                )}
              </dd>
              <dt className="text-[var(--dp-text-label)]">Tracking</dt>
              <dd className="text-[var(--dp-text-primary)] font-mono break-all">{preview.tracking_number}</dd>
            </dl>
            <div className="space-y-1.5">
              <label htmlFor="pc-insured" className="text-[11px] text-[var(--dp-text-label)]">Insured value (optional, $200–$1,500)</label>
              <input id="pc-insured" type="number" min="200" max="1500" step="0.01" value={insuredValue} onChange={(e) => setInsuredValue(e.target.value)}
                placeholder="Leave blank to skip insurance"
                className="w-full px-3 py-2 text-xs rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-bg)] text-[var(--dp-text-primary)] placeholder-[var(--dp-text-label)] focus:outline-none" />
            </div>
          </>
        )}

        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" ref={notNowRef} onClick={preview?.available === false || loadError ? onClose : later} disabled={busy}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            {preview?.available === false || loadError ? 'OK' : 'Not now'}
          </button>
          {preview?.available && (
            <button type="button" onClick={commit} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
              {busy && <RefreshCw size={12} className="animate-spin" />}
              {busy ? 'Committing…' : 'Commit'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
