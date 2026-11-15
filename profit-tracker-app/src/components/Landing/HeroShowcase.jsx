import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react';
import {
  BarChart3, CalendarDays, Clock, CreditCard, LayoutDashboard, Package, Tag, Wallet,
} from 'lucide-react';
import AnimatedLogo from '../UI/AnimatedLogo';
import {
  applyAction, cardSummary, cashFlow, formatMoney, itemProfit, monthlySeries, toISODate, totals,
} from './demoData';
import { EASE_OUT, EASE_QUART, useSequence } from './landingShared';
import { Tween } from './Fragments';

const MotionDiv = motion.div;
const MotionLi = motion.li;
const MotionCircle = motion.circle;

const NAV = [
  ['Dashboard', LayoutDashboard], ['Log a sale', Tag], ['Inventory', Package], ['Credit cards', CreditCard],
  ['Cash flow', Wallet], ['Analytics', BarChart3], ['Calendar', CalendarDays],
];

const money = (v) => formatMoney(Math.round(v));
const moneyWhole = (v) => formatMoney(Math.round(v), { whole: true });
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function Kpi({ label, value, format, note, tone, delay }) {
  return (
    <div className="lp-hero-kpi">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--lp-text-3)]">{label}</div>
      <div className={`text-[21px] font-extrabold mt-1 leading-none ${tone === 'gain' ? 'text-[var(--lp-gain)]' : ''}`}>
        <Tween value={value} format={format} delay={delay} />
      </div>
      <div className="text-[11px] text-[var(--lp-text-3)] mt-1.5 truncate">{note}</div>
    </div>
  );
}

