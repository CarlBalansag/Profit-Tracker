// Analytics → Products & Stores: profit per store. A store bought from on more
// than one store account opens to the same figures per account; the API sends
// `accounts` only for those stores, and its rows add up to the store's row.
import React, { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { GrowBar, Panel, Empty, Expand } from './Motion';

const usd = (n) => `${n < 0 ? '−' : ''}$${Math.abs(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RoiRow({ row, maxProfit, showSpend, delay = 0, height, children }) {
  const profitable = row.profit >= 0;
  return (
    <>
      {/* Wraps the figures under the name when both don't fit on a phone. */}
      <span className="mb-1.5 flex flex-wrap items-center justify-between gap-x-2 text-xs">
        <span className="flex min-w-0 max-w-full items-center gap-1.5 font-medium text-[var(--dp-text-primary)]">
          <span className="line-clamp-2 min-w-0 break-words">{row.name}</span>
          {children}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-[var(--dp-text-muted)]">
          {row.unitsSold} sold · <b className={profitable ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}>{profitable ? '+' : ''}{usd(row.profit)}</b>
          {row.roi != null && <> · {row.roi.toFixed(1)}% ROI</>}
        </span>
      </span>
      <GrowBar pct={(Math.abs(row.profit) / maxProfit) * 100} color={profitable ? 'var(--green)' : 'var(--red)'} delay={delay} height={height} />
      {showSpend && <span className="mt-1 block text-[11px] text-[var(--dp-text-label)] tabular-nums">{usd(row.spend)} spent this period · {usd(row.avgCostPerUnit)} avg / unit</span>}
    </>
  );
}

function StoreRow({ store, maxProfit, showSpend, delay }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const accounts = store.accounts ?? [];
  if (!accounts.length) return <div><RoiRow row={store} maxProfit={maxProfit} showSpend={showSpend} delay={delay} /></div>;
  const count = accounts.filter((a) => a.id).length;
  return (
    <div>
      {/* The whole row opens and closes; the negative margin keeps it in line
          with the other stores. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen(!open)}
        className="-mx-2 -my-1 block w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--dp-hover-bg)]"
      >
        <RoiRow row={store} maxProfit={maxProfit} showSpend={showSpend} delay={delay}>
          <span className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[11px] font-normal text-[var(--dp-text-secondary)]">
            {count} accounts
            <ChevronDown size={13} aria-hidden="true" className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
          </span>
        </RoiRow>
      </button>
      <div id={listId}>
        <Expand open={open}>
          <ul aria-label={`${store.name} by account`} className="ml-1 mt-3 space-y-3 border-l border-[color:var(--dp-border)] pl-3">
            {accounts.map((a) => (
              <li key={a.id ?? 'none'}>
                <RoiRow row={a} maxProfit={maxProfit} showSpend={showSpend} height={5} />
              </li>
            ))}
          </ul>
        </Expand>
      </div>
    </div>
  );
}

// `showSpend` is off when only one sales channel is shown: spend there is just
// the cost of what sold, not what was spent this period.
export default function StoreRoi({ stores, showSpend, loading }) {
  // Accounts are drawn on the stores' scale. One account can out-earn its own
  // store (when another lost money), so it counts towards the scale too.
  const maxProfit = Math.max(1, ...stores.flatMap((s) => [s, ...(s.accounts ?? [])]).map((r) => Math.abs(r.profit)));
  return (
    <Panel title="Store ROI" sub="Profit on items sold this period, by the store you bought them from.">
      {stores.length ? (
        <div className="space-y-4">
          {stores.map((s, i) => <StoreRow key={s.id ?? s.name} store={s} maxProfit={maxProfit} showSpend={showSpend} delay={i * 0.05} />)}
        </div>
      ) : <Empty>{loading ? 'Loading…' : 'No sold items in this period'}</Empty>}
    </Panel>
  );
}
