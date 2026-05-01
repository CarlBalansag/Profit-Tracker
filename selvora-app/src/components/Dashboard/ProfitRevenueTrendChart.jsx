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

function fallbackTrend(stats, dateFilter) {
  const end = new Date();
  const start = new Date(end);
  const days = dateFilter === '7 Days' ? 7 : dateFilter === 'YTD' ? Math.max(30, Math.ceil((end - new Date(end.getFullYear(), 0, 1)) / 86400000)) : 30;
  start.setDate(end.getDate() - days);

  const revenue = stats.totalRevenue || 0;
  const totalCost = stats.totalCost || 0;
  const grossProfit = stats.grossProfit ?? (revenue - (stats.soldCost || 0));
  const netProfit = stats.profit || 0;
  const cashback = stats.totalCashback || 0;
  const totalTax = stats.totalTax || 0;
  const soldCost = stats.soldCost || 0;

  return [
    { date: formatDateKey(start), totalCost: 0, grossProfit: 0, netProfit: 0, cashback: 0, totalTax: 0, totalRevenue: 0, soldCost: 0 },
    { date: formatDateKey(end), totalCost, grossProfit, netProfit, cashback, totalTax, totalRevenue: revenue, soldCost },
  ];
}

function hydrateLegacyTrend(points, stats) {
  const last = points[points.length - 1] || {};
  const finalTotalCost = Number(last.totalCost) || Number(stats.totalCost) || 0;
  const finalGrossProfit = Number(last.grossProfit) || Number(stats.grossProfit) || 0;
  const finalNetProfit = Number(last.netProfit) || Number(stats.profit) || 0;

  return points.map((point, index) => {
    const indexProgress = points.length > 1 ? index / (points.length - 1) : 1;
    const costProgress = finalTotalCost ? (Number(point.totalCost) || 0) / finalTotalCost : indexProgress;
    const soldProgress = finalGrossProfit || finalNetProfit
      ? Math.max(
        Math.abs(finalGrossProfit) ? Math.abs(Number(point.grossProfit) || 0) / Math.abs(finalGrossProfit) : 0,
        Math.abs(finalNetProfit) ? Math.abs(Number(point.netProfit) || 0) / Math.abs(finalNetProfit) : 0,
      )
      : indexProgress;

    return {
      ...point,
      totalTax: Object.prototype.hasOwnProperty.call(point, 'totalTax')
        ? Number(point.totalTax) || 0
        : (Number(stats.totalTax) || 0) * Math.max(0, Math.min(1, costProgress)),
      totalRevenue: Object.prototype.hasOwnProperty.call(point, 'totalRevenue')
        ? Number(point.totalRevenue) || 0
        : (Number(stats.totalRevenue) || 0) * Math.max(0, Math.min(1, soldProgress)),
      soldCost: Object.prototype.hasOwnProperty.call(point, 'soldCost')
        ? Number(point.soldCost) || 0
        : (Number(stats.soldCost) || 0) * Math.max(0, Math.min(1, soldProgress)),
    };
  });
}

const ZERO_POINT = { totalCost: 0, grossProfit: 0, netProfit: 0, cashback: 0, totalTax: 0, totalRevenue: 0, soldCost: 0 };

