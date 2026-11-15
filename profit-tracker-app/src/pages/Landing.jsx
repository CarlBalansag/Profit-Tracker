import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import AnimatedLogo from '../components/UI/AnimatedLogo';
import DemoApp from '../components/Landing/DemoApp';
import HeroShowcase from '../components/Landing/HeroShowcase';
import FeatureOverview from '../components/Landing/FeatureOverview';
import {
  AnalyticsFragment, CalendarFragment, CardsFragment, InventoryFragment,
} from '../components/Landing/Fragments';
import { EASE_OUT, EASE_QUART, useSeed } from '../components/Landing/landingShared';
import { signupEnabled } from '../services/firebaseAuth';
import '../components/Landing/landing.css';

const MotionDiv = motion.div;
const MotionLi = motion.li;

const ROWS = [
  {
    id: 'inventory',
    title: "Know what's sitting on the shelf.",
    body: "Every item you're holding, what you paid and how long it has sat. Slow movers stand out before they cost you.",
    Frag: InventoryFragment,
  },
  {
    id: 'cards',
    title: 'See what every card pays you back.',
    body: "Spend on each card and the cashback it earned, counted into what each item really cost. You'll know which card to use for the next drop.",
    Frag: CardsFragment,
  },
  {
    id: 'analytics',
    title: 'Find out which marketplace actually pays.',
    body: 'Profit by month, by marketplace and by item, so you know where to list next and which flips just kept you busy.',
    Frag: AnalyticsFragment,
  },
  {
    id: 'calendar',
    title: 'Look back at any day.',
    body: 'Every purchase and sale lands on the day it happened, which makes a busy month and month-end checks easy to follow.',
    Frag: CalendarFragment,
  },
];

const STEPS = [
  { title: 'Create your account', body: 'Add the cards you use and the marketplaces you sell on.' },
  { title: 'Log what you buy', body: 'It goes into inventory with its cashback worked out.' },
  { title: 'Log it when it sells', body: 'Fees, shipping and profit are done for you.' },
  { title: 'Watch the numbers', body: 'Profit, cards and cash flow stay up to date everywhere.' },
];

const scrollToDemo = () => {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('demo')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};

