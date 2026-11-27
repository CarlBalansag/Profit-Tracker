import React, { useState, useEffect, useRef } from 'react';
import { useDashboard, useGoals } from '../hooks/useApi';
import { PageLoader } from '../components/PageLoader';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  Clock, Layers, Zap, Store, Calendar, Settings,
  CreditCard, Info, TrendingUp, ChevronRight, Target, DollarSign, ShoppingBag, Flame
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
import ProfitCostTrendChart from '../components/Dashboard/ProfitCostTrendChart';
import MonthlyProfitSpendChart from '../components/Dashboard/MonthlyProfitSpendChart';
import PageNav from '../components/UI/PageNav';
import { SwipeArea } from '../components/Analytics/SectionPager';
import HScrollbar from '../components/UI/HScrollbar';
import CountUp from '../components/UI/CountUp';
import WorkflowPipeline from '../components/Dashboard/WorkflowPipeline';
import TodoSummary from '../components/Dashboard/TodoSummary';
import { useMatchMedia } from '../hooks/useMatchMedia';

// Status Pipeline views: every step, stock through paid ("All", the default),
// or one sale workflow's own steps.
const PIPELINE_VIEWS = [['all', 'All'], ['cashout', 'Cashout'], ['marketplace', 'Marketplace']];
import { formatMoney, formatWholeMoney, formatWholeDollars } from '../utils/money';
import { recordStatusLabel } from '../data/statusWorkflow';

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

// Sold-item results first (Net, Revenue, Gross), then purchase-side money
// (Spend, Cashback), so related tiles sit together.
const CARBON_KPI_ORDER = ['profit', 'totalRevenue', 'grossProfit', 'totalCost', 'totalCashback'];

const FILTERS_KEY = 'pt-dashboard-filters';
const DATE_FILTERS = ['7 Days', '30 Days', 'YTD', 'All Time'];
const MODE_FILTERS = ['All', 'Cashout', 'Marketplace'];
function readSavedFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTERS_KEY) || '{}');
    return {
      date: DATE_FILTERS.includes(saved.date) ? saved.date : null,
      mode: MODE_FILTERS.includes(saved.mode) ? saved.mode : null,
    };
  } catch { return {}; }
}
function writeSavedFilters(filters) {
  try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch { /* private mode: nothing to keep */ }
}

function formatShortDate(dateValue) {
  if (!dateValue) return '';
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Row profit includes the card's cashback, so it is shown to the cent: whole
// dollars turned small losses and gains into a misleading "+$0".
const isZeroMoney = (v) => Math.abs(v) < 0.005;
function signedMoney(v) {
  if (isZeroMoney(v)) return '$0.00';
  return `${v > 0 ? '+' : '−'}$${formatMoney(Math.abs(v))}`;
}
const profitTextClass = (v) => (isZeroMoney(v) ? 'text-[var(--dp-text-secondary)]' : v > 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]');
const profitPillClass = (v) => (isZeroMoney(v)
  ? 'bg-[var(--dp-bg)] text-[var(--dp-text-secondary)]'
  : v > 0 ? 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]' : 'bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]');
