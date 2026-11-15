import React, { useEffect, useMemo, useRef, useState } from 'react';
import { animate, motion, useInView } from 'motion/react';
import { Check, CheckCircle2, Clock, Sparkles } from 'lucide-react';
import {
  byPlatform, calendarEvents, cardOf, cardSummary, cashFlow, cashbackOf, formatMoney, itemProfit,
  saleNet, toISODate, totals,
} from './demoData';
import { EASE_OUT, EASE_QUART, blurIn, popIn, useSequence } from './landingShared';

// Pieces of the app that explain each feature on the landing page. Each one
// plays a short story when it scrolls into view (the way Copilot's sections
// do): parts arrive from a slight blur, then one thing happens in the app and
// the numbers move. They read the same fake data as the demo, so every number
// on the page agrees with the demo below it.

const MotionDiv = motion.div;
const MotionLi = motion.li;
const MotionSpan = motion.span;
const MotionCircle = motion.circle;

// A number that glides to its new value whenever it changes, starting from
// `from` the first time.
export function Tween({ value, from = 0, format = (v) => formatMoney(Math.round(v)), duration = 1.1, delay = 0, start = true }) {
  const [shown, setShown] = useState(from);
  const current = useRef(from);
  useEffect(() => {
    if (!start) return undefined;
    const controls = animate(current.current, value, {
      duration, delay, ease: EASE_OUT,
      onUpdate: (v) => { current.current = v; setShown(v); },
    });
    return () => controls.stop();
  }, [value, duration, delay, start]);
  return <span className="lp-num">{format(shown)}</span>;
}

// Tells a piece's story once it is mostly on screen.
function useStory(times) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.55 });
  const step = useSequence(inView, times);
  return { ref, inView, step };
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } } };

function Frag({ title, aside, children, className = '', storyRef, inView }) {
  return (
    <MotionDiv
      ref={storyRef}
      className={`lp-frag ${className}`}
      variants={stagger}
      initial="hidden"
      animate={inView ? 'show' : 'hidden'}
    >
      {(title || aside) && (
        <MotionDiv variants={blurIn} className="flex items-center justify-between gap-3 mb-3">
          <span className="text-[13px] font-extrabold text-[var(--lp-text-2)]">{title}</span>
          {aside}
        </MotionDiv>
      )}
      {children}
    </MotionDiv>
  );
}

// Text that is typed out left to right, like a receipt printing.
const print = {
  hidden: { opacity: 0, clipPath: 'inset(0 100% 0 0)', x: -3 },
  show: {
    opacity: 1, clipPath: 'inset(0 0% 0 0)', x: 0,
    transition: { opacity: { duration: 0.3, ease: EASE_QUART }, default: { duration: 0.75, ease: EASE_QUART } },
  },
};

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / 86400000);
const signed = (v) => formatMoney(Math.round(v), { sign: true });

function Line({ label, value, tone, strong }) {
  return (
    <MotionLi variants={print} className={`flex justify-between gap-4 py-2 ${strong ? 'pt-3 mt-1 border-t border-[var(--lp-border-strong)]' : 'border-b border-[var(--lp-border)]'}`}>
      <span className={strong ? 'font-extrabold' : 'text-[var(--lp-text-2)]'}>{label}</span>
      <span className={`lp-num font-bold ${tone === 'gain' ? 'text-[var(--lp-gain)]' : tone === 'loss' ? 'text-[var(--lp-loss)]' : ''}`}>{value}</span>
    </MotionLi>
  );
}

// ─── Overview pieces ───────────────────────────────────────────────────────

// Selling: the sale prints line by line, then the profit counts up.
export function SaleFragment({ items }) {
  const item = items.find((x) => x.sale && x.name.startsWith('Jordan 4'));
  const { ref, inView, step } = useStory([1100]);
  return (
    <Frag storyRef={ref} inView={inView} title={item.name} aside={<span className="text-[12px] text-[var(--lp-text-3)]">Sold on {item.sale.platform}</span>}>
      <ul className="text-[14px]">
        <Line label="Sold for" value={formatMoney(item.sale.price)} />
        <Line label={`${item.sale.platform} fee`} value={formatMoney(-item.sale.fees)} />
        <Line label="Shipping" value={formatMoney(-item.sale.shipping)} />
        <Line label="You paid" value={formatMoney(-item.cost)} />
        <MotionLi variants={blurIn} className="flex items-end justify-between pt-4">
          <span className="font-extrabold">Profit</span>
          <span className="lp-display text-[40px] leading-none text-[var(--lp-gain)]">
            <Tween value={itemProfit(item)} start={step >= 1} format={signed} />
          </span>
        </MotionLi>
      </ul>
    </Frag>
  );
}