function buildTrendData(stats, recent, dateFilter) {
  if (Array.isArray(stats.trend) && stats.trend.length > 0) {
    const points = stats.trend.map(point => ({
      date: point.date,
      totalCost: Number(point.totalCost) || 0,
      grossProfit: Number(point.grossProfit) || 0,
      netProfit: Number(point.netProfit) || 0,
      cashback: Number(point.cashback) || 0,
      ...(Object.prototype.hasOwnProperty.call(point, 'totalTax') ? { totalTax: Number(point.totalTax) || 0 } : {}),
      ...(Object.prototype.hasOwnProperty.call(point, 'totalRevenue') ? { totalRevenue: Number(point.totalRevenue) || 0 } : {}),
      ...(Object.prototype.hasOwnProperty.call(point, 'soldCost') ? { soldCost: Number(point.soldCost) || 0 } : {}),
    }));

    // Prepend a zero-origin point one day before the first real point so the
    // line always starts at $0 and visibly rises, even with a single data point.
    const firstDate = new Date(points[0].date);
    firstDate.setDate(firstDate.getDate() - 1);
    const originPoint = { ...ZERO_POINT, date: formatDateKey(firstDate) };

    return hydrateLegacyTrend([originPoint, ...points], stats);
  }

  if (!recent?.length) return fallbackTrend(stats, dateFilter);

  const rows = [...recent]
    .filter(row => row.date)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (rows.length < 2) return fallbackTrend(stats, dateFilter);

  let rawRevenue = 0;
  let rawGrossProfit = 0;
  let rawNetProfit = 0;
  let rawCashback = 0;
  let rawSoldCost = 0;
  const grouped = new Map();

  rows.forEach(row => {
    const key = formatDateKey(new Date(row.date));
    const rowRevenue = Number(row.revenue) || 0;
    const rowCost = Number(row.cost) || 0;
    const rowCashback = rowCost * ((stats.avgCashbackRate || 0) / 100);

    rawRevenue += rowRevenue;
    rawCashback += rowCashback;
    rawGrossProfit += rowRevenue - rowCost;
    rawNetProfit += rowRevenue - rowCost + rowCashback;
    rawSoldCost += rowCost;

    grouped.set(key, {
      date: key,
      totalCost: 0,
      grossProfit: rawGrossProfit,
      netProfit: rawNetProfit,
      cashback: rawCashback,
      totalTax: 0,
      totalRevenue: rawRevenue,
      soldCost: rawSoldCost,
    });
  });

  const points = Array.from(grouped.values());
  const last = points[points.length - 1];
  if (!last) return fallbackTrend(stats, dateFilter);

  const scale = (value, rawTotal, statTotal) => {
    if (!rawTotal) return statTotal || 0;
    return value * ((statTotal || 0) / rawTotal);
  };

  return points.map((point, index) => ({
    date: point.date,
    totalCost: (stats.totalCost || 0) * ((index + 1) / points.length),
    grossProfit: scale(point.grossProfit, last.grossProfit, stats.grossProfit ?? ((stats.totalRevenue || 0) - (stats.soldCost || 0))),
    netProfit: scale(point.netProfit, last.netProfit, stats.profit),
    cashback: scale(point.cashback, last.cashback, stats.totalCashback),
    totalTax: (stats.totalTax || 0) * ((index + 1) / points.length),
    totalRevenue: scale(point.totalRevenue, last.totalRevenue, stats.totalRevenue),
    soldCost: scale(point.soldCost, last.soldCost, stats.soldCost),
  }));
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

function buildOptions(points, chartSeries) {
  const dates = points.map(point => point.date);
  const displayDates = points.map(point => {
    const [year, month, day] = point.date.split('-');
    return `${Number(month)}/${Number(day)}/${year}`;
  });
  const activeSeries = normalizeSeriesConfig(chartSeries);
  const legendData = activeSeries.map(item => CHART_SERIES_REGISTRY[item.id].label);
  const colors = activeSeries.map(item => CHART_SERIES_REGISTRY[item.id].color);
  const areaSeriesId = activeSeries.find(item => item.id === 'totalCost')?.id || activeSeries[0]?.id;
  const series = activeSeries.map(item => {
    const def = CHART_SERIES_REGISTRY[item.id];
    return {
      name: def.label,
      type: 'line',
      smooth: true,
      showSymbol: true,
      symbolSize: 6,
      lineStyle: { width: 2, color: def.color },
      areaStyle: item.id === areaSeriesId ? {
        color: {
          type: 'linear',
          x: 0,
          y: 0,
          x2: 0,
          y2: 1,
          colorStops: [
            { offset: 0, color: hexToRgba(def.color, 0.18) },
            { offset: 1, color: hexToRgba(def.color, 0) },
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
      left: 52,
      right: 16,
      top: 28,
      bottom: 34,
      containLabel: false,
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: {
        type: 'cross',
        crossStyle: { color: 'rgba(148, 163, 184, 0.28)' },
        lineStyle: { color: 'rgba(148, 163, 184, 0.28)', type: 'dashed' },
      },
      backgroundColor: 'rgba(13, 15, 22, 0.96)',
      borderColor: 'rgba(255,255,255,0.10)',
      borderWidth: 1,
      padding: [10, 12],
      textStyle: { color: '#dbeafe', fontSize: 12 },
      formatter: params => {
        const dateIndex = params[0]?.dataIndex ?? 0;
        const title = `<div style="font-weight:700;color:#f8fafc;margin-bottom:6px">${displayDates[dateIndex] || params[0]?.axisValue || ''}</div>`;
        const lines = params.map(item => (
          `<div style="display:flex;align-items:center;justify-content:space-between;gap:18px;margin:3px 0">
            <span>${item.marker}${item.seriesName}</span>
            <strong style="color:#f8fafc">${money.format(item.value)}</strong>
          </div>`
        ));
        return title + lines.join('');
      },
    },
    legend: {
      right: 4,
      top: 0,
      itemWidth: 9,
      itemHeight: 9,
      icon: 'circle',
      textStyle: { color: '#64748b', fontSize: 11, fontWeight: 600 },
      data: legendData,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLine: { lineStyle: { color: 'rgba(148, 163, 184, 0.30)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#8aa0bd',
        fontSize: 10,
        margin: 8,
        formatter: value => {
          const [year, month, day] = value.split('-');
          return `${Number(month)}/${Number(day)}`;
        },
      },
    },
    yAxis: {
      type: 'value',
      min: value => Math.min(0, value.min),
      splitNumber: 4,
      axisLine: { show: true, lineStyle: { color: 'rgba(148, 163, 184, 0.30)' } },
      axisTick: { show: false },
      axisLabel: {
        color: '#8aa0bd',
        fontSize: 10,
        formatter: value => money.format(value),
      },
      splitLine: {
        lineStyle: { color: 'rgba(148, 163, 184, 0.08)', type: 'dashed' },
      },
    },
    series,
  };
}

export default function ProfitRevenueTrendChart({ stats, trend, recent, dateFilter, chartSeries }) {
  const chartRef = useRef(null);
  const instanceRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const chartStats = useMemo(() => ({ ...stats, trend }), [stats, trend]);
  const points = useMemo(() => buildTrendData(chartStats, recent, dateFilter), [chartStats, recent, dateFilter]);
  const activeSeries = useMemo(() => normalizeSeriesConfig(chartSeries), [chartSeries]);
  const isEmpty = points.every(point => activeSeries.every(item => !Number(point[item.id])));

  useEffect(() => {
    let cancelled = false;

    loadECharts()
      .then(echarts => {
        if (cancelled || !chartRef.current) return;
        const chart = instanceRef.current || echarts.init(chartRef.current, null, { renderer: 'canvas' });
        instanceRef.current = chart;
        chart.setOption(buildOptions(points, chartSeries), true);
        chart.resize();
        requestAnimationFrame(() => {
          if (!cancelled) chart.resize();
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
    };
  }, [points, chartSeries]);

  useEffect(() => {
    const resize = () => instanceRef.current?.resize();
    const observer = chartRef.current && 'ResizeObserver' in window
      ? new ResizeObserver(resize)
      : null;

    if (chartRef.current && observer) observer.observe(chartRef.current);
    window.addEventListener('resize', resize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
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

  return (
    <div className="relative h-full min-h-[280px] w-full">
      <div ref={chartRef} className="h-full min-h-[280px] w-full" />
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
