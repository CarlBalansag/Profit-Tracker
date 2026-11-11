import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, motionValue, useInView, useMotionValue, useTransform } from 'motion/react';
import { RotateCcw } from 'lucide-react';
import {
  fillDailyWindow,
  formatAxisLabel,
  formatChipLabel,
  formatLongLabel,
  monotonePath,
  niceTicks,
  normalizeTrendPoints,
  toCumulative,
} from '../../utils/trendPoints';
import { CHART_SERIES_REGISTRY } from '../../data/dashboardRegistry';

// Colors come from the app palette (colorPalette.css -> index.css --dp-* aliases).
const SERIES_STYLE = {
  totalRevenue: { color: 'var(--dp-accent-light)', fillOpacity: 0.3 },
  totalCost: { color: 'var(--dp-accent)', fillOpacity: 0.3 },
  grossProfit: { color: 'var(--dp-text-primary)', fillOpacity: 0.16 },
  cashback: { color: 'var(--dp-green-text)', fillOpacity: 0.5 },
  netProfit: { color: 'var(--dp-info-text)', fillOpacity: 0.16 },
  totalTax: { color: 'var(--dp-warning-text)', fillOpacity: 0.16 },
  soldCost: { color: 'var(--dp-text-muted)', fillOpacity: 0.16 },
};

const FALLBACK_SERIES = ['totalRevenue', 'totalCost', 'grossProfit', 'cashback'];

// The Settings line picker passes its visible rows, already sorted.
function resolveSeries(chartSeries) {
  const ids = (Array.isArray(chartSeries) ? chartSeries : [])
    .filter(item => item && item.visible !== false && SERIES_STYLE[item.id] && CHART_SERIES_REGISTRY[item.id])
    .map(item => item.id);
  return (ids.length ? ids : FALLBACK_SERIES).map(id => ({
    id,
    label: CHART_SERIES_REGISTRY[id].label,
    ...SERIES_STYLE[id],
  }));
}

const EASE_IN_OUT_CUBIC = [0.645, 0.045, 0.355, 1];
const REVEAL = { duration: 1.5, stagger: 0.65 };
const HIDE_DURATION = 0.8;
const SHOW_DURATION = 1.3;

const MotionRect = motion.rect;

const MIN_HEIGHT = 280;
const CLIP_PAD = 8; // lets dots and the line cap at the edges show fully

const moneyFull = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const moneyCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });

function SeriesLayer({ clipId, progress, plot, linePath, areaPath, dots, color, fillOpacity }) {
  const span = useMotionValue(plot.width + CLIP_PAD * 2);
  useEffect(() => { span.set(plot.width + CLIP_PAD * 2); }, [plot.width, span]);
  const clipWidth = useTransform([progress, span], ([p, s]) => Math.max(0, p * s));

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <MotionRect
            x={plot.left - CLIP_PAD}
            y={plot.top - CLIP_PAD}
            height={plot.height + CLIP_PAD * 2}
            width={clipWidth}
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {areaPath && <path d={areaPath} fill={color} fillOpacity={fillOpacity} stroke="none" />}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {dots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={3} fill={color} stroke="var(--dp-card-bg)" strokeWidth={1.25} />
        ))}
      </g>
    </g>
  );
}

