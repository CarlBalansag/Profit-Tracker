// Panels for Analytics → Products & Stores (next to Store ROI):
//   ProfitShare   each store's share of total profit, as one split bar
//   PriceBands    margin by what one unit cost
//   StoreRoutes   profit per unit for each store → place-sold route
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { GrowBar, Panel, Empty, Expand } from './Motion';

const MotionDiv = motion.div;
const EASE = [0.16, 1, 0.3, 1];
// Fixed order, so a store keeps its color as long as it keeps its rank.
const SHARE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const OTHER_COLOR = '#898781';
const MAX_ROUTE_STORES = 10;
const MAX_ROUTE_CHANNELS = 8;

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const signedShort = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${Math.round(Math.abs(n ?? 0)).toLocaleString('en-US')}`;
const tone = (n) => (n >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]');
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const shortDate = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

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

// What sits behind one square: the math, then every sale on that route.
function RouteDetail({ route, onClose }) {
  const items = route.items;
  return (
    <div
      role="region"
      aria-label={`${route.store} to ${route.channel}`}
      className="mt-4 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-hover-bg)] p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--dp-text-primary)]">
            {route.store} <span className="text-[var(--dp-text-label)]">→</span> {route.channel}
          </div>
          <div className="mt-1 text-xs tabular-nums text-[var(--dp-text-secondary)]">
            <span className={tone(route.profit)}>{usd(route.profit)}</span> profit ÷ {route.unitsSold} unit{route.unitsSold === 1 ? '' : 's'} ={' '}
            <b className={tone(route.profitPerUnit)}>{signed(route.profitPerUnit)} per unit</b>
          </div>
          {route.revenue != null && (
            <div className="mt-0.5 text-[11px] tabular-nums text-[var(--dp-text-muted)]">
              Profit = {usd(route.revenue)} paid to you (after fees) − {usd(route.cost)} item cost + {usd(route.cashback)} card cashback
            </div>
          )}
          <div className="mt-0.5 text-[11px] text-[var(--dp-text-muted)]">
            Units are the items bought at {route.store} that sold on {route.channel} this period, less any returned.
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close route details"
          className="shrink-0 rounded-md p-1 text-[var(--dp-text-label)] transition-colors hover:bg-[var(--dp-card-bg)] hover:text-[var(--dp-text-primary)]"
        >
          <X size={14} />
        </button>
      </div>

      {items?.length ? (
        <table className="mt-3 w-full table-fixed text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-[var(--dp-text-label)]">
              <th className="w-[92px] pb-1.5 text-left font-semibold">Sold</th>
              <th className="pb-1.5 text-left font-semibold">Item</th>
              <th className="w-[44px] pb-1.5 text-right font-semibold">Units</th>
              <th className="hidden w-[90px] pb-1.5 text-right font-semibold sm:table-cell">Paid</th>
              <th className="hidden w-[90px] pb-1.5 text-right font-semibold sm:table-cell">Cost</th>
              <th className="hidden w-[80px] pb-1.5 text-right font-semibold md:table-cell">Cashback</th>
              <th className="w-[84px] pb-1.5 text-right font-semibold">Profit</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-[color:var(--dp-border)]">
                <td className="py-1.5 text-[var(--dp-text-muted)]">{shortDate(item.date)}</td>
                <td className="truncate py-1.5 pr-2 text-[var(--dp-text-primary)]" title={item.product}>{item.product}</td>
                <td className="py-1.5 text-right">{item.units}</td>
                <td className="hidden py-1.5 text-right sm:table-cell">{usd(item.revenue)}</td>
                <td className="hidden py-1.5 text-right text-[var(--dp-text-secondary)] sm:table-cell">{usd(item.cost)}</td>
                <td className="hidden py-1.5 text-right text-[var(--dp-text-secondary)] md:table-cell">{usd(item.cashback)}</td>
                <td className={`py-1.5 text-right font-semibold ${tone(item.profit)}`}>{signed(item.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="mt-3 text-[11px] text-[var(--dp-text-muted)]">Refresh the page to see the sales behind this number.</p>}
    </div>
  );
}

export function StoreRoutes({ routes, loading }) {
  const [openKey, setOpenKey] = useState(null);
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
  const keyOf = (r) => `${r.store}|${r.channel}`;
  const cell = new Map(routes.map((r) => [keyOf(r), r]));
  const open = openKey ? cell.get(openKey) : null;
  const max = Math.max(1, ...routes.map((r) => Math.abs(r.profitPerUnit)));
  const shade = (ppu) => (ppu >= 0
    ? `color-mix(in srgb, var(--dp-green-text) ${Math.round(12 + (Math.abs(ppu) / max) * 50)}%, transparent)`
    : `color-mix(in srgb, var(--dp-red-text) ${Math.round(18 + (Math.abs(ppu) / max) * 50)}%, transparent)`);
  const routesFor = (store) => shownChannels.map((c) => cell.get(`${store}|${c}`)).filter(Boolean);
  const bestFor = (store) => {
    const list = routesFor(store);
    if (list.length < 2) return null;
    return list.reduce((top, r) => (r.profitPerUnit > top.profitPerUnit ? r : top));
  };
  const titleOf = (r) => `${r.store} → ${r.channel}: ${usd(r.profitPerUnit)} per unit · ${r.unitsSold} unit${r.unitsSold === 1 ? '' : 's'} · ${usd(r.profit)} total`;
  const toggle = (r) => setOpenKey((cur) => (cur === keyOf(r) ? null : keyOf(r)));
  // The best route gets an outline; the open one also gets an accent ring.
  const markStyle = (r, best) => ({
    backgroundColor: shade(r.profitPerUnit),
    outline: best === r ? '1.5px solid var(--dp-text-primary)' : 'none',
    outlineOffset: -1.5,
    boxShadow: openKey === keyOf(r) ? '0 0 0 2px var(--accent)' : 'none',
  });
  const pressProps = (r) => ({
    role: 'button',
    tabIndex: 0,
    'aria-pressed': openKey === keyOf(r),
    onClick: () => toggle(r),
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(r); } },
  });

  return (
    <Panel title="Where each store's items sell best" sub="Average profit per unit, by the store you bought from and where it sold. The best route for each store is outlined. Click a square to see how it adds up.">
      {routes.length ? (
        <>
          {/* Wider screens: a grid that always fits the card, no scrolling. */}
          <div
            className="hidden sm:grid gap-1.5 text-xs tabular-nums"
            style={{ gridTemplateColumns: `minmax(72px, 150px) repeat(${shownChannels.length}, minmax(0, 1fr))` }}
            role="table"
            aria-label="Profit per unit by store and where it sold"
          >
            <span role="columnheader" />
            {shownChannels.map((c) => (
              <span key={c} role="columnheader" className="truncate px-1 pb-1 text-center text-[11px] text-[var(--dp-text-label)]" title={c}>{c}</span>
            ))}
            {shownStores.map((store, si) => {
              const best = bestFor(store);
              return (
                <React.Fragment key={store}>
                  <span role="rowheader" className="self-center truncate pr-2 text-[var(--dp-text-secondary)]" title={store}>{store}</span>
                  {shownChannels.map((c, ci) => {
                    const r = cell.get(`${store}|${c}`);
                    if (!r) {
                      return <span key={c} role="cell" className="rounded-md bg-[var(--dp-hover-bg)] py-2 text-center text-[var(--dp-text-label)]">—</span>;
                    }
                    return (
                      <MotionDiv
                        key={c}
                        {...pressProps(r)}
                        title={titleOf(r)}
                        className="min-w-0 cursor-pointer rounded-md py-1.5 text-center transition-[filter] hover:brightness-125"
                        style={markStyle(r, best)}
                        initial={{ opacity: 0, scale: 0.85 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.35, ease: EASE, delay: Math.min((si * shownChannels.length + ci) * 0.03, 0.6) }}
                      >
                        <div className="font-semibold text-[var(--dp-text-primary)]">{signedShort(r.profitPerUnit)}</div>
                        <div className="truncate text-[10px] text-[var(--dp-text-secondary)]">{r.unitsSold} unit{r.unitsSold === 1 ? '' : 's'}</div>
                      </MotionDiv>
                    );
                  })}
                </React.Fragment>
              );
            })}
          </div>

          {/* Phones: one row per store, its routes as chips, best first. */}
          <ul className="space-y-3 sm:hidden">
            {shownStores.map((store) => {
              const best = bestFor(store);
              const list = routesFor(store).sort((a, b) => b.profitPerUnit - a.profitPerUnit);
              return (
                <li key={store}>
                  <div className="mb-1.5 truncate text-xs font-medium text-[var(--dp-text-primary)]">{store}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((r) => (
                      <span
                        key={r.channel}
                        {...pressProps(r)}
                        title={titleOf(r)}
                        className="cursor-pointer rounded-md px-2 py-1 text-[11px] tabular-nums text-[var(--dp-text-primary)]"
                        style={markStyle(r, best)}
                      >
                        {r.channel} <b>{signedShort(r.profitPerUnit)}</b> <span className="text-[var(--dp-text-secondary)]">· {r.unitsSold}u</span>
                      </span>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <Expand open={Boolean(open)}>
            {open && <RouteDetail key={openKey} route={open} onClose={() => setOpenKey(null)} />}
          </Expand>

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
