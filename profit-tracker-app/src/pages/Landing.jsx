import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowDown, BarChart3, CalendarDays, CreditCard, Package, Receipt, ShieldCheck, Tag, Wallet,
} from 'lucide-react';
import AnimatedLogo from '../components/UI/AnimatedLogo';
import DemoApp from '../components/Landing/DemoApp';
import { signupEnabled } from '../services/firebaseAuth';
import '../components/Landing/landing.css';

const FEATURES = [
  { icon: Tag, title: 'Profit on every flip', body: 'Log a sale and the marketplace fee, shipping and what you paid come off automatically. You see the real profit and ROI right away.' },
  { icon: Package, title: 'Inventory that adds itself up', body: "Everything you bought and haven't sold yet, what it cost, and how long it's been sitting." },
  { icon: CreditCard, title: 'Card spend and cashback', body: 'Track spending on each card and the cashback it earns, so you always know which card to use for the next drop.' },
  { icon: Wallet, title: 'Cash flow and payouts', body: "Money out on stock, money back from sales, and which payouts haven't landed yet." },
  { icon: BarChart3, title: 'Analytics that answer questions', body: 'Which months, marketplaces and items actually make you money, and which ones just keep you busy.' },
  { icon: CalendarDays, title: 'A calendar of every move', body: 'Purchases and sales on the day they happened, so a busy month is easy to look back on.' },
  { icon: Receipt, title: 'Expenses and taxes', body: 'Keep receipts, expenses and tax-exempt purchases in the same place as your sales, ready for tax season.' },
  { icon: ShieldCheck, title: 'No bank connection needed', body: 'You type in your own numbers. Nothing is linked to your bank, and your records stay in your account.' },
];

const STEPS = [
  { title: 'Create your account', body: 'Sign up with your email. Add the cards you use and the marketplaces you sell on.' },
  { title: 'Log what you buy', body: 'Item, price, store and card. It goes into your inventory and the cashback is worked out for you.' },
  { title: 'Log it when it sells', body: 'Pick the item, enter the sale price and where it sold. Fees and profit are done for you.' },
  { title: 'Watch the numbers', body: 'Profit, ROI, card spend and cash flow update on every page as you go.' },
];

const scrollToDemo = () => {
  const el = document.getElementById('demo');
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
};

