import React from 'react';
import { Check, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useEmailStoreMutations, useEmailStores } from '../../hooks/useApi';

const PANEL = 'rounded-xl border border-gray-800 bg-[#12121A] p-5 sm:p-6 space-y-4';
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Stores in your email: the stores ProfitTracker already reads, and the ones
 * it can't read yet, each with a Request button. The check looks at senders
 * and subject lines only.
 */
export function EmailStores() {
  const { data } = useEmailStores();
  const { scan, request, hide } = useEmailStoreMutations();
  if (!data) return null;
  const { supported, candidates, hidden = [], scanned_at: scannedAt, all_stores: allStores } = data;
  const busy = request.isPending || hide.isPending;

  const runScan = async () => {
    try {
      const result = await scan.mutateAsync();
      const found = result.candidates.length;
      toast.success(found ? `Found ${plural(found, 'store', 'stores')} we can't read yet` : 'No other stores found');
    } catch (err) { toast.error(err.message); }
  };
  const toggle = async (store) => {
    try {
      await request.mutateAsync({ id: store.id, on: !store.requested });
      if (!store.requested) toast.success(`Requested ${store.label}. Thanks!`);
    } catch (err) { toast.error(err.message); }
  };
  const setHidden = async (store, on) => {
    try {
      await hide.mutateAsync({ id: store.id, on });
      if (on) toast.success(`Hid ${store.label}`, { action: { label: 'Undo', onClick: () => setHidden(store, false) } });
    } catch (err) { toast.error(err.message); }
  };

  return (
    <section aria-labelledby="email-stores" className={PANEL}>
      <div>
        <h2 id="email-stores" className="text-sm font-bold text-white">Stores in your email</h2>
        <p className="mt-1 max-w-prose text-xs text-gray-500">See which stores email you about orders. Request the ones we can&apos;t read yet and we&apos;ll add them.</p>
      </div>

      {supported.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400">Read automatically</p>
          <ul className="flex flex-wrap gap-2">
            {supported.map((s) => (
              <li key={s.key} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs text-gray-200">
                <Check size={12} aria-hidden="true" className="text-emerald-400" />{s.label}<span className="text-gray-500">{s.order_emails}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-gray-400">Not supported yet</p>
          <ul className="divide-y divide-white/[0.06]">
            {candidates.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                <p className="min-w-0 text-sm text-gray-100">
                  {c.label} <span className="text-xs text-gray-500">· {c.source || c.domain} · {plural(c.order_emails, 'order email', 'order emails')}</span>
                </p>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => setHidden(c, true)} disabled={busy} aria-label={`${c.label} is not a store`} className="h-9 rounded-lg px-2.5 text-xs text-gray-500 transition-colors hover:bg-white/[0.04] hover:text-gray-300 disabled:opacity-50">Not a store</button>
                  {c.requested
                    ? <button type="button" onClick={() => toggle(c)} disabled={busy} aria-label={`Cancel the request for ${c.label}`} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs"><Check size={14} aria-hidden="true" className="text-emerald-400" /> Requested</button>
                    : <button type="button" onClick={() => toggle(c)} disabled={busy} aria-label={`Request ${c.label}`} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">Request</button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {scannedAt && candidates.length === 0 && <p className="text-sm text-gray-400">Every store that emails you about orders is one we already read.</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" onClick={runScan} disabled={scan.isPending} className={`page-btn ${scannedAt ? 'page-btn-secondary' : 'page-btn-primary'}`}>
          <Search size={14} aria-hidden="true" /> {scan.isPending ? 'Checking your email…' : scannedAt ? 'Check again' : 'Find stores in my email'}
        </button>
        <p className="text-xs text-gray-500">Looks at who sent each email and its subject line only.</p>
      </div>

      {hidden.length > 0 && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer text-gray-400">Hidden ({hidden.length})</summary>
          <ul className="mt-1 divide-y divide-white/[0.06]">
            {hidden.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                <span className="min-w-0 text-gray-400">{c.label} · {c.source || c.domain}</span>
                <button type="button" onClick={() => setHidden(c, false)} disabled={busy} aria-label={`Show ${c.label} again`} className="h-9 shrink-0 rounded-lg px-2.5 text-gray-400 transition-colors hover:bg-white/[0.04] hover:text-gray-200 disabled:opacity-50">Show</button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="text-xs text-gray-500">
        <summary className="cursor-pointer text-gray-400">Stores we read ({allStores.length})</summary>
        <p className="mt-2 leading-relaxed">{allStores.join(', ')}</p>
      </details>
    </section>
  );
}
