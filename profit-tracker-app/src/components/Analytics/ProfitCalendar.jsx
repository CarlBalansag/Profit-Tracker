// Profit per day for exactly the days the date filter covers.
//   7 Days    one row of seven days
//   30 Days   a wall calendar (Sun–Sat columns, one row per week)
//   YTD       GitHub-style year: one column per week since Jan 1
//   All Time  only the days that had sales, grouped by month, so it is a
//             handful of squares for a new account and grows with the history.
// Hovering a day shows its totals; clicking it opens the sales behind them
// in a panel at the side (below, on a phone).
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { Panel } from './Motion';

const MotionDiv = motion.div;
const MotionLi = motion.li;
const EASE = [0.16, 1, 0.3, 1];
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const fmt = (n) => (n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n) => `${n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const signed = (n) => `${n > 0 ? '+' : n < 0 ? '−' : ''}$${fmt(Math.abs(n ?? 0))}`;
const parse = (key) => new Date(`${key}T00:00:00Z`);
const iso = (d) => d.toISOString().slice(0, 10);
const longDate = (key) => parse(key).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = (key) => parse(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fullDate = (key) => parse(key).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const profitTone = (n) => (n >= 0 ? 'text-[var(--dp-green-text)]' : 'text-[var(--dp-red-text)]');

// The days to draw. The API sends them; an older saved copy of the data may
// not have them (or may be a bare list of days), so they can be worked out
// here the same way.
function rangeFor(dateRange, calendar, days, now = new Date()) {
  if (calendar && !Array.isArray(calendar) && calendar.from && calendar.to) {
    return { from: parse(calendar.from), to: parse(calendar.to) };
  }
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (dateRange === 'YTD') return { from: new Date(Date.UTC(to.getUTCFullYear(), 0, 1)), to };
  if (dateRange === 'All Time') return { from: days.length ? parse(days[0].date) : to, to };
  return { from: new Date(to.getTime() - (dateRange === '7 Days' ? 6 : 29) * DAY), to };
}

// Days from `from` to `to`; calendar layouts pad out to whole weeks with
// blank cells so every column is Sun–Sat.
function buildCells(from, to, padWeeks) {
  const start = padWeeks ? new Date(from.getTime() - from.getUTCDay() * DAY) : from;
  const end = padWeeks ? new Date(to.getTime() + (6 - to.getUTCDay()) * DAY) : to;
  const out = [];
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const d = new Date(t);
    out.push({ key: iso(d), inRange: d >= from && d <= to, weekday: d.getUTCDay(), dayOfMonth: d.getUTCDate() });
  }
  return out;
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
            <div className={`mt-0.5 text-sm font-bold tabular-nums ${profitTone(d.profit)}`}>
              {signed(d.profit)} {d.profit >= 0 ? 'profit' : 'loss'}
            </div>
            <div className="mt-0.5 tabular-nums text-[var(--dp-text-muted)]">
              {plural(d.sales, 'sale')}{d.units != null && d.units !== d.sales ? ` · ${d.units} units` : ''}
            </div>
            {d.revenue != null && (
              <div className="tabular-nums text-[var(--dp-text-muted)]">Revenue {usd(d.revenue)} · Cost {usd(d.cost)}</div>
            )}
            <div className="mt-1 text-[10px] text-[var(--dp-text-label)]">Click to see what sold</div>
          </>
        ) : <div className="mt-0.5 text-[var(--dp-text-muted)]">No sales</div>}
      </MotionDiv>
    </div>
  );
}

// What sold on the chosen day, and what each sale made or lost.
function DayPanel({ dayKey, day, onClose }) {
  const items = day?.items;
  return (
    <MotionDiv
      key={dayKey}
      role="region"
      aria-label={`Sales on ${longDate(dayKey)}`}
      className="min-w-0 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-hover-bg)] p-4"
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 16, transition: { duration: 0.15 } }}
      transition={{ duration: 0.3, ease: EASE }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-[var(--dp-text-secondary)]">{longDate(dayKey)}</div>
          {day && day.sales > 0 ? (
            <>
              <div className={`mt-1 text-xl font-bold tabular-nums ${profitTone(day.profit)}`}>
                {signed(day.profit)} <span className="text-xs font-semibold">{day.profit >= 0 ? 'profit' : 'loss'}</span>
              </div>
              <div className="text-[11px] tabular-nums text-[var(--dp-text-muted)]">
                {plural(day.sales, 'sale')}{day.units != null && day.units !== day.sales ? ` · ${day.units} units` : ''}
                {day.revenue != null && <> · {usd(day.revenue)} in · {usd(day.cost)} cost</>}
              </div>
            </>
          ) : <div className="mt-1 text-sm text-[var(--dp-text-muted)]">No sales on this day.</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close day details"
          className="shrink-0 rounded-md p-1 text-[var(--dp-text-label)] hover:bg-[var(--dp-card-bg)] hover:text-[var(--dp-text-primary)] transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {day && day.sales > 0 && (
        items?.length ? (
          <ul className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
            {items.map((item, i) => (
              <MotionLi
                key={item.id}
                className="rounded-lg bg-[var(--dp-card-bg)] px-3 py-2"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, ease: EASE, delay: 0.05 + i * 0.04 }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[var(--dp-text-primary)]" title={item.product}>{item.product}</div>
                    <div className="text-[10px] text-[var(--dp-text-label)]">
                      {[item.platform, item.units > 1 ? `${item.units} units` : null].filter(Boolean).join(' · ') || 'Direct'}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`text-xs font-bold tabular-nums ${profitTone(item.profit)}`}>{signed(item.profit)}</div>
                    <div className="text-[10px] tabular-nums text-[var(--dp-text-label)]">{usd(item.revenue)} − {usd(item.cost)}</div>
                  </div>
                </div>
              </MotionLi>
            ))}
          </ul>
        ) : <p className="mt-3 text-[11px] text-[var(--dp-text-muted)]">Refresh the page to see the sales for this day.</p>
      )}
    </MotionDiv>
  );
}

// One GitHub-style strip: a month label over each week, then its 7 days.
function YearStrip({ cells, label, renderCell, scrollToEnd }) {
  const ref = useRef(null);
  const weeks = Math.ceil(cells.length / 7);
  const monthLabels = useMemo(() => {
    const out = new Map();
    let last = -1;
    for (let w = 0; w < weeks; w += 1) {
      const firstInRange = cells.slice(w * 7, w * 7 + 7).find((c) => c.inRange) || cells[w * 7];
      const m = parse(firstInRange.key).getUTCMonth();
      if (m !== last) {
        out.set(w, parse(firstInRange.key).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }));
        last = m;
      }
    }
    return out;
  }, [cells, weeks]);

  // The newest strip opens scrolled to today, like GitHub.
  useLayoutEffect(() => {
    if (scrollToEnd && ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [scrollToEnd, cells.length]);

  return (
    <div>
      {label && <div className="mb-1 text-[11px] font-semibold text-[var(--dp-text-secondary)]">{label}</div>}
      <div ref={ref} className="overflow-x-auto pb-1">
        <div
          className="grid grid-flow-col gap-[3px]"
          style={{ gridTemplateRows: 'auto repeat(7, auto)', gridTemplateColumns: `28px repeat(${weeks}, minmax(10px, 20px))` }}
        >
          <span />
          {WEEKDAYS.map((w, i) => (
            <span key={w} className="self-center pr-1.5 text-right text-[9px] text-[var(--dp-text-label)]">{i % 2 ? w : ''}</span>
          ))}
          {Array.from({ length: weeks }, (_, w) => (
            <React.Fragment key={w}>
              <span className="h-4 overflow-visible whitespace-nowrap text-[10px] text-[var(--dp-text-label)]">{monthLabels.get(w) ?? ''}</span>
              {cells.slice(w * 7, w * 7 + 7).map((cell, d) => renderCell(cell, w * 7 + d, 'aspect-square w-full rounded-[3px]'))}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function ProfitCalendar({ calendar, dateRange }) {
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const [tip, setTip] = useState(null);
  const [selected, setSelected] = useState(null);

  const view = useMemo(() => {
    const days = (Array.isArray(calendar) ? calendar : calendar?.days) ?? [];
    const byDay = new Map(days.map((d) => [d.date, d]));
    const { from, to } = rangeFor(dateRange, calendar, days);
    const layout = dateRange === '7 Days' ? 'row'
      : dateRange === '30 Days' ? 'month'
        : dateRange === 'All Time' ? 'active' : 'year';

    // All Time: just the days with sales, in date order, one group per month.
    const months = [];
    if (layout === 'active') {
      days.filter((d) => d.sales > 0).forEach((d) => {
        const key = d.date.slice(0, 7);
        let group = months[months.length - 1];
        if (!group || group.key !== key) {
          group = { key, total: 0, cells: [] };
          months.push(group);
        }
        group.total += d.profit;
        group.cells.push({ key: d.date, inRange: true, dayOfMonth: parse(d.date).getUTCDate() });
      });
    }
    const multiYear = months.length > 0 && months[0].key.slice(0, 4) !== months[months.length - 1].key.slice(0, 4);
    const inRange = days.filter((d) => { const t = parse(d.date); return t >= from && t <= to; });
    return {
      byDay,
      from,
      layout,
      months,
      multiYear,
      cells: layout === 'active' ? [] : buildCells(from, to, layout !== 'row'),
      max: Math.max(1, ...inRange.map((d) => Math.abs(d.profit))),
      best: inRange.reduce((b, d) => (d.profit > (b?.profit ?? 0) ? d : b), null),
      worst: inRange.reduce((w, d) => (d.profit < (w?.profit ?? 0) ? d : w), null),
      total: inRange.reduce((s, d) => s + d.profit, 0),
      activeDays: inRange.filter((d) => d.sales > 0).length,
    };
  }, [calendar, dateRange]);

  // A changed filter starts fresh.
  const [lastRange, setLastRange] = useState(dateRange);
  if (lastRange !== dateRange) { setLastRange(dateRange); setSelected(null); setTip(null); }

  // On a phone the panel opens below the calendar; bring it into view.
  useEffect(() => {
    if (selected && panelRef.current && window.matchMedia?.('(max-width: 1023px)').matches) {
      panelRef.current.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selected]);

  const showTip = (e, cell) => {
    if (!cell.inRange || !wrapRef.current) return;
    const box = wrapRef.current.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const half = 110;
    const x = Math.min(Math.max(r.left + r.width / 2 - box.left, half), Math.max(half, box.width - half));
    // Above the day, or below it when there isn't room above.
    const below = r.top - box.top < 110;
    const y = below ? r.bottom - box.top + 8 : r.top - box.top - 8;
    setTip({ key: cell.key, day: view.byDay.get(cell.key), x, y, below });
  };
  const choose = (cell) => {
    if (!cell.inRange) return;
    setTip(null);
    setSelected((cur) => (cur === cell.key ? null : cell.key));
  };

  const renderCell = (cell, i, shape, children) => {
    const day = view.byDay.get(cell.key);
    const hasSales = cell.inRange && day?.sales > 0;
    const isSelected = selected === cell.key;
    return (
      <MotionDiv
        key={cell.key}
        data-day={cell.inRange ? cell.key : undefined}
        role={hasSales ? 'button' : undefined}
        tabIndex={hasSales ? 0 : undefined}
        aria-pressed={hasSales ? isSelected : undefined}
        aria-label={hasSales ? `${longDate(cell.key)}: ${signed(day.profit)} from ${plural(day.sales, 'sale')}` : undefined}
        onMouseEnter={(e) => showTip(e, cell)}
        onClick={() => choose(cell)}
        onKeyDown={(e) => { if (hasSales && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(cell); } }}
        className={`${shape} ${cell.inRange ? 'cursor-pointer' : ''} focus-visible:outline-2 focus-visible:outline-[var(--dp-text-primary)]`}
        style={{
          backgroundColor: cell.inRange ? cellColor(day, view.max) : 'transparent',
          outline: isSelected ? '2px solid var(--dp-text-primary)' : tip?.key === cell.key ? '1px solid var(--dp-text-secondary)' : 'none',
          outlineOffset: 1,
        }}
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35, ease: EASE, delay: Math.min(view.layout === 'year' ? Math.floor(i / 7) * 0.012 : i * 0.012, 0.8) }}
      >
        {children}
      </MotionDiv>
    );
  };

  const subtitle = dateRange === 'All Time'
    ? `Only the days you made sales${view.activeDays ? `, since your first on ${fullDate(iso(view.from))}` : ''}.`
    : { '7 Days': 'The last 7 days.', '30 Days': 'The last 30 days.', YTD: 'Every day this year so far.' }[dateRange] || '';

  return (
    <Panel title="Profit calendar" sub={`${subtitle} Darker green is more profit; red is a loss. Click a day to see what sold.`}>
      <div className={`grid gap-4 ${selected ? 'lg:grid-cols-[minmax(0,1fr)_320px]' : ''}`}>
        <div ref={wrapRef} className="relative min-w-0" onMouseLeave={() => setTip(null)}>
          <AnimatePresence>{tip && <Tip key="tip" tip={tip} />}</AnimatePresence>

          {view.layout === 'row' && (
            <div className="grid max-w-2xl grid-cols-7 gap-1.5" role="grid" aria-label="Profit per day">
              {view.cells.map((cell, i) => (
                <div key={cell.key} className="flex flex-col items-center gap-1">
                  {renderCell(cell, i, 'h-14 w-full rounded-md')}
                  <span className="text-[10px] text-[var(--dp-text-label)]">{WEEKDAYS[cell.weekday]} {cell.dayOfMonth}</span>
                </div>
              ))}
            </div>
          )}

          {view.layout === 'month' && (
            <div role="grid" aria-label="Profit per day" className="max-w-2xl">
              <div className="grid grid-cols-7 gap-1.5 mb-1">
                {WEEKDAYS.map((w) => <span key={w} className="text-center text-[10px] text-[var(--dp-text-label)]">{w}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {view.cells.map((cell, i) => renderCell(cell, i, 'relative h-9 rounded-md',
                  cell.inRange ? <span className="absolute left-1.5 top-1 text-[9px] text-[var(--dp-text-label)]">{cell.dayOfMonth}</span> : null))}
              </div>
            </div>
          )}

          {view.layout === 'year' && (
            <div role="grid" aria-label="Profit per day">
              <YearStrip cells={view.cells} scrollToEnd renderCell={renderCell} />
            </div>
          )}

          {view.layout === 'active' && (
            view.months.length ? (
              <div role="grid" aria-label="Days with sales" className="flex flex-wrap gap-x-6 gap-y-4">
                {view.months.map((month, mi) => {
                  const offset = view.months.slice(0, mi).reduce((n, m) => n + m.cells.length, 0);
                  const label = parse(`${month.key}-01`).toLocaleDateString('en-US', {
                    month: 'short', ...(view.multiYear ? { year: 'numeric' } : {}), timeZone: 'UTC',
                  });
                  return (
                    <div key={month.key} className="min-w-0">
                      <div className="mb-1.5 flex items-baseline gap-2 text-[11px]">
                        <span className="font-semibold text-[var(--dp-text-secondary)]">{label}</span>
                        <span className={`tabular-nums ${profitTone(month.total)}`}>{signed(month.total)}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {month.cells.map((cell, i) => renderCell(cell, offset + i, 'relative h-9 w-9 rounded-md',
                          <span className="absolute left-1.5 top-1 text-[9px] text-[var(--dp-text-primary)] opacity-70">{cell.dayOfMonth}</span>))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : <p className="py-6 text-center text-sm text-[var(--dp-text-muted)]">No sales yet.</p>
          )}
        </div>

        <div ref={panelRef} className="min-w-0 empty:hidden">
          <AnimatePresence mode="wait">
            {selected && <DayPanel key={selected} dayKey={selected} day={view.byDay.get(selected)} onClose={() => setSelected(null)} />}
          </AnimatePresence>
        </div>
      </div>

      <p className="mt-3 text-[11px] text-[var(--dp-text-muted)] tabular-nums">
        {view.activeDays > 0 ? (
          <>
            <b className={profitTone(view.total)}>{signed(view.total)}</b> over {plural(view.activeDays, 'day')} with sales
            {view.best && <> · Best day {shortDate(view.best.date)}: <b className="text-[var(--dp-green-text)]">{usd(view.best.profit)}</b></>}
            {view.worst && <> · Worst day {shortDate(view.worst.date)}: <b className="text-[var(--dp-red-text)]">{usd(view.worst.profit)}</b></>}
          </>
        ) : 'No sales in this range'}
      </p>
    </Panel>
  );
}
