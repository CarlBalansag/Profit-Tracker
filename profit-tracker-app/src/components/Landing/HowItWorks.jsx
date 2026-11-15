import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useMotionValueEvent, useScroll } from 'motion/react';
import { Check, CheckCircle2, Clock, PackagePlus, Tag } from 'lucide-react';
import { applyAction, cashFlow, formatMoney, itemProfit, monthlySeries, platformFee, toISODate, totals } from './demoData';
import { EASE_OUT, EASE_QUART, blurIn, popIn, useSequence } from './landingShared';
import { Tween } from './Fragments';
import TiltCard from './TiltCard';

// "How it works" as a pinned scroll story, the way Copilot tells its
// assistant: the app window stays put while you scroll, and each step of the
// scroll plays the next scene in it. One pair of sneakers goes all the way
// from checkout to payout. On phones the scenes stack and play as they come
// into view instead.

const MotionDiv = motion.div;
const MotionSpan = motion.span;
const MotionLi = motion.li;

const STEPS = [
  { title: 'Log what you buy', body: 'Item, price and the card you paid with. Cashback is worked out for you.', icon: PackagePlus },
  { title: 'Log it when it sells', body: 'Pick where it sold. The fee and your profit are done the moment you enter the price.', icon: Tag },
  { title: 'Watch everything update', body: 'Profit, inventory and your charts move on their own. No formulas to fix.', icon: Check },
  { title: 'Know when you get paid', body: 'Every sale waits in payouts until the money lands, so nothing slips.', icon: Clock },
];

const ITEM = 'Jordan 1 Retro High OG';
const COST = '180';
const PRICE = '295';
const PLATFORM = 'StockX';

// Types `text` out a few characters at a time once `go` is true.
function TypeText({ text, go, speed = 38 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!go) return undefined;
    let i = 0;
    const id = setInterval(() => { i += 1; setN(i); if (i >= text.length) clearInterval(id); }, speed);
    return () => clearInterval(id);
  }, [go, text, speed]);
  const shown = go ? text.slice(0, n) : '';
  return (
    <span>
      {shown}
      {go && n < text.length && <span className="lp-caret" aria-hidden="true" />}
    </span>
  );
}

function Field({ label, children, active }) {
  return (
    <div>
      <div className="text-[11.5px] font-bold text-[var(--lp-text-2)] mb-1.5">{label}</div>
      <div className={`lp-field ${active ? 'is-active' : ''}`}>{children}</div>
    </div>
  );
}

function PressButton({ pressed, children }) {
  return (
    <MotionDiv
      className="lp-fake-btn"
      animate={pressed ? { scale: [1, 0.95, 1], filter: ['brightness(1)', 'brightness(1.25)', 'brightness(1)'] } : {}}
      transition={{ duration: 0.4, ease: EASE_QUART }}
    >
      {children}
    </MotionDiv>
  );
}

