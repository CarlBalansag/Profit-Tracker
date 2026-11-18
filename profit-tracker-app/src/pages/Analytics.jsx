import React, { useMemo, useState } from 'react';
import { useDashboard } from '../hooks/useApi';
import LoadError from '../components/UI/LoadError';
import {
  DollarSign, ShoppingCart, TrendingUp, Percent, Gift, CreditCard, Package, BarChart2, RotateCcw,
  LayoutGrid, Users, Store, Truck, Receipt, Boxes,
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Rise, RiseItem, SlidingTabs, GrowBar, FlashNumber, Panel, Empty } from '../components/Analytics/Motion';
import ProfitCalendar from '../components/Analytics/ProfitCalendar';
import { ProfitShare, PriceBands, StoreRoutes } from '../components/Analytics/ProductPanels';


const DATE_OPTIONS = ['7 Days', '30 Days', 'YTD', 'All Time'].map((k) => ({ key: k, label: k }));
const MODE_OPTIONS = [
  { key: 'All', label: 'All', icon: LayoutGrid },
  { key: 'Cashout', label: 'Cashout', icon: Users },
  { key: 'Marketplace', label: 'Marketplace', icon: Store },
];
const TABS = [
  { key: 'overview', label: 'Overview', icon: BarChart2 },
  { key: 'products', label: 'Products & Stores', icon: Boxes },
  { key: 'channels', label: 'Channels', icon: Truck },
  { key: 'cards', label: 'Cards', icon: CreditCard },
];
const METRICS = [
  { key: 'profit', label: 'Profit' },
  { key: 'revenue', label: 'Revenue' },
  { key: 'roi', label: 'ROI' },
];
const PRIOR_LABEL = { '7 Days': 'prior 7 days', '30 Days': 'prior 30 days', YTD: 'same time last year' };

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
// A line subtracted or added on a receipt; nothing gets no sign.
const less = (n) => (n ? `−${usd(n)}` : usd(0));
const more = (n) => (n ? `+${usd(n)}` : usd(0));
const fmtPct = (n) => `${(n ?? 0).toFixed(2)}%`;
const axisMoney = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v))}`;

const PLATFORM_TYPE_COLOR = { Marketplace: 'var(--accent)', Cashout: 'var(--chart-2)', Direct: 'var(--text-muted)' };
// Share of attempted sales on a platform that were returned, disputed, or
// cancelled -- a quiet problem until it's visible, so this gets harder to
// miss the higher it climbs rather than one flat color throughout.
const exceptionColor = (pct) => (pct >= 15 ? 'var(--red)' : pct >= 5 ? 'var(--yellow)' : 'var(--green)');

const TOOLTIP = {
  contentStyle: { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 },
  labelStyle: { color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4 },
  itemStyle: { fontSize: 12 },
};
const AXIS = { stroke: 'var(--text-muted)', tick: { fill: 'var(--text-secondary)', fontSize: 11 }, tickLine: false, axisLine: false };
const TONE = { green: 'text-[var(--dp-green-text)]', red: 'text-[var(--dp-red-text)]', accent: 'text-[var(--accent)]', amber: 'text-[var(--dp-warning-text)]', default: 'text-[var(--dp-text-primary)]' };

// Change vs the last period, as a small ▲/▼ line under a stat.
function Delta({ now, before, pct = false, label }) {
  if (before == null || !Number.isFinite(before)) return null;
  const diff = now - before;
  if (Math.abs(diff) < 0.005) return <span className="text-[var(--dp-text-muted)]">Same as {label}</span>;
  const up = diff > 0;
  const rel = !pct && before !== 0 ? ` (${up ? '+' : '−'}${Math.abs((diff / Math.abs(before)) * 100).toFixed(0)}%)` : '';
  return (
    <span className={up ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}>
      {up ? '▲' : '▼'} {pct ? `${Math.abs(diff).toFixed(2)} pts` : usd(Math.abs(diff))}{rel} vs {label}
    </span>
  );
}

function Metric({ label, value, number, sub, icon: Icon, tone = 'default', pending }) {
  return (
    <RiseItem className="card relative min-w-0 p-4">
      {Icon && <Icon size={16} className={`absolute right-4 top-4 ${TONE[tone]}`} />}
      <span className="pr-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">{label}</span>
      <p className={`mt-2 text-xl font-bold tabular-nums ${TONE[tone]}`}>
        {Number.isFinite(number) ? <FlashNumber value={value} number={number} pending={pending} /> : value}
      </p>
      {sub && <p className="mt-1 text-[11px] text-[var(--dp-text-muted)]">{sub}</p>}
    </RiseItem>
  );
}

// Every bucket key between the first and last, so a quiet day or month shows
// as zero instead of being skipped on the x-axis.
function fillKeys(keys, daily, meta) {
  if (daily && meta) {
    const out = [];
    for (let d = new Date(`${meta.windowStart}T00:00:00Z`); d <= new Date(`${meta.windowEnd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
  if (!keys.length) return [];
  const sorted = [...keys].sort();
  if (daily) return sorted;
  const out = [];
  const [y0, m0] = sorted[0].split('-').map(Number);
  const [y1, m1] = sorted[sorted.length - 1].split('-').map(Number);
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 12 ? (y += 1, m = 1) : (m += 1)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}
const keyLabel = (key) => (key.length === 7
  ? new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  : new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }));

