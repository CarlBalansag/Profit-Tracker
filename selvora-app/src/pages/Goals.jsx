import React, { useState, useMemo } from 'react';
import { Target, Pencil, TrendingUp, DollarSign, ShoppingBag, X, Flame, Eye, EyeOff } from 'lucide-react';
import { useGoals, useGoalsMutations, useDashboard } from '../hooks/useApi';
import { useUiPreferences } from '../hooks/useUiPreferences';
import { PageLoader } from '../components/PageLoader';

// ── Constants ─────────────────────────────────────────────────────────────────

const METRIC_OPTIONS = [
  { value: 'netProfit',    label: 'Net Profit',  icon: TrendingUp,  prefix: '$', suffix: ''       },
  { value: 'totalRevenue', label: 'Revenue',      icon: DollarSign,  prefix: '$', suffix: ''       },
  { value: 'unitsSold',    label: 'Units Sold',   icon: ShoppingBag, prefix: '',  suffix: ' units' },
];

const PERIOD_OPTIONS = [
  { value: '7 Days',  label: '7 Days',  field: 'target_7d'  },
  { value: '30 Days', label: '30 Days', field: 'target_30d' },
  { value: 'YTD',     label: 'YTD',     field: 'target_ytd' },
];

// Get the target value for a given period from a goal record
function getTargetForPeriod(goal, period) {
  if (!goal) return null;
  if (period === '7 Days')  return goal.target_7d  ?? null;
  if (period === '30 Days') return goal.target_30d ?? null;
  if (period === 'YTD')     return goal.target_ytd ?? null;
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getCurrentValue(stats, metric) {
  if (metric === 'netProfit')    return Number(stats?.profit)       || 0;
  if (metric === 'totalRevenue') return Number(stats?.totalRevenue) || 0;
  if (metric === 'unitsSold')    return Number(stats?.unitsSold)    || 0;
  return 0;
}

function calcStreak(trend, metric, target, period) {
  if (!Array.isArray(trend) || trend.length === 0 || !target) return 0;

  const getBucketKey = (dateStr) => {
    if (period === 'YTD')     return dateStr.slice(0, 4);
    if (period === '30 Days') return dateStr.slice(0, 7);
    // 7 Days — ISO week
    const d = new Date(dateStr + (dateStr.length === 7 ? '-01' : ''));
    const thu = new Date(d);
    thu.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3);
    const ft = new Date(thu.getFullYear(), 0, 4);
    const week = Math.round(((thu - ft) / 86400000 + (ft.getDay() + 6) % 7) / 7) + 1;
    return `${thu.getFullYear()}-W${String(week).padStart(2, '0')}`;
  };

  const field = metric === 'netProfit' ? 'netProfit' : metric === 'totalRevenue' ? 'totalRevenue' : 'unitsSold';
  const buckets = new Map();
  for (const pt of trend) {
    const k = getBucketKey(pt.date);
    buckets.set(k, (buckets.get(k) || 0) + (Number(pt[field]) || 0));
  }

  const sorted = [...buckets.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const [, ...prev] = sorted;
  let streak = 0;
  for (const [, val] of prev) {
    if (val >= target) streak++;
    else break;
  }
  return streak;
}

// ── Pill Radio ────────────────────────────────────────────────────────────────

function PillRadio({ options, value, onChange, isGlass, size = 'md' }) {
  const isSmall = size === 'sm';
  return (
    <div className={`relative flex rounded-xl p-0.5 ${isGlass
      ? 'bg-white/[0.04] border border-white/[0.07]'
      : 'bg-[var(--bg-elevated)] border border-[color:var(--border-default)]'
    }`}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`relative flex-1 rounded-[9px] transition-all duration-200 font-medium select-none ${
              isSmall ? 'py-1 text-[10px]' : 'py-1.5 text-[11px]'
            } ${active
              ? isGlass
                ? 'bg-[#d8a65a]/20 text-[#d8a65a] shadow-sm'
                : 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-sm border border-[color:var(--border-default)]'
              : isGlass
                ? 'text-white/30 hover:text-white/50'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Progress ring ─────────────────────────────────────────────────────────────

function ProgressRing({ pct, size = 84, stroke = 7, color }) {
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, pct)) / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={stroke} />
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

function PaceBadge({ status, isGlass }) {
  const cfg = {
    ahead:  { label: 'Ahead of pace', cls: isGlass ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--green-bg)] text-[var(--green-soft)]' },
    on:     { label: 'On pace',        cls: isGlass ? 'bg-blue-500/15 text-blue-400'      : 'bg-[var(--accent-bg)] text-[var(--accent-soft)]' },
    behind: { label: 'Behind pace',    cls: isGlass ? 'bg-amber-500/15 text-amber-400'    : 'bg-yellow-500/10 text-yellow-400' },
    off:    { label: 'Off track',      cls: isGlass ? 'bg-red-500/15 text-red-400'        : 'bg-red-500/10 text-red-400' },
    nodata: { label: 'No target set',  cls: isGlass ? 'bg-white/5 text-white/30'          : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]' },
  };
  const { label, cls } = cfg[status] || cfg.nodata;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${cls}`}>
      {label}
    </span>
  );
}

