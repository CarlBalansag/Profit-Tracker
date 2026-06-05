import React, { useState, useEffect, useRef } from 'react';
import { useDashboard } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Layers, Zap, Store, Calendar, Share2, Settings,
  CreditCard, Info, TrendingUp
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useDashboardSettings } from '../hooks/useDashboardSettings';
import { useUiPreferences } from '../hooks/useUiPreferences';
import {
  STAT_CARD_REGISTRY,
  PIPELINE_CARD_REGISTRY,
  DEFAULT_DASHBOARD_SETTINGS,
} from '../data/dashboardRegistry';
import DashboardSettingsModal from '../components/DashboardSettingsModal';
import ProfitRevenueTrendChart from '../components/Dashboard/ProfitRevenueTrendChart';

const GLASS_BASE_LAYOUT_ITEMS = ['statCards', 'radarGraph', 'trendChart', 'paymentMethods', 'recentSales'];

function normalizeGlassLayoutOrder(glass = {}, count = 1) {
  const metricIds = Array.from({ length: count }, (_, index) => `metric-${index}`);
  const valid = new Set([...GLASS_BASE_LAYOUT_ITEMS, ...metricIds]);
  const existing = (glass.layoutOrder || [])
    .map(id => id === 'pipeline' ? 'radarGraph' : id)
    .filter(id => valid.has(id));
  return [...existing, ...[...valid].filter(id => !existing.includes(id))];
}

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

const CARBON_KPI_ORDER = ['profit', 'totalCost', 'totalRevenue', 'totalCashback'];