// Buying: the purchase prints, the card is picked, the cashback lands, and it
// goes into inventory.
export function PurchaseFragment({ items }) {
  const item = items.find((x) => !x.sale && x.name.startsWith('Steam Deck'));
  const card = cardOf(item.card);
  const back = cashbackOf(item);
  const { ref, inView, step } = useStory([900, 1700, 2500]);
  return (
    <Frag storyRef={ref} inView={inView} title="New purchase" aside={<span className="text-[12px] text-[var(--lp-text-3)]">{shortDate(item.boughtOn)}</span>}>
      <MotionDiv variants={print} className="text-[18px] font-extrabold mb-1">{item.name}</MotionDiv>
      <MotionDiv variants={blurIn} className="text-[13px] text-[var(--lp-text-3)] mb-4">Bought at {item.store} · {formatMoney(item.cost)}</MotionDiv>
      <div className="space-y-2 min-h-[150px]">
        {step >= 1 && (
          <MotionDiv variants={popIn} initial="hidden" animate="show" className="flex items-center justify-between gap-3 rounded-xl bg-[var(--lp-well)] px-3.5 py-2.5">
            <span className="text-[13.5px] font-bold">{card.name}</span>
            <span className="text-[12px] font-bold text-[var(--lp-text-3)]">{card.rate * 100}% back</span>
          </MotionDiv>
        )}
        {step >= 2 && (
          <MotionDiv variants={popIn} initial="hidden" animate="show" className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5 lp-gain-flash">
            <span className="text-[13.5px] text-[var(--lp-text-2)]">Cashback earned</span>
            <span className="lp-num text-[15px] font-extrabold text-[var(--lp-gain)]">{signed(back)}</span>
          </MotionDiv>
        )}
        {step >= 3 && (
          <MotionDiv variants={popIn} initial="hidden" animate="show" className="flex items-center justify-between gap-3 px-3.5 pt-1">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-[var(--lp-text-2)]"><Check size={13} className="text-[var(--lp-gain)]" /> Added to inventory</span>
            <span className="lp-num text-[13px] text-[var(--lp-text-2)]">Real cost <b className="text-[var(--lp-text)]">{formatMoney(item.cost - back)}</b></span>
          </MotionDiv>
        )}
      </div>
    </Frag>
  );
}

