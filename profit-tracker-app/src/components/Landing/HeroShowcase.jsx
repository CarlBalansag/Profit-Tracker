import React, { useRef } from 'react';
import { motion, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import {
  BarChart3, CalendarDays, Clock, CreditCard, LayoutDashboard, Package, Tag, Wallet,
} from 'lucide-react';
import AnimatedLogo from '../UI/AnimatedLogo';
import { DashboardScreen } from './DemoScreens';
import { cashFlow, formatMoney, itemProfit, totals } from './demoData';
import { EASE_OUT } from './landingShared';

const MotionDiv = motion.div;
const MotionCircle = motion.circle;

const NAV = [
  ['Dashboard', LayoutDashboard], ['Log a sale', Tag], ['Inventory', Package], ['Credit cards', CreditCard],
  ['Cash flow', Wallet], ['Analytics', BarChart3], ['Calendar', CalendarDays],
];

const noop = () => {};

// A picture of the app, not a working copy (the working demo is further down
// the page). It is inert so keyboard and screen-reader users skip past it.
function AppWindow({ items, today }) {
  return (
    <div className="lp-window" aria-hidden="true" inert>
      <div className="h-10 flex items-center gap-2 px-4 bg-[var(--lp-sidebar)] border-b border-[var(--lp-border)]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
        <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
      </div>
      <div className="flex h-[calc(100%-2.5rem)] bg-[var(--lp-bg)]">
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
        <div className="flex-1 min-w-0 p-4 sm:p-6 overflow-hidden">
          <DashboardScreen items={items} today={today} go={noop} flash={{}} />
        </div>
      </div>
    </div>
  );
}

function SellThroughRing({ fraction }) {
  const reduce = useReducedMotion();
  return (
    <svg width="58" height="58" viewBox="0 0 58 58" className="-rotate-90 shrink-0" aria-hidden="true">
      <circle cx="29" cy="29" r="24" fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="6" />
      <MotionCircle
        cx="29" cy="29" r="24" fill="none" stroke="var(--lp-accent-text)" strokeWidth="6" strokeLinecap="round"
        initial={{ pathLength: reduce ? fraction : 0 }}
        animate={{ pathLength: fraction }}
        transition={{ duration: 1.3, ease: EASE_OUT, delay: 1.1 }}
      />
    </svg>
  );
}

// Cards that lift out of the window on load, then drift further out as the
// page scrolls.
function PopCard({ className, delay, drift, progress, children }) {
  const reduce = useReducedMotion();
  // Phones have no room beside the window, so the cards only move up and down there.
  const [narrow] = React.useState(() => typeof window !== 'undefined' && window.innerWidth < 640);
  const x = useTransform(progress, [0, 1], [0, reduce || narrow ? 0 : drift[0]]);
  const y = useTransform(progress, [0, 1], [0, reduce ? 0 : drift[1]]);
  return (
    <MotionDiv className={`lp-pop-card ${className}`} style={{ x, y }}>
      <MotionDiv
        initial={reduce ? false : { opacity: 0, scale: 0.86, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, delay }}
      >
        {children}
      </MotionDiv>
    </MotionDiv>
  );
}

export default function HeroShowcase({ items, today }) {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 30%'] });
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.4 });
  const scale = useTransform(progress, [0, 0.5], [reduce ? 1 : 0.94, 1]);

  const sold = items.find((x) => x.sale && x.name.startsWith('Switch'));
  const t = totals(items);
  const flow = cashFlow(items);
  const sellThrough = t.unitsSold / items.length;

  return (
    <div ref={ref} className="relative mx-auto max-w-[1080px]">
      <div className="lp-window-haze" aria-hidden="true" />
      <MotionDiv
        style={{ scale }}
        initial={reduce ? false : { opacity: 0, y: 48 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE_OUT, delay: 0.15 }}
        className="relative"
      >
        <AppWindow items={items} today={today} />
      </MotionDiv>

      <PopCard className="left-2 sm:left-[-4%] top-[30%]" delay={0.75} drift={[-46, -18]} progress={progress}>
        <div className="text-[12px] font-bold text-[var(--lp-text-3)]">Sold on {sold.sale.platform}</div>
        <div className="text-[14.5px] font-extrabold mt-0.5 truncate">{sold.name}</div>
        <div className="lp-display text-[30px] leading-none mt-2 text-[var(--lp-gain)] lp-num">{formatMoney(itemProfit(sold), { sign: true })}</div>
        <div className="text-[12px] text-[var(--lp-text-3)] mt-1.5">profit after fees and cost</div>
      </PopCard>

      <PopCard className="right-[-5%] top-[12%] hidden sm:block" delay={0.95} drift={[48, -26]} progress={progress}>
        <div className="flex items-center gap-3.5">
          <SellThroughRing fraction={sellThrough} />
          <div>
            <div className="lp-display text-[24px] leading-none lp-num">{t.unitsSold} of {items.length}</div>
            <div className="text-[12px] text-[var(--lp-text-3)] mt-1">items sold</div>
          </div>
        </div>
      </PopCard>

      <PopCard className="right-2 sm:right-[2%] bottom-[8%]" delay={1.15} drift={[34, 30]} progress={progress}>
        <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--lp-warn)]"><Clock size={13} /> On the way</div>
        <div className="lp-display text-[26px] leading-none mt-2 lp-num">{formatMoney(flow.pendingTotal)}</div>
        <div className="text-[12px] text-[var(--lp-text-3)] mt-1.5">{flow.pending.length} payouts not landed yet</div>
      </PopCard>
    </div>
  );
}
