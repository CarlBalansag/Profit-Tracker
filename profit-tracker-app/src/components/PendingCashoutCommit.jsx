import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, useInvalidate } from '../hooks/useApi';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import { formatMoney } from '../utils/money';
import { PENDING_COMMIT_EVENT, TRACKING_SEND_EVENT, COMMIT_LOWER_EVENT } from '../utils/pendingCashoutCommit';

const readError = async (response) => {
  const body = await response.json().catch(() => ({}));
  return body.error || `Request failed (${response.status})`;
};

// Mounted once in the app shell. Shows nothing until an event arrives.
export default function PendingCashoutCommit() {
  // { id, askDirect }: askDirect is set when the tracking went on the purchase,
  // so the first question is whether that package is going to the cashout.
  const [pending, setPending] = useState(null);
  const [trackingSend, setTrackingSend] = useState(null);
  const [lower, setLower] = useState(null);

  useEffect(() => {
    const onPending = (event) => {
      const id = event.detail?.commitment_id;
      if (id) setPending({ id, askDirect: event.detail?.ask_direct || null });
    };
    const onTrackingSend = (event) => {
      if (event.detail?.commitment_id) setTrackingSend(event.detail);
    };
    const onLower = (event) => {
      if (event.detail?.commitment_id) setLower(event.detail);
    };
    window.addEventListener(PENDING_COMMIT_EVENT, onPending);
    window.addEventListener(TRACKING_SEND_EVENT, onTrackingSend);
    window.addEventListener(COMMIT_LOWER_EVENT, onLower);
    return () => {
      window.removeEventListener(PENDING_COMMIT_EVENT, onPending);
      window.removeEventListener(TRACKING_SEND_EVENT, onTrackingSend);
      window.removeEventListener(COMMIT_LOWER_EVENT, onLower);
    };
  }, []);

  if (lower && !pending && !trackingSend) {
    return <LowerCommitDialog key={lower.commitment_id} detail={lower} onClose={() => setLower(null)} />;
  }

  if (trackingSend && !pending) {
    return <SendTrackingDialog key={trackingSend.commitment_id} detail={trackingSend} onClose={() => setTrackingSend(null)} />;
  }
  if (!pending) return null;
  const close = () => setPending(null);
  if (pending.askDirect) {
    return (
      <DirectShipDialog key={`${pending.id}-direct`} askDirect={pending.askDirect} onClose={close}
        onUsed={() => setPending({ id: pending.id, askDirect: null })} />
    );
  }
  return <CommitDialog key={pending.id} commitmentId={pending.id} onClose={close} />;
}