// Money: a payout gets marked paid and moves out of "on the way".
export function PayoutsFragment({ items }) {
  const flow = cashFlow(items);
  const first = flow.pending[0];
  const { ref, inView, step } = useStory([1300, 1700]);
  const paid = step >= 2;
  return (
    <Frag
      storyRef={ref}
      inView={inView}
      title="Waiting on payouts"
      aside={<span className="text-[13px] font-extrabold text-[var(--lp-warn)]"><Tween value={paid ? flow.pendingTotal - saleNet(first) : flow.pendingTotal} from={flow.pendingTotal} start={paid} /></span>}
    >
      <ul className="space-y-2.5">
        {flow.pending.map((x) => {
          const done = paid && x.id === first.id;
          return (
            <MotionLi key={x.id} variants={popIn} className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition-colors duration-500 ${done ? 'bg-[rgba(143,195,158,0.1)]' : 'bg-[var(--lp-well)]'}`}>
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{x.name}</div>
                <div className="lp-num text-[12px] text-[var(--lp-text-3)]">{x.sale.platform} · {formatMoney(saleNet(x))}</div>
              </div>
              {x.id === first.id && !done ? (
                <MotionSpan
                  className="shrink-0 rounded-lg border border-[var(--lp-border-strong)] px-3 py-1.5 text-[12px] font-bold"
                  animate={step >= 1 ? { scale: [1, 0.92, 1], backgroundColor: ['rgba(255,255,255,0)', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0)'] } : {}}
                  transition={{ duration: 0.4, ease: EASE_QUART }}
                >
                  Mark paid
                </MotionSpan>
              ) : (
                <MotionSpan
                  key={done ? 'paid' : 'wait'}
                  initial={done ? { opacity: 0, y: 6, filter: 'blur(4px)' } : false}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                  className={`shrink-0 inline-flex items-center gap-1 text-[12px] font-bold ${done ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-text-3)]'}`}
                >
                  {done ? <><CheckCircle2 size={13} /> Paid</> : <><Clock size={13} /> On the way</>}
                </MotionSpan>
              )}
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

// Taxes: the expenses are scanned and each one gets its tax category.
export function ExpensesFragment() {
  const total = SAMPLE_EXPENSES.reduce((s, x) => s + x.amount, 0);
  const { ref, inView, step } = useStory([1000, 1900]);
  return (
    <Frag storyRef={ref} inView={inView} title="Expenses this month" aside={<span className="lp-num text-[13px] font-extrabold">{formatMoney(total)}</span>}>
      <div className="relative">
        {step === 1 && <div className="lp-scan" aria-hidden="true" />}
        <ul className="space-y-1">
          {SAMPLE_EXPENSES.map((x, i) => (
            <MotionLi key={x.name} variants={blurIn} className="flex items-center justify-between gap-3 py-2 border-b border-[var(--lp-border)] last:border-0">
              <div className="min-w-0">
                <div className="text-[14px] font-bold truncate">{x.name}</div>
                <div className="h-5 mt-0.5">
                  {step >= 2 && (
                    <MotionSpan
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 24, delay: i * 0.08 }}
                      className="inline-block text-[11px] font-bold rounded-full px-2 py-0.5 bg-[var(--lp-accent-tint)] text-[var(--lp-accent-text)]"
                    >
                      {x.cat}{x.recurring ? ' · monthly' : ''}
                    </MotionSpan>
                  )}
                </div>
              </div>
              <span className="lp-num text-[14px] font-bold">{formatMoney(x.amount)}</span>
            </MotionLi>
          ))}
        </ul>
      </div>
      <MotionDiv variants={blurIn} className="mt-3 text-[12.5px] text-[var(--lp-text-3)]">Grouped the way your Schedule C asks for it.</MotionDiv>
    </Frag>
  );
}

// ─── Feature-panel pieces ──────────────────────────────────────────────────

// Inventory: the shelf fills in, then the item that has sat longest is flagged.
export function InventoryFragment({ items, today }) {
  const stock = items.filter((x) => !x.sale);
  const todayISO = toISODate(today);
  const t = totals(items);
  const maxDays = Math.max(30, ...stock.map((x) => daysBetween(x.boughtOn, todayISO)));
  const oldest = [...stock].sort((a, b) => a.boughtOn.localeCompare(b.boughtOn))[0];
  const { ref, inView, step } = useStory([1500]);
  return (
    <Frag storyRef={ref} inView={inView} title="In stock" aside={<span className="lp-num text-[13px] font-extrabold">{formatMoney(t.inventoryValue)}</span>}>
      <ul className="space-y-2">
        {stock.map((x, i) => {
          const days = daysBetween(x.boughtOn, todayISO);
          const flagged = step >= 1 && x.id === oldest.id;
          return (
            <MotionLi key={x.id} variants={blurIn} className={`rounded-xl px-3 py-2 -mx-3 transition-colors duration-500 ${flagged ? 'bg-[var(--lp-accent-tint)]' : ''}`}>
              <div className="flex justify-between gap-3 text-[14px]">
                <span className="font-bold truncate">{x.name}</span>
                <span className="lp-num text-[var(--lp-text-2)] shrink-0">{formatMoney(x.cost)}</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-[var(--lp-well)] overflow-hidden">
                  <MotionDiv
                    className="h-full rounded-full bg-[var(--lp-accent)] origin-left"
                    style={{ width: `${(days / maxDays) * 100}%` }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: inView ? 1 : 0 }}
                    transition={{ duration: 1, ease: EASE_OUT, delay: 0.35 + i * 0.08 }}
                  />
                </div>
                <span className="lp-num text-[12px] text-[var(--lp-text-3)] w-16 text-right">{days} {days === 1 ? 'day' : 'days'}</span>
              </div>
              {flagged && (
                <MotionSpan
                  initial={{ opacity: 0, y: 4, filter: 'blur(4px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  transition={{ duration: 0.5, ease: EASE_OUT }}
                  className="block mt-1.5 text-[11.5px] font-bold text-[var(--lp-accent-text)]"
                >
                  Sitting the longest. Time to relist?
                </MotionSpan>
              )}
            </MotionLi>
          );
        })}
      </ul>
    </Frag>
  );
}

function Ring({ fraction, size = 52, play }) {
  const r = (size - 8) / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
      <MotionCircle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--lp-accent-text)" strokeWidth="6" strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: play ? fraction : 0 }}
        transition={{ duration: 1.2, ease: EASE_OUT, delay: 0.2 }}
      />
    </svg>
  );
}

