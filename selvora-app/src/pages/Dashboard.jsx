import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Layers, Zap, Store, Calendar, Share2, Settings,
  CreditCard, Info
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDashboardSettings } from '../hooks/useDashboardSettings';
import {
  STAT_CARD_REGISTRY,
  PIPELINE_CARD_REGISTRY,
  DEFAULT_DASHBOARD_SETTINGS,
} from '../data/dashboardRegistry';
import DashboardSettingsModal from '../components/DashboardSettingsModal';
import ProfitRevenueTrendChart from '../components/Dashboard/ProfitRevenueTrendChart';

const EMPTY_STATS = {
  totalCost: 0,
  soldCost: 0,
  totalRevenue: 0,
  totalCashback: 0,
  grossProfit: 0,
  profit: 0,
  roi: 0,
  transactionCount: 0,
  salesCount: 0,
  avgCashbackRate: 0,
  commissionFees: 0,
  totalTax: 0,
  inventoryValue: 0,
  inventoryQty: 0,
  listedQty: 0,
  unitsSold: 0,
  salesVelocity: 0,
};

function getMetricMeaning(label) {
  const meanings = {
    'Total Cost': 'Total Cost is the full amount spent to buy inventory, including item cost, tax, and inbound shipping.',
    'Sale Revenue': 'Sale Revenue is the money received from sold items after marketplace or platform fees.',
    Cashback: 'Cashback is money earned back from the payment card or payment method used for sold inventory.',
    'Net Profit': 'Net Profit is what remains after sold-item cost is covered, with cashback added back in.',
    'Gross Profit': 'Gross Profit is the difference between sale revenue and the cost basis of the sold item.',
    'Avg ROI': 'Avg ROI shows how much return you earned compared with the cost basis of sold items.',
    'Commission Fees': 'Commission Fees are marketplace or platform fees taken out of sales.',
    'Net Margin': 'Net Margin shows what percentage of sale revenue remains as net profit.',
    'Avg Sale Price': 'Avg Sale Price is the average revenue received per sold item.',
    'Avg Cost/Unit': 'Avg Cost/Unit is the average cost basis for each sold item.',
    'Total Tax Paid': 'Total Tax Paid is the purchase sales tax paid across inventory.',
    'Inventory Value': 'Inventory Value is the cost of unsold stock still on hand.',
    'Sales Velocity': 'Sales Velocity shows how quickly items are selling in the selected time range.',
    'Inventory Qty': 'Inventory Qty is the total number of items you currently have on hand.',
    'Active Listings': 'Active Listings is the total number of items currently listed for sale.',
    'Units Sold': 'Units Sold is the total quantity of items sold in the selected time range.',
  };

  return meanings[label] || `${label} explains what this metric means in the selected dashboard view.`;
}

function normalizeDashboardStats(rawStats, recent) {
  const stats = { ...EMPTY_STATS, ...(rawStats || {}) };
  const hasSoldOnlyFields = rawStats && Object.prototype.hasOwnProperty.call(rawStats, 'soldCost')
    && Object.prototype.hasOwnProperty.call(rawStats, 'grossProfit');

  if (hasSoldOnlyFields) return stats;

  // Compatibility for older API responses: profit/cashback used to include unsold purchases.
  if (!stats.salesCount) {
    return {
      ...stats,
      soldCost: 0,
      totalRevenue: 0,
      totalCashback: 0,
      grossProfit: 0,
      profit: 0,
      roi: 0,
      avgCashbackRate: 0,
    };
  }

  const soldCost = recent.reduce((sum, row) => sum + (Number(row.cost) || 0), 0);
  const soldCashback = soldCost * ((stats.avgCashbackRate || 0) / 100);
  const grossProfit = stats.totalRevenue - soldCost;
  const profit = grossProfit + soldCashback;

  return {
    ...stats,
    soldCost,
    totalCashback: soldCashback,
    grossProfit,
    profit,
    roi: soldCost > 0 ? (profit / soldCost) * 100 : 0,
    avgCashbackRate: soldCost > 0 ? (soldCashback / soldCost) * 100 : 0,
  };
}

