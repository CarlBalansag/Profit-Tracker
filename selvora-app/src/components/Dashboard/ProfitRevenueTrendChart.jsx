import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CHART_SERIES_REGISTRY, DEFAULT_DASHBOARD_SETTINGS } from '../../data/dashboardRegistry';

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

function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function hexToRgba(hex, alpha) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function readThemeVar(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

const TREND_FIELDS = ['totalCost', 'grossProfit', 'netProfit', 'cashback', 'totalTax', 'totalRevenue', 'soldCost'];

const ZERO_VALUES = Object.fromEntries(TREND_FIELDS.map(f => [f, 0]));

// Normalize the backend trend array (per-period deltas) into chart-ready points.
// The backend sends YYYY-MM keys for YTD/All Time and YYYY-MM-DD for 7/30 Days.
function normalizeTrendPoints(trend) {
  if (!Array.isArray(trend) || trend.length === 0) return [];
  return trend.map(point => ({
    date: point.date,
    totalCost:    Number(point.totalCost)    || 0,
    grossProfit:  Number(point.grossProfit)  || 0,
    netProfit:    Number(point.netProfit)    || 0,
    cashback:     Number(point.cashback)     || 0,
    totalTax:     Number(point.totalTax)     || 0,
    totalRevenue: Number(point.totalRevenue) || 0,
    soldCost:     Number(point.soldCost)     || 0,
  }));
}

// Fill every day in the window with a $0 point (for period mode daily views).
// Sparse active-only points are used in cumulative mode.
function fillDailyWindow(points, trendMeta) {
  if (!trendMeta?.windowStart || !trendMeta?.windowEnd) return points;
  const byDate = new Map(points.map(p => [p.date, p]));
  const result = [];
  const cursor = new Date(trendMeta.windowStart + 'T00:00:00.000Z');
  const end    = new Date(trendMeta.windowEnd   + 'T00:00:00.000Z');
  while (cursor <= end) {
    const key = cursor.toISOString().slice(0, 10);
    result.push(byDate.get(key) ?? { date: key, ...ZERO_VALUES });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

// Convert per-period delta points into cumulative running totals.
function toCumulative(points) {
  const running = {};
  TREND_FIELDS.forEach(f => { running[f] = 0; });
  return points.map(point => {
    const out = { date: point.date };
    TREND_FIELDS.forEach(f => {
      running[f] += point[f] || 0;
      out[f] = running[f];
    });
    return out;
  });
}

// Format a date key (YYYY-MM or YYYY-MM-DD) into a human-readable label.
function formatTrendLabel(dateKey) {
  if (dateKey.length === 7) {
    // Monthly bucket: "Jan 2025"
    const [year, month] = dateKey.split('-');
    return new Date(Number(year), Number(month) - 1, 1)
      .toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }
  // Daily bucket: "1/5/2025"
  const [year, month, day] = dateKey.split('-');
  return `${Number(month)}/${Number(day)}/${year}`;
}

function normalizeSeriesConfig(chartSeries) {
  const configured = Array.isArray(chartSeries) && chartSeries.length
    ? chartSeries
    : DEFAULT_DASHBOARD_SETTINGS.chartSeries;

  const visible = configured
    .filter(item => item.visible !== false && CHART_SERIES_REGISTRY[item.id])
    .sort((a, b) => a.order - b.order);

  return visible.length ? visible : DEFAULT_DASHBOARD_SETTINGS.chartSeries.filter(item => item.visible);
}

function buildOptions(points, chartSeries, uiStyle = 'neon-dark', containerWidth = 600) {
  const isGlass = uiStyle === 'glassmorphism-brown';
  const isMobile = containerWidth < 500;
  const dates = points.map(point => point.date);
  const displayDates = points.map(point => formatTrendLabel(point.date));
  const isMonthly = points.length > 0 && points[0].date.length === 7;
  const activeSeries = normalizeSeriesConfig(chartSeries);
  const legendData = activeSeries.map(item => {
    const label = CHART_SERIES_REGISTRY[item.id].label;
    if (isGlass) return label;
    return {
      name: label,
      icon: item.id === 'cashback'
        ? 'path://M0 4 L4 4 L4 6 L0 6 Z M7 4 L11 4 L11 6 L7 6 Z M14 4 L18 4 L18 6 L14 6 Z'
        : 'path://M0 4 L18 4 L18 6 L0 6 Z',
    };
  });
  const glassColors = {
    totalCost: '#8a8f93',
    grossProfit: '#d8a65a',
    netProfit: '#6aaa8e',
    cashback: '#c47a5a',
    totalTax: '#b86b3f',
    totalRevenue: '#e8e2d6',
    soldCost: '#9c8f7c',
  };
  const carbonColors = {
    totalCost: readThemeVar('--chart-1', '#888888'),
    grossProfit: readThemeVar('--chart-3', '#aaaaaa'),
    netProfit: readThemeVar('--chart-2', '#6e9e6e'),
    cashback: readThemeVar('--chart-4', '#505050'),
    totalTax: readThemeVar('--yellow', '#aaaaaa'),
    totalRevenue: readThemeVar('--accent', '#999999'),
    soldCost: readThemeVar('--text-secondary', '#888888'),
  };
  const glassMutedSeries = new Set();
  const colors = activeSeries.map(item => isGlass ? (glassColors[item.id] || CHART_SERIES_REGISTRY[item.id].color) : (carbonColors[item.id] || '#888888'));
  const areaSeriesId = activeSeries.find(item => item.id === 'totalCost')?.id || activeSeries[0]?.id;
  const series = activeSeries.map(item => {
    const def = CHART_SERIES_REGISTRY[item.id];
    const seriesColor = isGlass ? (glassColors[item.id] || def.color) : (carbonColors[item.id] || '#888888');
    const muted = isGlass && glassMutedSeries.has(item.id);
    return {
      name: def.label,
      type: 'line',
      smooth: true,
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 6,
      lineStyle: {
        width: muted ? 1.6 : 2,
        color: seriesColor,
        opacity: muted ? 0.55 : 0.9,
        type: (!isGlass && item.id === 'cashback') || (isGlass && item.id === 'netProfit') ? 'dashed' : 'solid',
      },
      itemStyle: {
        color: seriesColor,
        borderColor: isGlass ? '#17140f' : readThemeVar('--bg-base', '#0b0b0b'),
        borderWidth: isGlass ? 1.5 : 1,
        opacity: muted ? 0.55 : 1,
      },
      emphasis: {
        focus: 'series',
        lineStyle: { opacity: 1, width: 2.5 },
        itemStyle: { opacity: 1 },
      },
      areaStyle: item.id === areaSeriesId ? {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: hexToRgba(seriesColor, isGlass ? 0.14 : 0.06) },
            { offset: 1, color: hexToRgba(seriesColor, 0) },
          ],
        },
      } : undefined,
      data: points.map(point => Math.round(Number(point[item.id]) || 0)),
    };
  });

  return {
    backgroundColor: 'transparent',
    animationDuration: 900,
    animationEasing: 'cubicOut',
    color: colors,
    grid: {
      left: isMobile ? 4 : 52,
      right: isMobile ? 4 : 16,
      top: isMobile ? 8 : 28,
      bottom: isMobile ? 60 : 34,
      containLabel: isMobile ? true : false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        crossStyle: { color: isGlass ? 'rgba(216, 166, 90, 0.18)' : readThemeVar('--border-hover', 'rgba(255,255,255,0.08)') },
        lineStyle: { color: isGlass ? 'rgba(216, 166, 90, 0.18)' : readThemeVar('--border-hover', 'rgba(255,255,255,0.08)'), type: 'dashed' },
      },
      backgroundColor: isGlass ? 'rgba(20, 17, 14, 0.96)' : readThemeVar('--bg-surface', '#121212'),
      borderColor: isGlass ? 'rgba(216,166,90,0.16)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)'),
      borderWidth: 1,
      padding: isGlass ? [12, 14] : [10, 12],
      extraCssText: isGlass ? 'border-radius:14px;box-shadow:0 14px 36px rgba(0,0,0,0.32);' : undefined,
      textStyle: { color: isGlass ? '#e8e2d6' : readThemeVar('--text-primary', '#d0d0d0'), fontSize: 12, fontFamily: isGlass ? 'Inter, ui-sans-serif, system-ui' : undefined },
      formatter: params => {
        const dateIndex = params[0]?.dataIndex ?? 0;
        const title = `<div style="font-family:${isGlass ? 'Georgia, serif' : 'inherit'};font-weight:600;color:${isGlass ? '#fff4dc' : readThemeVar('--text-primary', '#d0d0d0')};margin-bottom:8px">${displayDates[dateIndex] || params[0]?.axisValue || ''}</div>`;
        const lines = params.map(item => (
          `<div style="display:flex;align-items:center;justify-content:space-between;gap:20px;margin:5px 0;color:${isGlass ? 'rgba(232,226,214,0.62)' : 'inherit'}">
            <span>${item.marker}<span style="margin-left:2px">${item.seriesName}</span></span>
            <strong style="color:${isGlass ? item.color : readThemeVar('--text-primary', '#d0d0d0')}">${money.format(item.value)}</strong>
          </div>`
        ));
        return title + lines.join('');
      },
    },
    legend: isMobile ? {
      bottom: 0,
      left: 'center',
      orient: 'horizontal',
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 8,
      icon: 'circle',
      textStyle: {
        color: isGlass ? 'rgba(232,226,214,0.38)' : readThemeVar('--text-secondary', '#6e6e6e'),
        fontSize: 9,
        fontWeight: 500,
      },
      data: legendData,
    } : {
      right: 4,
      top: 0,
      itemWidth: isGlass ? 9 : 18,
      itemHeight: isGlass ? 9 : 6,
      itemGap: 10,
      icon: isGlass ? 'circle' : 'path://M0 4 L18 4 L18 6 L0 6 Z',
      textStyle: {
        color: isGlass ? 'rgba(232,226,214,0.38)' : readThemeVar('--text-secondary', '#6e6e6e'),
        fontSize: isGlass ? 11 : 10,
        fontWeight: 500,
        fontFamily: isGlass ? 'Inter, ui-sans-serif, system-ui' : undefined,
      },
      data: legendData,
    },
    dataZoom: isGlass ? [] : [
      {
        type: 'inside',
        xAxisIndex: 0,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
        throttle: 50,
      },
      {
        type: 'inside',
        yAxisIndex: 0,
        filterMode: 'none',
        zoomOnMouseWheel: true,
        moveOnMouseMove: false,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
        throttle: 50,
      },
    ],
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLine: { lineStyle: { color: isGlass ? 'rgba(232,226,214,0.10)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)') } },
      axisTick: { show: false },
      axisLabel: {
        color: isGlass ? 'rgba(232,226,214,0.32)' : readThemeVar('--text-muted', '#404040'),
        fontSize: 10,
        fontFamily: isGlass ? 'Inter, ui-sans-serif, system-ui' : undefined,
        margin: 8,
        formatter: value => {
          if (value.length === 7) {
            // Monthly: "Jan"
            const [year, month] = value.split('-');
            return new Date(Number(year), Number(month) - 1, 1)
              .toLocaleDateString('en-US', { month: 'short' });
          }
          const [, month, day] = value.split('-');
          return `${Number(month)}/${Number(day)}`;
        },
      },
    },
    yAxis: {
      type: 'value',
      min: value => Math.min(0, value.min),
      splitNumber: 4,
      axisLine: { show: true, lineStyle: { color: isGlass ? 'rgba(232,226,214,0.14)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)') } },
      axisTick: { show: false },
      axisLabel: {
        color: isGlass ? 'rgba(232,226,214,0.32)' : readThemeVar('--text-muted', '#404040'),
        fontSize: 10,
        fontFamily: isGlass ? 'Inter, ui-sans-serif, system-ui' : undefined,
        formatter: value => money.format(value),
      },
      splitLine: {
        lineStyle: { color: isGlass ? 'rgba(232,226,214,0.07)' : readThemeVar('--border-default', 'rgba(255,255,255,0.04)'), type: 'dashed' },
      },
    },
    series,
  };
}

