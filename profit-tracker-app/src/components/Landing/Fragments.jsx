import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useInView, useReducedMotion } from 'motion/react';
import { CheckCircle2, Clock } from 'lucide-react';
import {
  byPlatform, calendarEvents, cardOf, cardSummary, cashFlow, cashbackOf, formatMoney, itemProfit,
  saleNet, toISODate, totals,
} from './demoData';
import { EASE_OUT } from './landingShared';

// Small, self-contained pieces of the app used to explain each feature on the
// landing page. They read the same fake data as the demo, so every number on
// the page agrees with the demo below it.

const MotionDiv = motion.div;
const MotionLi = motion.li;
const MotionSpan = motion.span;
const MotionCircle = motion.circle;

// Counts up to `value` (cents) the first time it scrolls into view.
export function CountUp({ value, sign = false, whole = false, duration = 900 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-10% 0px' });
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!inView || reduce) return undefined;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(value * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduce]);
  return <span ref={ref} className="lp-num">{formatMoney(reduce ? value : shown, { sign, whole })}</span>;
}

// Children pop in one after another when the fragment scrolls into view.
const list = { hidden: {}, show: { transition: { staggerChildren: 0.08, delayChildren: 0.1 } } };
const pop = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.55, ease: EASE_OUT } },
};

function Frag({ title, aside, children, className = '' }) {
  const reduce = useReducedMotion();
  return (
    <MotionDiv
      className={`lp-frag ${className}`}
      variants={list}
      initial={reduce ? 'show' : 'hidden'}
      whileInView="show"
      viewport={{ once: true, margin: '-12% 0px' }}
    >
      {(title || aside) && (
        <div className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[13px] font-extrabold text-[var(--lp-text-2)]">{title}</span>
          {aside}
        </div>
      )}
      {children}
    </MotionDiv>
  );
}

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);

function Line({ label, value, tone, strong }) {
  return (
    <MotionLi variants={pop} className={`flex justify-between gap-4 py-2 ${strong ? 'pt-3 mt-1 border-t border-[var(--lp-border-strong)]' : 'border-b border-[var(--lp-border)]'}`}>
      <span className={strong ? 'font-extrabold' : 'text-[var(--lp-text-2)]'}>{label}</span>
      <span className={`lp-num font-bold ${tone === 'gain' ? 'text-[var(--lp-gain)]' : tone === 'loss' ? 'text-[var(--lp-loss)]' : ''}`}>{value}</span>
    </MotionLi>
  );
}

// ─── Overview fragments ────────────────────────────────────────────────────

export function SaleFragment({ items }) {
  const item = items.find((x) => x.sale && x.name.startsWith('Jordan 4'));
  return (
    <Frag title={item.name} aside={<span className="text-[12px] text-[var(--lp-text-3)]">Sold on {item.sale.platform}</span>}>
      <ul className="text-[14px]">
        <Line label="Sold for" value={formatMoney(item.sale.price)} />
        <Line label={`${item.sale.platform} fee`} value={formatMoney(-item.sale.fees)} />
        <Line label="Shipping" value={formatMoney(-item.sale.shipping)} />
        <Line label="You paid" value={formatMoney(-item.cost)} />
        <MotionLi variants={pop} className="flex items-end justify-between pt-4">
          <span className="font-extrabold">Profit</span>
          <span className="lp-display text-[40px] leading-none text-[var(--lp-gain)]"><CountUp value={itemProfit(item)} sign /></span>
        </MotionLi>
      </ul>
    </Frag>
  );
}

export function PurchaseFragment({ items }) {
  const item = items.find((x) => !x.sale && x.name.startsWith('Steam Deck'));
  const card = cardOf(item.card);
  const back = cashbackOf(item);
  return (
    <Frag title="New purchase" aside={<span className="text-[12px] text-[var(--lp-text-3)]">{shortDate(item.boughtOn)}</span>}>
      <MotionDiv variants={pop} className="text-[18px] font-extrabold mb-1">{item.name}</MotionDiv>
      <MotionDiv variants={pop} className="text-[13px] text-[var(--lp-text-3)] mb-4">Bought at {item.store}</MotionDiv>
      <ul className="text-[14px]">
        <Line label="You paid" value={formatMoney(item.cost)} />
        <Line label={`${card.name}, ${card.rate * 100}% back`} value={formatMoney(back, { sign: true })} tone="gain" />
        <Line label="Real cost" value={formatMoney(item.cost - back)} strong />
      </ul>
      <MotionDiv variants={pop} className="mt-4 inline-flex items-center gap-2 text-[12.5px] font-bold text-[var(--lp-text-2)] bg-[var(--lp-well)] rounded-full px-3 py-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]" /> Added to inventory
      </MotionDiv>
    </Frag>
  );
}

