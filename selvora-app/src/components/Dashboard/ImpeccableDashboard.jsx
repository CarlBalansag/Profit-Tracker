import React from 'react';
import { Clock, Share2, Settings, CreditCard, Target, TrendingUp, DollarSign, ShoppingBag } from 'lucide-react';
import { Section } from '../Impeccable/Section';
import { Row } from '../Impeccable/Row';
import { StatRow } from '../Impeccable/StatRow';
import { Tabs } from '../Impeccable/Tabs';
import DashboardSettingsModal from '../DashboardSettingsModal';
import ProfitRevenueTrendChart from './ProfitRevenueTrendChart';
import MonthlyProfitSpendChart from './MonthlyProfitSpendChart';

const GOAL_METRIC_META = {
  netProfit: { label: 'Net Profit', icon: TrendingUp, prefix: '$' },
  totalRevenue: { label: 'Revenue', icon: DollarSign, prefix: '$' },
  unitsSold: { label: 'Units Sold', icon: ShoppingBag, prefix: '' },
};

function getTargetForFilter(goal, dateFilter) {
  if (dateFilter === '7 Days') return goal.target_7d ?? null;
  if (dateFilter === '30 Days') return goal.target_30d ?? null;
  if (dateFilter === 'YTD') return goal.target_ytd ?? null;
  const candidates = [goal.target_7d, goal.target_30d, goal.target_ytd].filter(v => v != null);
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

function getCurrentGoalValue(stats, metric) {
  if (metric === 'netProfit') return Number(stats?.profit) || 0;
  if (metric === 'totalRevenue') return Number(stats?.totalRevenue) || 0;
  if (metric === 'unitsSold') return Number(stats?.unitsSold) || 0;
  return 0;
}

function formatShortDate(dateValue) {
  if (!dateValue) return '';
  return new Date(dateValue).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getRowProfit(txn) {
  if (typeof txn.profit === 'number') return txn.profit;
  return (Number(txn.revenue) || 0) - (Number(txn.cost) || 0);
}

const MODE_TABS = [
  { id: 'All', label: 'All' },
  { id: 'Cashout', label: 'Cashout' },
  { id: 'Marketplace', label: 'Marketplace' },
];
const DATE_TABS = [
  { id: '7 Days', label: '7 Days' },
  { id: '30 Days', label: '30 Days' },
  { id: 'YTD', label: 'YTD' },
  { id: 'All Time', label: 'All Time' },
];

export function ImpeccableDashboard({
  user, lastUpdated, isLoading,
  modeFilter, setModeFilter, dateFilter, setDateFilter,
  settingsOpen, setSettingsOpen, settings, saveSettings, uiStyle, navigate,
  stats, pipeline, topCards, trend, trendMeta, recent,
  visibleStatCards, statCardRegistry,
  visiblePipelineCards, pipelineCardRegistry,
  visibleChartSeries, showTrendChart,
  showRecentSales,
  showPaymentMethods, showPipeline, showStatCards,
  activeGoals, showGoalsWidget,
  trendMode, setTrendMode, chartView, setChartView,
}) {
  const statItems = showStatCards
    ? visibleStatCards.map((cardConfig) => {
      const def = statCardRegistry[cardConfig.id];
      if (!def) return null;
      const isProfitLike = cardConfig.id === 'profit' || cardConfig.id === 'grossProfit';
      const value = def.getValue(stats);
      const color = isProfitLike
        ? (stats.profit < 0 ? 'var(--red)' : 'var(--green)')
        : undefined;
      return { id: cardConfig.id, label: def.label, value, sublabel: def.getSubtext(stats), color };
    }).filter(Boolean)
    : [];

  return (
    <div className="h-full overflow-auto theme-scrollbar px-4 py-5 sm:px-6 w-full max-w-[1800px] 4xl:max-w-[2100px] mx-auto space-y-5 bg-[var(--bg-base)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[20px] font-semibold text-[var(--text-primary)]">Welcome back, {user?.username || 'User'}</h1>
          <p className="text-[var(--text-muted)] text-[11px] mt-1 flex items-center gap-1">
            <Clock className="w-3 h-3" /> {lastUpdated ? `Updated at ${lastUpdated.toLocaleTimeString()}` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-[4px] text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <Share2 className="w-3.5 h-3.5" /> Share
          </button>
          <button
            data-tutorial-id="dashboard-settings-btn"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center justify-center w-8 h-8 rounded-[4px] border border-[color:var(--border-default)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            title="Dashboard Settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div data-tutorial-id="dashboard-filters" className="flex flex-wrap items-center gap-6">
        <Tabs tabs={MODE_TABS} active={modeFilter} onChange={setModeFilter} />
        <Tabs tabs={DATE_TABS} active={dateFilter} onChange={setDateFilter} />
      </div>

      {showStatCards && statItems.length > 0 && (
        <Section data-tutorial-id="dashboard-stats">
          <StatRow items={statItems} />
        </Section>
      )}

      {showPipeline && visiblePipelineCards.length > 0 && (
        <Section title="Pipeline" data-tutorial-id="dashboard-pipeline">
          {visiblePipelineCards.map((cardConfig) => {
            const def = pipelineCardRegistry[cardConfig.id];
            if (!def) return null;
            return (
              <Row
                key={cardConfig.id}
                icon={def.icon}
                label={def.label}
                value={pipeline[cardConfig.id] || 0}
                onClick={() => navigate('/transactions', {
                  state: {
                    status: cardConfig.id,
                    dateFilter: dateFilter || undefined,
                    platformMode: modeFilter && modeFilter !== 'All' ? modeFilter : undefined,
                  },
                })}
              />
            );
          })}
        </Section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]" data-tutorial-id="dashboard-chart">
        {showTrendChart && (
          <Section
            title={chartView === 'bar' ? 'Monthly Profit vs Spending' : 'Profit & Cost Trend'}
            action={
              <div className="flex gap-0.5 p-0.5 rounded-[4px] border border-[color:var(--border-default)]">
                {[['line', 'Line'], ['bar', 'Bar']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setChartView(val)}
                    className={`px-2.5 py-1 rounded-[3px] text-[10px] font-medium transition-colors ${
                      chartView === val
                        ? 'bg-[var(--accent-bg)] text-[var(--accent)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
            bare
          >
            <div className="min-h-[320px] flex flex-col">
              {isLoading ? (
                <div className="flex h-full min-h-[280px] items-center justify-center text-sm text-[var(--text-muted)]">Loading trend...</div>
              ) : chartView === 'bar' ? (
                <MonthlyProfitSpendChart trend={trend} uiStyle={uiStyle} />
              ) : (
                <ProfitRevenueTrendChart
                  stats={stats}
                  trend={trend}
                  trendMeta={trendMeta}
                  recent={recent}
                  dateFilter={dateFilter}
                  chartSeries={visibleChartSeries}
                  uiStyle={uiStyle}
                  trendMode={trendMode}
                  onTrendModeChange={setTrendMode}
                />
              )}
            </div>
          </Section>
        )}

        {(showGoalsWidget || showPaymentMethods) && (
          <div className="flex flex-col gap-4">
            {showGoalsWidget && (
              <Section title="Goals">
                {activeGoals.map((goal) => {
                  const meta = GOAL_METRIC_META[goal.metric] || GOAL_METRIC_META.netProfit;
                  const target = getTargetForFilter(goal, dateFilter);
                  const current = getCurrentGoalValue(stats, goal.metric);
                  return (
                    <Row
                      key={goal.id}
                      icon={meta.icon}
                      label={goal.name || meta.label}
                      sublabel={target != null ? `${meta.prefix}${current.toFixed(0)} of ${meta.prefix}${target.toFixed(0)}` : `${meta.prefix}${current.toFixed(0)}`}
                      value={target != null ? `${Math.min(100, Math.round((current / target) * 100))}%` : ''}
                      onClick={() => navigate('/goals')}
                    />
                  );
                })}
              </Section>
            )}
            {showPaymentMethods && (
              <Section title="Top Cards">
                {topCards.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No payment data yet.</p>
                ) : topCards.map((card, i) => (
                  <Row
                    key={i}
                    icon={CreditCard}
                    label={card.name}
                    sublabel={`${card.txns} txns`}
                    value={`$${card.amount.toFixed(0)}`}
                  />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>

      {showRecentSales && (
        <Section title="Recent Sales">
          {recent.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-[var(--text-muted)]">No recent sales found.</p>
          ) : recent.map((txn, i) => {
            const profit = getRowProfit(txn);
            return (
              <Row
                key={i}
                label={txn.product}
                sublabel={`${txn.platform || ''}${txn.platform && txn.date ? ' · ' : ''}${txn.date ? formatShortDate(txn.date) : ''}`}
                value={`${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(0)}`}
                valueColor={profit >= 0 ? 'var(--green)' : 'var(--red)'}
              />
            );
          })}
        </Section>
      )}

      {settingsOpen && (
        <DashboardSettingsModal
          settings={settings}
          uiStyle={uiStyle}
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

export default ImpeccableDashboard;
