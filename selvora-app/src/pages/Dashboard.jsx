import React, { useState, useEffect, useRef } from 'react';
import { useDashboard, useGoals } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Layers, Zap, Store, Calendar, Share2, Settings,
  CreditCard, Info, TrendingUp, Target, DollarSign, ShoppingBag, Flame
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
import MonthlyProfitSpendChart from '../components/Dashboard/MonthlyProfitSpendChart';
import PageNav from '../components/UI/PageNav';

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
  const [chartView, setChartView] = useState('line'); // 'line' | 'bar'
  const [pipelinePage, setPipelinePage] = useState(0); // mobile-only Status Pipeline pagination
  const [topCardsPage, setTopCardsPage] = useState(0); // mobile-only Top Cards pagination

  const { data, isLoading, isError, error, refetch } = useDashboard(modeFilter, dateFilter);
  const { data: goals = [] } = useGoals();
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
  const showGoals = dashboardSections.some(s => s.id === 'goals');
  const activeGoals = goals.filter(g => g.active);
  const showGoalsWidget = showGoals && activeGoals.length > 0;
  const hasRightColumn = showTrendChart && (showPaymentMethods || showGoalsWidget);
  const dashboardMiddleGridClass = isGlass
    ? (hasRightColumn ? 'lg:grid-cols-3' : 'lg:grid-cols-1')
    : (hasRightColumn ? 'lg:grid-cols-[minmax(0,1fr)_300px]' : 'lg:grid-cols-1');
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
    sold: { label: 'Units Sold', value: String(stats.unitsSold || stats.salesCount || 0), icon: TrendingUp, accent: false, title: 'Total quantity of items sold in the selected time range (not the number of sale records).' },
    tax: { label: 'Tax', value: `$${(stats.totalTax || 0).toFixed(0)}`, icon: Zap, accent: true },
    inventory: { label: 'Inventory', value: `$${(stats.inventoryValue || 0).toFixed(0)}`, icon: Store, accent: false },
    qty: { label: 'Qty', value: String(stats.inventoryQty || 0), icon: Layers, accent: true },
    avgSale: { label: 'Avg Sale', value: `$${(stats.unitsSold ? stats.totalRevenue / stats.unitsSold : 0).toFixed(0)}`, icon: TrendingUp, accent: false },
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
          : "grid min-w-0 grid-cols-1 gap-4 overflow-x-auto pb-4 sm:grid-cols-2 lg:grid-cols-none animate-in slide-in-from-bottom-4 duration-500 fade-in delay-100 fill-mode-both"
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
                description={def.description}
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
      const pipelinePerPage = 4;
      const pipelinePageCount = Math.ceil(visiblePipelineCards.length / pipelinePerPage);
      const safePipelinePage = Math.min(pipelinePage, pipelinePageCount - 1);
      const mobilePipelineCards = visiblePipelineCards.slice(
        safePipelinePage * pipelinePerPage,
        safePipelinePage * pipelinePerPage + pipelinePerPage
      );
      const renderPipelineCard = cardConfig => {
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
            onNavigate={navigate}
            uiStyle={preferences.style}
          />
        );
      };
      return (
        <div key="pipeline" data-tutorial-id="dashboard-pipeline" className={isGlass
          ? "rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.22)] animate-in fade-in duration-300 fill-mode-both"
          : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated animate-in slide-in-from-bottom-4 duration-500 fade-in delay-300 fill-mode-both"
        }>
          <h3 className={isGlass ? "mb-1 px-0.5 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/24" : "text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)] mb-1"}>Status Pipeline</h3>
          <p className={isGlass ? "mb-3 px-0.5 text-[10px] text-white/18" : "text-[12px] text-[var(--dp-text-secondary)] mb-4"}>
            Units currently in each stage right now — not a cumulative total. See "Units Sold" below for all units sold in this period regardless of their current status.
          </p>

          {/* Mobile (below lg): 4 cards at a time, paginated */}
          <div className="lg:hidden">
            <div key={safePipelinePage} className={isGlass ? "grid grid-cols-2 gap-4 page-transition" : "grid grid-cols-2 gap-3 page-transition"}>
              {mobilePipelineCards.map(renderPipelineCard)}
            </div>
            <PageNav count={pipelinePageCount} index={safePipelinePage} onChange={setPipelinePage} isGlass={isGlass} />
          </div>

          {/* Desktop (lg+): show every card at once, unchanged from before */}
          <div className={isGlass ? "hidden lg:grid grid-cols-3 2xl:grid-cols-4 gap-4" : "hidden lg:grid grid-cols-5 gap-3"}>
            {visiblePipelineCards.map(renderPipelineCard)}
          </div>
        </div>
      );
    }

    if (sectionId === 'goals') return null; // rendered inside trendChart right column

    if (sectionId === 'trendChart') {
      return (
        <div key="trendChart" data-tutorial-id="dashboard-chart" className={`grid grid-cols-1 ${dashboardMiddleGridClass} gap-4 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-500 fill-mode-both`}>
          {showTrendChart && (
            <div className={isGlass
              ? "lg:col-span-2 rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)] min-h-[360px] flex flex-col overflow-hidden"
              : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated min-h-[360px] flex flex-col overflow-hidden"
            }>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-3">
                <div>
                  <h3 className={isGlass ? "text-lg font-normal tracking-tight text-[#e8e2d6]" : "text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)]"}>
                    {chartView === 'bar' ? 'Monthly Profit vs Spending' : 'Profit & Cost Trend'}
                  </h3>
                  <p className={isGlass ? "text-[11px] text-white/20 mt-1" : "text-[12px] text-[var(--dp-text-secondary)] mt-1"}>
                    {chartView === 'bar' ? 'Net profit and total spending grouped by month' : 'Cumulative movement across selected dashboard metrics'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Line / Bar tab switcher */}
                  <div className={`flex gap-0.5 p-0.5 rounded-full ${isGlass ? 'bg-white/[0.04] border border-white/[0.06]' : 'bg-[var(--dp-bg)]'}`}>
                    {[['line', 'Line'], ['bar', 'Bar']].map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setChartView(val)}
                        className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                          chartView === val
                            ? isGlass
                              ? 'bg-white/[0.08] text-[#e8e2d6] border border-white/[0.10]'
                              : 'bg-[var(--dp-card-bg)] text-[var(--dp-accent)] dp-elevated'
                            : isGlass
                              ? 'text-white/25 hover:text-white/50 border border-transparent'
                              : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] border border-transparent'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className={isGlass ? "flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-white/25" : "flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>
                    <span className={isGlass ? "rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-1" : "rounded-full px-2 py-1 bg-[var(--dp-bg)]"}>{modeFilter}</span>
                    <span className={isGlass ? "rounded-full border border-white/[0.06] bg-white/[0.03] px-2 py-1" : "rounded-full px-2 py-1 bg-[var(--dp-bg)]"}>{dateFilter}</span>
                  </div>
                </div>
              </div>
              <div className={isGlass ? "flex-1 rounded-2xl bg-black/10" : "flex-1 rounded-2xl bg-[var(--dp-bg)]"}>
                {isLoading ? (
                  <div className={isGlass ? "flex h-full min-h-[280px] items-center justify-center text-sm text-gray-500" : "flex h-full min-h-[280px] items-center justify-center text-sm text-[var(--dp-text-secondary)]"}>Loading trend...</div>
                ) : chartView === 'bar' ? (
                  <MonthlyProfitSpendChart
                    trend={trend}
                    uiStyle={preferences.style}
                  />
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
          )}

          {(showGoalsWidget || showPaymentMethods) && (
            <div className="flex flex-col gap-4 h-full">
              {showGoalsWidget && (
                <DashboardGoalsWidget
                  goals={activeGoals}
                  stats={stats}
                  isGlass={isGlass}
                  dateFilter={dateFilter}
                  onNavigate={() => navigate('/goals')}
                />
              )}
              {showPaymentMethods && (() => {
                const topCardsPerPage = 3;
                const sourceCards = isGlass ? topCards.slice(0, 5) : topCards;
                const topCardsPageCount = Math.max(1, Math.ceil(sourceCards.length / topCardsPerPage));
                const safeTopCardsPage = Math.min(topCardsPage, topCardsPageCount - 1);
                const mobileTopCards = sourceCards.slice(
                  safeTopCardsPage * topCardsPerPage,
                  safeTopCardsPage * topCardsPerPage + topCardsPerPage
                );
                const renderCardRow = (card, i) => (
                  <div key={i} className={isGlass ? "flex items-center justify-between rounded-2xl border border-white/[0.045] bg-white/[0.02] px-4 py-3" : "flex items-center justify-between gap-3 rounded-2xl bg-[var(--dp-bg)] px-4 py-3"}>
                    <div className="flex items-center gap-3">
                      <CreditCard className={isGlass ? "w-4 h-4 text-[#d8a65a]" : "w-4 h-4 text-[var(--dp-text-secondary)]"} />
                      <div className="min-w-0">
                        <p className={isGlass ? "text-sm text-[#e8e2d6]" : `text-[12px] font-medium truncate max-w-[160px] ${i === 0 ? 'text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)]'}`}>{card.name}</p>
                        <p className={isGlass ? "text-xs text-white/20" : "text-[10px] text-[var(--dp-text-label)]"}>{card.txns} txns</p>
                      </div>
                    </div>
                    <p className={isGlass ? "text-sm font-medium text-[#d8a65a]" : `text-[12px] font-semibold tabular-nums ${i === 0 ? 'text-[var(--dp-accent)]' : 'text-[var(--dp-text-secondary)]'}`}>${card.amount.toFixed(0)}</p>
                  </div>
                );
                return (
                  <div className={isGlass
                    ? "rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
                    : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated"
                  }>
                    <h3 className={isGlass ? "mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)] mb-3"}>{isGlass ? 'Payment Methods' : 'Top Cards'}</h3>
                    {sourceCards.length === 0 ? (
                      <p className={isGlass ? "text-xs text-white/20" : "text-xs text-[var(--dp-text-secondary)]"}>No payment data yet.</p>
                    ) : (
                      <>
                        {/* Mobile (below lg): 3 cards at a time, paginated */}
                        <div className="lg:hidden">
                          <div key={safeTopCardsPage} className="space-y-3 page-transition">
                            {mobileTopCards.map((card, i) => renderCardRow(card, safeTopCardsPage * topCardsPerPage + i))}
                          </div>
                          <PageNav count={topCardsPageCount} index={safeTopCardsPage} onChange={setTopCardsPage} isGlass={isGlass} />
                        </div>

                        {/* Desktop (lg+): show every card at once, unchanged from before */}
                        <div className="hidden lg:block space-y-3">
                          {sourceCards.map((card, i) => renderCardRow(card, i))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}
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
          : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated pb-8 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-[700ms] fill-mode-both"
        }>
          <h3 className={isGlass ? "mb-4 text-[10px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)] mb-4"}>Recent Sales</h3>
          {recent.length === 0 ? (
            <p className={isGlass ? "text-white/20 text-sm text-center py-6" : "text-[var(--dp-text-secondary)] text-sm text-center py-6"}>No recent sales found.</p>
          ) : (
            <div className="overflow-x-auto pb-4">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={isGlass ? "border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wider" : "border-b border-[color:var(--dp-border)] text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>
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
                <tbody className={isGlass ? "text-sm divide-y divide-white/5" : "text-sm divide-y divide-[color:var(--dp-border)]"}>
                  {recent.map((txn, i) => (
                    <tr key={i} className={isGlass ? "hover:bg-white/[0.02] transition-colors" : "hover:bg-[var(--dp-hover-bg)] transition-[background] duration-150"}>
                      {visibleRecentSalesColumns.map(column => {
                        if (column.id === 'product') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pr-4 font-medium text-gray-200 max-w-[220px]" : "py-3 pr-4 font-semibold text-[var(--dp-text-primary)] max-w-[220px]"}>
                              <span className="truncate block">{txn.product}</span>
                            </td>
                          );
                        }
                        if (column.id === 'platform') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400" : "py-3 px-4 text-[var(--dp-text-secondary)]"}>{txn.platform}</td>;
                        if (column.id === 'buyer') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400 text-xs" : "py-3 px-4 text-[var(--dp-text-secondary)] text-xs"}>{txn.buyer}</td>;
                        if (column.id === 'cost') return <td key={column.id} className={isGlass ? "py-3 px-4 text-blue-400" : "py-3 px-4 tabular-nums text-[var(--dp-text-primary)]"}>${(txn.cost ?? 0).toFixed(2)}</td>;
                        if (column.id === 'sale') return <td key={column.id} className={isGlass ? "py-3 px-4 text-green-400" : "py-3 px-4 tabular-nums text-[var(--dp-text-primary)]"}>${(txn.revenue ?? 0).toFixed(2)}</td>;
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
                          const premiumStatusClass = st === 'SHIPPED_IN'
                            ? 'bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]'
                            : 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]';
                          return (
                            <td key={column.id} className="py-3 px-4">
                              <span className={isGlass ? `inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border ${cls}` : `inline-flex items-center rounded-full px-2.5 py-[3px] text-[9px] font-semibold uppercase tracking-[0.04em] ${premiumStatusClass}`}>
                                {txn.status || 'SOLD'}
                              </span>
                            </td>
                          );
                        }
                        if (column.id === 'date') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pl-4 text-gray-500 text-xs whitespace-nowrap" : "py-3 pl-4 text-[var(--dp-text-label)] text-[10px] whitespace-nowrap"}>
                              {isGlass ? new Date(txn.date).toLocaleDateString() : formatShortDate(txn.date)}
                            </td>
                          );
                        }
                        return null;
                      })}
                      {!isGlass && (
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold tabular-nums ${getRowProfit(txn) >= 0 ? 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]' : 'bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]'}`}>
                            {getRowProfit(txn) >= 0 ? '+' : '-'}${Math.abs(getRowProfit(txn)).toFixed(0)}
                          </span>
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
              <h3 className="font-serif text-xl font-semibold text-[#fff4dc]">
                {chartView === 'bar' ? 'Monthly Profit vs Spending' : 'Profit & Cost Trend'}
              </h3>
              <p className="mt-1 text-[11px] text-white/22">
                {chartView === 'bar' ? 'Net profit and total spending grouped by month' : 'Cumulative metrics over time'}
              </p>
            </div>
            {/* Line / Bar tab switcher */}
            <div className="flex gap-0.5 p-0.5 rounded-lg bg-white/[0.04] border border-white/[0.06]">
              {[['line', 'Line'], ['bar', 'Bar']].map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setChartView(val)}
                  className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                    chartView === val
                      ? 'bg-white/[0.08] text-[#e8e2d6] border border-white/[0.10]'
                      : 'text-white/25 hover:text-white/50 border border-transparent'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-[260px] flex-1 rounded-2xl bg-[#151719]/42 border border-white/[0.025] px-2 pt-2 shadow-[inset_0_1px_24px_rgba(0,0,0,0.18)]">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-white/25">Loading trend...</div>
            ) : chartView === 'bar' ? (
              <MonthlyProfitSpendChart
                trend={trend}
                uiStyle={preferences.style}
              />
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
      if (!showPaymentMethods && !showGoalsWidget) return null;

      const paymentCardsCard = (
        <div className="h-full rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-6 shadow-[0_10px_30px_rgba(0,0,0,0.22)]">
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

      if (!showPaymentMethods) {
        return (
          <DashboardGoalsWidget
            key="paymentMethods"
            goals={activeGoals}
            stats={stats}
            isGlass={isGlass}
            dateFilter={dateFilter}
            onNavigate={() => navigate('/goals')}
          />
        );
      }

      if (!showGoalsWidget) {
        return <div key="paymentMethods">{paymentCardsCard}</div>;
      }

      return (
        <div key="paymentMethods" className="grid h-full grid-cols-2 gap-4">
          {paymentCardsCard}
          <DashboardGoalsWidget
            goals={activeGoals}
            stats={stats}
            isGlass={isGlass}
            dateFilter={dateFilter}
            onNavigate={() => navigate('/goals')}
          />
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
              title={item.title}
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

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center p-6 bg-[var(--dp-bg)]">
        <div className="max-w-sm text-center text-sm rounded-[24px] bg-[var(--dp-card-bg)] dp-elevated p-8">
          <p className="text-[var(--dp-red-text)] font-medium mb-3">Could not load dashboard data{error?.message ? `: ${error.message}` : '.'}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 rounded-full bg-[var(--dp-accent)] text-[#ffffff] text-sm font-semibold transition-colors hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto theme-scrollbar bg-[var(--dp-bg)] font-['Inter']">
      <div className="px-4 py-6 sm:px-6 w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-6">

      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 animate-in fade-in duration-300">
        <div className="shrink-0">
          <h1 className={isGlass ? "text-3xl 3xl:text-4xl font-light tracking-tight text-[#e8e2d6]" : "text-[22px] font-semibold tracking-[-0.3px] text-[var(--dp-text-primary)]"}>Welcome back, {user?.username || 'User'}</h1>
          <p className={isGlass ? "text-white/25 text-[11px] mt-1 flex items-center gap-1" : "text-[var(--dp-text-secondary)] text-[12px] mt-1 flex items-center gap-1"}>
            <Clock className="w-3 h-3" /> {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-2">

          {/* Share Card + Settings — shown first on mobile (order-first), normal order on desktop */}
          <div className="flex items-center gap-2 order-first sm:order-last">
            <button className={isGlass ? "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all text-[#d8a65a] hover:text-[#e8e2d6] hover:bg-white/[0.05] border border-[#d8a65a]/20" : "flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-medium transition-colors bg-[var(--dp-card-bg)] text-[var(--dp-text-secondary)] dp-elevated hover:text-[var(--dp-text-primary)]"}>
              <Share2 className="w-3.5 h-3.5" /> Generate Share Card
            </button>
            <button
              data-tutorial-id="dashboard-settings-btn"
              onClick={() => setSettingsOpen(true)}
              className={isGlass ? "flex items-center justify-center w-9 h-9 rounded-xl text-white/30 hover:text-[#d8a65a] hover:bg-white/[0.06] border border-white/[0.06] transition-all" : "flex items-center justify-center w-9 h-9 rounded-full bg-[var(--dp-card-bg)] text-[var(--dp-text-secondary)] dp-elevated hover:text-[var(--dp-text-primary)] transition-colors"}
              title="Dashboard Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>

          {/* Mode Filters */}
          <div data-tutorial-id="dashboard-filters" className={isGlass ? "flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]" : "flex items-center gap-1 rounded-full bg-[var(--dp-card-bg)] p-1 dp-elevated"}>
            {['All', 'Cashout', 'Marketplace'].map((mode) => (
              <button
                key={mode}
                onClick={() => setModeFilter(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${modeFilter === mode ? (isGlass ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]') : (isGlass ? 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]')}`}
              >
                {mode === 'All' && <Layers className="w-3.5 h-3.5" />}
                {mode === 'Cashout' && <Zap className="w-3.5 h-3.5" />}
                {mode === 'Marketplace' && <Store className="w-3.5 h-3.5" />}
                {mode}
              </button>
            ))}
          </div>

          {!isGlass && <div className="hidden h-[14px] w-px bg-[var(--dp-border)] sm:block" />}

          {/* Date Filters */}
          <div className={isGlass ? "flex items-center gap-1 p-1 rounded-xl bg-[#181a1c]/78 border border-white/[0.05]" : "flex items-center gap-1 rounded-full bg-[var(--dp-card-bg)] p-1 dp-elevated"}>
            <Calendar className={isGlass ? "w-3.5 h-3.5 text-white/25 ml-1.5" : "w-3.5 h-3.5 text-[var(--dp-text-label)] ml-1.5"} />
            {['7 Days', '30 Days', 'YTD', 'All Time'].map((f) => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={`px-[10px] py-1 text-[12px] font-medium rounded-full transition-colors ${dateFilter === f ? (isGlass ? 'bg-[#d8a65a]/12 text-[#d8a65a] ring-1 ring-[#d8a65a]/25' : 'bg-[var(--dp-accent)] text-[#ffffff]') : (isGlass ? 'text-white/30 hover:text-[#e8e2d6] hover:bg-white/[0.04]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]')}`}
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
    </div>
  );
};

export default Dashboard;

// ── Helper Components ──────────────────────────────────────────────────────────

const GOAL_METRIC_META = {
  netProfit:    { label: 'Net Profit',  icon: TrendingUp,  prefix: '$' },
  totalRevenue: { label: 'Revenue',     icon: DollarSign,  prefix: '$' },
  unitsSold:    { label: 'Units Sold',  icon: ShoppingBag, prefix: ''  },
};

// Goals only store 7-day/30-day/YTD targets -- there is no dedicated
// "all time" target field. For "All Time" this returns the largest
// configured period target as a best-effort reference, along with which
// period it came from, so the UI can label it honestly instead of implying
// it's a true all-time goal.
function getTargetForFilter(goal, dateFilter) {
  if (dateFilter === '7 Days')  return { value: goal.target_7d  ?? null, period: '7-Day' };
  if (dateFilter === '30 Days') return { value: goal.target_30d ?? null, period: '30-Day' };
  if (dateFilter === 'YTD')     return { value: goal.target_ytd ?? null, period: 'YTD' };
  const candidates = [
    { value: goal.target_7d,  period: '7-Day' },
    { value: goal.target_30d, period: '30-Day' },
    { value: goal.target_ytd, period: 'YTD' },
  ].filter(c => c.value != null);
  return candidates.length > 0 ? candidates.reduce((max, c) => (c.value > max.value ? c : max)) : { value: null, period: null };
}

function getCurrentGoalValue(stats, metric) {
  if (metric === 'netProfit')    return Number(stats?.profit)       || 0;
  if (metric === 'totalRevenue') return Number(stats?.totalRevenue) || 0;
  if (metric === 'unitsSold')    return Number(stats?.unitsSold)    || 0;
  return 0;
}

function MiniProgressRing({ pct, size = 56, stroke = 5, color, isGlass }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={isGlass ? 'rgba(255,255,255,0.07)' : 'var(--dp-bg)'}
        strokeWidth={stroke} />
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
}

function DashboardGoalsWidget({ goals, stats, isGlass, dateFilter, onNavigate }) {
  const [idx, setIdx] = useState(0);
  const goalsWithTarget = goals.filter(g => getTargetForFilter(g, dateFilter).value != null);
  const allGoals = goalsWithTarget.length > 0 ? goalsWithTarget : goals;
  const count = allGoals.length;
  const safeIdx = count > 0 ? ((idx % count) + count) % count : 0;
  const goal = count > 0 ? allGoals[safeIdx] : null;

  if (!goal) return null;

  const meta = GOAL_METRIC_META[goal.metric] || GOAL_METRIC_META.netProfit;
  const IconComp = meta.icon;
  const current = getCurrentGoalValue(stats, goal.metric);
  const { value: target, period: targetPeriod } = getTargetForFilter(goal, dateFilter);
  const hasTarget = target != null && target > 0;
  // truePct is the real, uncapped percentage for display; progressPct is
  // capped to 100 and used only for the ring/bar's visual fill, which must
  // never overshoot its own circle/track.
  const truePct = hasTarget ? (current / target) * 100 : 0;
  const progressPct = Math.min(100, truePct);

  const ringColor = !hasTarget
    ? (isGlass ? 'rgba(255,255,255,0.12)' : 'var(--dp-border)')
    : progressPct >= 100 ? '#1A9A50'
    : progressPct >= 60  ? (isGlass ? '#6aaa8e' : '#1A9A50')
    : progressPct >= 35  ? '#D9A512'
    : '#D23B3B';

  const paceLabel = !hasTarget ? null
    : progressPct >= 100 ? 'Achieved'
    : progressPct >= 60  ? 'On track'
    : progressPct >= 35  ? 'Behind'
    : 'Off track';

  const paceColor = !hasTarget ? null
    : progressPct >= 100 ? (isGlass ? 'text-[#4ade80]' : 'text-[var(--dp-green-text)]')
    : progressPct >= 60  ? (isGlass ? 'text-[#6aaa8e]' : 'text-[var(--dp-green-text)]')
    : progressPct >= 35  ? 'text-[#D9A512]'
    : 'text-[var(--dp-red-text)]';

  const noTargetLabel = dateFilter === 'All Time' ? 'no target configured' : `no target for ${dateFilter}`;

  const fmt = (v) => goal.metric === 'unitsSold'
    ? Math.round(v).toLocaleString()
    : `$${Math.round(v).toLocaleString()}`;

  return (
    <div className={`flex flex-col animate-in slide-in-from-bottom-4 duration-500 fade-in fill-mode-both h-full ${
      isGlass
        ? 'rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]'
        : 'rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target size={13} className={isGlass ? 'text-[#d8a65a]' : 'text-[var(--dp-accent)]'} />
          <h3 className={isGlass
            ? 'text-[10px] font-medium uppercase tracking-[0.22em] text-white/25'
            : 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)]'
          }>Goals</h3>
        </div>
        <button
          onClick={onNavigate}
          className={`text-[10px] transition-colors ${isGlass ? 'text-white/20 hover:text-[#d8a65a]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-accent)]'}`}
        >
          View all →
        </button>
      </div>

      {/* Carousel — grows to fill remaining height */}
      <div className="flex flex-col flex-1 min-h-0">
        {/* Big ring + label centred */}
        <div key={safeIdx} className="flex flex-col items-center justify-center flex-1 gap-3 page-transition">
          {/* Ring */}
          <div className="relative">
            <MiniProgressRing pct={progressPct} size={96} stroke={7} color={ringColor} isGlass={isGlass} />
            <div className="absolute inset-0 flex items-center justify-center">
              <IconComp size={20} className={isGlass ? 'text-white/30' : 'text-[var(--dp-text-secondary)]'} />
            </div>
          </div>

          {/* Metric name + pace */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <p className={`text-[10px] font-medium uppercase tracking-[0.06em] ${isGlass ? 'text-white/30' : 'text-[var(--dp-text-label)]'}`}>
                {meta.label}
              </p>
              {paceLabel && (
                <span className={`text-[9px] font-semibold ${paceColor}`}>{paceLabel}</span>
              )}
            </div>

            {/* Current value */}
            <p className={`text-[22px] font-bold tabular-nums leading-tight ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]'}`}>
              {fmt(current)}
            </p>

            {/* Target */}
            {hasTarget ? (
              <p className={`text-[11px] mt-0.5 ${isGlass ? 'text-white/25' : 'text-[var(--dp-text-secondary)]'}`}>
                of {fmt(target)} goal{dateFilter === 'All Time' && targetPeriod ? ` (${targetPeriod} target, no all-time target set)` : ''}
              </p>
            ) : (
              <p className={`text-[11px] mt-0.5 ${isGlass ? 'text-white/20' : 'text-[var(--dp-text-secondary)]'}`}>
                {noTargetLabel}
              </p>
            )}

            {/* Percentage — the real, uncapped value; only the ring/bar fill is capped */}
            {hasTarget && (
              <p className={`text-[28px] font-bold tabular-nums leading-none mt-3 ${
                progressPct >= 100 ? (isGlass ? 'text-[#4ade80]' : 'text-[var(--dp-green-text)]')
                : progressPct >= 60  ? (isGlass ? 'text-[#6aaa8e]' : 'text-[var(--dp-green-text)]')
                : progressPct >= 35  ? (isGlass ? 'text-amber-400' : 'text-[#D9A512]')
                : (isGlass ? 'text-red-400' : 'text-[var(--dp-red-text)]')
              }`}>{Math.round(truePct)}%</p>
            )}
          </div>

          {/* Progress bar */}
          <div className={`w-full h-1.5 rounded-full overflow-hidden ${isGlass ? 'bg-white/[0.06]' : 'bg-[var(--dp-bg)]'}`}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: ringColor }}
            />
          </div>
        </div>

        {/* Nav arrows + dot indicators */}
        <PageNav count={count} index={safeIdx} onChange={setIdx} isGlass={isGlass} label="goal" />
      </div>
    </div>
  );
}

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
function GlassCircularPipeline({ cards, overflowCards = [], pipeline, onNavigate }) {
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

  const navigateTo = () => onNavigate('/statuses');

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

function StatCard({ id, title, modeTag, value, subtext, icon, color, formula = [], description, onClick, uiStyle = 'neon-dark' }) {
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
  const textColor = isGlass ? colorClass.split(' ')[0] : 'text-[var(--dp-accent)]';
  const calculation = formula.join(' ');
  const glassTextColor = title === 'Net Profit' || title === 'Gross Profit' || title === 'Cashback'
    ? 'text-[#d8a65a]'
    : 'text-[#e8e2d6]';
  const isProfitHero = id === 'profit' || title === 'Net Profit';

  return (
    <div ref={ref} onClick={onClick} className={isGlass
      ? `relative overflow-visible rounded-[20px] bg-[#181a1c]/72 border border-white/[0.06] p-5 sm:p-6 shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-colors duration-200 hover:bg-[#1d1f21]/78 hover:border-white/[0.09] group${onClick ? ' cursor-pointer' : ''}`
      : `relative ${open ? 'z-[80]' : 'z-0'} overflow-visible rounded-[24px] p-6 transition-shadow duration-150 group dp-elevated ${isProfitHero ? 'text-[#ffffff]' : 'bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] dp-elevated-hover'}${onClick ? ' cursor-pointer' : ''}`
    } style={!isGlass && isProfitHero ? { background: 'var(--dp-accent-gradient)' } : undefined}>
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <p className={isGlass ? "text-[10px] text-white/25 font-medium uppercase tracking-[0.2em]" : `text-[11px] font-medium uppercase tracking-[0.08em] ${isProfitHero ? 'text-[#ffffff]/75' : 'text-[var(--dp-text-label)]'}`}>
            {title}
            {modeTag && (
              <span className={isGlass ? "ml-1.5 text-[9px] font-normal normal-case tracking-normal text-[var(--text-muted)]" : `ml-1.5 text-[10px] font-normal normal-case tracking-normal ${isProfitHero ? 'text-[#ffffff]/60' : 'text-[var(--dp-text-label)]'}`}>
                {modeTag}
              </span>
            )}
          </p>
          <p className={isGlass ? `text-2xl 3xl:text-3xl font-light mt-2 ${glassTextColor}` : `mt-2 tabular-nums font-bold ${isProfitHero ? 'text-[32px] text-[#ffffff]' : 'text-[22px] text-[var(--dp-text-primary)]'}`}>{value}</p>
          <p className={isGlass ? "text-[10px] 3xl:text-xs text-white/18 mt-2" : `text-[11px] mt-1 ${isProfitHero ? 'text-[#ffffff]/70' : 'text-[var(--dp-text-secondary)]'}`}>{subtext}</p>
        </div>
        <div className={isGlass ? "w-9 h-9 3xl:w-11 3xl:h-11 rounded-xl bg-white/[0.035] border border-white/[0.05] flex items-center justify-center" : `w-9 h-9 rounded-full flex items-center justify-center ${isProfitHero ? 'bg-white/15 text-[#ffffff]' : 'bg-[var(--dp-bg)] text-[var(--dp-text-secondary)]'}`}>
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
            className={isGlass
              ? "absolute bottom-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors"
              : `absolute bottom-3 right-3 z-20 w-5 h-5 flex items-center justify-center rounded-full transition-colors ${isProfitHero ? 'text-[#ffffff]/50 hover:text-[#ffffff] hover:bg-white/15' : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] hover:bg-[var(--dp-bg)]'}`
            }
          >
            <Info className="w-3 h-3" />
          </button>
          {open && popoverCoords && createPortal(
            <div
              ref={popoverRef}
              className={`fixed w-[280px] rounded-2xl ${isGlass ? 'bg-[#1a1c23] border-white/10 shadow-2xl' : 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] dp-elevated'} border p-4 z-[9999] animate-in fade-in duration-150 ${
                popoverPosition === 'bottom' ? 'slide-in-from-top-1' : 'slide-in-from-bottom-1'
              }`}
              style={{
                left: popoverCoords.left,
                top: popoverCoords.top,
                bottom: popoverCoords.bottom,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className={`absolute right-4 h-3 w-3 rotate-45 ${isGlass ? 'bg-[#1a1c23]' : 'bg-[var(--dp-card-bg)]'} ${
                popoverPosition === 'bottom'
                  ? `${isGlass ? 'border-white/10' : 'border-[color:var(--dp-border)]'} -top-1.5 border-l border-t`
                  : `${isGlass ? 'border-white/10' : 'border-[color:var(--dp-border)]'} -bottom-1.5 border-r border-b`
              }`} />
              <p className={isGlass ? `text-[10px] font-medium uppercase tracking-[0.8px] ${textColor}` : `text-[11px] font-semibold uppercase tracking-[0.06em] ${textColor}`}>{title}</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className={isGlass ? "text-[9px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]" : "text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>Calculation</p>
                  <p className={isGlass ? "mt-1 text-xs font-semibold leading-relaxed text-[var(--text-primary)]" : "mt-1 text-xs font-semibold leading-relaxed text-[var(--dp-text-primary)]"}>{calculation}</p>
                </div>
                <div>
                  <p className={isGlass ? "text-[9px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]" : "text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>Meaning</p>
                  <p className={isGlass ? "mt-1 text-xs leading-relaxed text-[var(--text-secondary)]" : "mt-1 text-xs leading-relaxed text-[var(--dp-text-secondary)]"}>{description || `${title} is available in the selected dashboard view.`}</p>
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

function PipelineCard({ icon, count, label, statusKey, onNavigate, uiStyle = 'neon-dark' }) {
  const isGlass = uiStyle === 'glassmorphism-brown';
  const IconComponent = icon;
  const isEmpty = Number(count) === 0;
  const isAccentStatus = ['PURCHASED', 'SHIPPED', 'On Hand'].includes(statusKey);
  const isYellowStatus = statusKey === 'Pre Order';
  const premiumValue = isAccentStatus
      ? 'text-[var(--dp-accent)]'
      : isYellowStatus
        ? 'text-[#C9972E]'
        : 'text-[var(--dp-text-primary)]';
  return (
    <div
      onClick={() => onNavigate('/statuses')}
      title={`${count} unit${count === 1 ? '' : 's'} currently in "${label}" status. Click to open Statuses.`}
      className={isGlass
        ? "group relative min-h-[160px] cursor-pointer overflow-hidden rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-5 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:border-[#d8a65a]/18 hover:bg-[#1d1f21]/78"
        : `flex items-center gap-3 rounded-2xl p-4 cursor-pointer transition-colors ${isEmpty ? 'bg-transparent opacity-40' : 'bg-[var(--dp-bg)] hover:bg-[var(--dp-hover-bg)]'}`
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
          <div className="w-9 h-9 rounded-full bg-[var(--dp-card-bg)] flex items-center justify-center shrink-0">
            <IconComponent className={`w-4.5 h-4.5 ${isEmpty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-secondary)]'}`} />
          </div>
          <div>
            <p className={`text-[11px] font-medium uppercase tracking-[0.06em] ${isEmpty ? 'text-[var(--dp-text-label)]' : 'text-[var(--dp-text-secondary)]'}`}>{label}</p>
            <p className={`text-lg font-bold tabular-nums ${isEmpty ? 'text-[var(--dp-text-label)]' : premiumValue}`}>{count}</p>
          </div>
        </>
      )}
    </div>
  );
}