// Cards: a purchase goes on a card and that card's cashback ticks up.
export function CardsFragment({ items, today }) {
  const cards = cardSummary(items, today);
  const purchase = items.find((x) => x.name.startsWith('Steam Deck'));
  const back = cashbackOf(purchase);
  const total = cards.reduce((s, c) => s + c.cashback, 0);
  const { ref, inView, step } = useStory([1500, 2200]);
  const landed = step >= 2;
  return (
    <Frag
      storyRef={ref}
      inView={inView}
      title="Cashback by card"
      aside={<span className="text-[13px] font-extrabold text-[var(--lp-gain)]"><Tween value={landed ? total : total - back} start={inView} format={signed} /></span>}
    >
      <div className="h-11 mb-2">
        {step >= 1 && (
          <MotionDiv variants={print} initial="hidden" animate="show" className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-[var(--lp-border-strong)] px-3.5 py-2.5 text-[13px]">
            <span className="font-bold truncate">{purchase.name}</span>
            <span className="lp-num text-[var(--lp-text-2)] shrink-0">{formatMoney(purchase.cost)} on {cardOf(purchase.card).name}</span>
          </MotionDiv>
        )}
      </div>
      <ul className="space-y-2.5">
        {cards.map((c) => {
          const hit = landed && c.id === purchase.card;
          const value = c.id === purchase.card && !landed ? c.cashback - back : c.cashback;
          return (
            <MotionLi key={c.id} variants={popIn} className={`relative flex items-center gap-4 rounded-xl px-3.5 py-3 transition-colors duration-500 ${hit ? 'bg-[rgba(143,195,158,0.1)]' : 'bg-[var(--lp-well)]'}`}>
              <div className="relative shrink-0">
                <Ring fraction={total ? value / total : 0} play={inView} />
                <span className="absolute inset-0 grid place-items-center text-[11.5px] font-extrabold">{c.rate * 100}%</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-bold truncate">{c.name}</div>
                <div className="text-[12px] text-[var(--lp-text-3)]">•••• {c.last4}</div>
              </div>
              <span className="text-[14px] font-extrabold text-[var(--lp-gain)]">
                <Tween value={value} start={inView} delay={0.3} format={signed} />
              </span>
              {hit && (
                <MotionSpan
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: [0, 1, 1, 0], y: [6, -12, -16, -24] }}
                  transition={{ duration: 1.6, ease: EASE_OUT, times: [0, 0.2, 0.7, 1] }}
                  className="absolute right-3 -top-2 lp-num text-[12px] font-extrabold text-[var(--lp-gain)] pointer-events-none"
                >
                  {signed(back)}
                </MotionSpan>
              )}
            </MotionLi>
          );
        })}
      </ul>
    </Frag>
  );
}

// Analytics: the bars grow, then the best marketplace is called out.
export function AnalyticsFragment({ items }) {
  const platforms = byPlatform(items);
  const max = Math.max(1, ...platforms.map((p) => p.profit));
  const { ref, inView, step } = useStory([1600]);
  const top = platforms[0];
  return (
    <Frag storyRef={ref} inView={inView} title="Profit by marketplace">
      <div className="h-9 mb-2">
        {step >= 1 && (
          <MotionDiv variants={blurIn} initial="hidden" animate="show" className="inline-flex items-center gap-1.5 rounded-full bg-[var(--lp-accent-tint)] px-3 py-1.5 text-[12.5px] font-bold">
            <Sparkles size={13} className="text-[var(--lp-accent-text)]" /> {top.id} made you the most: {formatMoney(top.profit, { whole: true })}
          </MotionDiv>
        )}
      </div>
      <div className="flex items-end gap-3 h-[170px]" role="img" aria-label={platforms.map((p) => `${p.id} ${formatMoney(p.profit)}`).join(', ')}>
        {platforms.map((p, i) => (
          <div key={p.id} className="flex-1 h-full flex flex-col justify-end items-center gap-2 min-w-0">
            <span className="lp-num text-[12px] font-bold text-[var(--lp-text-2)]">{formatMoney(p.profit, { whole: true })}</span>
            <MotionDiv
              className="w-full max-w-[44px] rounded-t-md bg-[var(--lp-accent)] origin-bottom"
              style={{ height: `${Math.max((p.profit / max) * 100, 4)}%` }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: inView ? 1 : 0, opacity: step >= 1 && i > 0 ? 0.4 : 1 }}
              transition={{ scaleY: { duration: 0.9, ease: EASE_OUT, delay: 0.2 + i * 0.08 }, opacity: { duration: 0.5 } }}
            />
            <span className="text-[12px] text-[var(--lp-text-3)] truncate">{p.id}</span>
          </div>
        ))}
      </div>
    </Frag>
  );
}