// ── Goal Form Modal ────────────────────────────────────────────────────────────
// Each tab has its own independent input. Switching tabs shows/edits that period's value.

function GoalModal({ goal, onSave, onClose, isGlass, isSaving }) {
  const metaDef = METRIC_OPTIONS.find(m => m.value === goal.metric) || METRIC_OPTIONS[0];

  const [tab, setTab] = useState('30 Days');

  // Independent input per period, pre-filled from existing goal data
  const [inputs, setInputs] = useState({
    '7 Days':  goal.target_7d  != null ? String(goal.target_7d)  : '',
    '30 Days': goal.target_30d != null ? String(goal.target_30d) : '',
    'YTD':     goal.target_ytd != null ? String(goal.target_ytd) : '',
  });
  const [error, setError] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    // At least one period must have a value
    const has7d  = inputs['7 Days']  !== '' && !isNaN(parseFloat(inputs['7 Days']))  && parseFloat(inputs['7 Days'])  > 0;
    const has30d = inputs['30 Days'] !== '' && !isNaN(parseFloat(inputs['30 Days'])) && parseFloat(inputs['30 Days']) > 0;
    const hasYtd = inputs['YTD']     !== '' && !isNaN(parseFloat(inputs['YTD']))     && parseFloat(inputs['YTD'])     > 0;

    if (!has7d && !has30d && !hasYtd) {
      setError('Set a target for at least one period.');
      return;
    }
    setError('');
    onSave({
      metric:     goal.metric,
      target_7d:  has7d  ? parseFloat(inputs['7 Days'])  : null,
      target_30d: has30d ? parseFloat(inputs['30 Days']) : null,
      target_ytd: hasYtd ? parseFloat(inputs['YTD'])     : null,
    });
  }

  const inputCls = isGlass
    ? 'w-full rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2.5 text-sm text-[#e8e2d6] placeholder-white/20 focus:outline-none focus:border-[#d8a65a]/40'
    : 'w-full rounded-md border border-[color:var(--border-default)] bg-[var(--bg-elevated)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[color:var(--accent)]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className={`w-full max-w-sm rounded-2xl p-6 shadow-2xl ${isGlass ? 'bg-[#1a1c1e] border border-white/[0.08]' : 'bg-[var(--bg-surface)] border border-[color:var(--border-default)]'}`}>
        <div className="flex items-center justify-between mb-5">
          <h2 className={isGlass ? 'text-base font-semibold text-[#e8e2d6]' : 'text-[14px] font-semibold text-[var(--text-primary)]'}>
            Set {metaDef.label} Goal
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <PillRadio
            options={PERIOD_OPTIONS}
            value={tab}
            onChange={setTab}
            isGlass={isGlass}
          />

          <div>
            <label className={isGlass
              ? 'block text-[10px] font-semibold uppercase tracking-wider text-white/30 mb-1.5'
              : 'block text-[10px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)] mb-1.5'
            }>
              {tab} target{metaDef.prefix ? ` (${metaDef.prefix})` : metaDef.suffix.trim() ? ` (${metaDef.suffix.trim()})` : ''}
            </label>
            <input
              key={tab}
              className={inputCls}
              type="number"
              min="0.01"
              step="any"
              placeholder={metaDef.value === 'unitsSold' ? 'e.g. 20' : 'e.g. 500'}
              value={inputs[tab]}
              onChange={e => setInputs(prev => ({ ...prev, [tab]: e.target.value }))}
              autoFocus
            />
          </div>

          {/* Summary of all set targets */}
          {(inputs['7 Days'] || inputs['30 Days'] || inputs['YTD']) && (
            <div className={`rounded-xl px-3 py-2.5 space-y-1 ${isGlass ? 'bg-white/[0.03] border border-white/[0.05]' : 'bg-[var(--bg-elevated)]'}`}>
              {PERIOD_OPTIONS.map(p => {
                const val = inputs[p.value];
                const num = parseFloat(val);
                if (!val || isNaN(num) || num <= 0) return null;
                return (
                  <div key={p.value} className="flex justify-between">
                    <span className={`text-[10px] ${isGlass ? 'text-white/30' : 'text-[var(--text-muted)]'}`}>{p.label}</span>
                    <span className={`text-[10px] font-semibold ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--text-primary)]'}`}>
                      {metaDef.prefix}{num.toLocaleString()}{metaDef.suffix}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${isGlass ? 'bg-white/[0.04] text-white/40 hover:bg-white/[0.08]' : 'bg-[var(--bg-elevated)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
              Cancel
            </button>
            <button type="submit" disabled={isSaving} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${isGlass ? 'bg-[#d8a65a]/20 text-[#d8a65a] hover:bg-[#d8a65a]/30 border border-[#d8a65a]/20' : 'bg-[var(--accent)] text-white hover:opacity-90'}`}>
              {isSaving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Goal Card ─────────────────────────────────────────────────────────────────

function GoalCard({ metaDef, goal, getStats, trend, isGlass, onEdit, onToggleActive }) {
  const IconComp = metaDef.icon;

  const [viewPeriod, setViewPeriod] = useState('30 Days');

  const periodTarget = getTargetForPeriod(goal, viewPeriod);
  const hasTarget    = periodTarget != null && periodTarget > 0;

  const stats   = getStats(viewPeriod);
  const current = getCurrentValue(stats, metaDef.value);

  const progressPct = hasTarget ? Math.min(100, (current / periodTarget) * 100) : 0;

  // Simple pace: for rolling windows (7d, 30d) we're always "in the window" so compare directly
  // For YTD use elapsed days of year
  let elapsedPct = 100;
  if (viewPeriod === 'YTD') {
    const now   = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const total = now.getFullYear() % 4 === 0 ? 366 : 365;
    elapsedPct  = Math.min(100, (Math.max(1, Math.round((now - start) / 86400000)) / total) * 100);
  }

  let paceStatus = 'nodata';
  if (hasTarget) {
    if (progressPct >= 100)                    paceStatus = 'ahead';
    else if (progressPct >= elapsedPct)        paceStatus = 'ahead';
    else if (progressPct >= elapsedPct * 0.75) paceStatus = 'on';
    else if (progressPct >= elapsedPct * 0.4)  paceStatus = 'behind';
    else                                        paceStatus = 'off';
  }

  const streak = useMemo(
    () => hasTarget ? calcStreak(trend || [], metaDef.value, periodTarget, viewPeriod) : 0,
    [trend, metaDef.value, periodTarget, viewPeriod, hasTarget],
  );

  const ringColor = !hasTarget
    ? (isGlass ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.15)')
    : progressPct >= 100              ? '#4ade80'
    : paceStatus === 'ahead'          ? (isGlass ? '#6aaa8e' : '#4ade80')
    : paceStatus === 'on'             ? (isGlass ? '#5b8fc7' : '#60a5fa')
    : paceStatus === 'behind'         ? '#fbbf24'
    : '#f87171';

  const fmt = (v) => metaDef.value === 'unitsSold'
    ? Math.round(v).toLocaleString()
    : `$${Math.round(v).toLocaleString()}`;

  const isHidden = goal?.active === false;

  return (
    <div className={`relative flex flex-col rounded-2xl p-5 transition-opacity duration-300 ${
      isHidden ? 'opacity-35' : 'opacity-100'
    } ${isGlass
      ? 'bg-[#181a1c]/72 border border-white/[0.06] shadow-[0_10px_30px_rgba(0,0,0,0.22)]'
      : 'bg-[var(--bg-surface)] border border-[color:var(--border-default)]'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${isGlass ? 'bg-white/[0.05] border border-white/[0.06]' : 'bg-[var(--bg-elevated)]'}`}>
            <IconComp size={15} className={isGlass ? 'text-[#d8a65a]' : 'text-[var(--accent)]'} />
          </div>
          <p className={`text-[12px] font-semibold ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--text-primary)]'}`}>
            {metaDef.label}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {goal?.id && (
            <button
              onClick={onToggleActive}
              title={isHidden ? 'Show goal' : 'Hide goal'}
              className={`rounded-lg p-1.5 transition-colors ${isGlass ? 'text-white/25 hover:text-[#e8e2d6] hover:bg-white/[0.06]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
            >
              {isHidden ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
          )}
          <button
            onClick={onEdit}
            className={`rounded-lg p-1.5 transition-colors ${isGlass ? 'text-white/25 hover:text-[#e8e2d6] hover:bg-white/[0.06]' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'}`}
          >
            <Pencil size={13} />
          </button>
        </div>
      </div>

      {/* Period pill switcher */}
      <div className="mb-4">
        <PillRadio
          options={PERIOD_OPTIONS}
          value={viewPeriod}
          onChange={setViewPeriod}
          isGlass={isGlass}
          size="sm"
        />
      </div>

      {/* Progress ring + values */}
      <div className="flex items-center gap-5 mb-4">
        <div className="relative flex-shrink-0">
          <ProgressRing pct={progressPct} size={84} stroke={7} color={ringColor} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className={`text-[13px] font-bold tabular-nums ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--text-primary)]'}`}>
              {hasTarget ? `${Math.round(progressPct)}%` : '—'}
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div>
            <p className={`text-[10px] ${isGlass ? 'text-white/25' : 'text-[var(--text-muted)]'}`}>Current</p>
            <p className={`text-xl font-semibold tabular-nums ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--text-primary)]'}`}>
              {fmt(current)}
            </p>
          </div>
          <div>
            <p className={`text-[10px] ${isGlass ? 'text-white/25' : 'text-[var(--text-muted)]'}`}>Target</p>
            <p className={`text-sm tabular-nums ${isGlass ? 'text-white/40' : 'text-[var(--text-secondary)]'}`}>
              {hasTarget
                ? fmt(periodTarget)
                : <span className={isGlass ? 'text-white/20' : 'text-[var(--text-muted)]'}>Not set</span>
              }
            </p>
          </div>
        </div>
      </div>

      {/* Pace badge */}
      <PaceBadge status={paceStatus} isGlass={isGlass} />

      {/* Stats row */}
      <div className={`mt-4 grid grid-cols-2 gap-2 rounded-xl p-3 ${isGlass ? 'bg-white/[0.03] border border-white/[0.05]' : 'bg-[var(--bg-elevated)]'}`}>
        <div className="text-center">
          <p className={`text-[9px] font-medium uppercase tracking-wider mb-0.5 ${isGlass ? 'text-white/22' : 'text-[var(--text-muted)]'}`}>Period</p>
          <p className={`text-[11px] font-semibold tabular-nums ${isGlass ? 'text-[#e8e2d6]' : 'text-[var(--text-primary)]'}`}>
            {viewPeriod}
          </p>
        </div>
        <div className="text-center">
          <p className={`text-[9px] font-medium uppercase tracking-wider mb-0.5 ${isGlass ? 'text-white/22' : 'text-[var(--text-muted)]'}`}>Streak</p>
          <p className={`text-[11px] font-semibold tabular-nums flex items-center justify-center gap-0.5 ${isGlass ? 'text-[#d8a65a]' : 'text-[var(--accent)]'}`}>
            {streak > 0 ? <><Flame size={11} />{streak}</> : '—'}
          </p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mt-3">
        <div className={`relative h-1 rounded-full overflow-hidden ${isGlass ? 'bg-white/[0.06]' : 'bg-[var(--bg-elevated)]'}`}>
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700"
            style={{ width: `${progressPct}%`, background: ringColor }}
          />
        </div>
        <div className="flex justify-end mt-1">
          <p className={`text-[9px] ${isGlass ? 'text-white/18' : 'text-[var(--text-muted)]'}`}>
            {hasTarget ? `${Math.round(progressPct)}% of goal` : 'Set a target to track progress'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Stats data provider ───────────────────────────────────────────────────────

function GoalsStatsProvider({ children }) {
  const sevenDay  = useDashboard('All', '7 Days');
  const thirtyDay = useDashboard('All', '30 Days');
  const ytd       = useDashboard('All', 'YTD');

  function getStats(period) {
    if (period === '7 Days')  return sevenDay.data?.stats;
    if (period === '30 Days') return thirtyDay.data?.stats;
    return ytd.data?.stats;
  }

  return children(getStats);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Goals() {
  const { preferences } = useUiPreferences();
  const isGlass = preferences.style === 'glassmorphism-brown';

  const { data: goals = [], isLoading } = useGoals();
  const { create, update } = useGoalsMutations();

  const { data: allTimeData } = useDashboard('All', 'All Time');
  const trend = allTimeData?.trend || [];

  const [editingMetric, setEditingMetric] = useState(null);

  // One goal record per metric
  const goalByMetric = useMemo(() => {
    const map = {};
    for (const g of goals) {
      if (!map[g.metric] || (!map[g.metric].active && g.active)) {
        map[g.metric] = g;
      }
    }
    return map;
  }, [goals]);

  function handleSave(formData) {
    const existing = goalByMetric[formData.metric];
    if (existing) {
      update.mutate({ id: existing.id, ...formData }, { onSuccess: () => setEditingMetric(null) });
    } else {
      create.mutate({ ...formData, active: true }, { onSuccess: () => setEditingMetric(null) });
    }
  }

  function handleToggleActive(goal) {
    update.mutate({ id: goal.id, active: !goal.active });
  }

  if (isLoading) return <PageLoader />;

  const isSaving = create.isPending || update.isPending;
  const editingGoal = editingMetric
    ? (goalByMetric[editingMetric] || { metric: editingMetric, target_7d: null, target_30d: null, target_ytd: null })
    : null;

  return (
    <div className={`h-full overflow-auto theme-scrollbar px-4 py-6 sm:px-6 w-full max-w-[1400px] mx-auto space-y-6 ${isGlass ? 'text-[#e8e2d6]' : 'bg-[var(--bg-base)]'}`}>
      <div className="animate-in fade-in duration-300">
        <div className="flex items-center gap-2.5">
          <Target size={20} className={isGlass ? 'text-[#d8a65a]' : 'text-[var(--accent)]'} />
          <h1 className={isGlass ? 'text-3xl font-light tracking-tight text-[#e8e2d6]' : 'text-[18px] font-medium tracking-[-0.3px] text-[var(--text-primary)]'}>
            Goals
          </h1>
        </div>
        <p className={`mt-1 text-[11px] ${isGlass ? 'text-white/25' : 'text-[var(--text-muted)]'}`}>
          Track your profit, revenue, and sales targets over time
        </p>
      </div>

      <GoalsStatsProvider>
        {(getStats) => (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {METRIC_OPTIONS.map(metaDef => {
              const goal = goalByMetric[metaDef.value] || null;
              return (
                <GoalCard
                  key={metaDef.value}
                  metaDef={metaDef}
                  goal={goal}
                  getStats={getStats}
                  trend={trend}
                  isGlass={isGlass}
                  onEdit={() => setEditingMetric(metaDef.value)}
                  onToggleActive={goal ? () => handleToggleActive(goal) : undefined}
                />
              );
            })}
          </div>
        )}
      </GoalsStatsProvider>

      {editingMetric && (
        <GoalModal
          goal={editingGoal}
          onSave={handleSave}
          onClose={() => setEditingMetric(null)}
          isGlass={isGlass}
          isSaving={isSaving}
        />
      )}
    </div>
  );
}