export function PayoutsFragment({ items }) {
  const flow = cashFlow(items);
  const [paid, setPaid] = useState([]);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-15% 0px' });
  const reduce = useReducedMotion();
  // Shows one payout landing a moment after it comes into view.
  const firstId = flow.pending[0]?.id;
  useEffect(() => {
    if (!inView || reduce || !firstId) return undefined;
    const t = setTimeout(() => setPaid([firstId]), 1400);
    return () => clearTimeout(t);
  }, [inView, reduce, firstId]);
  return (
    <Frag title="Waiting on payouts" aside={<span className="lp-num text-[13px] font-extrabold text-[var(--lp-warn)]">{formatMoney(flow.pendingTotal)}</span>}>
      <ul ref={ref} className="space-y-2.5">
        {flow.pending.map((x) => {
          const done = paid.includes(x.id);
          return (
            <MotionLi key={x.id} variants={pop} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--lp-well)] px-3.5 py-3">
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{x.name}</div>
                <div className="text-[12px] text-[var(--lp-text-3)]">{x.sale.platform} · sold {shortDate(x.sale.soldOn)}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="lp-num text-[14px] font-extrabold">{formatMoney(saleNet(x))}</div>
                <MotionSpan
                  key={done ? 'paid' : 'pending'}
                  initial={reduce ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`inline-flex items-center gap-1 text-[11.5px] font-bold ${done ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-text-3)]'}`}
                >
                  {done ? <><CheckCircle2 size={12} /> Paid</> : <><Clock size={12} /> On the way</>}
                </MotionSpan>
              </div>
            </MotionLi>
          );
        })}
      </ul>
    </Frag>
  );
}

const SAMPLE_EXPENSES = [
  { name: 'Shipping supplies', cat: 'Supplies', amount: 8420 },
  { name: 'Storage unit', cat: 'Rent', amount: 12000, recurring: true },
  { name: 'Listing software', cat: 'Software', amount: 2999, recurring: true },
  { name: 'Mileage to outlets', cat: 'Car and truck', amount: 4690 },
];

export function ExpensesFragment() {
  const total = SAMPLE_EXPENSES.reduce((s, x) => s + x.amount, 0);
  return (
    <Frag title="Expenses this month" aside={<span className="lp-num text-[13px] font-extrabold">{formatMoney(total)}</span>}>
      <ul className="space-y-1">
        {SAMPLE_EXPENSES.map((x) => (
          <MotionLi key={x.name} variants={pop} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--lp-border)] last:border-0">
            <div className="min-w-0">
              <div className="text-[14px] font-bold truncate">{x.name}</div>
              <div className="text-[12px] text-[var(--lp-text-3)]">{x.cat}{x.recurring ? ' · repeats monthly' : ''}</div>
            </div>
            <span className="lp-num text-[14px] font-bold">{formatMoney(x.amount)}</span>
          </MotionLi>
        ))}
      </ul>
      <MotionDiv variants={pop} className="mt-3 text-[12.5px] text-[var(--lp-text-3)]">Grouped by tax category, ready for your Schedule C.</MotionDiv>
    </Frag>
  );
}

// ─── Feature-row fragments ─────────────────────────────────────────────────

export function InventoryFragment({ items, today }) {
  const stock = items.filter((x) => !x.sale);
  const todayISO = toISODate(today);
  const t = totals(items);
  const maxDays = Math.max(30, ...stock.map((x) => daysBetween(x.boughtOn, todayISO)));
  const reduce = useReducedMotion();
  return (
    <Frag title="In stock" aside={<span className="lp-num text-[13px] font-extrabold">{formatMoney(t.inventoryValue)}</span>}>
      <ul className="space-y-3">
        {stock.map((x) => {
          const days = daysBetween(x.boughtOn, todayISO);
          return (
            <MotionLi key={x.id} variants={pop}>
              <div className="flex justify-between gap-3 text-[14px]">
                <span className="font-bold truncate">{x.name}</span>
                <span className="lp-num text-[var(--lp-text-2)] shrink-0">{formatMoney(x.cost)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--lp-well)] overflow-hidden">
                  <MotionDiv
                    className="h-full rounded-full bg-[var(--lp-accent)] origin-left"
                    style={{ width: `${(days / maxDays) * 100}%` }}
                    initial={reduce ? false : { scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.3 }}
                  />
                </div>
                <span className="lp-num text-[12px] text-[var(--lp-text-3)] w-16 text-right">{days} {days === 1 ? 'day' : 'days'}</span>
              </div>
            </MotionLi>
          );
        })}
      </ul>
    </Frag>
  );
}

