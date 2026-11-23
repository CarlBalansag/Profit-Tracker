import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, useBuyers, useCashoutImportDetail, useCashoutImports, useUndoCashoutImport } from '../../hooks/useApi';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { displayLabel } from '../../data/statusWorkflow';
import { toastWithUndo } from '../../utils/undoToast';
import ConfirmDialog from '../UI/ConfirmDialog';
import TransactionDetailModal from '../TransactionDetailModal';

// Settings > Data > Import from cashouts > Past imports. Every import done
// from here, newest first: View lists what it added (still there, counted
// live), each purchase can be edited or deleted on its own, and Undo removes
// everything the import added in one step. Undo is logged in Activity, which
// can put it all back (profit-tracker-api/services/cashouts/importHistory.js).
const SHOWN = 5;
const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
// Purchase and sale dates are saved at noon UTC: show the day itself.
const day = (iso) => new Date(iso).toLocaleDateString('en-US', { timeZone: 'UTC', month: '2-digit', day: '2-digit', year: 'numeric' });
const layer = () => document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
// The cashout group, when it isn't just named after the cashout itself.
const groupName = (imp) => (imp.cashoutName && imp.cashoutName.trim().toLowerCase() !== imp.sourceName.toLowerCase() ? imp.cashoutName : null);
const btn = 'inline-flex items-center justify-center gap-1.5 px-3 h-[44px] sm:h-8 rounded-lg border text-sm sm:text-xs font-medium disabled:opacity-50';