// Status pills move from "waiting" (amber) through "on its way" (blue) to
// "paid" (green); red only for problems.
const STATUS_TONES = {
  waiting: 'bg-[var(--dp-warning-bg)] text-[var(--dp-warning-text)]',
  moving: 'bg-[var(--dp-info-bg)] text-[var(--dp-info-text)]',
  done: 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]',
  problem: 'bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]',
  neutral: 'bg-[var(--dp-bg)] text-[var(--dp-text-secondary)]',
};
const TONE_BY_STATUS = {
  done: ['PAID', 'COMPLETED'],
  problem: ['RETURNED', 'RETURN_IN_PROGRESS', 'DISPUTED', 'CANCELLED', 'REFUNDED', 'AUTHENTICATION_FAILED'],
  waiting: ['SOLD', 'LISTED', 'PENDING', 'AWAITING_SHIPMENT', 'AWAITING_HANDOFF', 'WAITING_FOR_PAYMENT', 'PENDING_PAYMENT'],
  moving: ['SHIPPED_OUT', 'OUTBOUND', 'IN_TRANSIT_OUT', 'HANDED_OVER', 'DELIVERED', 'DELIVERED_TO_PROVIDER',
    'DELIVERED_TO_AUTHENTICATOR', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'AUTHENTICATION', 'AUTHENTICATING', 'SHIPPED_IN'],
};
function statusToneClass(status) {
  const tone = Object.keys(TONE_BY_STATUS).find(key => TONE_BY_STATUS[key].includes(status));
  return STATUS_TONES[tone || 'neutral'];
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
  // On a phone (in a store), what needs doing comes before the numbers.
  const isPhone = useMatchMedia('(max-width: 639px)');
  // The last filters you picked come back after a reload or a visit elsewhere.
  const [savedFilters] = useState(readSavedFilters);
  const [dateFilter, setDateFilter] = useState(savedFilters.date || settings.defaultDateFilter || '30 Days');
  const [modeFilter, setModeFilter] = useState(savedFilters.mode || 'All');
  useEffect(() => { writeSavedFilters({ date: dateFilter, mode: modeFilter }); }, [dateFilter, modeFilter]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [trendMode, setTrendMode] = useState('period'); // 'period' | 'cumulative'
  const [chartView, setChartView] = useState('line'); // 'line' | 'bar'
  // The Status Pipeline follows the dashboard filter: All shows every step,
  // Cashout/Marketplace (which only have sales of that kind) their workflow.
  const pipelineView = modeFilter === 'Cashout' ? 'cashout' : modeFilter === 'Marketplace' ? 'marketplace' : 'all';
  const chooseMode = (mode) => setModeFilter(mode);
  const [topCardsPage, setTopCardsPage] = useState(0); // Top Cards pagination (3 per page, all breakpoints)
  const statsRowRef = useRef(null); // KPI row, driven by the drawn scrollbar below it

  const { data, isLoading, isError, error, refetch, isPlaceholderData } = useDashboard(modeFilter, dateFilter);
  // A filter change is loading: the page stays exactly as it is, usable, until
  // the new data arrives; the KPI numbers then count to their new values.
  const refreshing = Boolean(isPlaceholderData);
  const { data: goals = [] } = useGoals();
  useEffect(() => { if (data) setLastUpdated(new Date()); }, [data]);

  const recent = data?.recentTransactions || [];
  const stats = normalizeDashboardStats(data?.stats, recent);
  const pipeline = data?.pipelineCounts || {};
  const workflowPipelines = data?.workflowPipelines || {};
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
  // Buyer is dropped while none of the listed sales has one.
  const salesColumns = visibleRecentSalesColumns.filter(c => c.id !== 'buyer' || recent.some(t => t.buyer && t.buyer !== 'Unknown'));
  const openSale = (txn) => {
    if (txn.id) navigate('/transactions', { state: { openTransaction: { saleId: txn.id } } });
  };

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
    avgCost: { label: 'Avg Cost', value: `$${formatWholeMoney(stats.unitsSold ? stats.soldCost / stats.unitsSold : stats.transactionCount ? stats.totalCost / stats.transactionCount : 0)}`, icon: Store, accent: false },
    roi: { label: 'ROI', value: `${(stats.roi || 0).toFixed(0)}%`, icon: Zap, accent: true },
    revenue: { label: 'Revenue', value: `$${formatWholeMoney(stats.totalRevenue || 0)}`, icon: Store, accent: false },
    cashback: { label: 'Cashback', value: `$${formatWholeMoney(stats.totalCashback || 0)}`, icon: Layers, accent: true },
    sold: { label: 'Units Sold', value: String(stats.unitsSold || stats.salesCount || 0), icon: TrendingUp, accent: false, title: 'Total quantity of items sold in the selected time range (not the number of sale records).' },
    tax: { label: 'Tax', value: `$${formatWholeMoney(stats.totalTax || 0)}`, icon: Zap, accent: true },
    inventory: { label: 'Inventory', value: `$${formatWholeMoney(stats.inventoryValue || 0)}`, icon: Store, accent: false },
    qty: { label: 'Qty', value: String(stats.inventoryQty || 0), icon: Layers, accent: true },
    avgSale: { label: 'Avg Sale', value: `$${formatWholeMoney(stats.unitsSold ? stats.totalRevenue / stats.unitsSold : 0)}`, icon: TrendingUp, accent: false },
    netProfit: { label: 'Net Profit', value: formatWholeDollars(stats.profit || 0), icon: Zap, accent: true },
  };

  function renderDashboardSection(sectionId) {
    if (sectionId === 'statCards') {
      if (!showStatCards || visibleStatCards.length === 0) return null;
      // Glass keeps its per-card tag; the filters above say the scope.
      const modeTag = isGlass && modeFilter !== 'All'
        ? `sold via ${modeFilter}`
        : null;
      return (
        <div key="statCards">
        <div ref={statsRowRef} data-tutorial-id="dashboard-stats" className={isGlass
          ? `grid grid-cols-2 ${statColClass} gap-3 3xl:gap-4 max-sm:[&>*:first-child]:col-span-2 animate-in slide-in-from-bottom-4 duration-500 fade-in delay-100 fill-mode-both`
          : "grid min-w-0 grid-cols-2 gap-3 sm:gap-4 pb-4 lg:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] max-sm:[&>*:first-child]:col-span-2 animate-in fade-in duration-300 fill-mode-both"
        }>
          {visibleStatCards.map(cardConfig => {
            const base = STAT_CARD_REGISTRY[cardConfig.id];
            if (!base) return null;
            // A channel view (Cashout / Marketplace) uses the card's channel
            // wording where the number means something different there.
            const def = modeFilter !== 'All' && base.channel ? { ...base, ...base.channel } : base;
            const colorOverride = cardConfig.id === 'profit' && stats.profit < 0 ? 'red' : def.color;
            return (
              <StatCard
                key={cardConfig.id}
                id={cardConfig.id}
                title={def.label}
                modeTag={modeTag}
                loading={refreshing}
                value={def.getValue(stats)}
                subtext={def.getSubtext(stats)}
                icon={def.icon}
                color={colorOverride}
                formula={def.formula}
                breakdown={def.getBreakdown?.(stats)}
                description={def.description}
                uiStyle={preferences.style}
                onClick={() => navigate('/transactions', { state: { dateFilter, cardScope: modeFilter !== 'All' && base.channel ? 'sold' : def.scope, platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
              />
            );
          })}
        </div>
        {!isGlass && <HScrollbar targetRef={statsRowRef} className="hidden lg:block" />}
        </div>
      );
    }

    if (sectionId === 'pipeline') {
      if (!showPipeline || visiblePipelineCards.length === 0) return null;
      return (
        <div key="pipeline" data-tutorial-id="dashboard-pipeline" className={isGlass
          ? "rounded-[20px] border border-white/[0.06] bg-[#181a1c]/72 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.22)] animate-in fade-in duration-300 fill-mode-both"
          : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated animate-in fade-in duration-300 fill-mode-both"
        }>
          {/* Follows the page's All / Cashout / Marketplace filter; no second filter here. */}
          <h2 className={isGlass ? "mb-1 px-0.5 text-[11px] font-semibold uppercase tracking-[0.28em] text-white/24" : "mb-1 text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)]"}>
            Status Pipeline
            {pipelineView !== 'all' && <span className="normal-case tracking-normal"> · {PIPELINE_VIEWS.find(([v]) => v === pipelineView)?.[1]}</span>}
          </h2>
          {/* Up to two lines on a phone, one on wider screens; the same length
              on every tab so the card's height doesn't shift. */}
          <p className={isGlass ? "mb-3 hidden truncate px-0.5 text-[11px] text-white/18 sm:block" : "mb-4 line-clamp-2 min-h-[2lh] text-[12px] text-[var(--dp-text-secondary)] sm:min-h-0 sm:truncate"}>
            {pipelineView === 'all'
              ? 'Unsold stock right now, at cost. Sold items from this period, at sale price.'
              : `${PIPELINE_VIEWS.find(([v]) => v === pipelineView)?.[1]} sales from this period, at sale price, by step.`}
          </p>

          {/* Not remounted per tab: the same steps slide between tabs. */}
          <WorkflowPipeline
            pipeline={workflowPipelines[pipelineView]}
            pending={refreshing}
            onNavigate={navigate}
            // Every view shows only the steps with something in them; the
            // pipeline says how many empty ones it left out.
            hideEmpty={pipelineView === 'all'}
          />
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
                  <div className={isGlass ? "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-white/25" : "flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>
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
                  <ProfitCostTrendChart
                    trend={trend}
                    trendMeta={trendMeta}
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
                  dateFilter={dateFilter} refreshing={refreshing}
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
                  <div key={i} className={isGlass ? "flex items-center justify-between gap-3 rounded-2xl border border-white/[0.045] bg-white/[0.02] px-4 py-3" : "flex items-center justify-between gap-3 rounded-2xl bg-[var(--dp-bg)] px-4 py-3"}>
                    <div className="flex min-w-0 items-center gap-3">
                      <CreditCard className={isGlass ? "w-4 h-4 text-[#d8a65a]" : "w-4 h-4 text-[var(--dp-text-secondary)]"} />
                      <div className="min-w-0">
                        <p title={card.name} className={isGlass ? "text-sm text-[#e8e2d6]" : "text-[12px] font-medium line-clamp-2 [overflow-wrap:anywhere] text-[var(--dp-text-primary)]"}>{card.name}</p>
                        <p className={isGlass ? "text-xs text-white/20" : "text-[11px] text-[var(--dp-text-label)]"}>{card.txns} {card.txns === 1 ? 'purchase' : 'purchases'}</p>
                      </div>
                    </div>
                    <p className={isGlass ? "shrink-0 whitespace-nowrap text-sm font-medium text-[#d8a65a]" : "shrink-0 text-[12px] font-semibold tabular-nums text-[var(--dp-text-primary)]"}>${formatWholeMoney(card.amount)}</p>
                  </div>
                );
                return (
                  <div className={isGlass
                    ? "rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]"
                    : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated"
                  }>
                    <h2 className={isGlass ? "mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)] mb-3"}>{isGlass ? 'Payment Methods' : 'Top Credit Cards'}</h2>
                    {sourceCards.length === 0 ? (
                      <p className={isGlass ? "text-xs text-white/20" : "text-[13px] text-[var(--dp-text-secondary)]"}>{dateFilter === 'All Time' ? 'No card spending recorded yet.' : 'No card spending in this period.'}</p>
                    ) : (
                      <>
                        {/* 3 cards at a time, paginated — same on every breakpoint
                            so this column doesn't grow taller than the chart
                            next to it. */}
                        {/* Swipe left/right to page, same as the arrows. */}
                        <SwipeArea
                          onPrev={() => setTopCardsPage((safeTopCardsPage - 1 + topCardsPageCount) % topCardsPageCount)}
                          onNext={() => setTopCardsPage((safeTopCardsPage + 1) % topCardsPageCount)}
                        >
                        <div key={safeTopCardsPage} className="space-y-3 page-transition">
                          {mobileTopCards.map((card, i) => renderCardRow(card, safeTopCardsPage * topCardsPerPage + i))}
                        </div>
                        </SwipeArea>
                        <PageNav count={topCardsPageCount} index={safeTopCardsPage} onChange={setTopCardsPage} isGlass={isGlass} />
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
          : "rounded-[24px] p-6 bg-[var(--dp-card-bg)] dp-elevated pb-8 animate-in fade-in duration-300 fill-mode-both"
        }>
          <h2 className={isGlass ? "mb-4 text-[11px] font-medium uppercase tracking-[0.22em] text-white/25" : "text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--dp-text-primary)] mb-4"}>Recent Sales</h2>
          {recent.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className={isGlass ? "text-white/20 text-sm" : "text-[var(--dp-text-secondary)] text-sm"}>
                {dateFilter === 'All Time' ? 'No sales recorded yet.' : dateFilter === 'YTD' ? 'No sales so far this year.' : `No sales in the last ${dateFilter.toLowerCase()}.`}
              </p>
              {dateFilter !== 'All Time' && (
                <button
                  type="button"
                  onClick={() => setDateFilter('All Time')}
                  className={isGlass ? "rounded-full border border-white/[0.08] px-4 py-2 text-xs font-medium text-[#d8a65a] hover:bg-white/[0.05]" : "rounded-full bg-[var(--dp-bg)] px-4 py-2 text-[13px] font-medium text-[var(--dp-accent-text)] hover:bg-[var(--dp-hover-bg)] transition-colors"}
                >
                  Show All Time
                </button>
              )}
            </div>
          ) : (
            <>
            {/* One layout per screen size: a list on phones, a table from sm up.
                Each sale opens in Transactions. */}
            {isPhone ? (
            <ul className={isGlass ? "divide-y divide-white/5" : "divide-y divide-[color:var(--dp-border)]"}>
              {recent.map((txn, i) => (
                <li key={txn.id || i}>
                  <button
                    type="button"
                    onClick={() => openSale(txn)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left rounded-md outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)]"
                  >
                    <span className="min-w-0">
                      <span className={isGlass ? "block truncate text-sm font-medium text-gray-200" : "block truncate text-sm font-medium text-[var(--dp-text-primary)]"}>{txn.product}{txn.quantity > 1 && <span className="font-normal text-[var(--dp-text-secondary)]"> ×{txn.quantity}</span>}</span>
                      <span className={isGlass ? "block text-xs text-gray-500" : "block text-xs text-[var(--dp-text-secondary)]"}>
                        {formatShortDate(txn.date)} · {recordStatusLabel(txn.status || 'SOLD')}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={isGlass ? "block text-sm tabular-nums text-green-400" : "block text-sm font-medium tabular-nums text-[var(--dp-text-primary)]"}>${formatMoney(txn.revenue ?? 0)} <span className="text-[11px] font-normal text-[var(--dp-text-secondary)]">payout</span></span>
                      <span className={`block text-xs tabular-nums ${profitTextClass(getRowProfit(txn))}`}>{signedMoney(getRowProfit(txn))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            ) : (
            <div className={isGlass ? "overflow-x-auto pb-4" : "overflow-x-auto dp-scrollbar pb-4"}>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={isGlass ? "border-b border-white/10 text-xs font-semibold text-gray-500 uppercase tracking-wider" : "dp-neutral-head border-b border-[color:var(--dp-border)] text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>
                    {salesColumns.map(column => (
                      <th key={column.id} scope="col" className={`${column.id === 'product' ? 'pb-3 pr-4' : column.id === 'date' ? 'pb-3 pl-4' : 'pb-3 px-4'} font-medium`}>
                        {DEFAULT_DASHBOARD_SETTINGS.recentSalesColumns.find(c => c.id === column.id) && {
                          product: 'Product',
                          platform: 'Place Sold',
                          buyer: 'Buyer',
                          cost: 'Cost',
                          sale: 'Payout',
                          status: 'Status',
                          date: 'Date',
                        }[column.id]}
                      </th>
                    ))}
                    {!isGlass && <th scope="col" className="pb-3 px-4 font-medium">Profit</th>}
                  </tr>
                </thead>
                <tbody className={isGlass ? "text-sm divide-y divide-white/5" : "text-sm divide-y divide-[color:var(--dp-border)]"}>
                  {recent.map((txn, i) => (
                    <tr key={txn.id || i} onClick={() => openSale(txn)} className={isGlass ? "cursor-pointer hover:bg-white/[0.02] transition-colors" : "cursor-pointer hover:bg-[var(--dp-hover-bg)] transition-[background] duration-150"}>
                      {salesColumns.map(column => {
                        if (column.id === 'product') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pr-4 font-medium text-gray-200 max-w-[220px]" : "py-3 pr-4 font-semibold text-[var(--dp-text-primary)] max-w-[220px]"}>
                              {/* The row is clickable; this button is how a keyboard reaches it. */}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); openSale(txn); }}
                                className="block max-w-full truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)]"
                              >
                                {txn.product}
                                {txn.quantity > 1 && <span className="font-normal text-[var(--dp-text-secondary)]"> ×{txn.quantity}</span>}
                              </button>
                            </td>
                          );
                        }
                        if (column.id === 'platform') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400" : "py-3 px-4 text-[var(--dp-text-secondary)]"}>{txn.platform}</td>;
                        if (column.id === 'buyer') return <td key={column.id} className={isGlass ? "py-3 px-4 text-gray-400 text-xs" : "py-3 px-4 text-[var(--dp-text-secondary)] text-xs"}>{txn.buyer}</td>;
                        if (column.id === 'cost') return <td key={column.id} className={isGlass ? "py-3 px-4 text-blue-400" : "py-3 px-4 tabular-nums text-[var(--dp-text-primary)]"}>${formatMoney(txn.cost ?? 0)}</td>;
                        if (column.id === 'sale') return <td key={column.id} className={isGlass ? "py-3 px-4 text-green-400" : "py-3 px-4 tabular-nums text-[var(--dp-text-primary)]"}>${formatMoney(txn.revenue ?? 0)}</td>;
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
                          return (
                            <td key={column.id} className="py-3 px-4">
                              <span className={isGlass ? `inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase border ${cls}` : `inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold uppercase tracking-[0.04em] ${statusToneClass(st)}`}>
                                {recordStatusLabel(txn.status || 'SOLD')}
                              </span>
                            </td>
                          );
                        }
                        if (column.id === 'date') {
                          return (
                            <td key={column.id} className={isGlass ? "py-3 pl-4 text-gray-500 text-xs whitespace-nowrap" : "py-3 pl-4 text-[var(--dp-text-label)] text-[11px] whitespace-nowrap"}>
                              {isGlass ? new Date(txn.date).toLocaleDateString() : formatShortDate(txn.date)}
                            </td>
                          );
                        }
                        return null;
                      })}
                      {!isGlass && (
                        <td className="py-3 px-4">
                          <span title={txn.cashback ? `Includes $${formatMoney(txn.cashback)} cashback` : undefined} className={`inline-flex items-center rounded-full px-2.5 py-[3px] text-[11px] font-semibold tabular-nums ${profitPillClass(getRowProfit(txn))}`}>
                            {signedMoney(getRowProfit(txn))}
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {!isGlass && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <button
                  type="button"
                  onClick={() => navigate('/transactions', { state: { dateFilter, cardScope: 'sold', platformMode: modeFilter !== 'All' ? modeFilter : undefined } })}
                  className="inline-flex items-center gap-1 text-[13px] font-medium text-[var(--dp-text-primary)] hover:underline"
                >
                  View all sales <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                {/* Why a sale under cost can still show a small profit. */}
                <p className="text-[12px] text-[var(--dp-text-secondary)]">Profit includes the card cashback on each sale.</p>
              </div>
            )}
            </>
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
        <div key="statCards" className="grid h-full grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-[1.8fr_1fr_1fr_1fr_0.8fr] max-sm:[&>*:first-child]:col-span-2">
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
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all ${
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
              <ProfitCostTrendChart
                trend={trend}
                trendMeta={trendMeta}
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
          <h3 className="mb-5 text-[11px] font-bold uppercase tracking-[0.22em] text-white/22">Payment Cards</h3>
          <div className="space-y-3">
            {topCards.length === 0 ? (
              <p className="text-xs text-white/22">No payment data yet.</p>
            ) : topCards.slice(0, 3).map((card, index) => {
              const maxCardAmount = topCards.reduce((m, c) => Math.max(m, c.amount || 0), 1);
              return (
              <div key={card.name} className="rounded-2xl border border-white/[0.045] bg-white/[0.018] px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                  <div>
                    <p className="text-sm font-semibold text-[#e8e2d6]">{card.name}</p>
                    <p className="mt-1 text-[11px] text-white/22">{card.txns} txns</p>
                  </div>
                  <p className="whitespace-nowrap font-serif text-lg font-semibold text-[#d8a65a]">${formatMoney(card.amount)}</p>
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
            dateFilter={dateFilter} refreshing={refreshing}
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
            dateFilter={dateFilter} refreshing={refreshing}
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
            <h3 className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/22">Recent Sales</h3>
            <button onClick={() => navigate('/transactions')} className="rounded-lg border border-white/[0.05] bg-white/[0.025] px-3 py-1.5 text-[11px] text-white/24">View all -&gt;</button>
          </div>
          {recent.length === 0 ? (
            <p className="py-12 text-center font-serif text-sm italic text-white/18">No sales yet - start flipping.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-[color:var(--border-default)] text-[11px] font-bold uppercase tracking-wider text-white/18">
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
                      <td className="py-3 px-4 text-white/45">${formatMoney(txn.cost ?? 0)}</td>
                      <td className="py-3 px-4 text-[#d8a65a]">${formatMoney(txn.revenue ?? 0)}</td>
                      <td className="py-3 pl-4 text-[11px] font-bold uppercase tracking-wider text-white/35">{recordStatusLabel(txn.status || 'SOLD')}</td>
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
              <p className="mt-2 text-[11px] font-bold uppercase tracking-wider text-white/20">{item.label}</p>
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
      <div className="h-full overflow-auto theme-scrollbar w-full px-4 py-6 sm:px-6 max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-5 text-[#e8e2d6]">
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
                  onClick={() => chooseMode(mode)}
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

            <button
              aria-label="Dashboard settings"
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

        {/* Under the Status Pipeline (part of the grid above). */}
        <TodoSummary isGlass />

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

  // A failed refresh keeps the last good numbers on screen (see the bar below);
  // only a first load with nothing to show gets the full error card.
  if (isError && !data) {
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
    <div className="dp-dashboard h-full overflow-auto dp-scrollbar bg-[var(--dp-bg)] font-['Inter']">
      <div className="px-4 py-6 sm:px-6 w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-6">

      {/* Welcome Header */}
      {/* Phone: title and settings on one row, filters wrap underneath.
          Wider: title left, filters then settings on the right. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 animate-in fade-in duration-300">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--dp-text-primary)] [overflow-wrap:anywhere]">Welcome back, {user?.username || 'User'}</h1>
          <p className="text-[var(--dp-text-secondary)] text-[12px] mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden="true" /> {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading...'}
          </p>
        </div>

        <button
          type="button"
          data-tutorial-id="dashboard-settings-btn"
          onClick={() => setSettingsOpen(true)}
          aria-label="Dashboard settings"
          title="Dashboard settings"
          className="flex items-center justify-center w-9 h-9 rounded-full bg-[var(--dp-card-bg)] text-[var(--dp-text-secondary)] dp-elevated hover:text-[var(--dp-text-primary)] transition-colors sm:order-last"
        >
          <Settings className="w-4 h-4" aria-hidden="true" />
        </button>

        <div className="col-span-2 flex flex-wrap items-center gap-2 sm:ml-auto">
          {/* Mode Filters */}
          <div role="group" aria-label="Sales type" data-tutorial-id="dashboard-filters" className="flex items-center gap-1 rounded-full bg-[var(--dp-card-bg)] p-1 dp-elevated">
            {['All', 'Cashout', 'Marketplace'].map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={modeFilter === mode}
                onClick={() => chooseMode(mode)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-full transition-colors ${modeFilter === mode ? 'bg-[var(--dp-accent-bg)] font-semibold text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'}`}
              >
                {mode === 'All' && <Layers className="w-3.5 h-3.5" />}
                {mode === 'Cashout' && <Zap className="w-3.5 h-3.5" />}
                {mode === 'Marketplace' && <Store className="w-3.5 h-3.5" />}
                {mode}
              </button>
            ))}
          </div>

          <div className="hidden h-[14px] w-px bg-[var(--dp-border)] sm:block" />

          {/* Date Filters */}
          <div role="group" aria-label="Date range" className="flex items-center gap-1 rounded-full bg-[var(--dp-card-bg)] p-1 dp-elevated">
            <Calendar className="w-3.5 h-3.5 text-[var(--dp-text-label)] ml-1.5" aria-hidden="true" />
            {['7 Days', '30 Days', 'YTD', 'All Time'].map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={dateFilter === f}
                onClick={() => setDateFilter(f)}
                className={`px-[10px] py-1 text-[12px] font-medium rounded-full transition-colors ${dateFilter === f ? 'bg-[var(--dp-accent-bg)] font-semibold text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'}`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isError && data && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-red-bg)] px-4 py-3 text-[13px] text-[var(--dp-text-primary)]">
          <span>Couldn&apos;t refresh. These are the last numbers that loaded.</span>
          <button type="button" onClick={() => refetch()} className="rounded-full bg-[var(--dp-card-bg)] px-4 py-1.5 font-medium dp-elevated">Retry</button>
        </div>
      )}

      {/* "Needs attention": first on a phone; on wider screens right under
          the Status Pipeline, or at the top when the pipeline is hidden. */}
      {(isPhone || !showPipeline) && <TodoSummary />}
      {dashboardSections.map(section => (
        <React.Fragment key={section.id}>
          {renderDashboardSection(section.id)}
          {section.id === 'pipeline' && showPipeline && !isPhone && <TodoSummary />}
        </React.Fragment>
      ))}



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

function DashboardGoalsWidget({ goals, stats, isGlass, dateFilter, onNavigate, refreshing = false }) {
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
    : formatWholeDollars(v);

  return (
    <div className={`flex flex-col animate-in slide-in-from-bottom-4 duration-500 fade-in fill-mode-both h-full ${
      isGlass
        ? 'rounded-[20px] p-5 bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]'
        : 'rounded-[24px] p-[22px] bg-[var(--dp-card-bg)] dp-elevated'
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target size={12} className={isGlass ? 'text-[#d8a65a]' : 'text-[var(--dp-accent)]'} />
          <h3 className={isGlass
            ? 'text-[11px] font-medium uppercase tracking-[0.22em] text-white/25'
            : 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--dp-text-label)]'
          }>Goals</h3>
        </div>
        <button
          onClick={onNavigate}
          className={`text-[11px] transition-colors ${isGlass ? 'text-white/20 hover:text-[#d8a65a]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-accent)]'}`}
        >
          View all →
        </button>
      </div>

      {/* Carousel — grows to fill remaining height */}
      {/* Swipe left/right to change goal, same as the arrows. */}
      <SwipeArea className="flex flex-col flex-1 min-h-0" onPrev={() => setIdx((safeIdx - 1 + count) % count)} onNext={() => setIdx((safeIdx + 1) % count)}>
        {/* Big ring + label centred */}
        <div key={safeIdx} className="flex flex-col items-center justify-center flex-1 gap-2.5 page-transition">
          {/* Ring */}
          <div className="relative">
            <MiniProgressRing pct={progressPct} size={86} stroke={6} color={ringColor} isGlass={isGlass} />
            <div className="absolute inset-0 flex items-center justify-center">
              <IconComp size={18} className={isGlass ? 'text-white/30' : 'text-[var(--dp-text-secondary)]'} />
            </div>
          </div>

          {/* Metric name + pace */}
          <div className="text-center">
            <div className="flex items-center justify-center gap-2 mb-1">
              <p className={`text-[11px] font-medium uppercase tracking-[0.06em] ${isGlass ? 'text-white/30' : 'text-[var(--dp-text-label)]'}`}>
                {meta.label}
              </p>
              {paceLabel && (
                <span className={`text-[11px] font-semibold ${paceColor}`}>{paceLabel}</span>
              )}
            </div>

            {/* Current value */}
            <p className={`text-[20px] font-bold tabular-nums leading-tight ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]'}`}>
              <CountUp value={fmt(current)} pending={refreshing} />
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
              <p className={`text-[25px] font-bold tabular-nums leading-none mt-2.5 ${
                progressPct >= 100 ? (isGlass ? 'text-[#4ade80]' : 'text-[var(--dp-green-text)]')
                : progressPct >= 60  ? (isGlass ? 'text-[#6aaa8e]' : 'text-[var(--dp-green-text)]')
                : progressPct >= 35  ? (isGlass ? 'text-amber-400' : 'text-[#D9A512]')
                : (isGlass ? 'text-red-400' : 'text-[var(--dp-red-text)]')
              }`}>{Math.round(truePct)}%</p>
            )}
          </div>

          {/* Progress bar */}
          <div className={`w-full h-[5px] rounded-full overflow-hidden ${isGlass ? 'bg-white/[0.06]' : 'bg-[var(--dp-bg)]'}`}>
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: ringColor }}
            />
          </div>
        </div>

        {/* Nav arrows + dot indicators */}
        <PageNav count={count} index={safeIdx} onChange={setIdx} isGlass={isGlass} label="goal" />
      </SwipeArea>
    </div>
  );
}

function GlassTopMetricCard({ title, value, subtext, highlight, large, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`h-full min-h-[134px] rounded-[16px] border bg-[#181a1c]/72 p-6 text-left shadow-[0_10px_30px_rgba(0,0,0,0.18)] transition-colors hover:bg-[#1d1f21]/78 ${highlight ? 'border-[#d8a65a]/16' : 'border-white/[0.06]'}`}
    >
      <p className={`text-[11px] font-bold uppercase tracking-[0.22em] ${highlight ? 'text-[#d8a65a]/55' : 'text-white/20'}`}>{title}</p>
      <p className={`mt-3 font-serif font-light leading-none ${large ? 'text-4xl 3xl:text-5xl' : 'text-2xl 3xl:text-3xl'} ${highlight ? 'text-[#d8a65a]' : 'text-[#e8e2d6]'}`}>{value}</p>
      <p className="mt-3 text-[11px] font-semibold text-white/14">{subtext}</p>
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
      <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.22em] text-white/22">Pipeline</h3>
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
            className="rounded-lg border border-[#d8a65a]/14 bg-[#d8a65a]/8 px-3 py-1.5 text-[11px] font-semibold text-[#d8a65a]"
          >
            {card.label}: {card.count}
          </button>
        ))}
      </div>
      {overflow.length > 0 && (
        <div className="mt-4 border-t border-white/[0.04] pt-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-white/18">More Statuses</p>
          <div className="grid grid-cols-2 gap-2">
            {overflow.map(card => (
              <button
                key={card.id}
                onClick={() => navigateTo(card)}
                className="flex items-center justify-between rounded-lg border border-[color:var(--border-default)] bg-white/[0.018] px-2.5 py-2 text-left text-[11px] text-white/24 transition-colors hover:border-[#d8a65a]/14 hover:text-[#e8e2d6]"
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

function StatCard({ title, modeTag, value, subtext, icon, color, formula = [], breakdown, description, onClick, uiStyle = 'neon-dark', loading = false }) {
  const [open, setOpen] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState('bottom');
  const [popoverCoords, setPopoverCoords] = useState(null);
  const ref = useRef(null);
  const popoverRef = useRef(null);
  const infoRef = useRef(null);
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
    // Focus moves into the explanation so a screen reader reads it next.
    requestAnimationFrame(() => popoverRef.current?.focus());
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      setPopoverCoords(null);
      infoRef.current?.focus();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const colors = {
    blue: 'text-blue-400', green: 'text-green-400', pink: 'text-pink-400',
    emerald: 'text-emerald-400', purple: 'text-purple-400', cyan: 'text-cyan-400',
    orange: 'text-orange-400', red: 'text-red-400', violet: 'text-violet-400',
    sky: 'text-sky-400', yellow: 'text-yellow-400',
  };
  const textColor = isGlass ? (colors[color] || colors.purple) : 'text-[var(--dp-accent-text)]';
  const calculation = formula.join(' ');
  const glassTextColor = title === 'Net Profit' || title === 'Gross Profit' || title === 'Cashback'
    ? 'text-[#d8a65a]'
    : 'text-[#e8e2d6]';

  return (
    <div ref={ref} onClick={onClick} className={isGlass
      ? `relative overflow-visible rounded-[20px] bg-[#181a1c]/72 border border-white/[0.06] p-5 sm:p-6 shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-colors duration-200 hover:bg-[#1d1f21]/78 hover:border-white/[0.09] group${onClick ? ' cursor-pointer' : ''}`
      : `relative ${open ? 'z-[80]' : 'z-0'} overflow-visible rounded-[24px] p-6 group dp-elevated bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)] border border-[color:var(--dp-border)] ${onClick ? 'dp-clickable-card cursor-pointer' : 'dp-elevated-hover'}`
    }>
      {/* A real button under the content so the card can be reached with Tab
          and opened with Enter/Space; pointer taps go to the card itself. */}
      {onClick && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--dp-bg)]"
        >
          <span className="sr-only">{title}: see these transactions</span>
        </button>
      )}
      <div className="relative z-10 flex items-start justify-between">
        <div className="min-w-0">
          {/* One line, never wrapping: the mode tag sits small beside the title
              and is cut short if it doesn't fit, so the card keeps its height
              in All, Cashout and Marketplace. */}
          <p className={isGlass ? "flex items-baseline gap-1.5 min-w-0 whitespace-nowrap text-[11px] text-white/25 font-medium uppercase tracking-[0.2em]" : `flex items-baseline gap-1.5 min-w-0 whitespace-nowrap text-[11px] max-[359px]:tracking-normal font-medium uppercase tracking-[0.08em] dp-card-title transition-colors duration-300 text-[var(--dp-text-label)]`}>
            {/* Cut short with an ellipsis rather than spilling out of a narrow card. */}
            <span title={title} className="min-w-0 truncate">{title}</span>
            {modeTag && (
              <span title={modeTag} className={isGlass ? "min-w-0 truncate text-[9px] font-normal normal-case tracking-normal text-[var(--text-muted)]" : `min-w-0 truncate text-[9px] font-normal normal-case tracking-normal dp-card-tag transition-colors duration-300 text-[var(--dp-text-label)]`}>
                {modeTag}
              </span>
            )}
          </p>
          {/* While another filter loads, the last numbers stay up as they are;
              when the new ones arrive they count from the old value to the new
              one, up or down. Nothing fades or locks in between. */}
          <div aria-busy={loading || undefined}>
            <p className={isGlass ? `text-2xl 3xl:text-3xl font-light mt-2 ${glassTextColor}` : `mt-2 tabular-nums font-bold dp-card-value transition-colors duration-300 text-[22px] max-[359px]:text-[17px] text-[var(--dp-text-primary)]`}><CountUp value={value} pending={loading} /></p>
            <p className={isGlass ? "text-[11px] 3xl:text-xs text-white/18 mt-2" : `text-[12px] leading-snug mt-1 ${formula.length > 0 ? 'pr-5' : ''} dp-card-subtext transition-colors duration-300 text-[var(--dp-text-secondary)]`}>{subtext}</p>
          </div>
        </div>
        {isGlass && (
          <div className="w-9 h-9 3xl:w-11 3xl:h-11 rounded-xl bg-white/[0.035] border border-white/[0.05] flex items-center justify-center">
            <IconComponent className="w-4.5 h-4.5 3xl:w-5 3xl:h-5 text-[#d8a65a]" />
          </div>
        )}
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
            ref={infoRef}
            aria-label={`How ${title} is calculated`}
            aria-expanded={open}
            title="How this is calculated"
            className={isGlass
              ? "absolute bottom-2 right-2 z-20 w-5 h-5 flex items-center justify-center rounded-full text-gray-600 hover:text-gray-300 hover:bg-white/10 transition-colors"
              // A 44px invisible tap zone around the small icon.
              : `absolute bottom-3 right-3 z-20 w-5 h-5 flex items-center justify-center rounded-full transition-colors dp-card-info-btn text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] hover:bg-[var(--dp-bg)] after:absolute after:-inset-3 after:content-['']`
            }
          >
            <Info className="w-3 h-3" aria-hidden="true" />
          </button>
          {open && popoverCoords && createPortal(
            <div
              ref={popoverRef}
              tabIndex={-1}
              role="dialog"
              aria-label={`How ${title} is calculated`}
              className={`fixed w-[280px] rounded-2xl outline-none ${isGlass ? 'bg-[#1a1c23] border-white/10 shadow-2xl' : 'bg-[var(--dp-card-bg)] border-[color:var(--dp-border)] dp-elevated'} border p-4 z-[9999] animate-in fade-in duration-150 ${
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
              <p className={isGlass ? `text-[11px] font-medium uppercase tracking-[0.8px] ${textColor}` : `text-[11px] font-semibold uppercase tracking-[0.06em] ${textColor}`}>{title}</p>
              <div className="mt-3 space-y-3">
                <div>
                  <p className={isGlass ? "text-[11px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]" : "text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>Calculation</p>
                  <p className={isGlass ? "mt-1 text-xs font-semibold leading-relaxed text-[var(--text-primary)]" : "mt-1 text-xs font-semibold leading-relaxed text-[var(--dp-text-primary)]"}>{calculation}</p>
                </div>
                {breakdown && (
                  <div>
                    <p className={isGlass ? "text-[11px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]" : "text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>This period</p>
                    <p className={isGlass ? "mt-1 text-xs font-semibold tabular-nums leading-relaxed text-[var(--text-primary)]" : "mt-1 text-xs font-semibold tabular-nums leading-relaxed text-[var(--dp-text-primary)]"}>{breakdown}</p>
                  </div>
                )}
                <div>
                  <p className={isGlass ? "text-[11px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]" : "text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--dp-text-label)]"}>Meaning</p>
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
