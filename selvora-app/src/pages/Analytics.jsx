import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import {
  DollarSign, ShoppingCart, TrendingUp, Percent, Gift,
  CreditCard, Store, Package, BarChart2, Download, RotateCcw,
  LayoutGrid, Users, Table, PieChart as PieIcon
} from 'lucide-react';
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

const DATE_OPTIONS = ['7 Days', '30 Days', 'YTD', 'All Time'];
const MODE_OPTIONS = [
  { key: 'All',         label: 'All',         icon: LayoutGrid },
  { key: 'Cashout',     label: 'Cashout',     icon: Users },
  { key: 'Marketplace', label: 'Marketplace', icon: Store },
];

function fmt(n) { return (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtPct(n) { return (n ?? 0).toFixed(2) + '%'; }

const MetricCard = ({ icon: Icon, title, value, subtitle, color, titleColor, valueColor, subtitleColor, bgGlow, topRightIcon: TopRightIcon }) => (
  <div className="relative p-4 rounded-xl border border-gray-800 bg-[#16161E] overflow-hidden group hover:border-gray-700 transition-colors">
    {bgGlow && (
      <div className="absolute inset-0 pointer-events-none opacity-20" style={{ background: `radial-gradient(circle at top left, ${color}, transparent 60%)` }} />
    )}
    {TopRightIcon && (
      <div className="absolute top-4 right-4"><TopRightIcon size={14} style={{ color }} /></div>
    )}
    <div className="relative z-10 flex flex-col h-full">
      <div className="w-8 h-8 rounded-md flex items-center justify-center mb-3 bg-white/5 border border-white/5">
        <Icon size={16} style={{ color }} />
      </div>
      <div className={`text-[10px] font-bold tracking-wider mb-1 ${titleColor || 'text-gray-400'}`}>{title}</div>
      <div className={`text-xl font-bold mb-1 ${valueColor || 'text-white'}`}>{value}</div>
      <div className={`text-[10px] leading-tight ${subtitleColor || 'text-gray-500'} whitespace-pre-line`}>{subtitle}</div>
    </div>
  </div>
);

function Analytics() {
  const [activeTab, setActiveTab] = useState('overview');
  const [mode, setMode]           = useState('All');
  const [dateRange, setDateRange] = useState('All Time');
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ mode, date: dateRange });
      const res = await apiFetch(`/api/analytics/dashboard?${params}`, { credentials: 'include' });
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [mode, dateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const s = data?.stats ?? {};
  const trend = data?.trend ?? [];
  const topCards = data?.topCards ?? [];

  // Build monthly-bucketed chart data from daily cumulative trend points
  const monthlyTrend = (() => {
    if (!trend.length) return [];
    const byMonth = new Map();
    trend.forEach(pt => {
      const month = pt.date.slice(0, 7); // YYYY-MM
      byMonth.set(month, { name: month, revenue: pt.totalRevenue, profit: pt.netProfit, cashback: pt.cashback });
    });
    return Array.from(byMonth.values());
  })();

  // Expense breakdown pie: COGS vs tax vs commission
  const expenseData = [
    { name: 'COGS',       value: s.soldCost       || 0, color: '#ef4444' },
    { name: 'Tax',        value: s.totalTax        || 0, color: '#eab308' },
    { name: 'Commission', value: s.commissionFees  || 0, color: '#6366f1' },
  ].filter(e => e.value > 0);

  const expenseTotal = expenseData.reduce((sum, e) => sum + e.value, 0);

  // Cumulative profit area chart — use the trend directly
  const cumulativeData = trend.map(pt => ({ name: pt.date.slice(0, 7), profit: pt.netProfit }));
  // Deduplicate by month — keep last entry per month
  const cumulativeByMonth = (() => {
    const map = new Map();
    cumulativeData.forEach(pt => map.set(pt.name, pt));
    return Array.from(map.values());
  })();

  // Period P&L — net profit delta per month
  const periodPLData = (() => {
    const map = new Map();
    trend.forEach(pt => {
      const month = pt.date.slice(0, 7);
      map.set(month, pt.netProfit);
    });
    const months = Array.from(map.keys()).sort();
    return months.map((m, i) => {
      const prev = i > 0 ? map.get(months[i - 1]) : 0;
      const val = map.get(m) - prev;
      return { name: m, value: val, fill: val >= 0 ? '#22c55e' : '#ef4444' };
    });
  })();

  const topStore = topCards[0];

  return (
    <div className="max-w-7xl mx-auto space-y-6 pb-10 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Analytics & Insights</h1>
          <p className="text-sm text-gray-400 mt-1">Combined overview</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {MODE_OPTIONS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                mode === key
                  ? 'bg-purple-800/60 text-white border-purple-500/30'
                  : 'bg-transparent text-gray-400 hover:text-white hover:bg-white/5 border-transparent'
              }`}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
          <div className="w-px h-6 bg-gray-800 mx-1" />
          <button
            onClick={fetchData}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800 text-white hover:bg-gray-700 text-sm font-medium transition-colors"
          >
            <RotateCcw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent text-gray-400 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors">
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Date Range Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-[#111318] border border-white/5 w-max">
        {DATE_OPTIONS.map(opt => (
          <button
            key={opt}
            onClick={() => setDateRange(opt)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              dateRange === opt
                ? 'text-white bg-white/8 border border-white/10 shadow-sm'
                : 'text-gray-400 hover:text-gray-200 border border-transparent hover:bg-white/5'
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          icon={DollarSign} title="REVENUE" color="#3b82f6"
          value={loading ? '…' : `$${fmt(s.totalRevenue)}`}
          subtitle={`${s.salesCount ?? 0} sale${s.salesCount !== 1 ? 's' : ''}`}
          valueColor="text-white" titleColor="text-gray-500"
        />
        <MetricCard
          icon={ShoppingCart} title="COST" color="#ec4899" bgGlow
          value={loading ? '…' : `$${fmt(s.totalCost)}`}
          subtitle={`${s.transactionCount ?? 0} buys (incl. tax & shipping)`}
          valueColor="text-white" titleColor="text-[#71465d]" subtitleColor="text-[#71465d]"
        />
        <MetricCard
          icon={TrendingUp} title="PROFIT" color="#22c55e" bgGlow topRightIcon={TrendingUp}
          value={loading ? '…' : `$${fmt(s.profit)}`}
          subtitle={`CB $${fmt(s.totalCashback)} · Fees -$${fmt(s.commissionFees)}`}
          titleColor="text-green-500/70" valueColor="text-green-400" subtitleColor="text-green-500/50"
        />
        <MetricCard
          icon={Percent} title="ROI" color="#22c55e" bgGlow topRightIcon={TrendingUp}
          value={loading ? '…' : fmtPct(s.roi)}
          subtitle="Return on invested cost"
          titleColor="text-green-500/70" valueColor="text-green-400" subtitleColor="text-green-500/50"
        />
        <MetricCard
          icon={Gift} title="CASHBACK" color="#a855f7" bgGlow
          value={loading ? '…' : `$${fmt(s.totalCashback)}`}
          subtitle={`Avg ${fmtPct(s.avgCashbackRate)} rate`}
          titleColor="text-purple-500/70" valueColor="text-purple-400" subtitleColor="text-purple-500/50"
        />
        <MetricCard
          icon={CreditCard} title="COMMISSION" color="#eab308" bgGlow
          value={loading ? '…' : `$${fmt(s.commissionFees)}`}
          subtitle="Platform fees on sales"
          titleColor="text-yellow-500/70" valueColor="text-yellow-400" subtitleColor="text-yellow-500/50"
        />
        <MetricCard
          icon={Store} title="TOP CARD" color="#14b8a6" bgGlow
          value={loading ? '…' : (topStore?.name || '—')}
          subtitle={topStore ? `$${fmt(topStore.amount)} · ${topStore.txns} txn${topStore.txns !== 1 ? 's' : ''}` : 'No payment data'}
          titleColor="text-teal-500/70" valueColor="text-white" subtitleColor="text-teal-500/50"
        />
        <MetricCard
          icon={Package} title="INVENTORY" color="#6366f1" bgGlow
          value={loading ? '…' : s.inventoryQty ?? 0}
          subtitle={`$${fmt(s.inventoryValue)} on hand`}
          titleColor="text-indigo-500/70" valueColor="text-white" subtitleColor="text-indigo-500/50"
        />
      </div>

      {/* Profit Calculation Info Banner */}
      <div className="relative p-4 rounded-xl border border-gray-800 bg-[#16161E] flex flex-col sm:flex-row justify-between items-start gap-4">
        <div>
          <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Profit Calculation</h3>
          <p className="text-sm text-green-400 mb-1">
            <span className="font-semibold">Profit</span> = Revenue − COGS + Cashback
            <span className="text-gray-500 ml-2">(commission already deducted from revenue)</span>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Units sold: <span className="text-gray-300 font-medium">{s.unitsSold ?? 0}</span>
            {' · '}
            Listed: <span className="text-gray-300 font-medium">{s.listedQty ?? 0}</span>
            {' · '}
            On hand: <span className="text-gray-300 font-medium">{s.inventoryQty ?? 0}</span>
            {s.salesVelocity > 0 && (
              <> · Velocity: <span className="text-gray-300 font-medium">{s.salesVelocity.toFixed(2)}/day</span></>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 rounded-xl border border-gray-800 bg-[#16161E]">
        {[
          { id: 'overview',    label: 'Overview',      icon: BarChart2 },
          { id: 'breakdowns',  label: 'Breakdowns',    icon: PieIcon },
          { id: 'payments',    label: 'Payments',      icon: CreditCard },
          { id: 'detail',      label: 'Recent Sales',  icon: Table },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium rounded-lg transition-colors ${
              activeTab === tab.id ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
            }`}
          >
            <tab.icon size={16} /> {tab.label}
          </button>
        ))}
      </div>

      {/* ── Overview Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Revenue & Profit Trend */}
          <div className="col-span-1 lg:col-span-2 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <div className="flex justify-between items-start mb-6">
              <div>
                <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider">Revenue & Profit Trend</h3>
                <p className="text-xs text-gray-500 mt-1">Cumulative by month</p>
              </div>
            </div>
            <div className="h-[250px] w-full">
              {monthlyTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={monthlyTrend} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} itemStyle={{ fontSize: '12px' }} labelStyle={{ color: '#a1a1aa', fontSize: '12px', marginBottom: '4px' }} formatter={v => `$${fmt(v)}`} />
                    <Legend wrapperStyle={{ bottom: 0, fontSize: '12px' }} iconType="circle" />
                    <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                    <Line type="monotone" dataKey="profit"  name="Profit"  stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="cashback" name="Cashback" stroke="#a855f7" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No data for this period'}</div>
              )}
            </div>
          </div>

          {/* Expense Breakdown Pie */}
          <div className="col-span-1 p-5 rounded-xl border border-gray-800 bg-[#16161E] flex flex-col">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Cost Breakdown</h3>
            {expenseData.length > 0 ? (
              <>
                <div className="h-[180px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={expenseData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} stroke="none" paddingAngle={2} dataKey="value">
                        {expenseData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', color: '#fff' }} formatter={v => `$${fmt(v)}`} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-auto space-y-2">
                  {expenseData.map(e => (
                    <div key={e.name} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: e.color }} />
                        <span className="text-gray-300">{e.name}</span>
                      </div>
                      <div className="flex gap-4">
                        <span className="text-gray-500 text-xs mt-0.5">{expenseTotal > 0 ? Math.round((e.value / expenseTotal) * 100) : 0}%</span>
                        <span className="text-white font-medium">${fmt(e.value)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No cost data'}</div>
            )}
          </div>

          {/* Cumulative Profit */}
          <div className="col-span-1 lg:col-span-2 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Cumulative Profit</h3>
            <div className="h-[200px] w-full">
              {cumulativeByMonth.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={cumulativeByMonth} margin={{ top: 5, right: 20, left: 0, bottom: 20 }}>
                    <defs>
                      <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} formatter={v => `$${fmt(v)}`} />
                    <Area type="monotone" dataKey="profit" name="Net Profit" stroke="#a855f7" fillOpacity={1} fill="url(#colorProfit)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No data'}</div>
              )}
            </div>
          </div>

          {/* Period P&L */}
          <div className="col-span-1 p-5 rounded-xl border border-gray-800 bg-[#16161E]">
            <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-6">Period P&L</h3>
            <div className="h-[200px] w-full">
              {periodPLData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={periodPLData} margin={{ top: 5, right: 20, left: 0, bottom: 20 }} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dy={10} />
                    <YAxis stroke="#52525b" tick={{ fill: '#71717a', fontSize: 10 }} tickLine={false} axisLine={false} dx={-10} tickFormatter={v => `$${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} />
                    <Tooltip contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} cursor={{ fill: '#27272a', opacity: 0.4 }} formatter={v => `$${fmt(v)}`} />
                    <Bar dataKey="value" name="P&L" radius={[4, 4, 0, 0]}>
                      {periodPLData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No data'}</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Breakdowns Tab ───────────────────────────────────────────────────── */}
      {activeTab === 'breakdowns' && (
        <div className="p-5 rounded-xl border border-gray-800 bg-[#16161E]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">Cost Breakdown</h3>
          {expenseData.length > 0 ? (
            <div className="space-y-3">
              {expenseData.map(e => (
                <div key={e.name}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{e.name}</span>
                    <span className="text-white font-medium">${fmt(e.value)}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${expenseTotal > 0 ? (e.value / expenseTotal) * 100 : 0}%`, backgroundColor: e.color }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No data'}</div>
          )}
        </div>
      )}

      {/* ── Payments Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'payments' && (
        <div className="p-5 rounded-xl border border-gray-800 bg-[#16161E]">
          <h3 className="text-sm font-bold text-gray-300 uppercase tracking-wider mb-4">Payment Methods by Spend</h3>
          {topCards.length > 0 ? (
            <div className="space-y-3">
              {topCards.map((card, i) => {
                const maxAmt = topCards[0]?.amount || 1;
                return (
                  <div key={i}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300 font-medium">{card.name}</span>
                      <span className="text-gray-500">{card.txns} txns · <span className="text-white font-medium">${fmt(card.amount)}</span></span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full bg-indigo-500" style={{ width: `${(card.amount / maxAmt) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-10 text-center text-gray-600 text-sm">{loading ? 'Loading…' : 'No payment data for this period'}</div>
          )}
        </div>
      )}

      {/* ── Recent Sales Tab ──────────────────────────────────────────────────── */}
      {activeTab === 'detail' && (
        <div className="rounded-xl border border-gray-800 bg-[#16161E] overflow-x-auto">
          <table className="w-full text-left whitespace-nowrap">
            <thead>
              <tr className="border-b border-white/6 text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
                <th className="px-4 py-3.5">Product</th>
                <th className="px-4 py-3.5">Platform</th>
                <th className="px-4 py-3.5">Date</th>
                <th className="px-4 py-3.5">Cost</th>
                <th className="px-4 py-3.5">Revenue</th>
                <th className="px-4 py-3.5">Cashback</th>
                <th className="px-4 py-3.5">Profit</th>
                <th className="px-4 py-3.5">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/3">
              {!loading && (data?.recentTransactions ?? []).length === 0 && (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-600 text-sm">No sales in this period</td></tr>
              )}
              {(data?.recentTransactions ?? []).map(txn => (
                <tr key={txn.id} className="hover:bg-white/2 transition-colors">
                  <td className="px-4 py-3 text-sm font-medium text-gray-100 max-w-[200px] truncate">{txn.product}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{txn.platform}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{new Date(txn.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-sm text-blue-400 font-semibold">${fmt(txn.cost)}</td>
                  <td className="px-4 py-3 text-sm text-green-400 font-semibold">${fmt(txn.revenue)}</td>
                  <td className="px-4 py-3 text-xs text-purple-400 font-medium">${fmt(txn.cashback)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-bold ${txn.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {txn.profit >= 0 ? '+' : ''}${fmt(txn.profit)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded border bg-green-500/10 text-green-400 border-green-500/20">
                      {txn.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default Analytics;