// Calendar: the month fills with dots, then the latest busy day opens up.
export function CalendarFragment({ items, today }) {
  const events = useMemo(() => calendarEvents(items), [items]);
  const { ref, inView, step } = useStory([1800]);
  const todayISO = toISODate(today);
  const first = new Date(today.getFullYear(), today.getMonth(), 1);
  const daysIn = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysIn }, (_, i) => toISODate(new Date(today.getFullYear(), today.getMonth(), i + 1)))];
  const latest = Object.keys(events).filter((d) => d <= todayISO && d.slice(0, 7) === todayISO.slice(0, 7)).sort().pop();
  const open = step >= 1 && latest;
  return (
    <Frag storyRef={ref} inView={inView} title={today.toLocaleString('en-US', { month: 'long', year: 'numeric' })}>
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] font-bold text-[var(--lp-text-3)] mb-1.5">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => <span key={i}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((iso, i) => {
          if (!iso) return <span key={`b${i}`} />;
          const ev = events[iso] ?? [];
          const sold = ev.filter((e) => e.kind === 'sold').length;
          const on = open && iso === latest;
          return (
            <div key={iso} className={`h-10 rounded-lg flex flex-col items-center justify-center gap-1 text-[12px] transition-colors duration-500 ${on ? 'bg-[var(--lp-accent-tint)] ring-1 ring-[rgba(var(--accent-rgb),0.6)] text-[var(--lp-text)]' : ev.length ? 'bg-[var(--lp-well)] text-[var(--lp-text)]' : 'text-[var(--lp-text-3)]'}`}>
              <span className="lp-num leading-none">{Number(iso.slice(8))}</span>
              <span className="flex gap-0.5 h-1.5">
                {sold > 0 && (
                  <MotionSpan className="w-1.5 h-1.5 rounded-full bg-[var(--lp-accent-text)]"
                    initial={{ scale: 0 }} animate={{ scale: inView ? 1 : 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.3 + i * 0.02 }} />
                )}
                {ev.length > sold && (
                  <MotionSpan className="w-1.5 h-1.5 rounded-full bg-[var(--lp-text-3)]"
                    initial={{ scale: 0 }} animate={{ scale: inView ? 1 : 0 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 18, delay: 0.35 + i * 0.02 }} />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <div className="min-h-[86px] mt-3">
        {open && (
          <MotionDiv variants={stagger} initial="hidden" animate="show" className="rounded-xl bg-[var(--lp-well)] px-3.5 py-3">
            <MotionDiv variants={blurIn} className="text-[12px] font-bold text-[var(--lp-text-3)] mb-1.5">
              {new Date(`${latest}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
            </MotionDiv>
            {events[latest].map((e) => (
              <MotionDiv key={`${e.kind}-${e.item.id}`} variants={print} className="flex justify-between gap-3 text-[13px] py-0.5">
                <span className="truncate">{e.kind === 'sold' ? 'Sold' : 'Bought'} {e.item.name}</span>
                <span className={`lp-num font-bold shrink-0 ${e.kind === 'sold' ? 'text-[var(--lp-gain)]' : 'text-[var(--lp-text-2)]'}`}>
                  {e.kind === 'sold' ? signed(itemProfit(e.item)) : formatMoney(-e.item.cost)}
                </span>
              </MotionDiv>
            ))}
          </MotionDiv>
        )}
      </div>
    </Frag>
  );
}