function formatShortDate(dateValue) {
  if (!dateValue) return '';
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getRowProfit(txn) {
  if (typeof txn.profit === 'number') return txn.profit;
  return (Number(txn.revenue) || 0) - (Number(txn.cost) || 0);
}

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
  const { preferences } = useUiPreferences();
  const { settings, saveSettings } = useDashboardSettings(preferences.style);
  const isGlass = preferences.style === 'glassmorphism-brown';
  const [dateFilter, setDateFilter] = useState(settings.defaultDateFilter || '30 Days');
  const [modeFilter, setModeFilter] = useState('All');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [trendMode, setTrendMode] = useState('period'); // 'period' | 'cumulative'

  const { data, isLoading } = useDashboard(modeFilter, dateFilter);
  useEffect(() => { if (data) setLastUpdated(new Date()); }, [data]);

  const recent = data?.recentTransactions || [];
  const stats = normalizeDashboardStats(data?.stats, recent);
  const pipeline = data?.pipelineCounts || {};
  const topCards = data?.topCards || [];
  const trend = data?.trend || [];
  const trendMeta = data?.trendMeta ?? null;

  // Derive visible cards from settings
  const configuredStatCards = settings.statCards
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order);
  const visibleStatCards = isGlass
    ? configuredStatCards
    : [
      ...CARBON_KPI_ORDER
        .map((id) => configuredStatCards.find(card => card.id === id))
        .filter(Boolean),
      ...configuredStatCards.filter(card => !CARBON_KPI_ORDER.includes(card.id)),
    ];

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
  const dashboardMiddleGridClass = isGlass
    ? ((showTrendChart && showPaymentMethods) ? 'lg:grid-cols-3' : 'lg:grid-cols-1')
    : ((showTrendChart && showPaymentMethods) ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-1');
  const showPipeline = dashboardSections.some(s => s.id === 'pipeline') && visiblePipelineCards.length > 0;
  const showStatCards = dashboardSections.some(s => s.id === 'statCards') && visibleStatCards.length > 0;
  const glassMetricPanelCount = Math.max(1, Math.min(4, settings.glass?.metricPanelCount || 1));
  const glassLayoutOrder = normalizeGlassLayoutOrder(settings.glass || {}, glassMetricPanelCount);
  const defaultGlassMetricPanel = ['items', 'margin', 'avgCost', 'roi'];
  const glassMetricDefs = {
    items: { label: 'Items', value: String(stats.inventoryQty || stats.transactionCount || 0), icon: Layers, accent: false },
    margin: { label: 'Margin', value: `${stats.totalRevenue ? ((stats.profit / stats.totalRevenue) * 100).toFixed(0) : 0}%`, icon: TrendingUp, accent: true },
    avgCost: { label: 'Avg Cost', value: `$${(stats.unitsSold ? stats.soldCost / stats.unitsSold : stats.transactionCount ? stats.totalCost / stats.transactionCount : 0).toFixed(0)}`, icon: Store, accent: false },
    roi: { label: 'ROI', value: `${(stats.roi || 0).toFixed(0)}%`, icon: Zap, accent: true },
    revenue: { label: 'Revenue', value: `$${(stats.totalRevenue || 0).toFixed(0)}`, icon: Store, accent: false },
    cashback: { label: 'Cashback', value: `$${(stats.totalCashback || 0).toFixed(0)}`, icon: Layers, accent: true },
    sold: { label: 'Sold', value: String(stats.unitsSold || stats.salesCount || 0), icon: TrendingUp, accent: false },
    tax: { label: 'Tax', value: `$${(stats.totalTax || 0).toFixed(0)}`, icon: Zap, accent: true },
    inventory: { label: 'Inventory', value: `$${(stats.inventoryValue || 0).toFixed(0)}`, icon: Store, accent: false },
    qty: { label: 'Qty', value: String(stats.inventoryQty || 0), icon: Layers, accent: true },
    avgSale: { label: 'Avg Sale', value: `$${(stats.salesCount ? stats.totalRevenue / stats.salesCount : 0).toFixed(0)}`, icon: TrendingUp, accent: false },
    netProfit: { label: 'Net Profit', value: `$${(stats.profit || 0).toFixed(0)}`, icon: Zap, accent: true },
  };

  function renderDashboardSection(sectionId) {
    if (sectionId === 'statCards') {
      if (!showStatCards || visibleStatCards.length === 0) return null;
      const modeTag = modeFilter !== 'All'
        ? `sold via ${modeFilter}`
        : null;
      return (
        <div key="statCards" data-tutorial-id="dashboard-stats" className={isGlass
          ? `grid grid-cols-1 sm:grid-cols-2 ${statColClass} gap-3 3xl:gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-100 fill-mode-both`
          : "grid min-w-0 grid-cols-1 gap-3 overflow-x-auto pb-1 sm:grid-cols-2 lg:grid-cols-none animate-in slide-in-from-bottom-4 duration-500 fade-in delay-100 fill-mode-both"
        } style={!isGlass ? {
          gridTemplateColumns: visibleStatCards.length > 0
            ? `minmax(360px, 1.4fr) repeat(${Math.max(0, visibleStatCards.length - 1)}, minmax(210px, 1fr))`
            : undefined,
        } : undefined}>
          {visibleStatCards.map(cardConfig => {
            const def = STAT_CARD_REGISTRY[cardConfig.id];
            if (!def) return null;
            const colorOverride = cardConfig.id === 'profit' && stats.profit < 0 ? 'red' : def.color;
            return (
              <StatCard
                key={cardConfig.id}
                id={cardConfig.id}
                title={def.label}
                modeTag={modeTag}
                value={def.getValue(stats)}
                subtext={def.getSubtext(stats)}
                icon={def.icon}
                color={colorOverride}
                formula={def.formula}
                uiStyle={preferences.style}
                onClick={() => navigate('/transactions', { state: { dateFilter, cardScope: def.scope, platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
              />
            );
          })}
        </div>
      );
    }

    if (sectionId === 'pipeline') {
      if (!showPipeline || visiblePipelineCards.length === 0) return null;
      return (
        <div key="pipeline" data-tutorial-id="dashboard-pipeline" className={isGlass
          ? "rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.22)] animate-in fade-in duration-300 fill-mode-both"
          : "rounded-[9px] p-4 bg-[var(--bg-surface)] border border-[color:var(--border-default)] animate-in slide-in-from-bottom-4 duration-500 fade-in delay-300 fill-mode-both"
        }>
          <h3 className={isGlass ? "mb-3 px-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/24" : "text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-muted)] mb-4"}>Status Pipeline</h3>
          <div className={isGlass ? "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4" : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3"}>
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
                  uiStyle={preferences.style}
                />
              );
            })}
          </div>
        </div>
      );
    }

    if (sectionId === 'trendChart') {
      return (
        <div key="trendChart" data-tutorial-id="dashboard-chart" className={`grid grid-cols-1 ${dashboardMiddleGridClass} gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-500 fill-mode-both`}>
          {showTrendChart && (
            <div className={isGlass
              ? "lg:col-span-2 rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)] min-h-[360px] flex flex-col overflow-hidden"
              : "rounded-[9px] p-4 bg-[var(--bg-surface)] border border-[color:var(--border-default)] min-h-[360px] flex flex-col overflow-hidden"
            }>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                <div>
                  <h3 className={isGlass ? "text-lg font-normal tracking-tight text-[#e8e2d6]" : "text-[12px] font-medium uppercase tracking-[0.8px] text-[var(--text-primary)]"}>Profit & Cost Trend</h3>
                  <p className={isGlass ? "text-[11px] text-white/20 mt-1" : "text-[10px] text-[var(--text-secondary)] mt-1"}>Cumulative movement across selected dashboard metrics</p>
                </div>
                <div className={isGlass ? "flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/25" : "flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]"}>
                  <span className={isGlass ? "rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-1" : "rounded px-2 py-1 bg-[var(--bg-elevated)]"}>{modeFilter}</span>
                  <span className={isGlass ? "rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-1" : "rounded px-2 py-1 bg-[var(--bg-elevated)]"}>{dateFilter}</span>
                </div>
              </div>
              <div className={isGlass ? "flex-1 rounded-2xl bg-black/10" : "flex-1 rounded-md bg-[var(--bg-base)]"}>
                {isLoading ? (
                  <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-gray-500">Loading trend...</div>
                ) : (
                  <ProfitRevenueTrendChart
                    stats={stats}
                    trend={trend}
                    trendMeta={trendMeta}
                    recent={recent}
                    dateFilter={dateFilter}
                    chartSeries={visibleChartSeries}
                    uiStyle={preferences.style}
                    colorTheme={preferences.colorTheme}
                    trendMode={trendMode}
                    onTrendModeChange={setTrendMode}
                  />
                )}
              </div>
            </div>
          )}

          {showPaymentMethods && (
            <div className="space-y-5">
              <div className={isGlass
                ? "rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
                : "rounded-[9px] p-4 bg-[var(--bg-surface)] border border-[color:var(--border-default)]"
              }>
                <h3 className={isGlass ? "mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[11px] font-medium uppercase tracking-[0.8px] text-[var(--text-muted)] mb-3"}>{isGlass ? 'Payment Methods' : 'Top Cards'}</h3>
                <div className="space-y-3">
                  {topCards.length === 0 ? (
                    <p className={isGlass ? "text-xs text-white/20" : "text-xs text-[var(--text-muted)]"}>No payment data yet.</p>
                  ) : (isGlass ? topCards.slice(0, 5) : topCards).map((card, i) => (
                    <div key={i} className={isGlass ? "flex items-center justify-between rounded-2xl border border-white/[0.045] bg-white/[0.02] px-4 py-3" : "flex items-center justify-between gap-3 rounded-md bg-[var(--bg-elevated)] px-3 py-2.5"}>
                      <div className="flex items-center gap-3">
                        <CreditCard className={isGlass ? "w-4 h-4 text-[#d8a65a]" : "w-4 h-4 text-[var(--text-secondary)]"} />
                        <div className="min-w-0">
                          <p className={isGlass ? "text-sm text-[#e8e2d6]" : `text-[11px] truncate max-w-[160px] ${i === 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{card.name}</p>
                          <p className={isGlass ? "text-xs text-white/20" : "text-[9px] text-[var(--text-muted)]"}>{card.txns} txns</p>
                        </div>
                      </div>
                      <p className={isGlass ? "text-sm font-medium text-[#d8a65a]" : `text-[11px] font-semibold tabular-nums ${i === 0 ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>${card.amount.toFixed(0)}</p>
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
        <div key="recentSales" className={isGlass
          ? "rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)] pb-10 animate-in fade-in duration-300 fill-mode-both"
          : "rounded-[9px] p-4 bg-[var(--bg-surface)] border border-[color:var(--border-default)] pb-12 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-[700ms] fill-mode-both"
        }>
          <h3 className={isGlass ? "mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[12px] font-medium uppercase tracking-[0.8px] text-[var(--text-primary)] mb-4"}>Recent Sales</h3>
          {recent.length === 0 ? (
            <p className={isGlass ? "text-white/20 text-sm text-center py-6" : "text-gray-500 text-sm text-center py-6"}>No recent sales found.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={isGlass ? "border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wider" : "border-b border-[color:var(--border-default)] text-[9px] font-medium uppercase tracking-[0.8px] text-[var(--text-muted)]"}>
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
                    {!isGlass && <th className="pb-3 px-4 font-medium">Profit</th>}
                  </tr>
                </thead>
                <tbody className={isGlass ? "text-sm divide-y divide-white/5" : "text-sm"}>
                  {recent.map((txn, i) => (
                    <tr key={i} className={isGlass ? "hover:bg-white/[0.02] transition-colors" : `${i % 2 ? 'bg-white/[0.008]' : ''} hover:bg-[var(--border-hover)] transition-[background] duration-150`}>
                      {visibleRecentSalesColumns.map(column => {
                        if (column.id === 'product') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pr-4 font-medium text-gray-200 max-w-[220px]" : "py-3 pr-4 font-medium text-[var(--text-primary)] max-w-[220px]"}>
                              <span className="truncate block">{txn.product}</span>
                            </td>
                          );
                        }
                        if (column.id === 'platform') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400" : "py-3 px-4 text-[var(--text-secondary)]"}>{txn.platform}</td>;
                        if (column.id === 'buyer') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400 text-xs" : "py-3 px-4 text-[var(--text-secondary)] text-xs"}>{txn.buyer}</td>;
                        if (column.id === 'cost') return <td key={column.id} className={isGlass ? "py-3 px-4 text-blue-400" : "py-3 px-4 tabular-nums text-[var(--text-primary)]"}>${(txn.cost ?? 0).toFixed(2)}</td>;
                        if (column.id === 'sale') return <td key={column.id} className={isGlass ? "py-3 px-4 text-green-400" : "py-3 px-4 tabular-nums text-[var(--text-primary)]"}>${(txn.revenue ?? 0).toFixed(2)}</td>;
                        if (column.id === 'status') {
                          const statusColorMap = {
                            PURCHASED:      'bg-blue-500/10 text-blue-400 border-blue-500/20',
                            'ON HAND':      'bg-teal-500/10 text-teal-400 border-teal-500/20',
                            SHIPPED_IN:     'bg-purple-500/10 text-purple-400 border-purple-500/20',
                            SHIPPED_OUT:    'bg-sky-500/10 text-sky-400 border-sky-500/20',
                            DELIVERED:      'bg-orange-500/10 text-orange-400 border-orange-500/20',
                            SCANNED_IN:     'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
                            LISTED:         'bg-amber-500/10 text-amber-400 border-amber-500/20',
                            SOLD:           'bg-green-500/10 text-green-400 border-green-500/20',
                            AUTHENTICATION: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
                            PAID:           'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
                            COMPLETED:      'bg-teal-500/10 text-teal-400 border-teal-500/20',
                            RETURNED:       'bg-red-500/10 text-red-400 border-red-500/20',
                            DISPUTED:       'bg-rose-500/10 text-rose-400 border-rose-500/20',
                            CANCELLED:      'bg-gray-500/10 text-gray-400 border-gray-500/20',
                          };
                          const st = (txn.status || 'SOLD').toUpperCase();
                          const cls = statusColorMap[st] || statusColorMap.SOLD;
                          const carbonStatusClass = st === 'SHIPPED_IN'
                            ? 'bg-[var(--accent-bg)] text-[var(--accent-soft)]'
                            : 'bg-[var(--green-bg)] text-[var(--green-soft)]';
                          return (
                            <td key={column.id} className="py-3 px-4">
                              <span className={isGlass ? `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${cls}` : `inline-flex items-center rounded-[3px] px-[7px] py-[2px] text-[9px] font-medium uppercase tracking-[0.6px] ${carbonStatusClass}`}>
                                {txn.status || 'SOLD'}
                              </span>
                            </td>
                          );
                        }
                        if (column.id === 'date') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pl-4 text-gray-500 text-xs whitespace-nowrap" : "py-3 pl-4 text-[var(--text-muted)] text-[10px] whitespace-nowrap"}>
                              {isGlass ? new Date(txn.date).toLocaleDateString() : formatShortDate(txn.date)}
                            </td>
                          );
                        }
                        return null;
                      })}
                      {!isGlass && (
                        <td className={`py-3 px-4 tabular-nums font-semibold ${getRowProfit(txn) >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]'}`}>
                          {getRowProfit(txn) >= 0 ? '+' : '-'}${Math.abs(getRowProfit(txn)).toFixed(0)}
                        </td>
                      )}
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

  function renderGlassSection(sectionId) {
    if (sectionId === 'statCards') {
      if (!showStatCards) return null;
      return (
        <div key="statCards" className="grid h-full grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr]">
          {visibleStatCards.slice(0, 5).map((cardConfig, index) => {
            const def = STAT_CARD_REGISTRY[cardConfig.id];
            if (!def) return null;
            return (
              <GlassTopMetricCard
                key={cardConfig.id}
                title={def.label}
                value={def.getValue(stats)}
                subtext={def.getSubtext(stats)}
                highlight={cardConfig.id === 'profit' || cardConfig.id === 'grossProfit'}
                large={index === 0}
                onClick={() => navigate('/transactions', { state: { dateFilter, cardScope: def.scope, platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
              />
            );
          })}
        </div>
      );
    }

    if (sectionId === 'pipeline') {
      if (!showPipeline) return null;
      return (
        <GlassCircularPipeline
          key="pipeline"
          cards={visiblePipelineCards}
          pipeline={pipeline}
          modeFilter={modeFilter}
          dateFilter={dateFilter}
          onNavigate={navigate}
        />
      );
    }

    if (sectionId === 'trendChart') {
      if (!showTrendChart) return null;
      return (
        <div key="trendChart" className="flex h-full min-h-[298px] flex-col rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
          <div className="mb-3 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-serif text-xl font-semibold text-[#fff4dc]">Profit & Cost Trend</h3>
              <p className="mt-1 text-[11px] text-white/22">Cumulative metrics over time</p>
            </div>
          </div>
          <div className="min-h-[260px] flex-1 rounded-2xl bg-[#151719]/42 border border-white/[0.025] px-2 pt-2 shadow-[inset_0_1px_24px_rgba(0,0,0,0.18)]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-white/25">Loading trend...</div>
            ) : (
              <ProfitRevenueTrendChart
                stats={stats}
                trend={trend}
                trendMeta={trendMeta}
                recent={recent}
                dateFilter={dateFilter}
                chartSeries={visibleChartSeries}
                uiStyle={preferences.style}
                trendMode={trendMode}
                onTrendModeChange={setTrendMode}
              />
            )}
          </div>
        </div>
      );
    }

    if (sectionId === 'paymentMethods') {
      if (!showPaymentMethods) return null;
      return (
        <div key="paymentMethods" className="h-full rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
          <h3 className="mb-5 text-[10px] font-bold uppercase tracking-[0.22em] text-white/22">Payment Cards</h3>
          <div className="space-y-3">
            {topCards.length === 0 ? (
              <p className="text-xs text-white/22">No payment data yet.</p>
            ) : topCards.slice(0, 3).map((card, index) => {
              const maxCardAmount = topCards.reduce((m, c) => Math.max(m, c.amount || 0), 1);
              return (
              <div key={card.name} className="rounded-2xl border border-white/[0.045] bg-white/[0.018] px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#e8e2d6]">{card.name}</p>
                    <p className="mt-1 text-[10px] text-white/22">{card.txns} txns</p>
                  </div>
                  <p className="font-serif text-xl font-semibold text-[#d8a65a]">${card.amount.toFixed(2)}</p>
                </div>
                <div className="mt-4 h-1 rounded-full bg-white/[0.04]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(8, (card.amount / maxCardAmount) * 100))}%`,
                      background: index === 0 ? '#d8a65a' : '#6aaa8e',
                    }}
                  />
                </div>
              </div>
              );
            })}
          </div>
        </div>
      );
    }

    if (sectionId === 'recentSales') {
      if (!showRecentSales) return null;
      return (
        <div key="recentSales" className="h-full rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
          <div className="mb-5 flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/22">Recent Sales</h3>
            <button onClick={() => navigate('/transactions')} className="rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-1.5 text-[10px] text-white/24">View all -&gt;</button>
          </div>
          {recent.length === 0 ? (
            <p className="py-12 text-center font-serif text-sm italic text-white/18">No sales yet - start flipping.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[color:var(--border-default)] text-[10px] font-bold uppercase tracking-wider text-white/18">
                    <th className="pb-3 pr-4">Product</th>
                    <th className="pb-3 px-4">Cost</th>
                    <th className="pb-3 px-4">Sale</th>
                    <th className="pb-3 pl-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.035] text-sm">
                  {recent.slice(0, 4).map((txn, index) => (
                    <tr key={index}>
                      <td className="py-3 pr-4 font-medium text-[#e8e2d6]">{txn.product}</td>
                      <td className="py-3 px-4 text-white/45">${(txn.cost ?? 0).toFixed(2)}</td>
                      <td className="py-3 px-4 text-[#d8a65a]">${(txn.revenue ?? 0).toFixed(2)}</td>
                      <td className="py-3 pl-4 text-[10px] font-bold uppercase tracking-wider text-white/35">{txn.status || 'SOLD'}</td>
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

  function renderGlassQuickStats(panelIndex = 0) {
    const metricIds = settings.glass?.metricPanels?.[panelIndex] || defaultGlassMetricPanel;
    const panelItems = metricIds.map(id => glassMetricDefs[id] || glassMetricDefs.items);
    return (
      <div className="grid h-full grid-cols-2 gap-3">
        {panelItems.map((item, metricIndex) => {
          const IconComponent = item.icon;
          return (
            <button
              key={`${panelIndex}-${metricIndex}-${item.label}`}
              onClick={() => navigate('/transactions', { state: { dateFilter, platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
              className={`h-full min-h-[130px] rounded-[12px] border p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#1d1f21]/78 ${item.accent ? 'border-[#d8a65a]/14 bg-[#181816]/82' : 'border-white/[0.06] bg-[#181a1c]/72'}`}
            >
              <IconComponent className="h-3.5 w-3.5 text-white/14" />
              <p className={`mt-6 font-serif text-3xl font-semibold ${item.accent ? 'text-[#d8a65a]' : 'text-[#e8e2d6]'}`}>{item.value}</p>
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-white/20">{item.label}</p>
            </button>
          );
        })}
      </div>
    );
  }

  function renderGlassLayoutItem(itemId) {
    if (itemId === 'statCards') return renderGlassSection('statCards');
    if (itemId === 'radarGraph') return renderGlassSection('pipeline');
    if (itemId === 'trendChart') return renderGlassSection('trendChart');
    if (itemId === 'paymentMethods') return renderGlassSection('paymentMethods');
    if (itemId === 'recentSales') return renderGlassSection('recentSales');
    if (itemId.startsWith('metric-')) {
      const panelIndex = Number(itemId.replace('metric-', ''));
      if (!Number.isInteger(panelIndex) || panelIndex < 0 || panelIndex >= glassMetricPanelCount) return null;
      return renderGlassQuickStats(panelIndex);
    }
    return null;
  }

  function isGlassMetricItem(itemId) {
    return itemId.startsWith('metric-');
  }

  function getAdjacentMetricCount(layoutOrder, index) {
    let count = 0;
    for (let i = index - 1; i >= 0 && isGlassMetricItem(layoutOrder[i]); i -= 1) count += 1;
    for (let i = index + 1; i < layoutOrder.length && isGlassMetricItem(layoutOrder[i]); i += 1) count += 1;
    return Math.min(count, 3);
  }

  function glassSpanClass(span) {
    const spans = {
      2: 'xl:col-span-2',
      3: 'xl:col-span-3',
      4: 'xl:col-span-4',
      5: 'xl:col-span-5',
      6: 'xl:col-span-6',
      7: 'xl:col-span-7',
      8: 'xl:col-span-8',
      9: 'xl:col-span-9',
      10: 'xl:col-span-10',
      12: 'xl:col-span-12',
    };
    return spans[span] || 'xl:col-span-12';
  }

  function getGlassLayoutSpan(itemId, layoutOrder = glassLayoutOrder, index = layoutOrder.indexOf(itemId)) {
    const adjacentMetricCount = getAdjacentMetricCount(layoutOrder, index);
    const hasAdjacentMetric = adjacentMetricCount > 0;

    if (itemId === 'statCards') return hasAdjacentMetric ? glassSpanClass(12 - (adjacentMetricCount * 3)) : 'xl:col-span-12';
    if (itemId === 'radarGraph') return showTrendChart ? 'xl:col-span-2' : hasAdjacentMetric ? 'xl:col-span-9' : 'xl:col-span-3';
    if (itemId === 'trendChart') {
      if (hasAdjacentMetric && showPipeline) return glassSpanClass(Math.max(4, 10 - (adjacentMetricCount * 3)));
      if (hasAdjacentMetric) return glassSpanClass(12 - (adjacentMetricCount * 3));
      return showPipeline ? 'xl:col-span-10' : 'xl:col-span-12';
    }
    if (itemId === 'paymentMethods') return 'xl:col-span-4';
    if (itemId === 'recentSales') return 'xl:col-span-5';
    if (isGlassMetricItem(itemId)) return 'xl:col-span-3';
    return 'xl:col-span-12';
  }

  if (isGlass) {
    return (
      <div className="h-full overflow-auto theme-scrollbar w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-5 text-[#e8e2d6]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between animate-in fade-in duration-300">
          <div>
            <h1 className="text-3xl 3xl:text-4xl font-light tracking-tight text-[#e8e2d6]">Welcome back, {user?.username || 'User'}</h1>
            <p className="text-white/25 text-[11px] mt-1 flex items-center gap-1">
              <Clock className="w-3 h-3" /> {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]">
              {['All', 'Cashout', 'Marketplace'].map((mode) => (
                <button
                  key={mode}
                  onClick={() => setModeFilter(mode)}
                  className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all ${modeFilter === mode ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]'}`}
                >
                  {mode === 'All' && <Layers className="w-3.5 h-3.5" />}
                  {mode === 'Cashout' && <Zap className="w-3.5 h-3.5" />}
                  {mode === 'Marketplace' && <Store className="w-3.5 h-3.5" />}
                  {mode}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]">
              <Calendar className="w-3.5 h-3.5 text-white/25 ml-1.5" />
              {['7 Days', '30 Days', 'YTD', 'All Time'].map((f) => (
                <button
                  key={f}
                  onClick={() => setDateFilter(f)}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${dateFilter === f ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]'}`}
                >
                  {f}
                </button>
              ))}
            </div>

            <button className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all text-[#d8a65a] hover:text-[#e8e2d6] hover:bg-white/[0.05] border border-[#d8a65a]/20">
              <Share2 className="w-3.5 h-3.5" /> Generate Share Card
            </button>

            <button
              onClick={() => setSettingsOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-xl text-white/30 hover:text-[#d8a65a] hover:bg-white/[0.06] border border-white/[0.06] transition-all"
              title="Dashboard Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
          {glassLayoutOrder.map((itemId, index) => {
            const node = renderGlassLayoutItem(itemId);
            if (!node) return null;
            return (
              <div key={itemId} className={`${getGlassLayoutSpan(itemId, glassLayoutOrder, index)} h-full`}>
                {node}
              </div>
            );
          })}
        </div>

        {settingsOpen && (
          <DashboardSettingsModal
            settings={settings}
            uiStyle={preferences.style}
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
  }

  if (isLoading) return <PageLoader variant="dashboard" />;

  return (
    <div className={isGlass
      ? "h-full overflow-auto theme-scrollbar w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-6 text-[#e8e2d6]"
      : "h-full overflow-auto theme-scrollbar px-4 py-6 sm:px-6 w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-6 bg-[var(--bg-base)]"
    }>

      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in duration-300">
        <div>
          <h1 className={isGlass ? "text-3xl 3xl:text-4xl font-light tracking-tight text-[#e8e2d6]" : "text-[18px] font-medium tracking-[-0.3px] text-[var(--text-primary)]"}>Welcome back, {user?.username || 'User'}</h1>
          <p className={isGlass ? "text-white/25 text-[11px] mt-1 flex items-center gap-1" : "text-[var(--text-muted)] text-[11px] mt-1 flex items-center gap-1"}>
            <Clock className="w-3 h-3" /> {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">

          {/* Share Card + Settings — shown first on mobile (order-first), normal order on desktop */}
          <div className="flex items-center gap-2 order-first sm:order-last">
            <button className={isGlass ? "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all text-[#d8a65a] hover:text-[#e8e2d6] hover:bg-white/[0.05] border border-[#d8a65a]/20" : "flex items-center gap-2 px-3 py-2 rounded-md text-[10px] font-medium transition-colors text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"}>
              <Share2 className="w-3.5 h-3.5" /> Generate Share Card
            </button>
            <button
              data-tutorial-id="dashboard-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className={isGlass ? "flex items-center justify-center w-9 h-9 rounded-xl text-white/30 hover:text-[#d8a65a] hover:bg-white/[0.06] border border-white/[0.06] transition-all" : "flex items-center justify-center w-9 h-9 rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"}
              title="Dashboard Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Filters */}
          <div data-tutorial-id="dashboard-filters" className={isGlass ? "flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]" : "flex items-center gap-1 rounded bg-[var(--bg-surface)] p-1"}>
            {['All', 'Cashout', 'Marketplace'].map((mode) => (
              <button
                key={mode}
                onClick={() => setModeFilter(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded transition-colors ${modeFilter === mode ? (isGlass ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'bg-[var(--accent-bg)] text-[var(--accent)]') : (isGlass ? 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]')}`}
              >
                {mode === 'All' && <Layers className="w-3.5 h-3.5" />}
                {mode === 'Cashout' && <Zap className="w-3.5 h-3.5" />}
                {mode === 'Marketplace' && <Store className="w-3.5 h-3.5" />}
                {mode}
              </button>
            ))}
          </div>

          {!isGlass && <div className="hidden h-[14px] w-px bg-[var(--border-default)] sm:block" />}

          {/* Date Filters */}
          <div className={isGlass ? "flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]" : "flex items-center gap-1 rounded bg-[var(--bg-surface)] p-1"}>
            <Calendar className={isGlass ? "w-3.5 h-3.5 text-white/25 ml-1.5" : "w-3.5 h-3.5 text-[var(--text-muted)] ml-1.5"} />
            {['7 Days', '30 Days', 'YTD', 'All Time'].map((f) => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={`px-[9px] py-1 text-[10px] font-medium rounded transition-colors ${dateFilter === f ? (isGlass ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'bg-[var(--accent)] text-white') : (isGlass ? 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]')}`}
              >
                {f}
              </button>
            ))}
          </div>

        </div>
      </div>

      {dashboardSections.map(section => renderDashboardSection(section.id))}



      {/* Settings Modal */}
      {settingsOpen && (
        <DashboardSettingsModal
          settings={settings}
          uiStyle={preferences.style}
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

function GlassTopMetricCard({ title, value, subtext, highlight, large, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`h-full min-h-[134px] rounded-[16px] border bg-[#181a1c]/72 p-6 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#1d1f21]/78 ${highlight ? 'border-[#d8a65a]/16' : 'border-white/[0.06]'}`}
    >
      <p className={`text-[10px] font-bold uppercase tracking-[0.22em] ${highlight ? 'text-[#d8a65a]/55' : 'text-white/20'}`}>{title}</p>
      <p className={`mt-3 font-serif font-light leading-none ${large ? 'text-4xl 3xl:text-5xl' : 'text-2xl 3xl:text-3xl'} ${highlight ? 'text-[#d8a65a]' : 'text-[#e8e2d6]'}`}>{value}</p>
      <p className="mt-3 text-[10px] font-semibold text-white/14">{subtext}</p>
    </button>
  );
}
function GlassCircularPipeline({ cards, overflowCards = [], pipeline, modeFilter, dateFilter, onNavigate }) {
  const activeCards = cards
    .map(card => {
      const def = PIPELINE_CARD_REGISTRY[card.id];
      return def ? { ...card, label: def.label, count: pipeline[card.id] || 0 } : null;
    })
    .filter(Boolean);
  const featured = activeCards.slice(0, 4);
  const overflow = overflowCards
    .map(card => {
      const def = PIPELINE_CARD_REGISTRY[card.id];
      return def ? { ...card, label: def.label, count: pipeline[card.id] || 0 } : null;
    })
    .filter(Boolean);
  const total = activeCards.reduce((sum, card) => sum + card.count, 0);
  const center = 90;
  const radius = 58;
  const positions = [
    { angle: -Math.PI / 2, labelY: -20 },
    { angle: 0, labelY: 29 },
    { angle: Math.PI / 2, labelY: 29 },
    { angle: Math.PI, labelY: 29 },
  ];

  const navigateTo = (card) => onNavigate('/transactions', {
    state: {
      status: card.id,
      dateFilter: dateFilter || undefined,
      platformMode: modeFilter && modeFilter !== 'All' ? modeFilter : undefined,
    },
  });

  return (
    <div className="h-full rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
      <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.22em] text-white/22">Pipeline</h3>
      <div className="flex justify-center">
        <svg width="190" height="168" viewBox="0 0 180 168" aria-label="Status pipeline">
          <circle cx={center} cy={center - 5} r={radius} fill="none" stroke="rgba(255,255,255,0.035)" />
          <circle cx={center} cy={center - 5} r={radius - 24} fill="none" stroke="rgba(255,255,255,0.025)" />
          <text x={center} y={center - 9} textAnchor="middle" fill="#e8e2d6" fontSize="18" fontFamily="serif">{total}</text>
          <text x={center} y={center + 11} textAnchor="middle" fill="rgba(255,255,255,0.22)" fontSize="8" letterSpacing="2">ITEMS</text>
          {featured.map((card, index) => {
            const position = positions[index];
            const x = center + radius * Math.cos(position.angle);
            const y = center - 5 + radius * Math.sin(position.angle);
            const active = card.count > 0;
            return (
              <g key={card.id} role="button" tabIndex="0" onClick={() => navigateTo(card)} className="cursor-pointer">
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 16 : 11}
                  fill={active ? 'rgba(216,166,90,0.14)' : 'rgba(255,255,255,0.035)'}
                  stroke={active ? '#d8a65a' : 'rgba(255,255,255,0.065)'}
                  strokeWidth={active ? 1.4 : 1}
                />
                <text x={x} y={y + 4} textAnchor="middle" fill={active ? '#d8a65a' : 'rgba(255,255,255,0.18)'} fontSize="10" fontWeight="700">
                  {card.count}
                </text>
                <text x={x} y={y + position.labelY} textAnchor="middle" fill="rgba(255,255,255,0.20)" fontSize="6" letterSpacing="0.5">
                  {card.label.toUpperCase().slice(0, 10)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        {activeCards.filter(card => card.count > 0).slice(0, 2).map(card => (
          <button
            key={card.id}
            onClick={() => navigateTo(card)}
            className="rounded-lg border border-[#d8a65a]/14 bg-[#d8a65a]/8 px-3 py-1.5 text-[10px] font-semibold text-[#d8a65a]"
          >
            {card.label}: {card.count}
          </button>
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="mt-4 border-t border-white/[0.04] pt-3">
          <p className="mb-2 text-[9px] font-bold uppercase tracking-[0.2em] text-white/18">More Statuses</p>
          <div className="grid grid-cols-2 gap-2">
            {overflow.map(card => (
              <button
                key={card.id}
                onClick={() => navigateTo(card)}
                className="flex items-center justify-between rounded-lg border border-[color:var(--border-default)] bg-white/[0.018] px-2.5 py-2 text-left text-[10px] text-white/24 transition-colors hover:border-[#d8a65a]/14 hover:text-[#e8e2d6]"
              >
                <span className="truncate">{card.label}</span>
                <span className="ml-2 font-semibold text-[#d8a65a]">{card.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ id, title, modeTag, value, subtext, icon, color, formula = [], onClick, uiStyle = 'neon-dark' }) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState('bottom');
  const [popoverCoords, setPopoverCoords] = useState(null);
  const ref = useRef(null);
  const popoverRef = useRef(null);
  const isGlass = uiStyle === 'glassmorphism-brown';
  const IconComponent = icon;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (
        ref.current
        && !ref.current.contains(e.target)
        && !popoverRef.current?.contains(e.target)
      ) {
        setOpen(false);
        setPopoverCoords(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
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
  const textColor = isGlass ? colorClass.split(' ')[0] : 'text-[var(--accent)]';
  const calculation = formula.join(' ');
  const glassTextColor = title === 'Net Profit' || title === 'Gross Profit' || title === 'Cashback'
    ? 'text-[#d8a65a]'
    : 'text-[#e8e2d6]';
  const isProfitHero = id === 'profit' || title === 'Net Profit';
  const isLoss = isProfitHero && String(value).includes('-');
  const carbonValueColor = isProfitHero
    ? (isLoss ? 'text-[var(--red)]' : 'text-[var(--green)]')
    : (id === 'totalCashback' || title === 'Cashback'
      ? 'text-[var(--yellow)]'
      : id === 'totalRevenue' || title === 'Sale Revenue'
        ? 'text-[var(--accent)]'
        : 'text-[var(--text-primary)]');

  return (
    <div ref={ref} onClick={onClick} className={isGlass
      ? `relative overflow-visible rounded-[20px] bg-[#181a1c]/72 border border-white/[0.06] p-5 sm:p-6 shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-colors duration-200 hover:bg-[#1d1f21]/78 hover:border-white/[0.09] group${onClick ? ' cursor-pointer' : ''}`
      : `relative ${open ? 'z-[80]' : 'z-0'} overflow-visible rounded-[9px] bg-[var(--bg-elevated)] border border-[color:var(--border-default)] p-4 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:border-[color:var(--border-hover)] group ${isProfitHero ? 'border-l-[3px] [border-left-color:var(--green)]' : ''}${onClick ? ' cursor-pointer' : ''}`
    }>
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className={isGlass ? "text-[10px] text-white/25 font-medium uppercase tracking-[0.2em]" : "text-[10px] text-[var(--text-secondary)] font-normal uppercase tracking-[0.7px]"}>
            {title}
            {modeTag && (
              <span className="ml-1.5 text-[9px] font-normal normal-case tracking-normal text-[var(--text-muted)]">
                {modeTag}
              </span>
            )}
          </p>
          <p className={isGlass ? `text-2xl 3xl:text-3xl font-light mt-2 ${glassTextColor}` : `mt-2 tabular-nums font-semibold ${isProfitHero ? 'text-[26px]' : 'text-[18px]'} ${carbonValueColor}`}>{value}</p>
          <p className={isGlass ? "text-[10px] 3xl:text-xs text-white/18 mt-2" : "text-[10px] text-[var(--text-muted)] mt-1"}>{subtext}</p>
        </div>
        <div className={isGlass ? "w-9 h-9 3xl:w-11 3xl:h-11 rounded-xl bg-white/[0.035] border border-white/[0.05] flex items-center justify-center" : "w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)]"}>
          <IconComponent className={isGlass ? "w-4.5 h-4.5 3xl:w-5 3xl:h-5 text-[#d8a65a]" : "w-4.5 h-4.5 3xl:w-5 3xl:h-5"} />
        </div>
      </div>
      {formula.length > 0 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              const triggerRect = e.currentTarget.getBoundingClientRect();
              const width = 280;
              const gap = 10;
              const left = Math.max(12, Math.min(window.innerWidth - width - 12, triggerRect.right - width));
              const shouldOpenAbove = triggerRect.bottom + 180 > window.innerHeight;
              setPopoverPosition(shouldOpenAbove ? 'top' : 'bottom');
              setPopoverCoords({
                left,
                top: shouldOpenAbove ? undefined : triggerRect.bottom + gap,
                bottom: shouldOpenAbove ? window.innerHeight - triggerRect.top + gap : undefined,
              });
              if (open) {
                setPopoverCoords(null);
              }
              setOpen(v => !v);
            }}
            title="How this is calculated"
            className="absolute bottom-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors"
          >
            <Info className="w-3 h-3" />
          </button>
          {open && popoverCoords && createPortal(
            <div
              ref={popoverRef}
              className={`fixed w-[280px] rounded-[9px] ${isGlass ? 'bg-[#1a1c23] border-white/10 shadow-2xl' : 'bg-[var(--bg-elevated)] border-[color:var(--border-hover)]'} border p-4 z-[9999] animate-in fade-in duration-150 ${
                popoverPosition === 'bottom' ? 'slide-in-from-top-1' : 'slide-in-from-bottom-1'
              }`}
              style={{
                left: popoverCoords.left,
                top: popoverCoords.top,
                bottom: popoverCoords.bottom,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`absolute right-4 h-3 w-3 rotate-45 ${isGlass ? 'bg-[#1a1c23]' : 'bg-[var(--bg-elevated)]'} ${
                popoverPosition === 'bottom'
                  ? `${isGlass ? 'border-white/10' : 'border-[color:var(--border-hover)]'} -top-1.5 border-l border-t`
                  : `${isGlass ? 'border-white/10' : 'border-[color:var(--border-hover)]'} -bottom-1.5 border-r border-b`
              }`} />
              <p className={`text-[10px] font-medium uppercase tracking-[0.8px] ${textColor}`}>{title}</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]">Calculation</p>
                  <p className="mt-1 text-xs font-semibold leading-relaxed text-[var(--text-primary)]">{calculation}</p>
                </div>
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]">Meaning</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">{getMetricMeaning(title)}</p>
                </div>
              </div>
            </div>,
            document.body
          )}
        </>
      )}
    </div>
  );
}

function PipelineCard({ icon, count, label, statusKey, modeFilter, dateFilter, onNavigate, uiStyle = 'neon-dark' }) {
  const isGlass = uiStyle === 'glassmorphism-brown';
  const IconComponent = icon;
  const isEmpty = Number(count) === 0;
  const isAccentStatus = ['PURCHASED', 'SHIPPED_IN', 'On Hand'].includes(statusKey);
  const isYellowStatus = statusKey === 'Pre Order';
  const isCompleted = statusKey === 'COMPLETED';
  const carbonBorder = isCompleted
    ? 'border-b-2 [border-bottom-color:var(--green)]'
    : isAccentStatus
      ? 'border-b-2 [border-bottom-color:var(--accent)]'
      : isYellowStatus
        ? 'border-b-2 [border-bottom-color:var(--yellow)]'
        : 'border-b-2 border-b-transparent';
  const carbonValue = isCompleted
    ? 'text-[var(--green)]'
    : isAccentStatus
      ? 'text-[var(--accent)]'
      : isYellowStatus
        ? 'text-[var(--yellow)]'
        : 'text-[var(--text-primary)]';
  return (
    <div
      onClick={() => onNavigate('/transactions', { state: {
        status: statusKey,
        dateFilter: dateFilter || undefined,
        platformMode: modeFilter && modeFilter !== 'All' ? modeFilter : undefined,
      }})}
      className={isGlass
        ? "group relative min-h-[160px] cursor-pointer overflow-hidden rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:border-[#d8a65a]/18 hover:bg-[#1d1f21]/78"
        : `flex items-center gap-3 rounded-md p-3 cursor-pointer transition-colors ${isEmpty ? 'bg-transparent opacity-30' : `bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] ${carbonBorder}`}`
      }
    >
      {isGlass ? (
        <>
          <div className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.05] bg-white/[0.025] text-[#d8a65a]/75 opacity-75 transition-opacity group-hover:opacity-100">
            <IconComponent className="h-4 w-4" />
          </div>
          <p className="font-serif text-3xl font-semibold leading-none text-[#d8a65a]">{count}</p>
          <p className="mt-3 max-w-[75%] text-[10px] font-bold uppercase tracking-wider text-white/20">{label}</p>
        </>
      ) : (
        <>
          <div className="w-8 h-8 flex items-center justify-center">
            <IconComponent className={`w-4.5 h-4.5 ${isEmpty ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`} />
          </div>
          <div>
            <p className={`text-[10px] font-normal uppercase tracking-[0.6px] ${isEmpty ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}>{label}</p>
            <p className={`text-lg font-semibold tabular-nums ${isEmpty ? 'text-[var(--text-muted)]' : carbonValue}`}>{count}</p>
          </div>
        </>
      )}
    </div>
  );
}