function Reveal({ children, className = '', delay = 0 }) {
  const reduce = useReducedMotion();
  return (
    <MotionDiv
      className={className}
      initial={reduce ? false : { opacity: 0, y: 16, filter: 'blur(6px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true, margin: '-12% 0px' }}
      transition={{ opacity: { duration: 0.7, ease: EASE_QUART, delay }, default: { duration: 1, ease: EASE_OUT, delay } }}
    >
      {children}
    </MotionDiv>
  );
}

export default function Landing() {
  const accountLabel = signupEnabled ? 'Create free account' : 'Sign in';
  const { hash } = useLocation();
  const { items, today } = useSeed();
  const reduce = useReducedMotion();

  // "Try the demo first" on the sign-in page links to /#demo.
  useEffect(() => {
    if (hash === '#demo') document.getElementById('demo')?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const intro = (delay) => (reduce ? {} : {
    initial: { opacity: 0, y: 12, filter: 'blur(8px)' },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { opacity: { duration: 0.7, ease: EASE_QUART, delay }, default: { duration: 1, ease: EASE_OUT, delay } },
  });

  return (
    <div className="lp min-h-screen overflow-x-clip">
      <header className="lp-nav">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-8 h-16 flex items-center justify-between gap-3">
          <Link to="/" className="lp-focus flex items-center gap-2.5 rounded-md">
            <AnimatedLogo size={26} label={null} />
            <span className="lp-display text-[17px]">Profit Tracker</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
            <a href="#features" className="lp-focus lp-navlink hidden md:inline-block">What it does</a>
            <a href="#how" className="lp-focus lp-navlink hidden md:inline-block">How it works</a>
            <a href="#demo" className="lp-focus lp-navlink hidden md:inline-block">Demo</a>
            <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-sm ml-1">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative px-4 sm:px-8 pt-16 sm:pt-24 pb-8 sm:pb-10">
          <div className="lp-halos" aria-hidden="true" />
          <div className="relative max-w-[860px] mx-auto text-center">
            <motion.h1 {...intro(0)} className="lp-display text-[clamp(2.6rem,7vw,5.6rem)] leading-[0.98]">
              Your flips, finally in one place.
            </motion.h1>
            <motion.p {...intro(0.08)} className="text-[17px] sm:text-[19px] text-[var(--lp-text-2)] leading-relaxed max-w-[600px] mx-auto mt-6">
              Inventory, sales, cards and cash flow in one app built for resellers.
            </motion.p>
            <motion.div {...intro(0.16)} className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-9">
              <button type="button" onClick={scrollToDemo} className="lp-btn lp-btn-primary lp-btn-lg">Try the demo</button>
              <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-lg">{accountLabel}</Link>
            </motion.div>
            <motion.p {...intro(0.22)} className="text-[13px] text-[var(--lp-text-3)] mt-5">
              The demo needs no account and runs on sample data.
            </motion.p>
          </div>
          <div className="relative mt-14 sm:mt-20">
            <HeroShowcase items={items} today={today} />
          </div>
        </section>

        {/* What it does: overview */}
        <section id="features" className="px-4 sm:px-8 pt-16 sm:pt-20 pb-24 sm:pb-32 scroll-mt-16" aria-labelledby="features-title">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="text-center max-w-[720px] mx-auto mb-14 sm:mb-20">
              <h2 id="features-title" className="lp-display text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.02]">Your whole reselling business, in one place.</h2>
              <p className="text-[17px] text-[var(--lp-text-2)] leading-relaxed mt-5">
                Buying, selling, money and taxes stay connected, so one entry updates everything it touches.
              </p>
            </Reveal>
            <FeatureOverview items={items} today={today} />
          </div>
        </section>

        {/* What it does: in detail */}
        <section className="px-4 sm:px-8 pb-24 sm:pb-32" aria-label="Features in detail">
          <div className="max-w-[1200px] mx-auto space-y-5 sm:space-y-6">
            {ROWS.map((row, i) => {
              const Frag = row.Frag;
              return (
                <Reveal key={row.id}>
                  <article className={`lp-panel lp-panel-${i % 2 ? 'b' : 'a'}`}>
                    <div className={`lp-panel-copy ${i % 2 ? 'md:order-2' : ''}`}>
                      <h3 className="lp-display text-[clamp(1.8rem,3.4vw,2.75rem)] leading-[1.04]">{row.title}</h3>
                      <p className="text-[16.5px] text-[var(--lp-text-2)] leading-relaxed mt-4 max-w-[440px]">{row.body}</p>
                    </div>
                    <div className={`lp-panel-media ${i % 2 ? 'md:order-1' : ''}`}>
                      <Frag items={items} today={today} />
                    </div>
                  </article>
                </Reveal>
              );
            })}
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="px-4 sm:px-8 pt-8 pb-24 sm:pb-28 scroll-mt-16" aria-labelledby="how-title">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="max-w-[640px] mb-12">
              <h2 id="how-title" className="lp-display text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.02]">Up and running in an afternoon.</h2>
            </Reveal>
            <ol className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
              {STEPS.map((s, i) => (
                <MotionLi
                  key={s.title}
                  className="lp-step"
                  initial={reduce ? false : { opacity: 0, y: 14, filter: 'blur(6px)' }}
                  whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  viewport={{ once: true, margin: '-12% 0px' }}
                  transition={{ opacity: { duration: 0.6, ease: EASE_QUART, delay: i * 0.1 }, default: { duration: 0.9, ease: EASE_OUT, delay: i * 0.1 } }}
                >
                  <span className="lp-step-num lp-num">{i + 1}</span>
                  <h3 className="text-[18px] font-extrabold mt-4">{s.title}</h3>
                  <p className="text-[15px] text-[var(--lp-text-2)] leading-relaxed mt-1.5">{s.body}</p>
                </MotionLi>
              ))}
            </ol>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className="px-4 sm:px-8 pt-24 sm:pt-28 pb-28 sm:pb-36 scroll-mt-16 lp-demo-band" aria-labelledby="demo-title">
          <div className="max-w-[1200px] mx-auto">
            <Reveal className="text-center max-w-[680px] mx-auto mb-10">
              <h2 id="demo-title" className="lp-display text-[clamp(2rem,4.6vw,3.6rem)] leading-[1.02]">Now try it yourself.</h2>
              <p className="text-[17px] text-[var(--lp-text-2)] leading-relaxed mt-4">
                This is the app with sample data. Log a sale or a purchase and every page updates. Nothing is saved.
              </p>
            </Reveal>
            <DemoApp />
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--lp-border)] px-4 sm:px-8 py-8">
        <div className="max-w-[1200px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AnimatedLogo size={20} label={null} />
            <span className="text-[13px] font-bold text-[var(--lp-text-2)]">Profit Tracker</span>
          </div>
          <p className="text-[13px] text-[var(--lp-text-3)]">
            Already have an account? <Link to="/login" className="lp-focus font-bold text-[var(--lp-accent-text)] hover:underline rounded">Sign in</Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
