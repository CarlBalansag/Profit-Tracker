import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3, CalendarDays, CreditCard, LayoutDashboard, Maximize2, Minimize2, Package, RotateCcw, Tag, Wallet,
} from 'lucide-react';
import AnimatedLogo from '../UI/AnimatedLogo';
import { applyAction, createSeed } from './demoData';
import {
  AddScreen, AnalyticsScreen, CalendarScreen, CardsScreen, CashFlowScreen, DashboardScreen, InventoryScreen,
} from './DemoScreens';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'add', label: 'Log a sale', icon: Tag },
  { id: 'inventory', label: 'Inventory', icon: Package },
  { id: 'cards', label: 'Credit cards', icon: CreditCard },
  { id: 'cashflow', label: 'Cash flow', icon: Wallet },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'calendar', label: 'Calendar', icon: CalendarDays },
];

const TRY = [
  { label: 'Sell something', screen: 'add', opts: { tab: 'sale' } },
  { label: 'Add new stock', screen: 'add', opts: { tab: 'buy' } },
  { label: 'Mark a payout as paid', screen: 'cashflow' },
  { label: 'Check card cashback', screen: 'cards' },
  { label: 'Open the calendar', screen: 'calendar' },
];

// A small, fully working copy of the app with fake data. Nothing leaves the
// browser and nothing is saved: a reload or "Reset demo" starts over.
export default function DemoApp({ today: todayProp }) {
  const [today] = useState(() => todayProp ?? new Date());
  const [data, setData] = useState(() => createSeed(today));
  const dataRef = useRef(data);
  const [screen, setScreen] = useState('dashboard');
  const [nav, setNav] = useState({}); // per-visit options: tab, item, flash keys
  const [toast, setToast] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef(null);
  const frameRef = useRef(null);
  const toastTimer = useRef(null);
  const tabsRef = useRef(null);

  // Phone tab strip: slide sideways so the current page's tab is in view.
  // (Only the strip scrolls; scrollIntoView could also move the whole page.)
  useEffect(() => {
    const strip = tabsRef.current;
    const active = strip?.querySelector('[aria-current="page"]');
    if (!strip || !active || strip.scrollWidth <= strip.clientWidth) return;
    const left = active.offsetLeft - (strip.clientWidth - active.offsetWidth) / 2;
    strip.scrollTo?.({ left: Math.max(0, left), behavior: 'smooth' });
  }, [screen]);

  const dispatch = useCallback((action) => {
    const res = applyAction(dataRef.current, action);
    if (res.state !== dataRef.current) {
      dataRef.current = res.state;
      setData(res.state);
    }
    return res;
  }, []);

  const notify = useCallback((text) => {
    clearTimeout(toastTimer.current);
    setToast({ text, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const go = useCallback((id, opts = {}) => {
    setScreen(id);
    setNav({ ...opts, visit: Date.now() });
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, []);

  const reset = () => {
    dispatch({ type: 'reset', today });
    go('dashboard');
    notify('Demo reset to the starting data');
  };

  // Full screen: lock the page behind it, close on Escape.
  useEffect(() => {
    if (!expanded) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e) => { if (e.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [expanded]);

  const props = { items: data.items, today, dispatch, go, notify, flash: nav };
  let body;
  switch (screen) {
    case 'add':
      body = <AddScreen key={nav.visit} {...props} preselect={nav.item} initialTab={nav.tab ?? 'sale'} />;
      break;
    case 'inventory': body = <InventoryScreen {...props} />; break;
    case 'cards': body = <CardsScreen {...props} />; break;
    case 'cashflow': body = <CashFlowScreen {...props} />; break;
    case 'analytics': body = <AnalyticsScreen {...props} />; break;
    case 'calendar': body = <CalendarScreen {...props} />; break;
    default: body = <DashboardScreen {...props} />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3" aria-label="Things to try in the demo">
        <span className="text-[12px] font-bold text-[var(--lp-text-3)] mr-1">Try it:</span>
        {TRY.map((t) => (
          <button key={t.label} type="button" onClick={() => go(t.screen, t.opts)}
            className="lp-focus px-3 py-1.5 rounded-full border border-[var(--lp-border-strong)] text-[12.5px] font-bold text-[var(--lp-text-2)] hover:text-[var(--lp-text)] hover:border-[rgba(var(--accent-rgb),0.6)] hover:bg-[var(--lp-accent-tint)] transition-colors">
            {t.label}
          </button>
        ))}
      </div>

      <div
        ref={frameRef}
        role={expanded ? 'dialog' : 'region'}
        aria-modal={expanded || undefined}
        aria-label="Profit Tracker demo"
        className={expanded
          ? 'fixed inset-0 z-[100] flex flex-col bg-[var(--lp-bg)]'
          : 'relative rounded-2xl border border-[var(--lp-border-strong)] overflow-hidden flex flex-col shadow-[0_40px_100px_-30px_rgba(2,2,2,0.9),0_0_0_1px_rgba(2,2,2,0.6)] md:h-[640px]'}
      >
        {/* Window bar */}
        <div className="shrink-0 h-11 flex items-center gap-3 px-3 bg-[var(--lp-sidebar)] border-b border-[var(--lp-border)]">
          <div className="hidden sm:flex gap-1.5" aria-hidden="true">
            <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
            <span className="w-2.5 h-2.5 rounded-full bg-[#4a4c51]" />
          </div>
          <div className="flex-1 min-w-0 flex justify-center">
            <span className="max-w-[320px] w-full truncate text-center text-[11.5px] text-[var(--lp-text-3)] bg-[var(--lp-well)] rounded-md px-3 py-1">
              Demo · fake data · nothing is saved
            </span>
          </div>
          <button type="button" onClick={reset} className="lp-focus inline-flex items-center gap-1.5 text-[12px] font-bold text-[var(--lp-text-2)] hover:text-[var(--lp-text)] px-2 py-1 rounded-md hover:bg-[var(--lp-raised)]">
            <RotateCcw size={13} /> <span className="hidden sm:inline">Reset demo</span>
          </button>
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Exit full screen' : 'Full screen'}
            className="lp-focus p-1.5 rounded-md text-[var(--lp-text-2)] hover:text-[var(--lp-text)] hover:bg-[var(--lp-raised)]">
            {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row bg-[var(--lp-bg)]">
          {/* Sidebar (desktop) / tab strip (phone) */}
          <nav aria-label="Demo pages" className="shrink-0 md:w-[188px] bg-[var(--lp-sidebar)] md:border-r border-b md:border-b-0 border-[var(--lp-border)]">
            <div className="hidden md:flex items-center gap-2 px-4 h-14">
              <AnimatedLogo size={22} label={null} />
              <span className="text-[13px] font-extrabold tracking-tight">Profit Tracker</span>
            </div>
            <ul ref={tabsRef} className="lp-scroll relative flex md:flex-col gap-1 overflow-x-auto md:overflow-visible px-2 py-2 md:py-0">
              {NAV.map((n) => {
                const Icon = n.icon;
                const on = screen === n.id;
                return (
                  <li key={n.id} className="shrink-0">
                    <button type="button" onClick={() => go(n.id)} aria-current={on ? 'page' : undefined}
                      className={`lp-focus w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-bold whitespace-nowrap transition-colors ${on ? 'bg-[var(--lp-accent-tint)] text-[var(--lp-text)] md:shadow-[inset_2px_0_0_var(--lp-accent-text)]' : 'text-[var(--lp-text-3)] hover:text-[var(--lp-text-2)] hover:bg-[var(--lp-well)]'}`}>
                      <Icon size={15} className={on ? 'text-[var(--lp-accent-text)]' : ''} />
                      {n.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div ref={scrollRef} className="lp-scroll flex-1 min-w-0 min-h-0 md:overflow-y-auto p-3.5 sm:p-5 overflow-y-auto">
            <div key={screen} className="lp-pop max-w-[980px] mx-auto">{body}</div>
          </div>
        </div>

        <div aria-live="polite" className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-sm">
          {toast && (
            <div key={toast.id} className="lp-pop rounded-lg px-3.5 py-2.5 text-[12.5px] font-bold text-center bg-[var(--lp-raised)] border border-[var(--lp-border-strong)] shadow-[0_12px_30px_-10px_rgba(2,2,2,0.8)]">
              {toast.text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
