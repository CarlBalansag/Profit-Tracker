import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { History, X } from 'lucide-react';
import { useCashoutDealHistory } from '../../hooks/useApi';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { formatMoney } from '../../utils/money';
import { summarizePayoutHistory } from '../../utils/cashoutDeals';

// Cashout page: a deal's payout over time. Profit Tracker saves a deal's
// payout each time it changes (api services/cashouts/service.js
// recordSnapshots, kept 90 days), so this shows whether it tends to rise.

const day = (value) => new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayTime = (value) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = (value) => `$${formatMoney(value)}`;
const signed = (value) => `${value < 0 ? '-' : '+'}$${formatMoney(Math.abs(value))}`;

// Payouts as a stepped line: flat until the next change, like the payout itself.
function PayoutLine({ points, now }) {
  if (points.length < 2) return null;
  const width = 280;
  const height = 56;
  const pad = 4;
  const times = points.map((point) => new Date(point.at).getTime());
  const start = times[0];
  const end = Math.max(now, times[times.length - 1]);
  const low = Math.min(...points.map((point) => point.payout));
  const high = Math.max(...points.map((point) => point.payout));
  const x = (time) => pad + ((time - start) / (end - start || 1)) * (width - pad * 2);
  const y = (payout) => (high === low ? height / 2 : height - pad - ((payout - low) / (high - low)) * (height - pad * 2));
  let path = `M ${x(times[0]).toFixed(1)} ${y(points[0].payout).toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    path += ` H ${x(times[i]).toFixed(1)} V ${y(points[i].payout).toFixed(1)}`;
  }
  path += ` H ${x(end).toFixed(1)}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14" role="img" aria-label={`Payout from ${money(low)} to ${money(high)}`} preserveAspectRatio="none">
      <path d={path} fill="none" stroke="var(--dp-accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryWindow({ deal, onClose }) {
  const modalRef = useModalKeyboard(true, onClose);
  const [openedAt] = useState(() => Date.now());
  const { data, isLoading, isError, refetch, isFetching } = useCashoutDealHistory(deal.connectionProvider, deal.id);
  const summary = summarizePayoutHistory(data?.snapshots);
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 text-left whitespace-normal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={`Payout history for ${deal.name}`} className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-5 text-sm shadow-xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-[var(--dp-text-primary)]">Payout history</h2>
            <p className="mt-0.5 break-words text-xs text-[var(--dp-text-secondary)]">{deal.name}{deal.connectionName ? ` · ${deal.connectionName}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--dp-text-label)] hover:bg-[var(--dp-hover-bg)] hover:text-[var(--dp-text-primary)]">
            <X size={16} />
          </button>
        </div>

        {isLoading ? (
          <p className="mt-6 text-center text-xs text-[var(--dp-text-secondary)]">Loading payout history…</p>
        ) : isError ? (
          <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
            <span className="flex-1">Couldn&apos;t load the payout history.</span>
            <button type="button" onClick={() => refetch()} disabled={isFetching} className="page-btn page-btn-secondary">{isFetching ? 'Retrying…' : 'Try again'}</button>
          </div>
        ) : !summary ? (
          <p className="mt-6 text-center text-xs text-[var(--dp-text-secondary)]">No payouts recorded for this deal yet. They are saved each time your deals sync.</p>
        ) : (
          <>
            <dl className="mt-4 grid grid-cols-3 gap-2">
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-[var(--dp-text-label)]">Now</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(summary.latest.payout)}</dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-[var(--dp-text-label)]">Highest</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(summary.high)}</dd>
              </div>
              <div>
                <dt className="text-[12px] uppercase tracking-wider text-[var(--dp-text-label)]">Lowest</dt>
                <dd className="mt-0.5 font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(summary.low)}</dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-[var(--dp-text-secondary)]">
              {summary.points.length === 1
                ? `No change since it was first seen on ${day(summary.first.at)}.`
                : `Since ${day(summary.first.at)}: went up ${summary.rises} ${summary.rises === 1 ? 'time' : 'times'}, down ${summary.drops} ${summary.drops === 1 ? 'time' : 'times'}.`}
            </p>

            {summary.points.length > 1 && (
              <div className="mt-3 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-hover-bg)] p-2">
                <PayoutLine points={summary.points} now={openedAt} />
              </div>
            )}

            <ol className="mt-3 divide-y divide-[color:var(--dp-border)]">
              {[...summary.points].reverse().map((point) => (
                <li key={point.at} className="flex items-baseline gap-3 py-2">
                  <span className="min-w-0 flex-1 text-xs text-[var(--dp-text-secondary)]">
                    {dayTime(point.at)}
                    {point.status !== 'active' && <span className="ml-1.5 text-[var(--dp-text-label)]">({point.status})</span>}
                  </span>
                  <span className="font-semibold tabular-nums text-[var(--dp-text-primary)]">{money(point.payout)}</span>
                  <span className={`w-20 text-right text-xs tabular-nums ${point.change > 0 ? 'text-emerald-400' : point.change < 0 ? 'text-rose-400' : 'text-[var(--dp-text-label)]'}`}>
                    {point.change === null ? 'First seen' : point.change === 0 ? 'No change' : signed(point.change)}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[12px] text-[var(--dp-text-label)]">Changes are kept for 90 days.</p>
          </>
        )}
      </div>
    </div>,
    host,
  );
}

// The small "History" button on a deal, and its window.
export default function DealHistoryButton({ deal }) {
  const [open, setOpen] = useState(false);
  if (!deal?.connectionProvider || deal.id === undefined || deal.id === null) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Payout history for ${deal.name}`}
        title="How the payout of this deal has changed"
        className="inline-flex items-center gap-1 px-2 py-1 max-md:min-h-10 max-md:px-3 rounded text-[12px] font-medium whitespace-nowrap border border-[color:var(--dp-border)] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)]"
      >
        <History size={10} aria-hidden="true" />
        History
      </button>
      {open && <HistoryWindow deal={deal} onClose={() => setOpen(false)} />}
    </>
  );
}