function Toast({ show, children }) {
  return (
    <AnimatePresence>
      {show && (
        <MotionDiv
          initial={{ opacity: 0, y: 12, scale: 0.96, filter: 'blur(4px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.6, ease: EASE_OUT }}
          className="lp-toast"
        >
          {children}
        </MotionDiv>
      )}
    </AnimatePresence>
  );
}

// The four scenes. Each plays its own timeline from the moment it is shown.

function BuyScene({ play, story }) {
  const step = useSequence(play, [200, 1300, 2000, 2900, 3300]);
  return (
    <div className="space-y-3.5">
      <div className="text-[17px] font-extrabold">Log a purchase</div>
      <Field label="What did you buy?" active={step === 1}><TypeText text={ITEM} go={step >= 1} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="You paid" active={step === 2}><TypeText text={`$${COST}.00`} go={step >= 2} /></Field>
        <Field label="Card used" active={step === 3}>
          {step >= 3 && <MotionSpan variants={blurIn} initial="hidden" animate="show">{story.cardName} · 5% back</MotionSpan>}
        </Field>
      </div>
      <PressButton pressed={step >= 4}>Add to inventory</PressButton>
      <Toast show={step >= 5}>
        <CheckCircle2 size={15} className="text-[var(--lp-gain)]" />
        Added to inventory · <b className="text-[var(--lp-gain)]">{formatMoney(story.cashback, { sign: true })}</b> cashback
      </Toast>
    </div>
  );
}

function SellScene({ play, story }) {
  const step = useSequence(play, [200, 1000, 1700, 2100, 2500, 2900]);
  return (
    <div className="space-y-3.5">
      <div className="text-[17px] font-extrabold">Log a sale · <span className="text-[var(--lp-text-2)]">{ITEM}</span></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sold for" active={step === 1}><TypeText text={`$${PRICE}.00`} go={step >= 1} /></Field>
        <Field label="Where it sold" active={step === 2}>
          {step >= 2 && <MotionSpan variants={blurIn} initial="hidden" animate="show">{PLATFORM}</MotionSpan>}
        </Field>
      </div>
      <ul className="lp-receipt">
        {step >= 3 && <MotionLi variants={popIn} initial="hidden" animate="show"><span>{PLATFORM} fee, 12%</span><b>{formatMoney(-story.fee)}</b></MotionLi>}
        {step >= 4 && <MotionLi variants={popIn} initial="hidden" animate="show"><span>Shipping</span><b>$0.00</b></MotionLi>}
        {step >= 5 && <MotionLi variants={popIn} initial="hidden" animate="show"><span>You paid</span><b>{formatMoney(-story.cost)}</b></MotionLi>}
      </ul>
      <div className="flex items-end justify-between pt-1">
        <span className="font-extrabold">Profit</span>
        <span className="lp-display text-[40px] leading-none text-[var(--lp-gain)]">
          <Tween value={story.profit} start={step >= 6} format={(v) => formatMoney(Math.round(v), { sign: true })} />
        </span>
      </div>
    </div>
  );
}

function UpdateScene({ play, story }) {
  const step = useSequence(play, [700]);
  const s = step >= 1 ? story.after : story.before;
  const max = Math.max(1, ...story.afterMonths.map((m) => m.profit));
  const months = step >= 1 ? story.afterMonths : story.beforeMonths;
  const kpi = (label, value, fmt, tone) => (
    <div className="lp-hero-kpi">
      <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--lp-text-3)]">{label}</div>
      <div className={`text-[21px] font-extrabold mt-1 leading-none ${tone ? 'text-[var(--lp-gain)]' : ''}`}><Tween value={value} from={value} format={fmt} /></div>
    </div>
  );
  return (
    <div>
      <div className="text-[17px] font-extrabold mb-3.5">Dashboard</div>
      <div className="grid grid-cols-2 gap-2.5 mb-2.5">
        {kpi('Net profit', s.profit, (v) => formatMoney(Math.round(v)), true)}
        {kpi('Items sold', s.unitsSold * 100, (v) => String(Math.round(v / 100)))}
        {kpi('Inventory', s.inventoryValue, (v) => formatMoney(Math.round(v), { whole: true }))}
        {kpi('ROI', s.roi * 10000, (v) => `${(v / 100).toFixed(1)}%`, true)}
      </div>
      <div className="lp-hero-kpi">
        <div className="text-[12px] font-extrabold text-[var(--lp-text-2)] mb-2">Profit by month</div>
        <div className="flex items-end gap-2.5 h-[96px]">
          {months.map((m, i) => (
            <div key={m.key} className="flex-1 h-full flex items-end">
              <MotionDiv
                className={`w-full rounded-t-[4px] ${i === months.length - 1 && step >= 1 ? 'bg-[var(--lp-accent-text)]' : 'bg-[var(--lp-accent)]'}`}
                initial={false}
                animate={{ height: `${Math.max((m.profit / max) * 100, 3)}%` }}
                transition={{ duration: 0.9, ease: EASE_OUT }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PaidScene({ play, story }) {
  const step = useSequence(play, [1100, 1500]);
  const paid = step >= 2;
  return (
    <div>
      <div className="text-[17px] font-extrabold mb-3.5">Cash flow</div>
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className="lp-hero-kpi">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--lp-text-3)]">Money in</div>
          <div className="text-[21px] font-extrabold mt-1 leading-none text-[var(--lp-gain)]">
            <Tween value={paid ? story.moneyIn + story.net : story.moneyIn} from={story.moneyIn} format={(v) => formatMoney(Math.round(v), { whole: true })} />
          </div>
        </div>
        <div className="lp-hero-kpi">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--lp-text-3)]">On the way</div>
          <div className="text-[21px] font-extrabold mt-1 leading-none text-[var(--lp-warn)]">
            <Tween value={paid ? story.pending : story.pending + story.net} from={story.pending + story.net} format={(v) => formatMoney(Math.round(v), { whole: true })} />
          </div>
        </div>
      </div>
      <div className={`flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 transition-colors duration-500 ${paid ? 'bg-[rgba(143,195,158,0.12)]' : 'bg-[var(--lp-well)]'}`}>
        <div className="min-w-0">
          <div className="text-[14px] font-bold truncate">{ITEM}</div>
          <div className="lp-num text-[12px] text-[var(--lp-text-3)]">{PLATFORM} · {formatMoney(story.net)}</div>
        </div>
        {paid ? (
          <MotionSpan initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ duration: 0.5, ease: EASE_OUT }}
            className="inline-flex items-center gap-1 text-[12.5px] font-bold text-[var(--lp-gain)]">
            <CheckCircle2 size={14} /> Paid
          </MotionSpan>
        ) : (
          <MotionSpan animate={step >= 1 ? { scale: [1, 0.92, 1] } : {}} transition={{ duration: 0.4 }} className="rounded-lg border border-[var(--lp-border-strong)] px-3 py-1.5 text-[12px] font-bold">Mark paid</MotionSpan>
        )}
      </div>
    </div>
  );
}

