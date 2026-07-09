import React, { useEffect, useRef, useState } from 'react';

const ECHARTS_CDN = 'https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js';

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

function loadECharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-echarts-loader="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.echarts), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = ECHARTS_CDN;
    script.async = true;
    script.dataset.echartsLoader = 'true';
    script.onload = () => resolve(window.echarts);
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function readThemeVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

// Aggregate daily or monthly trend points into monthly buckets
function toMonthlyBuckets(trend) {
  const buckets = new Map();
  for (const point of trend) {
    const key = point.date.length === 7 ? point.date : point.date.slice(0, 7);
    if (!buckets.has(key)) {
      buckets.set(key, { date: key, netProfit: 0, totalCost: 0, cashback: 0, totalTax: 0 });
    }
    const b = buckets.get(key);
    b.netProfit  += Number(point.netProfit)  || 0;
    b.totalCost  += Number(point.totalCost)  || 0;
    b.cashback   += Number(point.cashback)   || 0;
    b.totalTax   += Number(point.totalTax)   || 0;
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function formatMonthLabel(dateKey) {
  const [year, month] = dateKey.split('-');
  return new Date(Number(year), Number(month) - 1, 1)
    .toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function buildOptions(points, uiStyle) {
  const isGlass = uiStyle === 'glassmorphism-brown';

  const GREEN  = isGlass ? '#6aaa8e' : '#4ade80';
  const RED    = isGlass ? '#c47a5a' : '#f87171';
  const BLUE   = isGlass ? '#5b8fc7' : '#60a5fa';
  const AMBER  = isGlass ? '#c9a84c' : '#fbbf24';

  const textMuted      = isGlass ? 'rgba(232,226,214,0.32)' : readThemeVar('--text-muted', '#606060');
  const textPrimary    = isGlass ? '#e8e2d6'                : readThemeVar('--text-primary', '#d0d0d0');
  const textSecondary  = isGlass ? 'rgba(232,226,214,0.38)' : readThemeVar('--text-secondary', '#6e6e6e');
  const borderColor    = isGlass ? 'rgba(232,226,214,0.08)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)');
  const tooltipBg      = isGlass ? 'rgba(20,17,14,0.96)'   : readThemeVar('--bg-surface', '#121212');
  const tooltipBorder  = isGlass ? 'rgba(216,166,90,0.16)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)');
  const splitLineColor = isGlass ? 'rgba(232,226,214,0.07)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)');

  const labels      = points.map(p => formatMonthLabel(p.date));
  const profitData  = points.map(p => Math.round(p.netProfit));
  const spendData   = points.map(p => Math.round(p.totalCost));
  const cashData    = points.map(p => Math.round(p.cashback));
  const taxData     = points.map(p => Math.round(p.totalTax));

  const SERIES = [
    { name: 'Net Profit', color: GREEN,  data: profitData },
    { name: 'Spending',   color: RED,    data: spendData  },
    { name: 'Cashback',   color: BLUE,   data: cashData   },
    { name: 'Tax',        color: AMBER,  data: taxData    },
  ];

  return {
    backgroundColor: 'transparent',
    animationDuration: 700,
    animationEasing: 'cubicOut',
    grid: {
      left: 52,
      right: 12,
      top: 32,
      bottom: 40,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      padding: [10, 14],
      extraCssText: isGlass ? 'border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,0.32);' : undefined,
      textStyle: { color: textPrimary, fontSize: 12 },
      formatter: params => {
        const label = params[0]?.axisValue ?? '';
        // Only show series that are not hidden via legend
        const lines = params
          .filter(item => item.value !== undefined && item.value !== null)
          .map(item =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;margin:4px 0">
              <span>${item.marker} ${item.seriesName}</span>
              <strong style="color:${item.color}">${money.format(item.value)}</strong>
            </div>`
          );
        return `<div style="font-weight:600;margin-bottom:8px;color:${textPrimary}">${label}</div>${lines.join('')}`;
      },
    },
    legend: {
      right: 4,
      top: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      icon: 'roundRect',
      // selectedMode true (default) — clicking a legend item toggles that series
      selectedMode: true,
      inactiveColor: isGlass ? 'rgba(232,226,214,0.14)' : 'rgba(120,120,120,0.25)',
      textStyle: {
        color: textSecondary,
        fontSize: 10,
        fontWeight: 500,
      },
      data: SERIES.map(s => ({ name: s.name, itemStyle: { color: s.color } })),
    },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: borderColor } },
      axisTick: { show: false },
      axisLabel: {
        color: textMuted,
        fontSize: 10,
        margin: 8,
      },
    },
    yAxis: {
      type: 'value',
      min: value => Math.min(0, value.min),
      splitNumber: 4,
      axisLine: { show: true, lineStyle: { color: borderColor } },
      axisTick: { show: false },
      axisLabel: {
        color: textMuted,
        fontSize: 10,
        formatter: value => money.format(value),
      },
      splitLine: {
        lineStyle: { color: splitLineColor, type: 'dashed' },
      },
    },
    series: SERIES.map((s, i) => ({
      name: s.name,
      type: 'bar',
      barMaxWidth: 18,
      barGap: '6%',
      // First bar in the group controls the category gap
      ...(i === 0 ? { barCategoryGap: '30%' } : {}),
      itemStyle: {
        color: s.color,
        borderRadius: [3, 3, 0, 0],
      },
      emphasis: { itemStyle: { opacity: 0.82 } },
      data: s.data,
    })),
  };
}

export default function MonthlyProfitSpendChart({ trend = [], uiStyle = 'neon-dark' }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const [failed, setFailed] = useState(false);

  const points = toMonthlyBuckets(trend);
  const isEmpty = points.length === 0 || points.every(
    p => !p.netProfit && !p.totalCost && !p.cashback && !p.totalTax
  );

  useEffect(() => {
    let cancelled = false;
    loadECharts()
      .then(echarts => {
        if (cancelled || !chartRef.current) return;
        const chart = instanceRef.current || echarts.init(chartRef.current, null, { renderer: 'canvas' });
        instanceRef.current = chart;
        chart.setOption(buildOptions(points, uiStyle), true);
        chart.resize();
        requestAnimationFrame(() => { if (!cancelled) chart.resize(); });
      })
      .catch(() => setFailed(true));
    return () => { cancelled = true; };
  }, [points, uiStyle]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const observer = 'ResizeObserver' in window
      ? new ResizeObserver(() => instanceRef.current?.resize())
      : null;
    if (observer) observer.observe(el);
    const onResize = () => instanceRef.current?.resize();
    window.addEventListener('resize', onResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => () => instanceRef.current?.dispose(), []);

  if (failed) {
    return (
      <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-gray-500">
        Chart could not be loaded.
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[260px] w-full">
      <div ref={chartRef} className="h-full w-full min-h-[260px]" />
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-white/10 bg-[#0d1118]/85 px-4 py-2 text-xs text-gray-500 shadow-xl">
            Monthly data appears after sales are recorded.
          </div>
        </div>
      )}
    </div>
  );
}