function ProfitTrend({ data, dateRange }) {
  const [metric, setMetric] = useState('profit');
  const daily = dateRange === '7 Days' || dateRange === '30 Days';
  const hasPrior = Boolean(data?.priorStats);

  const points = useMemo(() => {
    const cur = new Map((data?.trend ?? []).map((p) => [p.date.slice(0, daily ? 10 : 7), p]));
    const prior = new Map((data?.priorTrend ?? []).map((p) => [p.date.slice(0, daily ? 10 : 7), p]));
    // Monthly trend arrives per month; daily ranges arrive per day.
    const keys = fillKeys(Array.from(cur.keys()), daily, data?.trendMeta);
    const pick = (p) => {
      if (!p) return 0;
      if (metric === 'revenue') return p.totalRevenue || 0;
      if (metric === 'roi') return p.soldCost > 0 ? (p.netProfit / p.soldCost) * 100 : 0;
      return p.netProfit || 0;
    };
    return keys.map((k) => ({
      key: k,
      name: keyLabel(k),
      now: pick(cur.get(k)),
      before: hasPrior ? pick(prior.get(k)) : undefined,
    }));
  }, [data, daily, metric, hasPrior]);

  const fmtValue = (v) => (metric === 'roi' ? `${v.toFixed(1)}%` : usd(v));
  const color = metric === 'revenue' ? 'var(--accent)' : 'var(--green)';

  return (
    <Panel
      title="Trend"
      sub={`${METRICS.find((m) => m.key === metric).label} per ${daily ? 'day' : 'month'}${hasPrior ? `, dashed line is the ${PRIOR_LABEL[dateRange]}` : ''}`}
      right={<SlidingTabs size="sm" ariaLabel="Trend metric" value={metric} onChange={setMetric} options={METRICS} />}
    >
      <div className="w-full" style={{ height: 260 }}>
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={points} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hover)" vertical={false} />
              <XAxis dataKey="name" {...AXIS} dy={8} interval="preserveStartEnd" minTickGap={20} />
              <YAxis {...AXIS} width={56} tickFormatter={(v) => (metric === 'roi' ? `${Math.round(v)}%` : axisMoney(v))} />
              <ReferenceLine y={0} stroke="var(--border-hover)" />
              <Tooltip {...TOOLTIP} formatter={(v, name) => [fmtValue(v), name]} />
              {hasPrior && (
                <Line key={`b-${metric}`} dataKey="before" name={PRIOR_LABEL[dateRange]} type="monotone" stroke="var(--text-muted)" strokeDasharray="5 4" strokeWidth={1.5} dot={false} isAnimationActive animationDuration={900} />
              )}
              <Line key={`n-${metric}`} dataKey="now" name="This period" type="monotone" stroke={color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={1300} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty>No sales in this period</Empty>}
      </div>
    </Panel>
  );
}