export default function ProfitRevenueTrendChart({ stats, trend, trendMeta = null, recent, dateFilter, chartSeries, uiStyle = 'neon-dark', colorTheme = 'copper', trendMode = 'period', onTrendModeChange }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const [containerWidth, setContainerWidth] = useState(600);
  const rawPoints = useMemo(() => normalizeTrendPoints(trend), [trend]);
  const periodPoints = useMemo(() => fillDailyWindow(rawPoints, trendMeta), [rawPoints, trendMeta]);
  const points = useMemo(() => trendMode === 'cumulative' ? toCumulative(rawPoints) : periodPoints, [rawPoints, periodPoints, trendMode]);
  const activeSeries = useMemo(() => normalizeSeriesConfig(chartSeries), [chartSeries]);
  const isEmpty = points.every(point => activeSeries.every(item => !Number(point[item.id])));

  useEffect(() => {
    let cancelled = false;

    loadECharts()
      .then(echarts => {
        if (cancelled || !chartRef.current) return;
        const chart = instanceRef.current || echarts.init(chartRef.current, null, { renderer: 'canvas' });
        instanceRef.current = chart;
        chart.setOption(buildOptions(points, chartSeries, uiStyle, containerWidth), true);
        chart.resize();
        requestAnimationFrame(() => {
          if (!cancelled) chart.resize();
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
  }, [points, chartSeries, uiStyle, colorTheme, containerWidth]);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;

    const handleResize = (entries) => {
      const width = entries?.[0]?.contentRect?.width ?? el.offsetWidth;
      setContainerWidth(width);
      instanceRef.current?.resize();
    };

    const observer = 'ResizeObserver' in window ? new ResizeObserver(handleResize) : null;
    if (observer) observer.observe(el);

    // Set initial width
    setContainerWidth(el.offsetWidth);

    const windowResize = () => instanceRef.current?.resize();
    window.addEventListener('resize', windowResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', windowResize);
    };
  }, []);

  useEffect(() => () => instanceRef.current?.dispose(), []);

  if (failed) {
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center rounded-lg border border-dashed border-white/10 bg-black/20 text-sm text-gray-500">
        Apache ECharts could not be loaded.
      </div>
    );
  }

  const isGlassStyle = uiStyle === 'glassmorphism-brown';

  return (
    <div className="relative h-full min-h-[280px] w-full flex flex-col">
      {/* Period / Cumulative tab toggle */}
      {onTrendModeChange && (
        <div className="flex justify-end px-1 pb-1 shrink-0">
          <div className={`flex gap-0.5 p-0.5 rounded-lg ${isGlassStyle ? 'bg-white/[0.04] border border-white/[0.06]' : 'bg-[var(--bg-elevated)] border border-[color:var(--border-default)]'}`}>
            {[['period', 'Period'], ['cumulative', 'Cumulative']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => onTrendModeChange(val)}
                className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                  trendMode === val
                    ? isGlassStyle
                      ? 'bg-white/[0.08] text-[#e8e2d6] border border-white/[0.10]'
                      : 'bg-[var(--accent-bg)] text-[var(--accent)] border border-[color:var(--accent)]/30'
                    : isGlassStyle
                      ? 'text-white/25 hover:text-white/50 border border-transparent'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-transparent'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div ref={chartRef} className="flex-1 min-h-[280px] w-full" />
      {isEmpty && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-white/10 bg-[#0d1118]/85 px-4 py-2 text-xs text-gray-500 shadow-xl">
            Profit lines appear after sales data is recorded.
          </div>
        </div>
      )}
    </div>
  );
}