export default function Landing() {
  const accountLabel = signupEnabled ? 'Create free account' : 'Sign in';
  const { hash } = useLocation();

  // "Try the demo first" on the sign-in page links to /#demo.
  useEffect(() => {
    if (hash === '#demo') document.getElementById('demo')?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div className="lp min-h-screen overflow-x-hidden">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-[var(--lp-border)] bg-[rgba(17,18,20,0.85)] backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="lp-focus flex items-center gap-2.5 rounded-md">
            <AnimatedLogo size={24} label={null} />
            <span className="font-extrabold text-[14px] tracking-tight">Profit Tracker</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
            <a href="#features" className="lp-focus hidden sm:inline-block px-3 py-2 text-[13px] font-bold text-[var(--lp-text-2)] hover:text-[var(--lp-text)] rounded-md">Features</a>
            <a href="#how" className="lp-focus hidden sm:inline-block px-3 py-2 text-[13px] font-bold text-[var(--lp-text-2)] hover:text-[var(--lp-text)] rounded-md">How it works</a>
            <Link to="/login" className="lp-btn lp-btn-ghost lp-btn-sm">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative px-4 sm:px-8 pt-16 sm:pt-24 pb-12">
          <div className="lp-hero-glow absolute inset-0 pointer-events-none" aria-hidden="true" />
          <div className="lp-grid absolute inset-0 pointer-events-none" aria-hidden="true" />
          <div className="relative max-w-3xl mx-auto text-center">
            <p className="lp-eyebrow mb-5">For resellers and flippers</p>
            <h1 className="text-[clamp(2.3rem,6.4vw,4.4rem)] font-extrabold leading-[1.03] tracking-[-0.035em]">
              Know what every flip<br className="hidden sm:block" /> <span className="text-[var(--lp-accent-text)]">actually made you.</span>
            </h1>
            <p className="text-[16px] sm:text-[17px] text-[var(--lp-text-2)] leading-relaxed max-w-xl mx-auto mt-6">
              Profit Tracker keeps your inventory, sales, fees, card cashback and payouts in one place,
              so you stop guessing from a spreadsheet and start seeing real profit.
            </p>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 mt-9">
              <button type="button" onClick={scrollToDemo} className="lp-btn lp-btn-primary !text-[15px] !px-6 !py-3.5">
                Try the demo <ArrowDown size={16} />
              </button>
              <Link to="/login" className="lp-btn lp-btn-ghost !text-[15px] !px-6 !py-3.5">{accountLabel}</Link>
            </div>
            <p className="text-[12.5px] text-[var(--lp-text-3)] mt-5">No sign-up needed for the demo · No bank connection</p>
          </div>
        </section>

        {/* Demo */}
        <section id="demo" className="px-4 sm:px-8 pb-24 scroll-mt-16" aria-labelledby="demo-title">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <div>
                <h2 id="demo-title" className="text-[22px] sm:text-[26px] font-extrabold tracking-tight">Click around. It's the real thing, with fake data.</h2>
                <p className="text-[14px] text-[var(--lp-text-3)] mt-1">Log a sale or a purchase and watch every page update. Reset whenever you like.</p>
              </div>
            </div>
            <DemoApp />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="px-4 sm:px-8 py-24 border-t border-[var(--lp-border)] scroll-mt-14" aria-labelledby="features-title">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-12">
              <p className="lp-eyebrow mb-3">Features</p>
              <h2 id="features-title" className="text-[30px] sm:text-[38px] font-extrabold tracking-tight leading-[1.1]">
                Built around how reselling actually works.
              </h2>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <li key={f.title} className="lp-card p-5">
                    <span className="inline-flex w-9 h-9 items-center justify-center rounded-[10px] bg-[var(--lp-accent-tint)] border border-[rgba(var(--accent-rgb),0.35)] mb-4">
                      <Icon size={17} className="text-[var(--lp-accent-text)]" />
                    </span>
                    <h3 className="text-[15.5px] font-extrabold mb-1.5">{f.title}</h3>
                    <p className="text-[13.5px] text-[var(--lp-text-2)] leading-relaxed">{f.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* How it works */}
        <section id="how" className="px-4 sm:px-8 py-24 border-t border-[var(--lp-border)] scroll-mt-14" aria-labelledby="how-title">
          <div className="max-w-6xl mx-auto">
            <div className="max-w-2xl mb-12">
              <p className="lp-eyebrow mb-3">How it works</p>
              <h2 id="how-title" className="text-[30px] sm:text-[38px] font-extrabold tracking-tight leading-[1.1]">
                Four steps, then it runs itself.
              </h2>
            </div>
            <ol className="grid grid-cols-1 md:grid-cols-4 gap-6 md:gap-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="relative md:pt-8">
                  <div className="hidden md:block absolute top-[15px] left-10 right-0 h-px bg-[var(--lp-border-strong)]" aria-hidden="true" />
                  <div className="flex md:block gap-4">
                    <span className="lp-num shrink-0 md:absolute md:top-0 md:left-0 w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-extrabold bg-[var(--lp-card)] border border-[rgba(var(--accent-rgb),0.55)] text-[var(--lp-accent-text)]">
                      {i + 1}
                    </span>
                    <div className="md:mt-4">
                      <h3 className="text-[16px] font-extrabold mb-1.5">{s.title}</h3>
                      <p className="text-[13.5px] text-[var(--lp-text-2)] leading-relaxed">{s.body}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Closing call to action */}
        <section className="px-4 sm:px-8 py-24 border-t border-[var(--lp-border)]">
          <div className="max-w-3xl mx-auto lp-card relative overflow-hidden px-6 py-12 sm:px-12 text-center">
            <div className="lp-hero-glow absolute inset-0 pointer-events-none" aria-hidden="true" />
            <div className="relative">
              <h2 className="text-[28px] sm:text-[36px] font-extrabold tracking-tight leading-[1.1]">Your next flip deserves real numbers.</h2>
              <p className="text-[15px] text-[var(--lp-text-2)] mt-4 max-w-md mx-auto">Play with the demo first, or jump straight in. It's free while we're in this early stage.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center mt-8">
                <button type="button" onClick={scrollToDemo} className="lp-btn lp-btn-primary !px-6 !py-3.5">Try the demo</button>
                <Link to="/login" className="lp-btn lp-btn-ghost !px-6 !py-3.5">{accountLabel}</Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--lp-border)] px-4 sm:px-8 py-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AnimatedLogo size={20} label={null} />
            <span className="text-[13px] font-bold text-[var(--lp-text-2)]">Profit Tracker</span>
          </div>
          <p className="text-[12.5px] text-[var(--lp-text-3)]">Built for resellers. Your data stays yours.</p>
        </div>
      </footer>
    </div>
  );
}