function Analytics() {
  const [activeTab, setActiveTab] = useState('overview');
  const [mode, setMode] = useState('All');
  const [dateRange, setDateRange] = useState('All Time');

  const { data, isLoading: loading, isFetching, isPlaceholderData, isLoadingError, refetch: fetchData } = useDashboard(mode, dateRange);
  const pending = loading || (isFetching && isPlaceholderData);

  const s = data?.stats ?? {};
  const p = data?.priorStats ?? null;
  const priorLabel = PRIOR_LABEL[dateRange];
  // Profit counts cashback on sold items only; the Cashback card shows every purchase.
  const soldCashback = (s.profit ?? 0) - (s.totalRevenue ?? 0) + (s.soldCost ?? 0);
  const topCards = data?.topCards ?? [];
  const platformBreakdown = data?.platformBreakdown ?? [];
  const vendorBreakdown = data?.vendorBreakdown ?? [];
  const storesWithSales = vendorBreakdown.filter((v) => v.unitsSold > 0).sort((a, b) => b.profit - a.profit);
  const cashbackRateTrend = useMemo(() => {
    const byMonth = new Map();
    (data?.trend ?? []).forEach((pt) => {
      const m = pt.date.slice(0, 7);
      const row = byMonth.get(m) || { key: m, cashback: 0, cost: 0 };
      row.cashback += pt.cashback || 0;
      row.cost += pt.totalCost || 0;
      byMonth.set(m, row);
    });
    return Array.from(byMonth.values()).map((r) => ({ name: keyLabel(r.key), rate: r.cost > 0 ? (r.cashback / r.cost) * 100 : 0 }));
  }, [data]);

  if (isLoadingError) return <LoadError title="Analytics & Insights" what="your analytics" onRetry={() => fetchData()} />;

  const money = (v) => (loading ? '…' : usd(v));
  const showExpenses = mode === 'All' && s.businessExpenses != null;

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="h-full overflow-auto">
      <div className="w-full max-w-7xl mx-auto space-y-6 pb-10 px-4 py-6 sm:px-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--dp-text-primary)] tracking-tight">Analytics & Insights</h1>
            <p className="text-sm text-[var(--dp-text-secondary)] mt-1">{mode === 'All' ? 'Combined overview' : `${mode} sales only`}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SlidingTabs size="sm" ariaLabel="Sales channel" value={mode} onChange={setMode} options={MODE_OPTIONS} />
            <button type="button" onClick={() => fetchData()} className="page-btn page-btn-secondary">
              <RotateCcw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <SlidingTabs ariaLabel="Date range" value={dateRange} onChange={setDateRange} options={DATE_OPTIONS} className="w-max" />

        {/* Metrics */}
        <Rise key={`${mode}`} className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Metric label="Revenue" icon={DollarSign} value={money(s.totalRevenue)} number={s.totalRevenue} pending={pending}
            sub={p ? <Delta now={s.totalRevenue} before={p.totalRevenue} label={priorLabel} /> : `${s.salesCount ?? 0} sale${s.salesCount !== 1 ? 's' : ''}, after fees`} />
          <Metric label="Profit" icon={TrendingUp} tone="green" value={money(s.profit)} number={s.profit} pending={pending}
            sub={p ? <Delta now={s.profit} before={p.profit} label={priorLabel} /> : `incl. ${usd(soldCashback)} cashback on sold items`} />
          <Metric label="ROI" icon={Percent} tone="green" value={loading ? '…' : fmtPct(s.roi)} number={s.roi} pending={pending}
            sub={p ? <Delta now={s.roi} before={p.roi} pct label={priorLabel} /> : 'Profit on what the sold items cost'} />
          {showExpenses ? (
            <Metric label="After expenses" icon={Receipt} tone={(s.profitAfterExpenses ?? 0) >= 0 ? 'green' : 'red'} value={money(s.profitAfterExpenses)} number={s.profitAfterExpenses} pending={pending}
              sub={`Profit minus ${usd(s.businessExpenses)} business expenses`} />
          ) : (
            <Metric label="Units sold" icon={Package} value={loading ? '…' : String(s.unitsSold ?? 0)} number={s.unitsSold} pending={pending}
              sub={p ? `${p.unitsSold} in the ${priorLabel}` : `${s.salesCount ?? 0} sales`} />
          )}
          <Metric label="Cashback" icon={Gift} value={money(s.totalCashback)} number={s.totalCashback} pending={pending}
            sub={`Avg ${fmtPct(s.avgCashbackRate)} on purchases`} />
          <Metric label="Platform fees" icon={CreditCard} tone="amber" value={money(s.commissionFees)} number={s.commissionFees} pending={pending}
            sub={s.totalRevenue > 0 ? `${fmtPct((s.commissionFees / (s.totalRevenue + s.commissionFees)) * 100)} of sale prices` : 'Taken out of payouts'} />
          <Metric label="Item cost" icon={ShoppingCart} value={money(s.soldCost)} number={s.soldCost} pending={pending}
            sub="What the sold items cost you, incl. tax & shipping" />
          <Metric label="In stock" icon={Package} value={loading ? '…' : String(s.inventoryQty ?? 0)} number={s.inventoryQty} pending={pending}
            sub={`${usd(s.inventoryValue)} at cost · ${s.listedQty ?? 0} listed`} />
        </Rise>

        <SlidingTabs ariaLabel="Analytics sections" value={activeTab} onChange={setActiveTab} options={TABS} />

        {activeTab === 'overview' && (
          <Rise key={`overview-${mode}-${dateRange}`} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <RiseItem className="lg:col-span-2"><ProfitTrend data={data} dateRange={dateRange} /></RiseItem>
            <RiseItem className="lg:col-span-1">
              <Panel title="Profit" sub="How profit is worked out for this period.">
                <div className="space-y-2 text-sm tabular-nums">
                  <div className="flex justify-between"><span className="text-[var(--dp-text-secondary)]">Revenue, after fees</span><b>{usd(s.totalRevenue)}</b></div>
                  <div className="flex justify-between"><span className="text-[var(--dp-text-secondary)]">Item cost</span><b className="text-[var(--dp-red-text)]">{less(s.soldCost)}</b></div>
                  <div className="flex justify-between"><span className="text-[var(--dp-text-secondary)]">Cashback on sold items</span><b className="text-[var(--dp-green-text)]">{more(soldCashback)}</b></div>
                  <div className="flex justify-between border-t border-[color:var(--dp-border)] pt-2"><span>Profit on sales</span><b className="text-[var(--dp-green-text)]">{usd(s.profit)}</b></div>
                  {showExpenses && (
                    <>
                      <div className="flex justify-between"><span className="text-[var(--dp-text-secondary)]">Business expenses</span><b className="text-[var(--dp-red-text)]">{less(s.businessExpenses)}</b></div>
                      <div className="flex justify-between border-t border-[color:var(--dp-border)] pt-2"><span>After expenses</span><b className={(s.profitAfterExpenses ?? 0) >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}>{usd(s.profitAfterExpenses)}</b></div>
                    </>
                  )}
                </div>
                <p className="mt-3 text-[11px] text-[var(--dp-text-muted)]">
                  {s.unitsSold ?? 0} units sold{s.salesVelocity > 0 ? ` · ${s.salesVelocity.toFixed(2)} sales/day` : ''}
                  {showExpenses ? ' · Expenses are from the Expenses page.' : ''}
                </p>
              </Panel>
            </RiseItem>
            <RiseItem className="lg:col-span-3"><ProfitCalendar calendar={data?.profitCalendar} dateRange={dateRange} /></RiseItem>
          </Rise>
        )}

        {activeTab === 'products' && (
          <Rise key={`products-${mode}-${dateRange}`} className="grid grid-cols-1 lg:grid-cols-2 items-start gap-6">
            <RiseItem>
              <Panel title="Store ROI" sub="Profit on items sold this period, by the store you bought them from.">
                {storesWithSales.length ? (
                  <div className="space-y-4">
                    {storesWithSales.map((v, i) => {
                      const maxProfit = Math.max(...storesWithSales.map((x) => Math.abs(x.profit)), 1);
                      return (
                        <div key={v.id ?? v.name}>
                          <div className="flex justify-between gap-2 text-xs mb-1.5">
                            <span className="truncate font-medium text-[var(--dp-text-primary)]">{v.name}</span>
                            <span className="shrink-0 tabular-nums text-[var(--dp-text-muted)]">
                              {v.unitsSold} sold · <b className={v.profit >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}>{v.profit >= 0 ? '+' : ''}{usd(v.profit)}</b>
                              {v.roi != null && <> · {v.roi.toFixed(1)}% ROI</>}
                            </span>
                          </div>
                          <GrowBar pct={(Math.abs(v.profit) / maxProfit) * 100} color={v.profit >= 0 ? 'var(--green)' : 'var(--red)'} delay={i * 0.05} />
                          {mode === 'All' && <div className="mt-1 text-[11px] text-[var(--dp-text-label)] tabular-nums">{usd(v.spend)} spent this period · {usd(v.avgCostPerUnit)} avg / unit</div>}
                        </div>
                      );
                    })}
                  </div>
                ) : <Empty>{loading ? 'Loading…' : 'No sold items in this period'}</Empty>}
              </Panel>
            </RiseItem>
            {/* The two shorter cards stack beside Store ROI, so neither waits
                for it to end; the store-to-channel grid gets the full width. */}
            <RiseItem className="space-y-6">
              <ProfitShare stores={storesWithSales} loading={loading} />
              <PriceBands bands={data?.priceBands ?? []} loading={loading} />
            </RiseItem>
            <RiseItem className="lg:col-span-2"><StoreRoutes routes={data?.storeChannels ?? []} loading={loading} /></RiseItem>
          </Rise>
        )}

        {activeTab === 'channels' && (
          <Rise key={`channels-${mode}-${dateRange}`} className="space-y-6">
            <RiseItem>
              <Panel title="Platform payouts" sub="How much each Cashout or Marketplace channel has actually paid you, after its commission.">
                {platformBreakdown.length > 0 ? (
                  <>
                    <div className="w-full mb-6" style={{ height: 200 }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={platformBreakdown} margin={{ top: 5, right: 20, left: 0, bottom: 5 }} barSize={36}>
                          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hover)" vertical={false} />
                          <XAxis dataKey="name" {...AXIS} dy={8} />
                          <YAxis {...AXIS} tickFormatter={axisMoney} />
                          <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--dp-hover-bg)' }} formatter={(v) => usd(v)} />
                          <Bar dataKey="revenue" name="Paid to you" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900}>
                            {platformBreakdown.map((entry, i) => <Cell key={i} fill={PLATFORM_TYPE_COLOR[entry.type] || 'var(--chart-1)'} />)}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="space-y-3">
                      {platformBreakdown.map((pl) => (
                        <div key={pl.id ?? pl.name} className="rounded-lg border border-[color:var(--dp-border)] p-3">
                          <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-[var(--dp-text-primary)]">{pl.name}</span>
                              <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded border" style={{ color: PLATFORM_TYPE_COLOR[pl.type] || 'var(--chart-1)', borderColor: PLATFORM_TYPE_COLOR[pl.type] || 'var(--chart-1)' }}>{pl.type}</span>
                            </div>
                            <span className={`text-sm font-bold ${pl.profit >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}`}>{pl.profit >= 0 ? '+' : ''}${fmt(pl.profit)} profit</span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div><span className="text-[var(--dp-text-muted)]">Paid to you </span><span className="font-medium">${fmt(pl.revenue)}</span></div>
                            <div><span className="text-[var(--dp-text-muted)]">Commission </span><span className="text-[var(--dp-warning-text)] font-medium">${fmt(pl.commission)}</span></div>
                            <div><span className="text-[var(--dp-text-muted)]">Units </span><span className="font-medium">{pl.unitsSold}</span></div>
                            <div><span className="text-[var(--dp-text-muted)]">Avg payout </span><span className="font-medium">{pl.avgPayoutDays != null ? `${pl.avgPayoutDays}d` : '—'}</span></div>
                          </div>
                          {(pl.returnedCount + pl.disputedCount + pl.cancelledCount) > 0 && (
                            <div className="mt-2 text-[11px]" style={{ color: exceptionColor(pl.exceptionRatePct) }}>
                              {pl.exceptionRatePct.toFixed(1)}% of attempted sales here were returned, disputed, or cancelled
                              {' '}({pl.returnedCount} returned · {pl.disputedCount} disputed · {pl.cancelledCount} cancelled)
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                ) : <Empty>{loading ? 'Loading…' : 'No sales in this period'}</Empty>}
              </Panel>
            </RiseItem>
          </Rise>
        )}

        {activeTab === 'cards' && (
          <Rise key={`cards-${mode}-${dateRange}`} className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RiseItem>
              <Panel title="Cashback & spend by card" sub={mode === 'All' ? 'Purchases made on each card this period, and the cashback they earned.' : 'Cost and cashback of items sold through this channel, by the card they were bought with.'}>
                {topCards.length > 0 ? (
                  <div className="space-y-4">
                    {topCards.map((card, i) => {
                      const maxAmt = Math.max(...topCards.map((c) => c.amount), 1);
                      return (
                        <div key={card.name}>
                          <div className="flex justify-between gap-2 text-xs mb-1.5">
                            <span className="truncate font-medium text-[var(--dp-text-primary)]">{card.name}</span>
                            <span className="shrink-0 tabular-nums text-[var(--dp-text-muted)]">
                              <b className="text-[var(--dp-green-text)]">{usd(card.cashback)}</b> cashback · {fmtPct(card.cashbackRate)}
                            </span>
                          </div>
                          <GrowBar pct={(card.amount / maxAmt) * 100} color="var(--accent)" delay={i * 0.05} />
                          <div className="mt-1 text-[11px] text-[var(--dp-text-label)] tabular-nums">{usd(card.amount)} spent · {card.txns} purchase{card.txns !== 1 ? 's' : ''}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : <Empty>{loading ? 'Loading…' : 'No payment data for this period'}</Empty>}
              </Panel>
            </RiseItem>
            <RiseItem>
              <Panel title="Cashback rate" sub="Cashback earned as a share of purchase spend, by month.">
                <div className="w-full" style={{ height: 220 }}>
                  {cashbackRateTrend.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={cashbackRateTrend} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hover)" vertical={false} />
                        <XAxis dataKey="name" {...AXIS} dy={8} />
                        <YAxis {...AXIS} tickFormatter={(v) => `${v.toFixed(1)}%`} />
                        <Tooltip {...TOOLTIP} formatter={(v) => `${v.toFixed(2)}%`} />
                        <Line type="monotone" dataKey="rate" name="Cashback rate" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive animationDuration={1200} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <Empty>{loading ? 'Loading…' : 'No data for this period'}</Empty>}
                </div>
              </Panel>
            </RiseItem>
          </Rise>
        )}
      </div>
    </div>
  );
}

export default Analytics;