const SCENES = [BuyScene, SellScene, UpdateScene, PaidScene];

function SceneWindow({ index, play, story }) {
  const Scene = SCENES[index];
  return (
    <TiltCard className="w-full">
      <div className="lp-story-window" aria-hidden="true">
        <div className="h-9 flex items-center gap-2 px-4 bg-[var(--lp-sidebar)] border-b border-[var(--lp-border)]">
          <span className="w-2 h-2 rounded-full bg-[#4a4c51]" /><span className="w-2 h-2 rounded-full bg-[#4a4c51]" /><span className="w-2 h-2 rounded-full bg-[#4a4c51]" />
        </div>
        <div className="p-5 sm:p-6 min-h-[360px]">
          <AnimatePresence mode="wait" initial={false}>
            <MotionDiv
              key={index}
              initial={{ opacity: 0, y: 12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)', transition: { opacity: { duration: 0.5, ease: EASE_QUART }, default: { duration: 0.8, ease: EASE_OUT } } }}
              exit={{ opacity: 0, y: -10, filter: 'blur(8px)', transition: { duration: 0.3, ease: EASE_QUART } }}
            >
              <Scene play={play} story={story} />
            </MotionDiv>
          </AnimatePresence>
        </div>
      </div>
    </TiltCard>
  );
}

function useStoryData(items, today) {
  return useMemo(() => {
    const start = { items, nextId: items.length + 1 };
    const date = toISODate(today);
    const bought = applyAction(start, { type: 'logPurchase', name: ITEM, cost: COST, card: 'flex', store: 'Nike', date });
    const sold = applyAction(bought.state, { type: 'logSale', itemId: bought.item.id, price: PRICE, platform: PLATFORM, shipping: '', date });
    const fee = platformFee(PLATFORM, Number(PRICE) * 100);
    const flow = cashFlow(start.items);
    return {
      cardName: 'Freedom Flex',
      cashback: Math.round(Number(COST) * 100 * 0.05),
      cost: Number(COST) * 100,
      fee,
      profit: itemProfit(sold.item),
      net: Number(PRICE) * 100 - fee,
      before: totals(bought.state.items),
      after: totals(sold.state.items),
      beforeMonths: monthlySeries(bought.state.items, today),
      afterMonths: monthlySeries(sold.state.items, today),
      moneyIn: flow.moneyIn,
      pending: flow.pendingTotal,
    };
  }, [items, today]);
}

function StepList({ active, onPick }) {
  return (
    <ol className="space-y-2">
      {STEPS.map((s, i) => {
        const on = i === active;
        const Icon = s.icon;
        return (
          <li key={s.title}>
            <button type="button" onClick={() => onPick(i)} aria-current={on ? 'step' : undefined}
              className={`lp-focus lp-howstep ${on ? 'is-on' : ''}`}>
              <span className="lp-howstep-icon"><Icon size={16} /></span>
              <span className="min-w-0">
                <span className="block text-[18px] font-extrabold">{s.title}</span>
                <span className="lp-howstep-body"><span>{s.body}</span></span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export default function HowItWorks({ items, today }) {
  const story = useStoryData(items, today);
  const track = useRef(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length))));
  });

  // Clicking a step scrolls to the part of the track that shows it.
  const pick = (i) => {
    const el = track.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const span = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + span * ((i + 0.5) / STEPS.length), behavior: 'smooth' });
  };

  return (
    <>
      {/* Wide screens: pinned window, scroll moves through the steps. */}
      <div ref={track} className="hidden md:block relative" style={{ height: `${STEPS.length * 85 + 40}vh` }}>
        <div className="sticky top-16 h-[calc(100vh-4rem)] flex items-center">
          <div className="w-full grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-12 items-center">
            <div>
              <StepList active={active} onPick={pick} />
              <div className="lp-howprogress mt-6" aria-hidden="true">
                <MotionDiv className="h-full bg-[var(--lp-accent-text)] origin-left" style={{ scaleX: scrollYProgress }} />
              </div>
            </div>
            <SceneWindow index={active} play story={story} />
          </div>
        </div>
      </div>

      {/* Phones and tablets: the scenes stack and play as they scroll in. */}
      <ol className="md:hidden space-y-12">
        {STEPS.map((s, i) => <PhoneStep key={s.title} step={s} index={i} story={story} />)}
      </ol>
    </>
  );
}

function PhoneStep({ step, index, story }) {
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.5 });
  return (
    <li ref={ref}>
      <div className="flex items-center gap-3 mb-2">
        <span className="lp-howstep-icon is-on"><step.icon size={16} /></span>
        <h3 className="text-[19px] font-extrabold">{step.title}</h3>
      </div>
      <p className="text-[15px] text-[var(--lp-text-2)] leading-relaxed mb-4">{step.body}</p>
      <SceneWindow index={index} play={inView} story={story} />
    </li>
  );
}