export default function ProfitCostTrendChart({ trend, trendMeta = null, chartSeries, uiStyle = 'neon-dark', trendMode = 'period', onTrendModeChange }) {
  const isGlass = uiStyle === 'glassmorphism-brown';
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');

  const [size, setSize] = useState({ width: 0, height: MIN_HEIGHT });
  const { width, height } = size;
  const [hidden, setHidden] = useState(() => new Set());
  const [hoverIndex, setHoverIndex] = useState(null);
  const hiddenRef = useRef(hidden);
  const startedRef = useRef(false);
  const controlsRef = useRef({});
  const [progress] = useState(() => Object.fromEntries(Object.keys(SERIES_STYLE).map(id => [id, motionValue(0)])));

  const seriesKey = (Array.isArray(chartSeries) ? chartSeries : [])
    .filter(item => item && item.visible !== false)
    .map(item => item.id)
    .join(',');
  // Keyed on the visible ids so a new-but-equal settings array doesn't rebuild the chart.
  const activeSeries = useMemo(
    () => resolveSeries(seriesKey.split(',').filter(Boolean).map(id => ({ id }))),
    [seriesKey],
  );

  const inView = useInView(wrapRef, { once: true, amount: 0.35 });

  // ---- data ----
  const rawPoints = useMemo(() => normalizeTrendPoints(trend), [trend]);
  const points = useMemo(
    () => (trendMode === 'cumulative' ? toCumulative(rawPoints) : fillDailyWindow(rawPoints, trendMeta)),
    [rawPoints, trendMeta, trendMode],
  );
  const isEmpty = points.length === 0 || points.every(p => activeSeries.every(s => !p[s.id]));

  // ---- size (rebuilds geometry on resize; animation state lives in motion values) ----
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.max(MIN_HEIGHT, Math.round(el.clientHeight));
      setSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    };
    measure();
    if (!('ResizeObserver' in window)) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const compact = width > 0 && width < 460;

  const geo = useMemo(() => {
    const allValues = points.flatMap(p => activeSeries.map(s => p[s.id]));
    // Amounts are never shown below $0, so the axis always starts at zero.
    const ticks = niceTicks(0, Math.max(0, ...allValues), 5);
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const left = compact ? 44 : 60;
    const plot = { left, top: 12, width: Math.max(10, width - left - 14), height: height - 12 - 42 };
    const n = points.length;
    const step = n > 1 ? plot.width / (n - 1) : 0;
    const xAt = i => (n > 1 ? plot.left + i * step : plot.left + plot.width / 2);
    const yAt = v => plot.top + plot.height - ((Math.max(0, v) - yMin) / (yMax - yMin || 1)) * plot.height;
    const baseline = yAt(0);
    const series = activeSeries.map(s => {
      const pts = points.map((p, i) => [xAt(i), yAt(p[s.id])]);
      const linePath = monotonePath(pts);
      const areaPath = pts.length > 1
        ? `${linePath}L${pts[pts.length - 1][0]},${baseline}L${pts[0][0]},${baseline}Z`
        : '';
      return { ...s, pts, linePath, areaPath };
    });
    const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plot.width / (compact ? 58 : 56)))));
    return { ticks, plot, xAt, yAt, step, series, labelEvery, n };
  }, [points, width, height, compact, activeSeries]);

  // ---- animation ----
  const stopAll = useCallback(() => {
    Object.values(controlsRef.current).forEach(c => c?.stop());
    controlsRef.current = {};
  }, []);

  const play = useCallback(() => {
    stopAll();
    startedRef.current = true;
    let slot = 0;
    Object.values(progress).forEach(mv => mv.set(0));
    activeSeries.forEach((s) => {
      const mv = progress[s.id];
      if (hiddenRef.current.has(s.id)) return;
      controlsRef.current[s.id] = animate(mv, 1, {
        duration: REVEAL.duration,
        delay: slot * REVEAL.stagger,
        ease: EASE_IN_OUT_CUBIC,
      });
      slot += 1;
    });
  }, [activeSeries, progress, stopAll]);

  useEffect(() => {
    if (inView && !startedRef.current) play();
  }, [inView, play]);

  // Lines added in Settings after the first reveal wipe in; removed ones reset
  // so they wipe in again if they come back.
  useEffect(() => {
    if (!startedRef.current) return;
    const ids = new Set(activeSeries.map(s => s.id));
    Object.entries(progress).forEach(([id, mv]) => {
      if (!ids.has(id)) {
        controlsRef.current[id]?.stop();
        mv.set(0);
      } else if (!hiddenRef.current.has(id) && mv.get() === 0 && !mv.isAnimating()) {
        controlsRef.current[id] = animate(mv, 1, { duration: SHOW_DURATION, ease: EASE_IN_OUT_CUBIC });
      }
    });
  }, [activeSeries, progress]);

  useEffect(() => stopAll, [stopAll]);

  const toggleSeries = (id) => {
    const next = new Set(hiddenRef.current);
    const nowHidden = !next.has(id);
    if (nowHidden) next.add(id); else next.delete(id);
    hiddenRef.current = next;
    setHidden(next);

    if (!startedRef.current) return; // the first reveal will honour the new state
    controlsRef.current[id]?.stop();
    const target = nowHidden ? 0 : 1;
    controlsRef.current[id] = animate(progress[id], target, {
      duration: nowHidden ? HIDE_DURATION : SHOW_DURATION,
      ease: EASE_IN_OUT_CUBIC,
    });
  };

  // ---- hover / touch ----
  const indexFromEvent = (event) => {
    const svg = svgRef.current;
    if (!svg || geo.n === 0) return null;
    const x = event.clientX - svg.getBoundingClientRect().left;
    if (geo.n === 1) return 0;
    const i = Math.round((x - geo.plot.left) / geo.step);
    return Math.max(0, Math.min(geo.n - 1, i));
  };

  const handlePointer = (event) => {
    const i = indexFromEvent(event);
    setHoverIndex(prev => (prev === i ? prev : i));
  };

  const handleLeave = (event) => {
    if (event.pointerType === 'touch') return; // taps keep the selection until a tap elsewhere
    setHoverIndex(null);
  };

  useEffect(() => {
    if (hoverIndex === null) return undefined;
    const onDown = (event) => {
      if (!svgRef.current?.contains(event.target)) setHoverIndex(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [hoverIndex]);

  const activeIndex = hoverIndex !== null && hoverIndex < geo.n ? hoverIndex : null;
  const visibleSeries = geo.series.filter(s => !hidden.has(s.id));
  const hoverX = activeIndex !== null ? geo.xAt(activeIndex) : 0;
  const showTooltip = activeIndex !== null && visibleSeries.length > 0;

  // Position the tooltip before paint: right of the guide, flipped left near the edge, kept in bounds.
  useLayoutEffect(() => {
    const tip = tooltipRef.current;
    if (!tip || !showTooltip) return;
    const gap = 14;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = hoverX + gap;
    if (left + w > width - 4) left = hoverX - gap - w;
    left = Math.max(4, Math.min(left, width - w - 4));
    const topDot = Math.min(...visibleSeries.map(s => s.pts[activeIndex][1]));
    const top = Math.max(4, Math.min(topDot - h / 2, geo.plot.top + geo.plot.height - h));
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  const formatTick = v => (compact ? moneyCompact : moneyFull).format(v);

  return (
    <div className="relative flex h-full min-h-[280px] w-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4 pb-5">
        {onTrendModeChange ? (
          <div className={`flex gap-0.5 p-0.5 rounded-lg ${isGlass ? 'bg-white/[0.04] border border-white/[0.06]' : 'bg-[var(--dp-card-bg)] dp-elevated'}`}>
            {[['period', 'Period'], ['cumulative', 'Cumulative']].map(([val, label]) => (
              <button
                key={val}
                type="button"
                aria-pressed={trendMode === val}
                onClick={() => onTrendModeChange(val)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] ${
                  trendMode === val
                    ? 'bg-[var(--dp-accent-bg)] text-[var(--dp-accent)]'
                    : 'text-[var(--dp-text-muted)] hover:text-[var(--dp-text-primary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        ) : <span />}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {activeSeries.map(s => {
            const isHidden = hidden.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={!isHidden}
                onClick={() => toggleSeries(s.id)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium transition-[opacity,border-color,color] duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-card-bg)] ${
                  isHidden
                    ? 'border-dashed border-[var(--dp-border-hover)] text-[var(--dp-text-muted)] opacity-55 line-through'
                    : 'border-[var(--dp-border-hover)] bg-[var(--dp-card-bg)] text-[var(--dp-text-primary)]'
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                {s.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={play}
            aria-label="Replay chart animation"
            title="Replay"
            className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--dp-border-hover)] text-[var(--dp-text-muted)] transition-colors hover:text-[var(--dp-text-primary)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--dp-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--dp-card-bg)]"
          >
            <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={wrapRef} className="relative w-full flex-1 overflow-hidden" style={{ minHeight: MIN_HEIGHT }}>
        {width > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            className="absolute inset-0 block select-none tabular-nums"
            style={{ touchAction: 'pan-y', fontFamily: 'inherit' }}
            role="img"
            aria-label={`Profit and cost trend, ${geo.n} ${geo.n === 1 ? 'point' : 'points'}`}
          >
            {/* grid + y axis */}
            {geo.ticks.map(t => (
              <g key={t}>
                <line
                  x1={geo.plot.left}
                  x2={geo.plot.left + geo.plot.width}
                  y1={geo.yAt(t)}
                  y2={geo.yAt(t)}
                  stroke={t === 0 ? 'var(--dp-text-muted)' : 'var(--dp-border-hover)'}
                  strokeOpacity={t === 0 ? 0.55 : 1}
                  strokeWidth={t === 0 ? 1.5 : 1}
                  strokeDasharray={t === 0 ? '0 5' : '3 4'}
                  strokeLinecap={t === 0 ? 'round' : 'butt'}
                />
                <text x={geo.plot.left - 8} y={geo.yAt(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--dp-text-muted)">
                  {formatTick(t)}
                </text>
              </g>
            ))}

            {/* x axis labels */}
            {points.map((p, i) => (i % geo.labelEvery === 0 ? (
              <text
                key={p.date}
                x={geo.xAt(i)}
                y={geo.plot.top + geo.plot.height + 30}
                textAnchor={geo.n > 1 && i === 0 ? 'start' : geo.n > 1 && i === geo.n - 1 ? 'end' : 'middle'}
                fontSize={11}
                fill="var(--dp-text-muted)"
              >
                {formatAxisLabel(p.date, i)}
              </text>
            ) : null))}

            {/* series */}
            {geo.series.map(s => (
              <SeriesLayer
                key={s.id}
                clipId={`${uid}-clip-${s.id}`}
                progress={progress[s.id]}
                plot={geo.plot}
                linePath={s.linePath}
                areaPath={s.areaPath}
                dots={s.pts}
                color={s.color}
                fillOpacity={s.fillOpacity}
              />
            ))}

            {/* hover guide + dots */}
            {activeIndex !== null && (
              <g pointerEvents="none">
                <line
                  x1={hoverX}
                  x2={hoverX}
                  y1={geo.plot.top}
                  y2={geo.plot.top + geo.plot.height}
                  stroke="var(--dp-text-muted)"
                  strokeOpacity={0.6}
                  strokeDasharray="4 4"
                />
                {visibleSeries.map(s => (
                  <circle
                    key={s.id}
                    cx={hoverX}
                    cy={s.pts[activeIndex][1]}
                    r={5.5}
                    fill={s.color}
                    stroke="var(--dp-card-bg)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}

            {/* pointer capture */}
            <rect
              x={0}
              y={0}
              width={width}
              height={height}
              fill="transparent"
              onPointerMove={handlePointer}
              onPointerDown={handlePointer}
              onPointerLeave={handleLeave}
            />
          </svg>
        )}

        {/* month chip under the x axis */}
        {activeIndex !== null && (
          <div
            className="pointer-events-none absolute rounded-md border border-[var(--dp-border-hover)] bg-[var(--dp-card-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--dp-text-primary)] shadow-sm whitespace-nowrap"
            style={{
              left: Math.max(22, Math.min(hoverX, width - 22)),
              top: geo.plot.top + geo.plot.height + 19,
              transform: 'translateX(-50%)',
            }}
          >
            {formatChipLabel(points[activeIndex].date)}
          </div>
        )}

        {/* tooltip */}
        {showTooltip && (
          <div
            ref={tooltipRef}
            role="status"
            className="pointer-events-none absolute left-0 top-0 min-w-[168px] rounded-xl border border-[var(--dp-border-hover)] bg-[var(--dp-card-bg)] px-3 py-2.5 text-[12px] text-[var(--dp-text-primary)]"
            style={{ boxShadow: 'var(--dp-card-shadow-hover)' }}
          >
            <div className="mb-1.5 font-semibold">{formatLongLabel(points[activeIndex].date)}</div>
            {visibleSeries.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-5 py-0.5">
                <span className="flex items-center gap-1.5 text-[var(--dp-text-muted)]">
                  <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                  {s.label}
                </span>
                <span className="font-semibold tabular-nums">{moneyFull.format(points[activeIndex][s.id])}</span>
              </div>
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-lg border border-[var(--dp-border)] bg-[var(--dp-card-bg)] px-4 py-2 text-xs text-[var(--dp-text-muted)]">
              Profit lines appear after sales data is recorded.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
