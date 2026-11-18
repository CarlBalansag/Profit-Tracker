// Panels for Analytics → Products & Stores (next to Store ROI):
//   ProfitShare   each store's share of total profit, as one split bar
//   PriceBands    margin by what one unit cost
//   StoreRoutes   profit per unit for each store → place-sold route
import React from 'react';
import { motion } from 'motion/react';
import { GrowBar, Panel, Empty } from './Motion';

const MotionDiv = motion.div;
const EASE = [0.16, 1, 0.3, 1];
// Fixed order, so a store keeps its color as long as it keeps its rank.
const SHARE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const OTHER_COLOR = '#898781';
const MAX_ROUTE_STORES = 8;
const MAX_ROUTE_CHANNELS = 6;

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const signedShort = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.round(Math.abs(n ?? 0)).toLocaleString('en-US')}`;
const tone = (n) => (n >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]');

export function ProfitShare({ stores, loading }) {
  const earners = stores.filter((s) => s.profit > 0).sort((a, b) => b.profit - a.profit);
  const losers = stores.filter((s) => s.profit < 0).sort((a, b) => a.profit - b.profit);
  const total = earners.reduce((sum, s) => sum + s.profit, 0);
  const top = earners.slice(0, SHARE_COLORS.length);
  const rest = earners.slice(SHARE_COLORS.length);
  const slices = [
    ...top.map((s, i) => ({ key: s.id ?? s.name, name: s.name, profit: s.profit, color: SHARE_COLORS[i] })),
    ...(rest.length ? [{ key: 'other', name: `Other (${rest.length})`, profit: rest.reduce((sum, s) => sum + s.profit, 0), color: OTHER_COLOR }] : []),
  ];
  const pct = (v) => (total > 0 ? (v / total) * 100 : 0);

  return (
    <Panel title="Where your profit comes from" sub="Each store's share of the profit made this period.">
      {slices.length ? (
        <>
          <MotionDiv
            className="flex h-6 w-full origin-left gap-[2px] overflow-hidden rounded-md"
            role="img"
            aria-label={slices.map((s) => `${s.name} ${Math.round(pct(s.profit))}%`).join(', ')}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.9, ease: EASE }}
          >
            {slices.map((s) => <div key={s.key} title={`${s.name}: ${usd(s.profit)}`} style={{ flex: s.profit, backgroundColor: s.color }} />)}
          </MotionDiv>
          <ul className="mt-4 space-y-2 text-xs tabular-nums">
            {slices.map((s) => (
              <li key={s.key} className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: s.color }} />
                  <span className="truncate text-[var(--dp-text-primary)]">{s.name}</span>
                </span>
                <span className="shrink-0 text-[var(--dp-text-muted)]">
                  <b className="text-[var(--dp-text-primary)]">{Math.round(pct(s.profit))}%</b> · <span className="text-[var(--dp-green-text)]">{usd(s.profit)}</span>
                </span>
              </li>
            ))}
          </ul>
          {losers.length > 0 && (
            <p className="mt-3 border-t border-[color:var(--dp-border)] pt-3 text-[11px] text-[var(--dp-text-muted)]">
              Lost money: {losers.map((s, i) => (
                <span key={s.id ?? s.name}>{i ? ', ' : ''}{s.name} <span className="text-[var(--dp-red-text)]">{usd(s.profit)}</span></span>
              ))}
            </p>
          )}
        </>
      ) : <Empty>{loading ? 'Loading…' : 'No profit from sales in this period'}</Empty>}
    </Panel>
  );
}

export function PriceBands({ bands, loading }) {
  const sold = bands.filter((b) => b.unitsSold > 0);
  const maxMargin = Math.max(1, ...sold.map((b) => Math.abs(b.margin ?? 0)));
  const best = sold.reduce((top, b) => ((b.margin ?? -Infinity) > (top?.margin ?? -Infinity) ? b : top), null);
  return (
    <Panel title="Margin by price range" sub="Sales grouped by what one unit cost you. Margin is profit over what the buyer paid.">
      {sold.length ? (
        <>
          <div className="space-y-3.5">
            {bands.map((b, i) => (
              <div key={b.key}>
                <div className="mb-1.5 flex justify-between gap-2 text-xs tabular-nums">
                  <span className="font-medium text-[var(--dp-text-primary)]">{b.label}</span>
                  {b.unitsSold > 0 ? (
                    <span className="text-[var(--dp-text-muted)]">
                      <b className={tone(b.margin)}>{b.margin.toFixed(1)}%</b> · {b.unitsSold} sold · <span className={tone(b.profit)}>{usd(b.profit)}</span>
                    </span>
                  ) : <span className="text-[var(--dp-text-label)]">Nothing sold</span>}
                </div>
                <GrowBar pct={b.unitsSold ? (Math.abs(b.margin) / maxMargin) * 100 : 0} color={(b.margin ?? 0) >= 0 ? 'var(--green)' : 'var(--red)'} delay={i * 0.06} />
              </div>
            ))}
          </div>
          {best && sold.length > 1 && (
            <p className="mt-4 text-[11px] text-[var(--dp-text-muted)]">
              Best margin: <b className="text-[var(--dp-text-primary)]">{best.label}</b> items, {best.roi != null ? `${best.roi.toFixed(1)}% ROI` : ''}.
            </p>
          )}
        </>
      ) : <Empty>{loading ? 'Loading…' : 'No sold items in this period'}</Empty>}
    </Panel>
  );
}

export function StoreRoutes({ routes, loading }) {
  const byStore = new Map();
  const byChannel = new Map();
  routes.forEach((r) => {
    byStore.set(r.store, (byStore.get(r.store) ?? 0) + r.profit);
    byChannel.set(r.channel, (byChannel.get(r.channel) ?? 0) + r.unitsSold);
  });
  const stores = Array.from(byStore.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const channels = Array.from(byChannel.entries()).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const shownStores = stores.slice(0, MAX_ROUTE_STORES);
  const shownChannels = channels.slice(0, MAX_ROUTE_CHANNELS);
  const cell = new Map(routes.map((r) => [`${r.store}|${r.channel}`, r]));
  const max = Math.max(1, ...routes.map((r) => Math.abs(r.profitPerUnit)));

  return (
    <Panel title="Where each store's items sell best" sub="Average profit per unit, by the store you bought from and where it sold. The best route for each store is outlined.">
      {routes.length ? (
        <>
          <div className="overflow-x-auto">
            <div
              className="grid min-w-max gap-1.5 text-xs tabular-nums"
              style={{ gridTemplateColumns: `minmax(90px, max-content) repeat(${shownChannels.length}, minmax(76px, 1fr))` }}
              role="table"
              aria-label="Profit per unit by store and where it sold"
            >
              <span role="columnheader" />
              {shownChannels.map((c) => (
                <span key={c} role="columnheader" className="truncate px-1 pb-1 text-center text-[11px] text-[var(--dp-text-label)]" title={c}>{c}</span>
              ))}
              {shownStores.map((store, si) => {
                const best = shownChannels
                  .map((c) => cell.get(`${store}|${c}`))
                  .filter(Boolean)
                  .reduce((top, r) => (r.profitPerUnit > (top?.profitPerUnit ?? -Infinity) ? r : top), null);
                return (
                  <React.Fragment key={store}>
                    <span role="rowheader" className="self-center truncate pr-2 text-[var(--dp-text-secondary)]" title={store}>{store}</span>
                    {shownChannels.map((c, ci) => {
                      const r = cell.get(`${store}|${c}`);
                      if (!r) {
                        return <span key={c} role="cell" className="rounded-md bg-[var(--dp-hover-bg)] py-2 text-center text-[var(--dp-text-label)]">—</span>;
                      }
                      const strength = Math.abs(r.profitPerUnit) / max;
                      const bg = r.profitPerUnit >= 0
                        ? `color-mix(in srgb, var(--dp-green-text) ${Math.round(12 + strength * 50)}%, transparent)`
                        : `color-mix(in srgb, var(--dp-red-text) ${Math.round(18 + strength * 50)}%, transparent)`;
                      const isBest = best === r && shownChannels.filter((x) => cell.get(`${store}|${x}`)).length > 1;
                      return (
                        <MotionDiv
                          key={c}
                          role="cell"
                          title={`${store} → ${c}: ${usd(r.profitPerUnit)} per unit · ${r.unitsSold} unit${r.unitsSold === 1 ? '' : 's'} · ${usd(r.profit)} total`}
                          className="rounded-md py-1.5 text-center"
                          style={{ backgroundColor: bg, outline: isBest ? '1.5px solid var(--dp-text-primary)' : 'none', outlineOffset: -1.5 }}
                          initial={{ opacity: 0, scale: 0.85 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ duration: 0.35, ease: EASE, delay: Math.min((si * shownChannels.length + ci) * 0.03, 0.6) }}
                        >
                          <div className="font-semibold text-[var(--dp-text-primary)]">{signedShort(r.profitPerUnit)}</div>
                          <div className="text-[10px] text-[var(--dp-text-secondary)]">{r.unitsSold} unit{r.unitsSold === 1 ? '' : 's'}</div>
                        </MotionDiv>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          {(stores.length > shownStores.length || channels.length > shownChannels.length) && (
            <p className="mt-3 text-[11px] text-[var(--dp-text-muted)]">
              Showing your top {shownStores.length} stores by profit and {shownChannels.length} busiest places you sell.
            </p>
          )}
        </>
      ) : <Empty>{loading ? 'Loading…' : 'No sold items in this period'}</Empty>}
    </Panel>
  );
}
