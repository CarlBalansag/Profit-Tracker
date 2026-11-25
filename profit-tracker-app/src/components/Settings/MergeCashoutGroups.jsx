import React, { useEffect, useRef, useState } from 'react';
import { ArrowUpDown, X } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const MOVES = [
  ['sales', 'sale'], ['purchases', 'purchase'], ['store_accounts', 'store account'],
  ['connections', 'cashout connection'], ['imports', 'past import'], ['tax_forms', '1099-K form'],
];
const moveList = (counts = {}) => MOVES
  .filter(([key]) => counts[key] > 0)
  .map(([key, word]) => `${counts[key]} ${word}${counts[key] === 1 ? '' : 's'}`);

const SELECT = 'w-full bg-[var(--dp-bg)] border border-[color:var(--dp-border)] rounded-lg px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--dp-accent)]';

// Combines two cashout groups that are the same buyer: what's on the first
// moves to the second, then the first is removed. Shows what will move before
// anything happens; the server logs it as one change that Undo reverses.
export function MergeCashoutGroups({ groups, initialFromId = '', onClose, onMerged }) {
  const [fromId, setFromId] = useState(initialFromId);
  const [intoId, setIntoId] = useState('');
  const [preview, setPreview] = useState(null); // { id, counts } | { id, error }
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const fromRef = useRef(null);
  const intoRef = useRef(null);
  const modalRef = useModalKeyboard(true, () => { if (!saving) onClose(); }, initialFromId ? intoRef : fromRef);

  const from = groups.find((g) => g.id === fromId);
  const into = groups.find((g) => g.id === intoId);
  const current = preview?.id === fromId ? preview : null;

  // A slow answer for a group picked earlier never replaces a newer one.
  useEffect(() => {
    if (!fromId) return undefined;
    let wanted = true;
    (async () => {
      try {
        const res = await apiFetch(`/api/platforms/${fromId}/merge-preview`);
        const ok = await requireSuccessfulResponse(res, 'Could not check this group');
        const { counts } = await ok.json();
        if (wanted) setPreview({ id: fromId, counts });
      } catch (err) {
        if (wanted) setPreview({ id: fromId, error: err.message });
      }
    })();
    return () => { wanted = false; };
  }, [fromId, attempt]);

  const pickFrom = (id) => { setFromId(id); if (id && id === intoId) setIntoId(''); setError(null); };
  const pickInto = (id) => { setIntoId(id); setError(null); };
  const swap = () => { setFromId(intoId); setIntoId(fromId); setError(null); };

  const ready = Boolean(from && into && current?.counts && !saving);
  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/platforms/${from.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: into.id }),
      });
      const ok = await requireSuccessfulResponse(res, 'Could not merge these groups');
      onMerged({ from, into, ...(await ok.json()) });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  const moves = moveList(current?.counts);

  return (
    <div className="fixed inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <form
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="merge-groups-title"
        onSubmit={submit}
        className="w-full max-w-md bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-2xl dp-elevated flex flex-col text-[var(--dp-text-primary)]"
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-[color:var(--dp-border)]">
          <h3 id="merge-groups-title" className="text-base font-semibold">Merge cashout groups</h3>
          <button type="button" aria-label="Close" onClick={onClose} disabled={saving} className="text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors disabled:opacity-40">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 overflow-y-auto min-h-0">
          <p className="text-sm text-[var(--dp-text-secondary)]">For two groups that are the same buyer. Everything moves into the one you keep.</p>
          <div>
            <label htmlFor="merge-from" className="block text-xs text-[var(--dp-text-secondary)] mb-1.5">Group to merge and remove</label>
            <select id="merge-from" ref={fromRef} value={fromId} disabled={saving} onChange={(e) => pickFrom(e.target.value)} className={SELECT}>
              <option value="">Select a group…</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swap}
              disabled={saving || (!fromId && !intoId)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] disabled:opacity-40 transition-colors"
            >
              <ArrowUpDown className="w-3.5 h-3.5" /> Swap
            </button>
          </div>
          <div>
            <label htmlFor="merge-into" className="block text-xs text-[var(--dp-text-secondary)] mb-1.5">Group to keep</label>
            <select id="merge-into" ref={intoRef} value={intoId} disabled={saving} onChange={(e) => pickInto(e.target.value)} className={SELECT}>
              <option value="">Select a group…</option>
              {groups.filter((g) => g.id !== fromId).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          {from && (
            <div aria-live="polite" className="rounded-xl border border-[color:var(--dp-border)] px-4 py-3 text-sm space-y-2">
              {!current && <p className="text-[var(--dp-text-secondary)]">Checking what's on {from.name}…</p>}
              {current?.error && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[var(--dp-red-text)]">{current.error}</p>
                  <button type="button" onClick={() => { setPreview(null); setAttempt((n) => n + 1); }} className="text-xs font-semibold text-[var(--dp-accent-text)]">Retry</button>
                </div>
              )}
              {current?.counts && (
                <>
                  {moves.length > 0 ? (
                    <div>
                      <p className="font-medium break-words">{into ? `Moves to ${into.name}` : `On ${from.name}`}</p>
                      <ul className="mt-1 text-[var(--dp-text-secondary)] tabular-nums">
                        {moves.map((line) => <li key={line}>{line}</li>)}
                      </ul>
                    </div>
                  ) : <p className="font-medium break-words">Nothing is recorded on {from.name}.</p>}
                  {into && (
                    <p className="text-xs text-[var(--dp-text-secondary)] break-words">
                      {from.name} is {moves.length > 0 ? 'then removed. No sale or amount changes.' : 'removed.'} You can undo this for 30 days.
                    </p>
                  )}
                  {into && current.counts.sales > 0 && Boolean(from.tax_exempt_place) !== Boolean(into.tax_exempt_place) && (
                    <p className="text-xs text-[var(--dp-warning-text)] break-words">
                      {from.tax_exempt_place
                        ? `${from.name} is tax exempt and ${into.name} isn't.`
                        : `${into.name} is tax exempt and ${from.name} isn't.`}
                      {' '}Sales that move keep their own tax setting; new ones follow {into.name}.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {error && <p role="alert" className="text-sm text-[var(--dp-red-text)] break-words">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[color:var(--dp-border)]">
          <button type="button" onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button type="submit" disabled={!ready} className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors">
            {saving ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </form>
    </div>
  );
}
