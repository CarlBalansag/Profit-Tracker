// Profit per day for exactly the days the date filter covers.
//   7 Days   one row of seven days
//   30 Days  a wall calendar (Sun–Sat columns, one row per week)
//   YTD      GitHub-style year: one column per week since Jan 1
//   All Time GitHub-style, the last 365 days
// Hovering (or tapping) a day shows its profit, sales, revenue and cost.
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Panel } from './Motion';

const MotionDiv = motion.div;
const EASE = [0.16, 1, 0.3, 1];
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const parse = (iso) => new Date(`${iso}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const longDate = (key) => parse(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = (key) => parse(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const SUBTITLE = {
  '7 Days': 'The last 7 days.',
  '30 Days': 'The last 30 days.',
  YTD: 'Every day this year so far.',
  'All Time': 'The last 365 days.',
};

// The days a filter covers, ending today (UTC, matching the API's dates).
function rangeFor(dateRange, now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = dateRange === 'YTD'
    ? new Date(Date.UTC(to.getUTCFullYear(), 0, 1))
    : new Date(to.getTime() - (dateRange === '7 Days' ? 6 : dateRange === '30 Days' ? 29 : 364) * DAY);
  return { from, to };
}

function cellColor(day, max) {
  if (!day || day.sales === 0) return 'var(--dp-hover-bg)';
  const strength = Math.abs(day.profit) / max;
  return day.profit >= 0
    ? `color-mix(in srgb, var(--dp-green-text) ${Math.round(22 + strength * 78)}%, transparent)`
    : `color-mix(in srgb, var(--dp-red-text) ${Math.round(30 + strength * 70)}%, transparent)`;
}

function Tip({ tip }) {
  const d = tip.day;
  return (
    <div
      className="pointer-events-none absolute z-20"
      style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})` }}
    >
    <MotionDiv
      role="tooltip"
      className="w-max max-w-[220px] rounded-lg border border-[color:var(--dp-border-hover)] bg-[var(--dp-card-bg)] px-3 py-2 text-xs shadow-lg"
      initial={{ opacity: 0, y: tip.below ? -4 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.1 } }}
      transition={{ duration: 0.15, ease: EASE }}
    >
      <div className="font-semibold text-[var(--dp-text-primary)]">{longDate(tip.key)}</div>
      {d && d.sales > 0 ? (
        <>
          <div className={`mt-0.5 text-sm font-bold tabular-nums ${d.profit >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}`}>
            {signed(d.profit)} {d.profit >= 0 ? 'profit' : 'loss'}
          </div>
          <div className="mt-0.5 tabular-nums text-[var(--dp-text-muted)]">
            {d.sales} sale{d.sales === 1 ? '' : 's'}{d.units != null && d.units !== d.sales ? ` · ${d.units} units` : ''}
          </div>
          {d.revenue != null && (
            <div className="tabular-nums text-[var(--dp-text-muted)]">Revenue {usd(d.revenue)} · Cost {usd(d.cost)}</div>
          )}
        </>
      ) : <div className="mt-0.5 text-[var(--dp-text-muted)]">No sales</div>}
    </MotionDiv>
    </div>
  );
}