// The sale of a committed purchase has a tracking number the cashout doesn't
// have yet. Nothing is sent until "Send" is pressed.
function SendTrackingDialog({ detail, onClose }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const notNowRef = useRef(null);
  const modalRef = useModalKeyboard(true, () => !busy && onClose(), notNowRef);
  const cashout = detail.cashout || 'the cashout';

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cashouts/commitments/${detail.commitment_id}/tracking`, { method: 'POST' });
      if (!response.ok) throw new Error(await readError(response));
      const result = await response.json();
      invalidate.cashouts();
      toast.success(result.sent?.length ? `Tracking sent to ${cashout}.` : `${cashout} already has this tracking number.`);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`Send this tracking number to ${cashout}?`}
        className="w-full max-w-md rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Send this tracking number to {cashout}?</h3>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-[var(--dp-text-secondary)]">
          This purchase is already committed to {cashout}, but {cashout} doesn't have this tracking number yet.
        </p>
        {detail.tracking_number && <p className="text-xs font-mono break-all text-[var(--dp-text-primary)]">{detail.tracking_number}</p>}
        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" ref={notNowRef} onClick={onClose} disabled={busy}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            Not now
          </button>
          <button type="button" onClick={send} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {busy && <RefreshCw size={12} className="animate-spin" />}
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// A committed purchase's sale won't ship any more (cancelled, voided,
// returned). Asks before taking its units off the cashout commitment: lowered
// when other purchases are still on it, withdrawn when it's the last one.
function LowerCommitDialog({ detail, onClose }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const keepRef = useRef(null);
  const modalRef = useModalKeyboard(true, () => !busy && onClose(), keepRef);
  const cashout = detail.cashout || 'the cashout';
  const withdrawAll = !detail.remaining;
  const title = withdrawAll ? `Withdraw your commitment with ${cashout}?` : `Lower your commitment with ${cashout}?`;

  const confirmLower = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cashouts/commitments/${detail.commitment_id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readError(response));
      invalidate.cashouts();
      toast.success(withdrawAll ? `Commitment with ${cashout} withdrawn.` : `Commitment with ${cashout} lowered to ${detail.remaining}.`);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={title}
        className="w-full max-w-md rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <h3 className="font-bold text-base text-[var(--dp-text-primary)]">{title}</h3>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-[var(--dp-text-secondary)]">
          {withdrawAll
            ? `These ${detail.quantity} were committed to ${cashout} and won't be sent now. Withdrawing frees them back to the deal.`
            : `These ${detail.quantity} were committed to ${cashout} and won't be sent now. Your commitment goes from ${detail.total} to ${detail.remaining}; the other purchases on it stay committed.`}
        </p>
        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" ref={keepRef} onClick={onClose} disabled={busy}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            Keep it
          </button>
          <button type="button" onClick={confirmLower} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {busy && <RefreshCw size={12} className="animate-spin" />}
            {withdrawAll ? 'Withdraw' : `Lower to ${detail.remaining}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// A tracking number was added to the purchase, not the sale. It's the right
// one to commit with only if the store is shipping straight to the cashout.
// "Yes" copies it onto the sale (the number the commit sends), then shows the
// usual commit prompt. Nothing is committed from this step.
function DirectShipDialog({ askDirect, onClose, onUsed }) {
  const invalidate = useInvalidate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const noRef = useRef(null);
  const modalRef = useModalKeyboard(true, () => !busy && onClose(), noRef);
  const cashout = askDirect.cashout || 'the cashout';

  const useIt = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/sales/${askDirect.sale_id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking_number: askDirect.tracking_number }),
      });
      if (!response.ok) throw new Error(await readError(response));
      invalidate.sales();
      onUsed();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  const notDirect = () => {
    toast.message('Saved on the purchase only', {
      description: `You'll be asked to commit when you add the tracking for the package you send to ${cashout}.`,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`Is this package going straight to ${cashout}?`}
        className="w-full max-w-md rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-[color:var(--dp-border)] pb-3">
          <h3 className="font-bold text-base text-[var(--dp-text-primary)]">Is this package going straight to {cashout}?</h3>
          <button type="button" aria-label="Close" onClick={onClose} disabled={busy} className="text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]">
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-[var(--dp-text-secondary)]">
          This purchase is waiting to be committed to {cashout}. If the store ships it there directly, this is the tracking number to commit with.
        </p>
        <p className="text-xs font-mono break-all text-[var(--dp-text-primary)]">{askDirect.tracking_number}</p>
        {error && <p role="alert" className="text-xs text-rose-400">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[color:var(--dp-border)] pt-3">
          <button type="button" ref={noRef} onClick={notDirect} disabled={busy}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:bg-[var(--dp-hover-bg)]">
            No, it's coming to me
          </button>
          <button type="button" onClick={useIt} disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-[var(--dp-accent)] text-white hover:opacity-90 disabled:opacity-50">
            {busy && <RefreshCw size={12} className="animate-spin" />}
            Yes, commit with it
          </button>
        </div>
      </div>
    </div>
  );
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
      const raised = result.raisedTo ? ` Your commitment is now ${result.raisedTo}.` : '';
      if (result.raisedTo && result.trackingSubmitted) {
        toast.success(`Added to your commitment with ${preview.cashout}: now ${result.raisedTo}.`, {
          description: `${result.trackingShared ? "That tracking number was already sent with another item, so it wasn't sent again." : 'Tracking sent.'}${priceNote}`,
        });
      } else if (result.trackingShared && result.trackingSubmitted) {
        toast.success(`Committed to ${preview.cashout}.`, {
          description: `That tracking number was already sent with another item, so it wasn't sent again.${priceNote}`,
        });
      } else if (result.trackingSubmitted) {
        toast.success(`Committed to ${preview.cashout}, and tracking sent.`, priceNote ? { description: priceNote.trim() } : undefined);
      } else {
        toast.success(`Committed to ${preview.cashout}, but tracking failed to send.`, {
          description: `${result.trackingError || 'Send it again with Send tracking in Cashout > Commitments.'}${raised}${priceNote}`,
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
        className="w-full max-w-xl rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] shadow-xl p-5 space-y-4 max-h-[85vh] overflow-y-auto">
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
            {preview.commit_error && (
              <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                Last try: {preview.commit_error}
              </p>
            )}
            <p className="text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
              {preview.adds_to
                ? `You already have ${preview.adds_to.committed} of this item committed to ${preview.cashout}. Committing adds these ${qty}, raising your binding commitment to ${preview.adds_to.new_total}, and sends this tracking number.`
                : `You added a tracking number to a purchase you logged before it shipped. Committing is a real, binding pledge to ${preview.cashout}, sent with this tracking number.`}
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
              <label htmlFor="pc-insured" className="block text-[11px] text-[var(--dp-text-label)]">Insured value (optional, $200–$1,500)</label>
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