const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { settings, saveSettings } = useDashboardSettings();
  const [dateFilter, setDateFilter] = useState(settings.defaultDateFilter || '30 Days');
  const [modeFilter, setModeFilter] = useState('All');
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`http://localhost:3000/api/analytics/dashboard?mode=${modeFilter}&date=${encodeURIComponent(dateFilter)}`, { credentials: 'include' });
        if (res.ok) {
          setData(await res.json());
          setLastUpdated(new Date());
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchAnalytics();
  }, [user, modeFilter, dateFilter]);

  const recent = data?.recentTransactions || [];
  const stats = normalizeDashboardStats(data?.stats, recent);
  const pipeline = data?.pipelineCounts || {};
  const topCards = data?.topCards || [];
  const trend = data?.trend || [];

  // Derive visible cards from settings
  const visibleStatCards = settings.statCards
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)
    .slice(0, 5);

  const visiblePipelineCards = settings.pipelineCards
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order);

  const visibleChartSeries = (settings.chartSeries || [])
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order);
  const showTrendChart = visibleChartSeries.length > 0;
  const visibleRecentSalesColumns = (settings.recentSalesColumns || DEFAULT_DASHBOARD_SETTINGS.recentSalesColumns)
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order);
  const showRecentSales = visibleRecentSalesColumns.length > 0;

  const colClasses = { 1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5' };
  const statColClass = colClasses[visibleStatCards.length] || 'lg:grid-cols-5';
  const dashboardSections = (settings.dashboardSections?.length ? settings.dashboardSections : DEFAULT_DASHBOARD_SETTINGS.dashboardSections)
    .filter(section => section.visible !== false)
    .sort((a, b) => a.order - b.order);
  const showPaymentMethods = dashboardSections.some(s => s.id === 'paymentMethods');
  const dashboardMiddleGridClass = (showTrendChart && showPaymentMethods) ? 'lg:grid-cols-3' : 'lg:grid-cols-1';

  function renderDashboardSection(sectionId) {
    if (sectionId === 'statCards') {
      if (visibleStatCards.length === 0) return null;
      const modeTag = modeFilter !== 'All'
        ? `sold via ${modeFilter}`
        : null;
      return (
        <div key="statCards" className={`grid grid-cols-1 sm:grid-cols-2 ${statColClass} gap-4 3xl:gap-5 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-100 fill-mode-both`}>
          {visibleStatCards.map(cardConfig => {
            const def = STAT_CARD_REGISTRY[cardConfig.id];
            if (!def) return null;
            const colorOverride = cardConfig.id === 'profit' && stats.profit < 0 ? 'pink' : def.color;
            return (
              <StatCard
                key={cardConfig.id}
                title={def.label}
                modeTag={modeTag}
                value={def.getValue(stats)}
                subtext={def.getSubtext(stats)}
                icon={def.icon}
                color={colorOverride}
                formula={def.formula}
                onClick={() => navigate('/transactions', { state: { dateFilter, cardScope: def.scope, platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
              />
            );
          })}
        </div>
      );
    }

    if (sectionId === 'pipeline') {
      if (visiblePipelineCards.length === 0) return null;
      return (
        <div key="pipeline" className="rounded-xl p-4 bg-white/[0.02] border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.2)] animate-in slide-in-from-bottom-4 duration-500 fade-in delay-300 fill-mode-both">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">Status Pipeline</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {visiblePipelineCards.map(cardConfig => {
              const def = PIPELINE_CARD_REGISTRY[cardConfig.id];
              if (!def) return null;
              return (
                <PipelineCard
                  key={cardConfig.id}
                  icon={def.icon}
                  count={pipeline[cardConfig.id] || 0}
                  label={def.label}
                  color={def.color}
                  statusKey={cardConfig.id}
                  modeFilter={modeFilter}
                  dateFilter={dateFilter}
                  onNavigate={navigate}
                />
              );
            })}
          </div>
        </div>
      );
    }

    if (sectionId === 'trendChart') {
      return (
        <div key="trendChart" className={`grid grid-cols-1 ${dashboardMiddleGridClass} gap-6 3xl:gap-8 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-500 fill-mode-both`}>
          {showTrendChart && (
            <div className="lg:col-span-2 rounded-xl p-4 bg-white/[0.02] border border-white/10 shadow-[0_0_18px_rgba(0,0,0,0.22)] min-h-[360px] flex flex-col overflow-hidden">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                <div>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300">Profit & Cost Trend</h3>
                  <p className="text-[11px] text-gray-600 mt-1">Cumulative movement across selected dashboard metrics</p>
                </div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">{modeFilter}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-1">{dateFilter}</span>
                </div>
              </div>
              <div className="flex-1 rounded-lg bg-black/20">
                {isLoading ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-gray-500">Loading trend...</div>
                ) : (
                  <ProfitRevenueTrendChart
                    stats={stats}
                    trend={trend}
                    recent={recent}
                    dateFilter={dateFilter}
                    chartSeries={visibleChartSeries}
                  />
                )}
              </div>
            </div>
          )}

          {showPaymentMethods && (
            <div className="space-y-6">
              <div className="rounded-xl p-4 bg-white/[0.02] border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.2)]">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">Payment Methods</h3>
                <div className="space-y-3">
                  {topCards.length === 0 ? (
                    <p className="text-xs text-gray-500">No payment data yet.</p>
                  ) : topCards.slice(0, 5).map((card, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CreditCard className="w-4 h-4 text-purple-400" />
                        <div>
                          <p className="text-sm text-gray-300">{card.name}</p>
                          <p className="text-xs text-gray-500">· {card.txns} txns</p>
                        </div>
                      </div>
                      <p className="text-sm font-medium text-purple-400">${card.amount.toFixed(2)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      );
    }

    if (sectionId === 'recentSales') {
      if (!showRecentSales) return null;
      return (
        <div key="recentSales" className="rounded-xl p-4 bg-white/[0.02] border border-white/10 shadow-[0_0_15px_rgba(0,0,0,0.2)] pb-12 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-[700ms] fill-mode-both">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-300 mb-4">Recent Sales</h3>
          {recent.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-6">No recent sales found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {visibleRecentSalesColumns.map(column => (
                      <th key={column.id} className={`${column.id === 'product' ? 'pb-3 pr-4' : column.id === 'date' ? 'pb-3 pl-4' : 'pb-3 px-4'} font-medium`}>
                        {DEFAULT_DASHBOARD_SETTINGS.recentSalesColumns.find(c => c.id === column.id) && {
                          product: 'Product',
                          platform: 'Place Sold',
                          buyer: 'Buyer',
                          cost: 'Cost',
                          sale: 'Sale',
                          status: 'Status',
                          date: 'Date',
                        }[column.id]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-sm divide-y divide-white/5">
                  {recent.map((txn, i) => (
                    <tr key={i} className="hover:bg-white/[0.02] transition-colors">
                      {visibleRecentSalesColumns.map(column => {
                        if (column.id === 'product') {
                          return (
                            <td key={column.id} className="py-3 pr-4 font-medium text-gray-200 max-w-[220px]">
                              <span className="truncate block">{txn.product}</span>
                            </td>
                          );
                        }
                        if (column.id === 'platform') return <td key={column.id} className="py-3 px-4 text-gray-400">{txn.platform}</td>;
                        if (column.id === 'buyer') return <td key={column.id} className="py-3 px-4 text-gray-400 text-xs">{txn.buyer}</td>;
                        if (column.id === 'cost') return <td key={column.id} className="py-3 px-4 text-blue-400">${(txn.cost ?? 0).toFixed(2)}</td>;
                        if (column.id === 'sale') return <td key={column.id} className="py-3 px-4 text-green-400">${(txn.revenue ?? 0).toFixed(2)}</td>;
                        if (column.id === 'status') {
                          const statusColorMap = {
                            PURCHASED: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
                            'ON HAND': 'bg-teal-500/10 text-teal-400 border-teal-500/20',
                            SHIPPED: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
                            DELIVERED: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
                            SCANNED_IN: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
                            LISTED: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
                            SOLD: 'bg-green-500/10 text-green-400 border-green-500/20',
                            PAID: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                            COMPLETED: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
                            RETURNED: 'bg-red-500/10 text-red-400 border-red-500/20',
                            DISPUTED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
                            CANCELLED: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
                            PENDING_PAYMENT: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
                            IN_TRANSIT_OUT: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
                            AUTHENTICATION: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
                          };
                          const st = (txn.status || 'SOLD').toUpperCase();
                          const cls = statusColorMap[st] || statusColorMap.SOLD;
                          return (
                            <td key={column.id} className="py-3 px-4">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${cls}`}>
                                {txn.status || 'SOLD'}
                              </span>
                            </td>
                          );
                        }
                        if (column.id === 'date') {
                          return (
                            <td key={column.id} className="py-3 pl-4 text-gray-500 text-xs whitespace-nowrap">
                              {new Date(txn.date).toLocaleDateString()}
                            </td>
                          );
                        }
                        return null;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  return (
    <div className="h-full overflow-auto theme-scrollbar px-4 py-6 sm:px-6 w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-6">

      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in duration-300">
        <div>
          <h1 className="text-2xl 3xl:text-3xl font-bold text-white">Welcome back, {user?.username || 'User'}</h1>
          <p className="text-gray-600 text-[11px] mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">

          {/* Mode Filters */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            {['All', 'Cashout', 'Marketplace'].map((mode) => (
              <button
                key={mode}
                onClick={() => setModeFilter(mode)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${modeFilter === mode ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}
              >
                {mode === 'All' && <Layers className="w-3.5 h-3.5" />}
                {mode === 'Cashout' && <Zap className="w-3.5 h-3.5" />}
                {mode === 'Marketplace' && <Store className="w-3.5 h-3.5" />}
                {mode}
              </button>
            ))}
          </div>

          {/* Date Filters */}
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06]">
            <Calendar className="w-3.5 h-3.5 text-gray-500 ml-1.5" />
            {['7 Days', '30 Days', 'YTD', 'All Time'].map((f) => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${dateFilter === f ? 'bg-purple-500/20 text-purple-400 ring-1 ring-purple-500/40' : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'}`}
              >
                {f}
              </button>
            ))}
          </div>

          <button className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all text-cyan-200 hover:text-white hover:bg-cyan-500/15 border border-cyan-400/30">
            <Share2 className="w-3.5 h-3.5" /> Generate Share Card
          </button>

          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-400 hover:text-white hover:bg-white/[0.06] border border-white/[0.06] transition-all"
            title="Dashboard Settings"
          >
            <Settings className="w-4 h-4" />
          </button>

        </div>
      </div>

      {dashboardSections.map(section => renderDashboardSection(section.id))}



      {/* Settings Modal */}
      {settingsOpen && (
        <DashboardSettingsModal
          settings={settings}
          onClose={() => setSettingsOpen(false)}
          onSave={(newSettings) => {
            saveSettings(newSettings);
            setDateFilter(newSettings.defaultDateFilter);
            setSettingsOpen(false);
          }}
        />
      )}

    </div>
  );
};

export default Dashboard;

// ── Helper Components ──────────────────────────────────────────────────────────

function StatCard({ title, modeTag, value, subtext, icon: Icon, color, formula = [], onClick }) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState('bottom');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    setPopoverPosition(rect.top < 180 ? 'bottom' : 'top');
  }, [open]);

  const colors = {
    blue:    'text-blue-400 from-blue-500/20 to-blue-600/5',
    green:   'text-green-400 from-green-500/20 to-green-600/5',
    pink:    'text-pink-400 from-pink-500/20 to-pink-600/5',
    emerald: 'text-emerald-400 from-emerald-500/20 to-emerald-600/5',
    purple:  'text-purple-400 from-purple-500/20 to-purple-600/5',
    cyan:    'text-cyan-400 from-cyan-500/20 to-cyan-600/5',
    orange:  'text-orange-400 from-orange-500/20 to-orange-600/5',
    red:     'text-red-400 from-red-500/20 to-red-600/5',
    violet:  'text-violet-400 from-violet-500/20 to-violet-600/5',
    sky:     'text-sky-400 from-sky-500/20 to-sky-600/5',
    yellow:  'text-yellow-400 from-yellow-500/20 to-yellow-600/5',
  };
  const colorClass = colors[color] || colors.purple;
  const textColor = colorClass.split(' ')[0];
  const gradients = colorClass.split(' ').slice(1).join(' ');
  const calculation = formula.join(' ');

  return (
    <div ref={ref} onClick={onClick} className={`relative overflow-visible rounded-xl bg-white/[0.02] border border-white/10 p-4 sm:p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_8px_30px_rgb(0,0,0,0.12)] hover:border-white/20 group${onClick ? ' cursor-pointer' : ''}`}>
      <div className={`absolute inset-0 rounded-xl bg-gradient-to-br ${gradients} opacity-50 group-hover:opacity-100 transition-opacity pointer-events-none`} />
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className="text-xs 3xl:text-sm text-gray-400 font-medium uppercase tracking-wider">
            {title}
            {modeTag && (
              <span className="ml-1.5 text-[9px] font-normal normal-case tracking-normal text-gray-600">
                {modeTag}
              </span>
            )}
          </p>
          <p className={`text-xl 3xl:text-2xl font-bold mt-1 ${textColor}`}>{value}</p>
          <p className="text-[10px] 3xl:text-xs text-gray-500 mt-1">{subtext}</p>
        </div>
        <div className="w-9 h-9 3xl:w-11 3xl:h-11 rounded-lg bg-white/5 flex items-center justify-center">
          <Icon className={`w-4.5 h-4.5 3xl:w-5 3xl:h-5 ${textColor}`} />
        </div>
      </div>
      {formula.length > 0 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(v => !v); }}
            title="How this is calculated"
            className="absolute bottom-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors"
          >
            <Info className="w-3 h-3" />
          </button>
          {open && (
            <div className={`absolute right-2 w-64 rounded-xl bg-[#1a1c23] border border-white/10 shadow-2xl p-4 z-50 animate-in fade-in duration-150 ${
              popoverPosition === 'bottom'
                ? 'top-[calc(100%+8px)] slide-in-from-top-1'
                : 'bottom-8 slide-in-from-bottom-1'
            }`}>
              <div className={`absolute right-2 h-3 w-3 rotate-45 bg-[#1a1c23] ${
                popoverPosition === 'bottom'
                  ? '-top-1.5 border-l border-t border-white/10'
                  : '-bottom-1.5 border-r border-b border-white/10'
              }`} />
              <p className={`text-xs font-semibold uppercase tracking-wider ${textColor}`}>{title}</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Calculation</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-white">{calculation}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">What It Means</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-300">{getMetricMeaning(title)}</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PipelineCard({ icon: Icon, count, label, color, statusKey, modeFilter, dateFilter, onNavigate }) {
  const colors = {
    blue: 'text-blue-400', yellow: 'text-yellow-400', orange: 'text-orange-400',
    amber: 'text-amber-400', green: 'text-green-400', emerald: 'text-emerald-400',
    purple: 'text-purple-400', red: 'text-red-400', rose: 'text-rose-400',
    cyan: 'text-cyan-400', sky: 'text-sky-400',
  };
  const c = colors[color] || 'text-gray-400';
  return (
    <div
      onClick={() => onNavigate('/transactions', { state: {
        status: statusKey,
        dateFilter: dateFilter || undefined,
        platformMode: modeFilter && modeFilter !== 'All' ? modeFilter : undefined,
      }})}
      className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] cursor-pointer hover:bg-white/[0.05] hover:border-white/[0.10] transition-all"
    >
      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center">
        <Icon className={`w-4.5 h-4.5 ${c}`} />
      </div>
      <div>
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`text-lg font-bold ${c}`}>{count}</p>
      </div>
    </div>
  );
}