function Ring({ fraction, size = 64 }) {
  const reduce = useReducedMotion();
  const r = (size - 8) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <MotionCircle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lp-accent-text)" strokeWidth="6" strokeLinecap="round"
        initial={{ pathLength: reduce ? fraction : 0 }}
        whileInView={{ pathLength: fraction }}
        viewport={{ once: true }}
        transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.25 }}
      />
    </svg>
  );
}

export function CardsFragment({ items, today }) {
  const cards = cardSummary(items, today);
  const total = cards.reduce((s, c) => s + c.cashback, 0);
  return (
    <Frag title="Cashback by card" aside={<span className="lp-num text-[13px] font-extrabold text-[var(--lp-gain)]">{formatMoney(total, { sign: true })}</span>}>
      <ul className="space-y-3">
        {cards.map((c) => (
          <MotionLi key={c.id} variants={pop} className="flex items-center gap-4 rounded-xl bg-[var(--lp-well)] px-3.5 py-3">
            <div className="relative shrink-0">
              <Ring fraction={total ? c.cashback / total : 0} size={52} />
              <span className="absolute inset-0 grid place-items-center text-[11.5px] font-extrabold">{c.rate * 100}%</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-bold truncate">{c.name}</div>
              <div className="text-[12px] text-[var(--lp-text-3)]">{c.purchases} purchases · •••• {c.last4}</div>
            </div>
            <span className="lp-num text-[14px] font-extrabold text-[var(--lp-gain)]">{formatMoney(c.cashback, { sign: true })}</span>
          </MotionLi>
        ))}
      </ul>
    </Frag>
  );
}

export function AnalyticsFragment({ items }) {
  const platforms = byPlatform(items);
  const max = Math.max(1, ...platforms.map((p) => p.profit));
  const reduce = useReducedMotion();
  return (
    <Frag title="Profit by marketplace">
      <div className="flex items-end gap-3 h-[180px]" role="img" aria-label={platforms.map((p) => `${p.id} ${formatMoney(p.profit)}`).join(', ')}>
        {platforms.map((p, i) => (
          <div key={p.id} className="flex-1 h-full flex flex-col justify-end items-center gap-2 min-w-0">
            <span className="lp-num text-[12px] font-bold text-[var(--lp-text-2)]">{formatMoney(p.profit, { whole: true })}</span>
            <MotionDiv
              className="w-full max-w-[44px] rounded-t-md bg-[var(--lp-accent)] origin-bottom"
              style={{ height: `${Math.max((p.profit / max) * 100, 4)}%`, opacity: i === 0 ? 1 : 0.6 }}
              initial={reduce ? false : { scaleY: 0 }}
              whileInView={{ scaleY: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8, ease: EASE_OUT, delay: 0.15 + i * 0.08 }}
            />
            <span className="text-[12px] text-[var(--lp-text-3)] truncate">{p.id}</span>
          </div>
        ))}
      </div>
    </Frag>
  );
}

export function CalendarFragment({ items, today }) {
  const events = useMemo(() => calendarEvents(items), [items]);
  const reduce = useReducedMotion();
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysIn = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => toISODate(new Date(today.getFullYear(), today.getMonth(), i + 1)))];
  return (
    <Frag title={today.toLocaleString('en-US', { month: 'long', year: 'numeric' })}>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-[var(--lp-text-3)] mb-1.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`b${i}`} />;
          const ev = events[iso] ?? [];
          const sold = ev.filter((e) => e.kind === 'sold').length;
          return (
            <div key={iso} className={`h-10 rounded-lg flex flex-col items-center justify-center gap-1 text-[12px] ${ev.length ? 'bg-[var(--lp-well)] text-[var(--lp-text)]' : 'text-[var(--lp-text-3)]'}`}>
              <span className="lp-num leading-none">{Number(iso.slice(8))}</span>
              <span className="flex gap-0.5 h-1.5">
                {sold > 0 && (
                  <MotionSpan className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]"
                    initial={reduce ? false : { scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.2 + i * 0.015 }} />
                )}
                {ev.length > sold && (
                  <MotionSpan className="w-1.5 h-1.5 rounded-full bg-[var(--lp-text-3)]"
                    initial={reduce ? false : { scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.25 + i * 0.015 }} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex gap-4 mt-3 text-[12px] text-[var(--lp-text-3)]">
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]" />Sold</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-[var(--lp-text-3)]" />Bought</span>
      </div>
    </Frag>
  );
}