// The dashboard as it looks in the app, playing a short story on load: the
// numbers fill in, then a sale lands and every total moves with it.
function HeroDashboard({ before, after, sold, today, playing }) {
  const reduce = useReducedMotion();
  const step = useSequence(playing, [2600]);
  const state = step >= 1 ? after : before;
  const t = totals(state.items);
  const months = monthlySeries(state.items, today);
  const max = Math.max(1, ...monthlySeries(after.items, today).map((m) => m.profit));
  const recent = state.items.filter((x) => x.sale).sort((a, b) => b.sale.soldOn.localeCompare(a.sale.soldOn) || (b.id === sold.id) - (a.id === sold.id)).slice(0, 5);

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <div className="text-[19px] font-extrabold tracking-tight">Dashboard</div>
          <div className="text-[12.5px] text-[var(--lp-text-3)]">Everything you've bought and sold, added up.</div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] text-white text-[12px] font-bold px-3 py-2"><Tag size={13} /> Log a sale</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-2.5">
        <Kpi label="Net profit" value={t.profit} format={money} note={`${pct(t.margin)} margin`} tone="gain" delay={0.5} />
        <Kpi label="Revenue" value={t.revenue} format={moneyWhole} note={`${t.unitsSold} items sold`} delay={0.6} />
        <Kpi label="ROI" value={t.roi * 10000} format={(v) => pct(v / 10000)} note="profit ÷ what you paid" tone="gain" delay={0.7} />
        <Kpi label="Inventory" value={t.inventoryValue} format={moneyWhole} note={`${t.inStockCount} items in stock`} delay={0.8} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-2.5">
        <div className="lp-hero-kpi lg:col-span-3">
          <div className="text-[12px] font-extrabold text-[var(--lp-text-2)] mb-3">Profit by month</div>
          <div className="flex items-end gap-3 h-[150px]">
            {months.map((m, i) => (
              <div key={m.key} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
                <MotionDiv
                  className="w-full max-w-[30px] rounded-t-[5px] bg-[var(--lp-accent)] origin-bottom"
                  initial={reduce ? false : { scaleY: 0 }}
                  animate={{ scaleY: 1, height: `${Math.max((m.profit / max) * 100, 3)}%` }}
                  transition={{ scaleY: { duration: 0.9, ease: EASE_OUT, delay: 0.7 + i * 0.07 }, height: { duration: 0.8, ease: EASE_OUT } }}
                />
                <span className="text-[10.5px] text-[var(--lp-text-3)]">{m.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="lp-hero-kpi lg:col-span-2">
          <div className="text-[12px] font-extrabold text-[var(--lp-text-2)] mb-2">Recent sales</div>
          <ul className="space-y-1">
            {recent.map((x, i) => {
              const fresh = x.id === sold.id;
              return (
                <MotionLi
                  key={x.id}
                  layout={!reduce}
                  className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-2 ${fresh ? 'lp-print' : ''}`}
                  initial={reduce ? false : { opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ opacity: { duration: 0.5, ease: EASE_QUART, delay: fresh ? 0 : 0.9 + i * 0.08 }, x: { duration: 0.7, ease: EASE_OUT, delay: fresh ? 0 : 0.9 + i * 0.08 }, layout: { duration: 0.6, ease: EASE_OUT } }}
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] font-bold truncate">{x.name}</div>
                    <div className="text-[11px] text-[var(--lp-text-3)]">{x.sale.platform} · {fresh ? 'just now' : shortDate(x.sale.soldOn)}</div>
                  </div>
                  <span className="lp-num text-[12.5px] font-extrabold text-[var(--lp-gain)] shrink-0">{formatMoney(itemProfit(x), { sign: true })}</span>
                </MotionLi>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// A picture of the app, not a working copy (the working demo is further down
// the page). It is inert so keyboard and screen-reader users skip past it.
function AppWindow({ children, dimmed }) {
  return (
    <div className="lp-window" aria-hidden="true" inert>
      <div className="h-10 flex items-center gap-2 px-4 bg-[var(--lp-sidebar)] border-b border-[var(--lp-border)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
      </div>
      <div className={`lp-window-body ${dimmed ? 'is-dimmed' : ''}`}>
        <div className="hidden md:block w-[190px] shrink-0 bg-[var(--lp-sidebar)] border-r border-[var(--lp-border)] px-2">
          <div className="flex items-center gap-2 px-3 h-14">
            <AnimatedLogo size={22} label={null} />
            <span className="text-[13px] font-extrabold tracking-tight">Profit Tracker</span>
          </div>
          {NAV.map((entry, i) => {
            const [label, Icon] = entry;
            return (
              <div key={label} className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-bold mb-1 ${i === 0 ? 'bg-[var(--lp-accent-tint)] text-[var(--lp-text)]' : 'text-[var(--lp-text-3)]'}`}>
                <Icon size={15} className={i === 0 ? 'text-[var(--lp-accent-text)]' : ''} /> {label}
              </div>
            );
          })}
        </div>
        <div className="flex-1 min-w-0 p-4 sm:p-6 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function Ring({ fraction, show }) {
  const reduce = useReducedMotion();
  return (
    <svg width="54" height="54" viewBox="0 0 54 54" className="-rotate-90 shrink-0" aria-hidden="true">
      <circle cx="27" cy="27" r="22" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="6" />
      <MotionCircle
        cx="27" cy="27" r="22" fill="none" stroke="var(--lp-accent-text)" strokeWidth="6" strokeLinecap="round"
        initial={{ pathLength: reduce ? fraction : 0 }}
        animate={{ pathLength: show || reduce ? fraction : 0 }}
        transition={{ duration: 1.3, ease: EASE_OUT, delay: show ? 0.25 : 0 }}
      />
    </svg>
  );
}

// Cards that lift out of the window while it is in the middle of the screen
// (the window dims behind them), and settle back in when it leaves.
function LiftCard({ className, show, delay, children }) {
  const reduce = useReducedMotion();
  const visible = show || reduce;
  return (
    <MotionDiv
      className={`lp-pop-card ${className}`}
      initial={false}
      animate={visible ? { opacity: 1, scale: 1, y: 0 } : { opacity: 0, scale: 0.94, y: 18 }}
      transition={{
        opacity: { duration: 0.65, ease: EASE_QUART, delay: visible ? delay : 0 },
        default: { duration: 0.9, ease: EASE_OUT, delay: visible ? delay : 0 },
      }}
    >
      {children}
    </MotionDiv>
  );
}

export default function HeroShowcase({ items, today }) {
  const ref = useRef(null);
  const stageRef = useRef(null);
  const reduce = useReducedMotion();
  const [playing, setPlaying] = useState(false);
  const inMiddle = useInView(stageRef, { amount: 0.6 });
  // Only once the visitor scrolls, so the intro plays undimmed first.
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 60));
  const spotlight = inMiddle && scrolled;

  // The sale that lands during the intro, run through the demo's own logic.
  const { before, after, sold } = useMemo(() => {
    const start = { items, nextId: items.length + 1 };
    const target = items.find((x) => !x.sale && x.name.startsWith('Travis Scott'));
    const res = applyAction(start, { type: 'logSale', itemId: target.id, price: '268', platform: 'StockX', shipping: '', date: toISODate(today) });
    return { before: start, after: res.state, sold: res.item };
  }, [items, today]);

  useEffect(() => {
    const t = setTimeout(() => setPlaying(true), 400);
    return () => clearTimeout(t);
  }, []);

  const t = totals(after.items);
  const flow = cashFlow(after.items);
  const best = [...cardSummary(after.items, today)].sort((a, b) => b.cashback - a.cashback)[0];

  return (
    <div ref={ref} className="relative mx-auto max-w-[1080px]">
      <div className="lp-window-haze" aria-hidden="true" />
      <MotionDiv
        ref={stageRef}
        initial={reduce ? false : { opacity: 0, y: 40, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ opacity: { duration: 0.8, ease: EASE_QUART, delay: 0.2 }, default: { duration: 1.1, ease: EASE_OUT, delay: 0.2 } }}
        className="relative"
      >
        <AppWindow dimmed={spotlight && !reduce}>
          <HeroDashboard before={before} after={after} sold={sold} today={today} playing={playing} />
        </AppWindow>
      </MotionDiv>

      <LiftCard className="left-2 sm:left-[-5%] top-[34%]" show={spotlight} delay={0}>
        <div className="flex items-center gap-3.5">
          <Ring fraction={t.unitsSold / after.items.length} show={spotlight} />
          <div>
            <div className="lp-display text-[20px] sm:text-[24px] leading-none lp-num whitespace-nowrap">{t.unitsSold} of {after.items.length}</div>
            <div className="text-[12px] text-[var(--lp-text-3)] mt-1">items sold</div>
          </div>
        </div>
      </LiftCard>

      <LiftCard className="right-[-5%] top-[14%] hidden sm:block" show={spotlight} delay={0.12}>
        <div className="text-[12px] font-bold text-[var(--lp-text-3)]">Best card for cashback</div>
        <div className="text-[15px] font-extrabold mt-1">{best.name}</div>
        <div className="lp-display text-[26px] leading-none mt-2 text-[var(--lp-gain)] lp-num">{formatMoney(best.cashback, { sign: true })}</div>
      </LiftCard>

      <LiftCard className="right-2 sm:right-[3%] bottom-[10%]" show={spotlight} delay={0.24}>
        <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--lp-warn)]"><Clock size={13} /> On the way</div>
        <div className="lp-display text-[26px] leading-none mt-2 lp-num">{formatMoney(flow.pendingTotal)}</div>
        <div className="text-[12px] text-[var(--lp-text-3)] mt-1.5">{flow.pending.length} payouts not landed yet</div>
      </LiftCard>
    </div>
  );
}