function state(imp) {
  if (imp.remaining === 0) return { text: 'Undone or all deleted', tone: 'text-gray-400 border-gray-700 bg-white/5' };
  if (imp.remaining < imp.purchases) return { text: `${imp.remaining} of ${imp.purchases} still here`, tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' };
  return null;
}

export function PastImports({ platforms = [], paymentMethods = [] }) {
  const { data: imports = [], isLoading, isError } = useCashoutImports();
  const undo = useUndoCashoutImport();
  const qc = useQueryClient();
  const [all, setAll] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [undoingId, setUndoingId] = useState(null);
  // Read fresh from the list, so a purchase deleted since the window opened isn't counted.
  const undoing = imports.find((i) => i.id === undoingId) || null;
  const shown = all ? imports : imports.slice(0, SHOWN);

  const runUndo = async () => {
    try {
      const res = await undo.mutateAsync(undoing.id);
      toastWithUndo(`Import undone: removed ${plural(res.removed, 'purchase')}.`, res.activity_id, () => qc.invalidateQueries());
      setUndoingId(null);
      setViewing(null);
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <section aria-labelledby="past-imports" className="space-y-3">
      <div>
        <h3 id="past-imports" className="text-sm font-semibold text-white">Past imports</h3>
        <p className="text-xs text-gray-500">Look back at what an import added, fix or delete single purchases, or undo the whole import.</p>
      </div>

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
      {isError && <p role="alert" className="text-sm text-red-400">Could not load past imports.</p>}
      {!isLoading && !isError && imports.length === 0 && (
        <p className="text-sm text-gray-500">No imports yet. Each one you do here is listed so you can come back to it.</p>
      )}

      {shown.length > 0 && (
        <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800">
          {shown.map((imp) => {
            const s = state(imp);
            const label = `${imp.sourceName} import from ${when(imp.createdAt)}`;
            return (
              <li key={imp.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-gray-200">{imp.sourceName}{groupName(imp) ? ` → ${groupName(imp)}` : ''}</span>
                    {s && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${s.tone}`}>{s.text}</span>}
                  </div>
                  <p className="text-xs text-gray-500 break-words">
                    {[when(imp.createdAt), imp.fileName].filter(Boolean).join(' · ')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {plural(imp.purchases, 'purchase')} · {plural(imp.units, 'unit')} · {money(imp.payout)} payout
                    {imp.costNeeded > 0 && <span className="text-amber-300"> · {imp.costNeeded} imported without a cost</span>}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  <button type="button" aria-label={`View ${label}`} onClick={() => setViewing(imp)} className={`${btn} border-gray-700 text-gray-200 hover:bg-white/5`}>
                    <Eye size={14} /> View
                  </button>
                  <button type="button" aria-label={`Undo ${label}`} onClick={() => setUndoingId(imp.id)} disabled={imp.remaining === 0} className={`${btn} border-red-500/40 text-red-300 hover:bg-red-500/10`}>
                    <Undo2 size={14} /> Undo
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {imports.length > SHOWN && (
        <button type="button" onClick={() => setAll((v) => !v)} className="text-sm text-[var(--dp-accent-text,var(--accent))] min-h-[44px] sm:min-h-0 hover:underline">
          {all ? 'Show fewer' : `Show all ${imports.length}`}
        </button>
      )}

      {viewing && (
        <ImportView
          imp={viewing}
          platforms={platforms}
          paymentMethods={paymentMethods}
          blocked={Boolean(undoing)}
          onUndo={() => setUndoingId(viewing.id)}
          onClose={() => setViewing(null)}
        />
      )}
      {undoing && createPortal(
        <ConfirmDialog
          open
          title="Undo this import?"
          consequence={`Deletes the ${plural(undoing.remaining, 'purchase')} this ${undoing.sourceName} import added that are still here, with their sales. Changes made to them since go too.\n\nYou can put it all back from Activity for 30 days.`}
          confirmLabel={`Delete ${plural(undoing.remaining, 'purchase')}`}
          busy={undo.isPending}
          onConfirm={runUndo}
          onClose={() => setUndoingId(null)}
        />,
        layer(),
      )}
    </section>
  );
}

// What one import added that's still there, each with its sale.
function ImportView({ imp, platforms, paymentMethods, blocked, onUndo, onClose }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useCashoutImportDetail(imp.id);
  const { data: buyers = [] } = useBuyers();
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);
  // A window opened on top takes Escape; this one waits for it to close.
  const modalRef = useModalKeyboard(!editing && !deleting && !blocked, onClose);
  const refresh = () => qc.invalidateQueries();
  const purchases = data?.purchases || [];

  const runDelete = async () => {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/inventory/${encodeURIComponent(deleting.id)}`, { method: 'DELETE' });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || 'Could not delete that purchase.');
      toastWithUndo('Purchase deleted.', body.activity_id, refresh);
      setDeleting(null);
      refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center sm:p-4">
        <div className="absolute inset-0 bg-[var(--dp-modal-backdrop)] backdrop-blur-xs" onClick={onClose} />
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="past-import-title" className="relative flex w-full sm:w-[min(760px,94vw)] max-h-[92dvh] flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[color:var(--dp-border)] px-4 sm:px-6 py-4">
            <div className="min-w-0">
              <h2 id="past-import-title" className="text-base font-semibold text-white">{imp.sourceName} import</h2>
              <p className="mt-0.5 text-xs text-gray-500 break-words">
                {[when(imp.createdAt), groupName(imp) && `to ${groupName(imp)}`, imp.fileName].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-0.5 text-xs text-gray-400">
                Added {plural(imp.purchases, 'purchase')} ({plural(imp.units, 'unit')}, {money(imp.payout)} payout).
                {data && data.remaining < imp.purchases && ` ${data.remaining} still here.`}
              </p>
            </div>
            <button type="button" aria-label="Close" onClick={onClose} className="flex h-[44px] w-[44px] sm:h-8 sm:w-8 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 theme-scrollbar">
            {isLoading && <p className="text-sm text-gray-500">Loading…</p>}
            {isError && <p role="alert" className="text-sm text-red-400">Could not load this import.</p>}
            {data && purchases.length === 0 && (
              <p className="text-sm text-gray-500">Nothing from this import is left. It was undone, or every purchase was deleted. Activity can bring them back.</p>
            )}
            {purchases.length > 0 && (
              <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800" aria-label="Purchases from this import">
                {purchases.map((p) => (
                  <li key={p.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-0.5 text-xs">
                      <div className="text-sm text-gray-200 break-words">{p.name}</div>
                      <div className="text-gray-400 break-words">
                        Bought {day(p.purchaseDate)} · {p.qty} × {p.costNeeded ? <span className="text-amber-300">cost needed</span> : money(p.unitCost)}
                        {(p.salesTax > 0 || p.shipping > 0) && ` + ${money(p.salesTax + p.shipping)} tax/shipping`}
                        {[p.store, p.account, p.orderNumber && `order ${p.orderNumber}`, p.card].filter(Boolean).map((t) => ` · ${t}`).join('')}
                      </div>
                      {p.sales.map((s) => (
                        <div key={s.id} className="text-gray-500 break-words">
                          Sold {day(s.date)}{s.cashout ? ` to ${s.cashout}` : ''} · {s.qty} × {money(s.unitPrice)}{s.fee > 0 ? ` (${money(s.fee)} fee)` : ''} · {displayLabel(s.status)}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                      <button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEditing(p)} className={`${btn} border-gray-700 text-gray-200 hover:bg-white/5`}>
                        <Pencil size={14} /> Edit
                      </button>
                      <button type="button" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)} className={`${btn} border-red-500/40 text-red-300 hover:bg-red-500/10`}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="shrink-0 border-t border-[color:var(--dp-border)] px-4 sm:px-6 py-3 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 h-[44px] sm:h-9 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-white/5">
              Close
            </button>
            <button type="button" onClick={onUndo} disabled={!purchases.length} className="inline-flex items-center justify-center gap-2 px-4 h-[44px] sm:h-9 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-medium text-white disabled:opacity-50">
              <Undo2 size={14} /> Undo whole import
            </button>
          </div>
        </div>
      </div>

      {editing && (
        <TransactionDetailModal
          row={{ rawId: editing.id }}
          platforms={platforms}
          paymentMethods={paymentMethods}
          buyers={buyers}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this purchase?"
        consequence={deleting ? `Deletes ${deleting.name} and its sale. Everything else from this import stays.\n\nYou can undo this right after, or from Activity.` : ''}
        confirmLabel="Delete purchase"
        busy={busy}
        onConfirm={runDelete}
        onClose={() => setDeleting(null)}
      />
    </>,
    layer(),
  );
}

export default PastImports;
