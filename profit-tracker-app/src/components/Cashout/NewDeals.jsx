import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ExternalLink, Sparkles } from 'lucide-react';
import { useCashoutDealAlerts } from '../../hooks/useApi';
import { formatMoney } from '../../utils/money';
import { formatDealRoi } from '../../utils/cashoutDeals';

// Cashout page > New deals: the last week of deals cashouts dropped (from
// every cashout Profit Tracker syncs, connected here or not), newest first,
// with what you'd make using your best card. The same list the deal alert
// notifications come from (api services/cashouts/dealAlerts.js).

const NOTIFICATIONS_STATE = { tab: 'notifications' };

const KIND_LABELS = { new: 'New', relisted: 'Back', payout_up: 'Payout up' };

function ago(value, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

const money = (value) => `$${formatMoney(value)}`;
const signedMoney = (value) => `${value < 0 ? '-' : '+'}$${formatMoney(Math.abs(value))}`;
const tone = (value) => (value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-[var(--dp-text-primary)]');

function DealRow({ item, highlighted, alertsOn }) {
  const { deal } = item;
  const best = item.best_card;
  return (
    <li
      id={`deal-alert-${item.id}`}
      className={`rounded-xl border p-4 transition-colors ${highlighted ? 'border-[color:var(--dp-accent)] bg-[var(--dp-accent-bg)]' : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]'} ${deal.live ? '' : 'opacity-60'}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {deal.image_url && (
          <img src={deal.image_url} alt="" loading="lazy" className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain" />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <span className="rounded border border-[color:var(--dp-border)] bg-[var(--dp-hover-bg)] px-2 py-0.5 font-medium text-[var(--dp-text-primary)]">{deal.provider_name}</span>
            <span className="rounded bg-[var(--dp-accent-bg)] px-2 py-0.5 font-semibold text-[var(--dp-accent)]">
              {KIND_LABELS[item.kind] || 'New'}
              {item.kind === 'payout_up' && item.previous_payout !== null ? ` from ${money(item.previous_payout)}` : ''}
            </span>
            <span className="text-[var(--dp-text-label)]">{ago(item.created_at)}</span>
            {!deal.live && <span className="text-[var(--dp-text-label)]">· No longer listed</span>}
          </div>
          <p className="break-words text-sm font-semibold text-[var(--dp-text-primary)]">
            {deal.deal_url ? (
              <a href={deal.deal_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-1 hover:underline">
                <span>{deal.name}</span>
                <ExternalLink size={12} className="mt-1 shrink-0 text-[var(--dp-text-label)]" aria-hidden="true" />
                <span className="sr-only">(opens {deal.provider_name})</span>
              </a>
            ) : deal.name}
          </p>
          <p className="text-xs text-[var(--dp-text-secondary)]">
            Pays <span className="font-medium text-[var(--dp-text-primary)] tabular-nums">{money(item.payout)}</span>
            {item.retail ? <> · Retail <span className="tabular-nums">{money(item.retail)}</span></> : ' · No retail price listed'}
            {deal.stores.length > 0 && <> · {deal.stores.join(', ')}</>}
            {deal.vendor_limit ? <> · Limit {deal.vendor_limit}</> : null}
          </p>
          {alertsOn && !item.matches_filters && (
            <p className="text-[12px] text-[var(--dp-text-label)]">Doesn't match your deal alert filters.</p>
          )}
        </div>
        <div className="shrink-0 sm:min-w-[9rem] sm:text-right">
          {item.profit !== null ? (
            <>
              <p className={`text-lg font-bold tabular-nums ${tone(item.profit)}`}>{signedMoney(item.profit)}</p>
              {item.roi !== null && item.roi !== undefined && (
                <p className="text-[12px] font-medium tabular-nums text-[var(--dp-text-secondary)]">{formatDealRoi({ amount: item.profit, pct: item.roi })}</p>
              )}
              <p className="text-[12px] text-[var(--dp-text-label)]">
                {best && item.rewards ? `incl. ${money(item.rewards)} back with ${best.card.name} (${Math.round(best.rate * 100) / 100}%)` : 'No card rewards counted'}
              </p>
            </>
          ) : (
            <p className="text-xs text-[var(--dp-text-label)]">Profit unknown without a retail price</p>
          )}
        </div>
      </div>
    </li>
  );
}

export default function NewDeals({ highlightId = null }) {
  const { data, isLoading, isError, refetch, isFetching } = useCashoutDealAlerts();

  // Coming from a notification: bring that deal into view.
  useEffect(() => {
    if (!highlightId || !data) return;
    document.getElementById(`deal-alert-${highlightId}`)?.scrollIntoView({ block: 'center' });
  }, [highlightId, data]);

  if (isLoading) return <div className="p-8 text-center text-xs text-[var(--dp-text-secondary)]">Loading new deals…</div>;
  if (isError) {
    return (
      <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex flex-wrap items-center gap-3">
        <span className="flex-1">Couldn't load new deals. Nothing was changed.</span>
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="page-btn page-btn-secondary">{isFetching ? 'Retrying…' : 'Try again'}</button>
      </div>
    );
  }

  const items = data?.items ?? [];
  return (
    <div className="space-y-4">
      {!data?.alerts_on && (
        <div className="flex flex-col gap-3 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-4 sm:flex-row sm:items-center">
          <BellRing size={18} className="shrink-0 text-[var(--dp-accent)]" aria-hidden="true" />
          <p className="flex-1 text-sm text-[var(--dp-text-secondary)]">
            Get a notification on your phone the moment a cashout drops a deal, with your profit using your best card.
          </p>
          <Link to="/settings" state={NOTIFICATIONS_STATE} className="page-btn page-btn-primary shrink-0">Turn on deal alerts</Link>
        </div>
      )}
      {items.length === 0 ? (
        <div className="rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-10 text-center">
          <Sparkles size={24} className="mx-auto mb-3 text-[var(--dp-accent)]" aria-hidden="true" />
          <p className="text-sm font-semibold text-[var(--dp-text-primary)]">No new deals this week yet</p>
          <p className="mt-1 text-xs text-[var(--dp-text-secondary)]">New deals show up here within a minute or so of a cashout posting them.</p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {items.map((item) => <DealRow key={item.id} item={item} highlighted={item.id === highlightId} alertsOn={Boolean(data?.alerts_on)} />)}
        </ul>
      )}
    </div>
  );
}
