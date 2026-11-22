import React, { useMemo, useState } from 'react';
import { useMatchMedia } from '../hooks/useMatchMedia';
import { RotateCcw, ChevronRight, ArrowDownLeft, ArrowUpRight, CreditCard, Package } from 'lucide-react';
import {
  ComposedChart, Bar, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { useCashFlow } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import LoadError from '../components/UI/LoadError';
import { Rise, RiseItem, SlidingTabs, GrowBar, FlashNumber, Expand, Panel, Empty, LateGlow } from '../components/Analytics/Motion';
import MoneyMap from '../components/CashFlow/MoneyMap';
import { TaxReservePanel } from '../components/CashFlow/TaxReservePanel';

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const axisMoney = (v) => `${v < 0 ? '−' : ''}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(v))}`;
const monthLabel = (key) => new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const TOOLTIP = {
  contentStyle: { backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-default)', borderRadius: 8 },
  labelStyle: { color: 'var(--text-secondary)', fontSize: 12, marginBottom: 4 },
  itemStyle: { fontSize: 12 },
};
const AXIS = { stroke: 'var(--text-muted)', tick: { fill: 'var(--text-secondary)', fontSize: 11 }, tickLine: false, axisLine: false };

const STATE_PILL = {
  late: { label: (g) => `Late ${g.maxLateDays}d`, cls: 'bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]' },
  due_soon: { label: () => 'Due soon', cls: 'bg-[var(--dp-warning-bg)] text-[var(--dp-warning-text)]' },
  on_time: { label: () => 'On time', cls: 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]' },
};
const Pill = ({ cls, children }) => <span className={`shrink-0 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;

function Kpi({ label, value, number, sub, tone = 'text-[var(--dp-text-primary)]', icon: Icon, pending }) {
  return (
    <RiseItem className="card relative min-w-0 p-4">
      {Icon && <Icon size={16} className="absolute right-4 top-4 text-[var(--dp-text-label)]" />}
      <span className="block pr-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">{label}</span>
      <p className={`mt-2 text-xl font-bold tabular-nums ${tone}`}><FlashNumber value={value} number={number} pending={pending} /></p>
      {sub && <p className="mt-1 text-[11px] text-[var(--dp-text-muted)]">{sub}</p>}
    </RiseItem>
  );
}

function OwedRow({ group }) {
  const [open, setOpen] = useState(false);
  const isPhone = useMatchMedia('(max-width: 639px)');
  const pill = STATE_PILL[group.state];
  return (
    <LateGlow active={group.state === 'late'} className="rounded-xl">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 rounded-xl px-2 py-2.5 text-left hover:bg-[var(--dp-hover-bg)] transition-colors"
      >
        <ChevronRight size={14} className={`shrink-0 text-[var(--dp-text-label)] transition-transform duration-300 ${open ? 'rotate-90' : ''}`} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--dp-text-primary)]">{group.name}</span>
          <span className="block text-[11px] text-[var(--dp-text-muted)]">
            {plural(group.count, 'sale')} · oldest {group.oldestDays}d<span className="hidden sm:inline"> · usually pays in {group.expectedDays}d</span>
          </span>
        </span>
        {/* Phones stack the pill over the amount so the name keeps its width. */}
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          <Pill cls={pill.cls}>{pill.label(group)}</Pill>
          <span className="text-right text-sm font-bold tabular-nums text-[var(--dp-green-text)] sm:w-24">{usd(group.amount)}</span>
        </span>
      </button>
      <Expand open={open}>
        <div className="pl-9 pr-2 pb-2 max-sm:pl-2">
          {/* Phones: one block per sale (item + owed, then sold / expected),
              since four columns don't fit beside the indent at 360px. */}
          {isPhone ? (
          <ul className="divide-y divide-[color:var(--dp-border)] text-xs tabular-nums">
            {group.items.map((item) => (
              <li key={item.id} className="py-2">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 text-[var(--dp-text-secondary)]">
                    {item.product}{item.payoutStatus === 'partial' && <span className="text-[var(--dp-warning-text)]"> · short-paid</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-[var(--dp-text-primary)]">{usd(item.amount)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-[var(--dp-text-muted)]">
                  Sold {dayLabel(item.saleDate)} · Expected{' '}
                  <span className={item.lateDays > 0 ? 'text-[var(--dp-red-text)]' : ''}>
                    {dayLabel(item.expectedDate)}{item.lateDays > 0 ? ` (${item.lateDays}d late)` : ''}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          ) : (
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--dp-text-label)]">
                <th className="text-left font-semibold pb-1">Item</th>
                <th className="text-right font-semibold pb-1">Sold</th>
                <th className="text-right font-semibold pb-1">Expected</th>
                <th className="text-right font-semibold pb-1">Owed</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => (
                <tr key={item.id} className="border-t border-[color:var(--dp-border)]">
                  <td className="py-1.5 pr-2 max-w-[160px] truncate text-[var(--dp-text-secondary)]">
                    {item.product}{item.payoutStatus === 'partial' && <span className="text-[var(--dp-warning-text)]"> · short-paid</span>}
                  </td>
                  <td className="py-1.5 text-right text-[var(--dp-text-muted)]">{dayLabel(item.saleDate)}</td>
                  <td className={`py-1.5 text-right ${item.lateDays > 0 ? 'text-[var(--dp-red-text)]' : 'text-[var(--dp-text-muted)]'}`}>
                    {dayLabel(item.expectedDate)}{item.lateDays > 0 ? ` (${item.lateDays}d late)` : ''}
                  </td>
                  <td className="py-1.5 text-right font-semibold text-[var(--dp-text-primary)]">{usd(item.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--dp-text-label)]">Expected date from {group.expectedBasis === 'default' ? 'a 14-day default (no paid sales from them yet)' : group.expectedBasis}.</p>
        </div>
      </Expand>
    </LateGlow>
  );
}

function BillRow({ bill, index }) {
  const pct = bill.billsSoFar > 0 ? (bill.payoutsBefore / bill.billsSoFar) * 100 : 100;
  return (
    <div className="px-2 py-2.5">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[var(--dp-text-primary)]">{bill.card}</span>
          <span className="block text-[11px] text-[var(--dp-text-muted)]">
            Due {dayLabel(bill.dueDate)} · {bill.dueInDays === 0 ? 'today' : `in ${bill.dueInDays}d`}{!bill.final && ' · cycle still open'}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
          {bill.covered
            ? <Pill cls="bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]">Covered</Pill>
            : <Pill cls="bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]">Short {usd(-bill.gap)}</Pill>}
          <span className="text-right text-sm font-bold tabular-nums text-[var(--dp-red-text)] sm:w-24">{usd(bill.amount)}</span>
        </span>
      </div>
      <div className="mt-2 pl-0">
        <GrowBar pct={pct} color={bill.covered ? 'var(--dp-green-text)' : 'var(--dp-warning-text)'} delay={0.1 + index * 0.06} height={5} />
        <p className="mt-1 text-[10px] text-[var(--dp-text-label)] tabular-nums">
          {usd(bill.payoutsBefore)} expected in payouts by then, against {usd(bill.billsSoFar)} of bills due by then
        </p>
      </div>
    </div>
  );
}

function CashFlow() {
  const { data, isLoading, isFetching, isLoadingError, refetch } = useCashFlow();
  const [months, setMonths] = useState('6');

  const monthly = useMemo(() => {
    const rows = data?.monthly ?? [];
    return rows.slice(-Number(months)).map((m) => ({ ...m, name: monthLabel(m.month), outNeg: -m.out }));
  }, [data, months]);
  const tiedUp = useMemo(() => (data?.tiedUp ?? []).map((w) => ({ ...w, name: dayLabel(w.date) })), [data]);

  if (isLoading) return <PageLoader variant="generic" />;
  if (isLoadingError) return <LoadError title="Cash Flow" what="your cash flow" onRetry={() => refetch()} />;

  const s = data.summary;
  const tiedNow = tiedUp.length ? tiedUp[tiedUp.length - 1].total : s.inStock;
  const netDelta = s.netThisMonth - s.netLastMonth;
  const upcomingBills = data.coverage.filter((b) => b.dueInDays <= 45);
  const gap30 = s.coverageGap;
  const refreshing = isFetching && !isLoading;

  return (
    // The app shell never scrolls; each page owns its scroll container.
    <div className="h-full overflow-auto">
      <div className="w-full max-w-6xl mx-auto space-y-6 pb-10 px-4 py-6 sm:px-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-[var(--dp-text-primary)] tracking-tight">Cash Flow</h1>
            <p className="text-sm text-[var(--dp-text-secondary)] mt-1">Money in, money out, and what's still owed</p>
          </div>
          <button type="button" onClick={() => refetch()} className="page-btn page-btn-secondary">
            <RotateCcw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        <Rise className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Kpi label="Owed to you" icon={ArrowDownLeft} value={usd(s.owedTotal)} number={s.owedTotal} pending={refreshing}
            tone="text-[var(--dp-green-text)]"
            sub={s.owedCount ? `${plural(s.owedCount, 'sale')} unpaid${s.lateCount ? ` · ${s.lateCount} late` : ''}` : 'Nothing waiting'} />
          <Kpi label="Bills due, 30d" icon={CreditCard} value={usd(s.billsDue30)} number={s.billsDue30} pending={refreshing}
            tone={s.billsDue30 > 0 ? 'text-[var(--dp-red-text)]' : undefined} sub="Estimated from charges" />
          <Kpi label="Net this month" icon={ArrowUpRight} value={signed(s.netThisMonth)} number={s.netThisMonth} pending={refreshing}
            tone={s.netThisMonth >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}
            sub={`${netDelta >= 0 ? '▲' : '▼'} ${usd(Math.abs(netDelta))} vs last month`} />
          <Kpi label="Tied up now" icon={Package} value={usd(tiedNow)} number={tiedNow} pending={refreshing}
            sub={`${usd(s.inStock)} in stock + ${usd(s.owedTotal)} unpaid`} />
        </Rise>

        <TaxReservePanel />

        {/* Owed vs due */}
        <Panel title="Owed vs due" sub="Who still owes you, next to the card bills coming up and whether payouts land before them.">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between px-2 mb-1">
                <h4 className="text-xs font-semibold text-[var(--dp-text-secondary)]">Owed to you</h4>
                <span className="text-sm font-bold tabular-nums text-[var(--dp-green-text)]">{usd(s.owedTotal)}</span>
              </div>
              {data.owed.length
                ? <Rise className="space-y-0.5">{data.owed.map((g) => <RiseItem key={g.name}><OwedRow group={g} /></RiseItem>)}</Rise>
                : <Empty>Every sale has been paid.</Empty>}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between px-2 mb-1">
                <h4 className="text-xs font-semibold text-[var(--dp-text-secondary)]">Card bills</h4>
                <span className="text-sm font-bold tabular-nums text-[var(--dp-red-text)]">{usd(upcomingBills.reduce((t, b) => t + b.amount, 0))}</span>
              </div>
              {upcomingBills.length
                ? <Rise className="divide-y divide-[color:var(--dp-border)]">{upcomingBills.map((b, i) => <RiseItem key={`${b.cardId}-${b.dueDate}`}><BillRow bill={b} index={i} /></RiseItem>)}</Rise>
                : <Empty>{data.cards.some((c) => c.hasDates) ? 'No card charges waiting on a bill.' : 'Add statement close and due days to your cards in Settings to see bills here.'}</Empty>}
            </div>
          </div>
          <div className={`mt-5 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm ${gap30 >= 0 ? 'bg-[var(--dp-green-bg)]' : 'bg-[var(--dp-red-bg)]'}`}>
            <Pill cls={gap30 >= 0 ? 'bg-[var(--dp-green-text)] text-[var(--dp-card-bg)]' : 'bg-[var(--dp-red-text)] text-[var(--dp-card-bg)]'}>{gap30 >= 0 ? 'Covered' : 'Short'}</Pill>
            <span className="text-[var(--dp-text-secondary)]">
              What you're owed {gap30 >= 0 ? 'covers' : 'falls short of'} the next 30 days of card bills by{' '}
              <b className="tabular-nums text-[var(--dp-text-primary)]">{usd(Math.abs(gap30))}</b>
            </span>
          </div>
        </Panel>

        {/* Money in vs out */}
        <Panel
          title="Money in vs out"
          sub="In: payouts received and store refunds. Out: purchases, business expenses and refunds to buyers. The line is the net."
          right={<SlidingTabs size="sm" ariaLabel="Months shown" value={months} onChange={setMonths} options={[{ key: '6', label: '6 months' }, { key: '12', label: '12 months' }]} />}
        >
          <div className="w-full" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthly} stackOffset="sign" margin={{ top: 5, right: 10, left: 0, bottom: 0 }} barSize={22}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hover)" vertical={false} />
                <XAxis dataKey="name" {...AXIS} dy={8} />
                <YAxis {...AXIS} tickFormatter={axisMoney} width={56} />
                <ReferenceLine y={0} stroke="var(--border-hover)" />
                <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--dp-hover-bg)' }}
                  formatter={(v, name) => [usd(name === 'Out' ? -v : v), name]} />
                <Bar dataKey="in" name="In" stackId="cash" fill="var(--green)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900} />
                <Bar dataKey="outNeg" name="Out" stackId="cash" fill="var(--red)" radius={[4, 4, 0, 0]} isAnimationActive animationDuration={900} />
                <Line dataKey="net" name="Net" type="linear" stroke="var(--text-primary)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive animationDuration={1200} animationBegin={300} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs tabular-nums">
            {(() => {
              const t = monthly.reduce((a, m) => ({ payouts: a.payouts + m.payouts, purchases: a.purchases + m.purchases, expenses: a.expenses + m.expenses, net: a.net + m.net }), { payouts: 0, purchases: 0, expenses: 0, net: 0 });
              return [
                ['Payouts', usd(t.payouts), 'text-[var(--dp-green-text)]'],
                ['Purchases', usd(t.purchases), 'text-[var(--dp-red-text)]'],
                ['Expenses', usd(t.expenses), 'text-[var(--dp-red-text)]'],
                ['Net', signed(t.net), t.net >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'],
              ].map(([l, v, c]) => (
                <div key={l}><span className="block text-[var(--dp-text-label)]">{l}, {months} mo</span><span className={`text-sm font-bold ${c}`}>{v}</span></div>
              ));
            })()}
          </div>
        </Panel>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Cash tied up */}
          <Panel title="Cash tied up" sub="Unsold stock at cost plus sold-but-unpaid sales, week by week. Rising means cash is getting stuck.">
            <div className="w-full" style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={tiedUp} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-hover)" vertical={false} />
                  <XAxis dataKey="name" {...AXIS} dy={8} interval="preserveStartEnd" minTickGap={24} />
                  <YAxis {...AXIS} tickFormatter={axisMoney} width={56} />
                  <Tooltip {...TOOLTIP} formatter={(v, name) => [usd(v), name]} />
                  <Area dataKey="inventory" name="In stock" stackId="t" type="linear" stroke="var(--yellow)" fill="var(--yellow)" fillOpacity={0.25} isAnimationActive animationDuration={1200} />
                  <Area dataKey="unpaid" name="Sold, unpaid" stackId="t" type="linear" stroke="var(--dp-info-text)" fill="var(--dp-info-text)" fillOpacity={0.25} isAnimationActive animationDuration={1200} animationBegin={200} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {/* Card balances vs limits */}
          <Panel title="Card balances vs limits" sub="Estimated balance from what was charged to each card since its last unpaid statement.">
            {data.cards.length ? (
              <div className="space-y-4">
                {data.cards.map((c, i) => {
                  const pct = c.utilizationPct;
                  const color = pct == null ? 'var(--accent)' : pct >= 70 ? 'var(--red)' : pct >= 30 ? 'var(--yellow)' : 'var(--green)';
                  return (
                    <div key={c.id}>
                      <div className="flex justify-between gap-2 text-xs mb-1.5">
                        <span className="truncate font-medium text-[var(--dp-text-primary)]">{c.name}{c.last4 && <span className="text-[var(--dp-text-label)]"> ··{c.last4}</span>}</span>
                        <span className="shrink-0 tabular-nums text-[var(--dp-text-muted)]">
                          <b className="text-[var(--dp-text-primary)]">{usd(c.balance)}</b>
                          {c.limit ? ` of ${usd(c.limit)} · ${Math.round(pct)}%` : ' · no limit set'}
                        </span>
                      </div>
                      <GrowBar pct={c.limit ? pct : 0} color={color} delay={i * 0.07} />
                    </div>
                  );
                })}
              </div>
            ) : <Empty>No credit cards yet. Add one in Settings.</Empty>}
          </Panel>
        </div>

        <Panel title="Where your money is" sub="Everything you've put into purchases, and where it sits right now.">
          <MoneyMap map={data.map} />
        </Panel>

        <p className="text-[11px] text-[var(--dp-text-label)]">
          Card bills are estimates from purchases, expenses and shipping labels charged to each card; payments to the card aren't recorded in the app. Cashback isn't counted as money in.
        </p>
      </div>
    </div>
  );
}

export default CashFlow;