export default function ProfitCalendar({ calendar, dateRange }) {
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const [tip, setTip] = useState(null);

  const { cells, byDay, max, best, total, activeDays, layout, weeks, monthLabels } = useMemo(() => {
    // An older saved copy of this data may be a bare list of days; the range
    // is worked out here from the filter either way, the same way the API does.
    const days = (Array.isArray(calendar) ? calendar : calendar?.days) ?? [];
    const map = new Map(days.map((d) => [d.date, d]));
    const { from, to } = rangeFor(dateRange);
    const mode = dateRange === '7 Days' ? 'row' : dateRange === '30 Days' ? 'month' : 'year';
    const out = [];
    if (from && to) {
      // Pad to whole weeks for the calendar layouts; padding cells are blank.
      const start = mode === 'row' ? from : new Date(from.getTime() - from.getUTCDay() * DAY);
      const end = mode === 'row' ? to : new Date(to.getTime() + (6 - to.getUTCDay()) * DAY);
      for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
        const d = new Date(t);
        out.push({ key: iso(d), inRange: d >= from && d <= to, weekday: d.getUTCDay(), dayOfMonth: d.getUTCDate() });
      }
    }
    const weekCount = Math.ceil(out.length / 7);
    // Month names over the first week column that starts in each month.
    const labels = [];
    if (mode === 'year') {
      let last = -1;
      for (let w = 0; w < weekCount; w += 1) {
        const first = out[w * 7];
        const m = parse(first.key).getUTCMonth();
        if (m !== last) {
          labels.push({ col: w, text: parse(first.key).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }) });
          last = m;
        }
      }
    }
    const inRangeDays = days.filter((d) => (!from || parse(d.date) >= from));
    return {
      cells: out,
      byDay: map,
      max: Math.max(1, ...inRangeDays.map((d) => Math.abs(d.profit))),
      best: inRangeDays.reduce((b, d) => (d.profit > (b?.profit ?? 0) ? d : b), null),
      total: inRangeDays.reduce((s, d) => s + d.profit, 0),
      activeDays: inRangeDays.filter((d) => d.sales > 0).length,
      layout: mode,
      weeks: weekCount,
      monthLabels: labels,
    };
  }, [calendar, dateRange]);

  // A year view opens scrolled to today, like GitHub.
  useLayoutEffect(() => {
    if (layout === 'year' && scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [layout, cells.length]);

  const show = (e, cell) => {
    if (!cell.inRange || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const half = 110;
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, half), box.width - half);
    // Above the day, or below it when there isn't room above.
    const below = r.top - box.top < 90;
    const y = below ? r.bottom - box.top + 8 : r.top - box.top - 8;
    setTip({ key: cell.key, day: byDay.get(cell.key), x, y, below });
  };

  const cellProps = (cell, i) => ({
    key: cell.key,
    onMouseEnter: (e) => show(e, cell),
    onClick: (e) => show(e, cell),
    'data-day': cell.inRange ? cell.key : undefined,
    initial: { opacity: 0, scale: 0.5 },
    animate: { opacity: 1, scale: 1 },
    transition: { duration: 0.35, ease: EASE, delay: layout === 'year' ? Math.floor(i / 7) * 0.012 : i * 0.012 },
    style: {
      backgroundColor: cell.inRange ? cellColor(byDay.get(cell.key), max) : 'transparent',
      outline: tip?.key === cell.key ? '2px solid var(--dp-text-primary)' : 'none',
      outlineOffset: 1,
    },
  });

  return (
    <Panel title="Profit calendar" sub={`${SUBTITLE[dateRange] || ''} Darker green is more profit; red is a loss. Hover or tap a day for details.`}>
      <div ref={wrapRef} className="relative" onMouseLeave={() => setTip(null)}>
        <AnimatePresence>{tip && <Tip key="tip" tip={tip} />}</AnimatePresence>

        {layout === 'row' && (
          <div className="grid max-w-2xl grid-cols-7 gap-1.5" role="grid" aria-label="Profit per day">
            {cells.map((cell, i) => (
              <div key={cell.key} className="flex flex-col items-center gap-1">
                <MotionDiv {...cellProps(cell, i)} className="h-14 w-full cursor-default rounded-md" />
                <span className="text-[10px] text-[var(--dp-text-label)]">{WEEKDAYS[cell.weekday]} {cell.dayOfMonth}</span>
              </div>
            ))}
          </div>
        )}

        {layout === 'month' && (
          <div role="grid" aria-label="Profit per day" className="max-w-2xl">
            <div className="grid grid-cols-7 gap-1.5 mb-1">
              {WEEKDAYS.map((w) => <span key={w} className="text-center text-[10px] text-[var(--dp-text-label)]">{w}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {cells.map((cell, i) => (
                <MotionDiv {...cellProps(cell, i)} className="relative h-9 cursor-default rounded-md">
                  {cell.inRange && <span className="absolute left-1.5 top-1 text-[9px] text-[var(--dp-text-label)]">{cell.dayOfMonth}</span>}
                </MotionDiv>
              ))}
            </div>
          </div>
        )}

        {layout === 'year' && (
          <div ref={scrollRef} className="overflow-x-auto pb-1" role="grid" aria-label="Profit per day">
            {/* One grid, filled column by column: a month label on top of each
                week, then its seven days. Squares grow to fit the card. */}
            <div
              className="grid grid-flow-col gap-[3px]"
              style={{ gridTemplateRows: 'auto repeat(7, auto)', gridTemplateColumns: `28px repeat(${weeks}, minmax(10px, 20px))` }}
            >
              <span />
              {WEEKDAYS.map((w, i) => (
                <span key={w} className="self-center pr-1.5 text-right text-[9px] text-[var(--dp-text-label)]">{i % 2 ? w : ''}</span>
              ))}
              {Array.from({ length: weeks }, (_, w) => {
                const label = monthLabels.find((l) => l.col === w);
                return (
                  <React.Fragment key={w}>
                    <span className="h-4 overflow-visible whitespace-nowrap text-[10px] text-[var(--dp-text-label)]">{label?.text ?? ''}</span>
                    {cells.slice(w * 7, w * 7 + 7).map((cell, d) => (
                      <MotionDiv {...cellProps(cell, w * 7 + d)} className="aspect-square w-full cursor-default rounded-[3px]" />
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--dp-text-muted)] tabular-nums">
        {activeDays > 0 ? (
          <>
            <b className={total >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]'}>{signed(total)}</b> over {activeDays} day{activeDays === 1 ? '' : 's'} with sales
            {best && <> · Best day {shortDate(best.date)}: <b className="text-[var(--dp-green-text)]">{usd(best.profit)}</b></>}
          </>
        ) : 'No sales in this range'}
      </p>
    </Panel>
  );
}
