import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ArrowLeftRight, Boxes,
  ReceiptText, FileText, ChartLine, Wallet, CreditCard as CreditCardIcon,
  Settings, History, ChevronDown, PanelLeftClose, PanelLeft, Database, LogOut, X, BadgeDollarSign, BadgePercent, BookOpen, Target, CalendarDays, Truck, Sparkles, ClipboardList, BanknoteArrowDown, Landmark, HandCoins, ListChecks, Zap
} from 'lucide-react';
import clsx from 'clsx';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { SCHEDULE_C_ENABLED } from '../../config/features';
import { CURRENT_VERSION } from '../../data/changelog';
import VersionHistoryModal from '../VersionHistoryModal';
import ThemeSwitch from '../UI/ThemeSwitch';
import AnimatedLogo from '../UI/AnimatedLogo';
import { useCashoutProviders } from '../../hooks/useCashoutProviders';
import { usePrefetchProps } from '../../hooks/usePrefetchPage';
import { useTodoCount } from '../../hooks/useApi';
import { useMatchMedia } from '../../hooks/useMatchMedia';
import { useTutorial } from '../../context/TutorialContext';

const MotionDiv = motion.div;

const Sidebar = ({ isOpen, setIsOpen, isCollapsed: collapsedPref, setIsCollapsed, uiStyle = 'neon-dark' }) => {
  // Collapsing is a desktop choice: below 1024px the sidebar is the phone
  // drawer, which always shows its labels (and has no expand button).
  const isNarrow = useMatchMedia('(max-width: 1023px)');
  // Settings and Activity live in the account menu, so the account button
  // marks them as the current page.
  const { pathname: currentPath } = useLocation();
  const onAccountPage = currentPath.startsWith('/settings') || currentPath.startsWith('/activity');
  const isCollapsed = collapsedPref && !isNarrow;
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { data: cashoutProviders = [] } = useCashoutProviders();
  const hasCashoutAccess = Array.isArray(cashoutProviders) && cashoutProviders.length > 0;
  const todoCount = useTodoCount();
  const isGlass = uiStyle === 'glassmorphism-brown';
  const reduceMotion = useReducedMotion();
  const navRef = useRef(null);
  const marker = useNavMarker(navRef, [isCollapsed, isGlass, hasCashoutAccess, isOpen]);
  const profileRootRef = useRef(null);
  const profileButtonRef = useRef(null);
  const profileMenuId = useId();
  useProfileMenu(isProfileMenuOpen, setIsProfileMenuOpen, profileRootRef, profileButtonRef);
  const drawerRef = useMobileDrawer(isOpen, () => setIsOpen(false));
  // Below 1024px the closed drawer is only slid off-screen; inert keeps its
  // links out of the Tab order and away from screen readers.
  const isDesktop = useMatchMedia('(min-width: 1024px)');
  const offscreen = !isOpen && !isDesktop;
  const tooltip = useCollapsedTooltip(drawerRef, isCollapsed && !isGlass);
  // In the phone drawer, Dashboard, Transactions and Inventory are already on
  // the bottom bar, so the drawer leaves them out (the guided tour still
  // points at them, so they stay while it runs).
  const touring = Boolean(useTutorial()?.active);
  const inBar = isNarrow && !touring;
  const moreBelow = useMoreBelow(navRef, [isCollapsed, isOpen, hasCashoutAccess]);

  if (isGlass) {
    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm lg:hidden"
            onClick={() => setIsOpen(false)}
          />
        )}

        <aside
          ref={drawerRef}
          inert={offscreen}
          className={clsx(
            "fixed left-4 top-1/2 z-50 -translate-y-1/2 transition-transform duration-300 lg:translate-x-0",
            isOpen ? "translate-x-0" : "-translate-x-24 lg:translate-x-0"
          )}
          onClick={(e) => { if (e.target.closest('a')) setIsOpen(false); }}
        >
          <div ref={navRef} className="relative flex flex-col items-center gap-0.5 rounded-[24px] border border-white/[0.07] bg-[#181a1c]/[0.88] px-2 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <button
              onClick={() => navigate('/')}
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl"
              title="Profit Tracker"
              aria-label="Profit Tracker dashboard"
            >
              <AnimatedLogo size={28} label={null} />
            </button>

            <NavMarker marker={marker} className="rounded-xl bg-[#d8a65a]/10" />

            <GlassNavItem icon={LayoutDashboard} label="Dashboard" to="/" />
            <GlassNavItem icon={ListChecks} label="To-Do" to="/todos" badge={todoCount} />
            <GlassNavItem icon={CalendarDays} label="Calendar" to="/calendar" />
            <GlassNavItem icon={ShoppingCart} label="Add Transaction" to="/add-transaction" />
            <GlassNavItem icon={BadgeDollarSign} label="Record Sale" to="/add-sale" />
            <GlassNavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" />
            <GlassNavItem icon={Boxes} label="Inventory" to="/inventory" />
            <GlassNavItem icon={Truck} label="Shipping" to="/shipping" />
            <GlassNavItem icon={ClipboardList} label="Statuses" to="/statuses" />
            <GlassNavItem icon={Wallet} label="Cash Flow" to="/cashflow" />
            <GlassNavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" />
            {hasCashoutAccess && <GlassNavItem icon={HandCoins} label="Cashout" to="/cashout" />}
            <GlassNavItem icon={ChartLine} label="Analytics" to="/analytics" />
            <GlassNavItem icon={Target} label="Goals" to="/goals" />
            <GlassNavItem icon={BanknoteArrowDown} label="Expenses" to="/expenses" />
            <GlassNavItem icon={ReceiptText} label="Receipts" to="/receipts" />
            <GlassNavItem icon={FileText} label="Invoices" to="/invoices" />
            <GlassNavItem icon={BadgePercent} label="Tax Exempt" to="/tax-exempt" />
            {SCHEDULE_C_ENABLED && <GlassNavItem icon={Landmark} label="Schedule C" to="/schedule-c" />}

            <div className="my-2 h-px w-7 bg-white/[0.07]" />

            <GlassNavItem icon={BookOpen} label="Guide" to="/guide" />
            <GlassNavButton icon={Settings} label="Settings" onClick={() => navigate('/settings')} />
          </div>
        </aside>
      </>
    );
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside
        ref={drawerRef}
        inert={offscreen}
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex flex-col transition-[width,translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none lg:static lg:translate-x-0 border-r border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated dp-sidebar",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-[72px]" : "w-[min(85vw,320px)] lg:w-60"
        )}
        onClick={(e) => { if (e.target.closest('a')) setIsOpen(false); }}
      >
        <div className={clsx("flex items-center py-5 border-b border-[color:var(--dp-border)]", isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4")}>
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
            {/* Draws once when the app loads, not on every collapse or drawer open. */}
            <AnimatedLogo
              size={30}
              label={isCollapsed ? 'Profit Tracker' : null}
            />
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-[var(--dp-text-primary)] tracking-[-0.3px]">Profit Tracker</p>
              <p className="text-[11px] text-[var(--dp-text-label)] uppercase tracking-[1.2px]">Reselling</p>
            </div>
          )}

          <button type="button" aria-label="Close menu" className="flex items-center justify-center lg:hidden p-1.5 pointer-coarse:min-h-[44px] pointer-coarse:min-w-[44px] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-md hover:bg-[var(--dp-hover-bg)]" onClick={() => setIsOpen(false)}>
            <X size={18} />
          </button>

          <button
            className="hidden lg:block p-1.5 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-md hover:bg-[var(--dp-hover-bg)]"
            onClick={() => setIsCollapsed(!isCollapsed)}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav ref={navRef} className={clsx("relative flex-1 py-3 px-2 space-y-3 overflow-y-auto overflow-x-hidden dp-scrollbar", isCollapsed && "dp-rail", moreBelow && "dp-nav-more")}>
          <NavMarker marker={marker} className="!mt-0 rounded-md bg-[var(--dp-accent-bg)]" />
          {/* Grouped by how a reseller works: today's work, buying and selling,
              shipping, money, then the bookkeeping (folded by default). */}
          <SidebarSection title="Today" isCollapsed={isCollapsed} foldable={false}>
            {!inBar && <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />}
            <NavItem icon={ListChecks} label="To-Do" to="/todos" isCollapsed={isCollapsed} badge={todoCount} />
            <NavItem icon={CalendarDays} label="Calendar" to="/calendar" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Sell & Buy" isCollapsed={isCollapsed} tutorialId="sidebar-section-core">
            <NavItem icon={ShoppingCart} label="Add Transaction" to="/add-transaction" isCollapsed={isCollapsed} tutorialId="sidebar-add-transaction" />
            <NavItem icon={BadgeDollarSign} label="Record Sale" to="/add-sale" isCollapsed={isCollapsed} tutorialId="sidebar-record-sale" />
            {!inBar && <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} tutorialId="sidebar-transactions" />}
            {!inBar && <NavItem icon={Boxes} label="Inventory" to="/inventory" isCollapsed={isCollapsed} tutorialId="sidebar-inventory" />}
            <NavItem icon={Zap} label="Email Automation" to="/automation" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Ship" isCollapsed={isCollapsed}>
            <NavItem icon={Truck} label="Shipping" to="/shipping" isCollapsed={isCollapsed} />
            <NavItem icon={ClipboardList} label="Statuses" to="/statuses" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Money" isCollapsed={isCollapsed} tutorialId="sidebar-section-insights">
            <NavItem icon={Wallet} label="Cash Flow" to="/cashflow" isCollapsed={isCollapsed} tutorialId="sidebar-cashflow" />
            <NavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" isCollapsed={isCollapsed} tutorialId="sidebar-creditcard" />
            {hasCashoutAccess && <NavItem icon={HandCoins} label="Cashout" to="/cashout" isCollapsed={isCollapsed} />}
            <NavItem icon={ChartLine} label="Analytics" to="/analytics" isCollapsed={isCollapsed} tutorialId="sidebar-analytics" />
            <NavItem icon={Target} label="Goals" to="/goals" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Books" isCollapsed={isCollapsed} tutorialId="sidebar-section-operations" defaultFolded>
            <NavItem icon={BanknoteArrowDown} label="Expenses" to="/expenses" isCollapsed={isCollapsed} tutorialId="sidebar-expenses" />
            <NavItem icon={ReceiptText} label="Receipts" to="/receipts" isCollapsed={isCollapsed} tutorialId="sidebar-receipts" />
            <NavItem icon={FileText} label="Invoices" to="/invoices" isCollapsed={isCollapsed} />
            <NavItem icon={BadgePercent} label="Tax Exempt" to="/tax-exempt" isCollapsed={isCollapsed} tutorialId="sidebar-tax-exempt" />
            {SCHEDULE_C_ENABLED && <NavItem icon={Landmark} label="Schedule C" to="/schedule-c" isCollapsed={isCollapsed} />}
          </SidebarSection>
        </nav>

        <div className="hidden lg:block p-2 border-t border-[color:var(--dp-border)]">
          <button
            onClick={() => setShowChangelog(true)}
            aria-label={isCollapsed ? `v${CURRENT_VERSION}, What's New` : undefined}
            data-tip={isCollapsed ? `v${CURRENT_VERSION} · What's New` : undefined}
            className={clsx("flex items-center rounded-md border-l-2 border-transparent text-[12px] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Sparkles size={14} />
            {!isCollapsed && (
              <>
                <span className="truncate">What&apos;s New</span>
                <span className="ml-auto text-[11px] tabular-nums text-[var(--dp-text-label)]">v{CURRENT_VERSION}</span>
              </>
            )}
          </button>
          <button
            data-tutorial-id="sidebar-datasetup"
            aria-label={isCollapsed ? 'Data Setup' : undefined}
            data-tip={isCollapsed ? 'Data Setup' : undefined}
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className={clsx("flex items-center rounded-md border-l-2 border-transparent text-[12px] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Database size={14} />
            {!isCollapsed && <span className="truncate">Data Setup</span>}
          </button>
          <NavItem icon={BookOpen} label="Guide" to="/guide" isCollapsed={isCollapsed} tutorialId="sidebar-guide" />
          <div data-tip={isCollapsed ? 'Theme' : undefined} className={clsx("flex items-center py-1.5", isCollapsed ? "justify-center" : "justify-between px-3")}>
            {!isCollapsed && <span className="text-[12px] text-[var(--dp-text-secondary)]">Theme</span>}
            <ThemeSwitch inline />
          </div>
        </div>

        <div ref={profileRootRef} className="p-2 border-t border-[color:var(--dp-border)] relative">
          <button
            ref={profileButtonRef}
            type="button"
            aria-haspopup="true"
            aria-expanded={isProfileMenuOpen}
            aria-controls={profileMenuId}
            aria-label={isCollapsed ? `Account: ${user?.username || 'Account'}` : undefined}
            data-tip={isCollapsed ? `${user?.username || 'Account'}${onAccountPage ? ' · Settings' : ''}` : undefined}
            aria-current={onAccountPage ? 'page' : undefined}
            className={clsx("flex items-center rounded-md hover:bg-[var(--dp-hover-bg)] transition-colors", onAccountPage && "bg-[var(--dp-accent-bg)] ring-1 ring-inset ring-[color:var(--dp-accent-text)]/30", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-3 py-2 px-3 text-left")}
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          >
            <div className="w-7 h-7 rounded-full bg-[var(--dp-bg)] flex-shrink-0 text-[var(--dp-accent)] flex items-center justify-center text-[11px] font-semibold">{(user?.username || '?').slice(0, 2).toUpperCase()}</div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[var(--dp-text-primary)] truncate">{user?.username || 'Account'}</p>
                  <p className="text-[11px] text-[var(--dp-text-label)]">Online</p>
                </div>
                <ChevronDown size={14} className={clsx("text-[var(--dp-text-label)] transition-transform", isProfileMenuOpen ? "rotate-180" : "")} />
              </>
            )}
          </button>

          <AnimatePresence>
          {isProfileMenuOpen && (
            <MotionDiv
              key="profile-menu"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1, transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] } }}
              exit={reduceMotion ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, y: 4, scale: 0.98, transition: { duration: 0.1, ease: 'easeIn' } }}
              style={{ transformOrigin: 'bottom center' }}
              id={profileMenuId} className="absolute bottom-full left-2 right-2 mb-2 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated-hover rounded-lg py-2 z-50 overflow-hidden">
               <NavLink to="/settings" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <Settings size={14} className="text-[var(--dp-text-secondary)]" /> Settings
               </NavLink>
               <NavLink to="/activity" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <History size={14} className="text-[var(--dp-text-secondary)]" /> Activity
               </NavLink>
               {/* Phone drawer only: the items the desktop sidebar keeps in its footer. */}
               <div className="lg:hidden">
                 <div className="h-px w-full bg-[var(--dp-border)] my-1"></div>
                 <button type="button" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); setShowChangelog(true); }}>
                   <Sparkles size={14} className="text-[var(--dp-text-secondary)]" /> What's New <span className="ml-auto text-[11px] text-[var(--dp-text-label)]">v{CURRENT_VERSION}</span>
                 </button>
                 <button type="button" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); setIsOpen(false); navigate('/settings', { state: { tab: 'datasetup' } }); }}>
                   <Database size={14} className="text-[var(--dp-text-secondary)]" /> Data Setup
                 </button>
                 <NavLink to="/guide" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                   <BookOpen size={14} className="text-[var(--dp-text-secondary)]" /> Guide
                 </NavLink>
                 <div className="flex items-center justify-between px-4 py-1.5 pointer-coarse:min-h-[44px]">
                   <span className="text-[12px] font-medium text-[var(--dp-text-secondary)]">Theme</span>
                   <ThemeSwitch inline />
                 </div>
               </div>
               <div className="h-px w-full bg-[var(--dp-border)] my-1"></div>
               <SignOutRow onSignOut={() => { setIsProfileMenuOpen(false); logout(); }} />
            </MotionDiv>
          )}
          </AnimatePresence>
        </div>
        {tooltip}
      </aside>

      <VersionHistoryModal open={showChangelog} onClose={() => setShowChangelog(false)} />
    </>
  );
};

// The active-item highlight is ONE element per sidebar that glides to the
// active link: it measures the link (NavLink marks it aria-current="page")
// inside the nav and moves there with a decelerating CSS transition. A route
// change animates; everything else that moves the link (collapsing the
// sidebar, folding a section, resizing) just follows it with no animation.
// With reduced motion the glide is a short, plain ease. No marker
// shows when the active page has no item, or its section is folded.
const MARKER_GLIDE = 'cubic-bezier(0.16,1,0.3,1)';

function useNavMarker(containerRef, deps) {
  const { pathname } = useLocation();
  const [box, setBox] = useState(null);
  const lastPath = useRef(null);

  const measure = useCallback((animate) => {
    const container = containerRef.current;
    if (!container) return;
    const link = container.querySelector('a[aria-current="page"]');
    if (!link || link.closest('.hidden, [data-folded="true"]')) {
      setBox((prev) => (prev ? { ...prev, show: false, href: null, animate: false } : prev));
      return;
    }
    const c = container.getBoundingClientRect();
    const l = link.getBoundingClientRect();
    const next = {
      top: l.top - c.top + container.scrollTop - container.clientTop,
      left: l.left - c.left + container.scrollLeft - container.clientLeft,
      width: l.width,
      height: l.height,
      href: link.getAttribute('href'),
      show: true,
    };
    setBox((prev) => {
      // A re-measure that lands on the same spot (the active link's classes
      // changing, say) must not cancel a glide that's under way.
      const same = prev?.show && prev.href === next.href
        && ['top', 'left', 'width', 'height'].every((k) => Math.abs(prev[k] - next[k]) < 0.5);
      if (!animate && same) return prev;
      // Only glide from a spot it was already showing at.
      return { ...next, animate: animate && Boolean(prev?.show) };
    });
  }, [containerRef]);

  // The current page's row is scrolled into view inside the nav on load, on
  // navigation and when the phone drawer opens (only the nav scrolls).
  useLayoutEffect(() => {
    const reveal = () => {
      const container = containerRef.current;
      const link = container?.querySelector('a[aria-current="page"]');
      if (!link || link.closest('[data-folded="true"]')) return;
      const c = container.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      const pad = 8;
      if (l.top < c.top + pad) container.scrollTop -= c.top + pad - l.top;
      else if (l.bottom > c.bottom - pad) container.scrollTop += l.bottom - (c.bottom - pad);
    };
    reveal();
    // Again once the drawer's rows have grown to their 44px touch height
    // (that happens just after it opens).
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(reveal); });
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, ...deps]);

  useLayoutEffect(() => {
    const routeChanged = lastPath.current !== null && lastPath.current !== pathname;
    lastPath.current = pathname;
    measure(routeChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, measure, ...deps]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const follow = () => measure(false);
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(follow);
      ro.observe(container);
      // Links, section headers and section bodies: opening the phone drawer
      // makes the headers taller (44px touch rows), which moves every link.
      container.querySelectorAll('a, button, [data-section-body]').forEach((el) => ro.observe(el));
    }
    // Folding a section flips a class without resizing the nav.
    const mo = new MutationObserver(follow);
    mo.observe(container, { attributes: true, attributeFilter: ['class', 'data-folded'], subtree: true });
    return () => { ro?.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return box;
}

const NavMarker = ({ marker, className }) => {
  const reduceMotion = useReducedMotion();
  const glide = reduceMotion ? '0.15s ease-out' : `0.35s ${MARKER_GLIDE}`;
  return (
    <span
      aria-hidden="true"
      data-nav-marker=""
      data-active-href={marker?.href ?? ''}
      className={clsx('pointer-events-none absolute', className)}
      style={{
        top: marker?.top ?? 0,
        left: marker?.left ?? 0,
        width: marker?.width ?? 0,
        height: marker?.height ?? 0,
        opacity: marker?.show ? 1 : 0,
        transition: marker?.animate
          ? ['top', 'left', 'width', 'height'].map((p) => `${p} ${glide}`).concat('opacity 0.2s').join(', ')
          : 'opacity 0.2s',
      }}
    />
  );
};

// Folded sections are remembered between visits.
const FOLDS_KEY = 'pt-sidebar-folds';
const readFolds = () => {
  try { return JSON.parse(localStorage.getItem(FOLDS_KEY)) || {}; } catch { return {}; }
};

// Whether a nav item's link is the current page (as NavLink decides it).
const isCurrent = (to, pathname) => (to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(`${to}/`));

const SidebarSection = ({ title, children, isCollapsed, tutorialId, foldable = true, defaultFolded = false }) => {
  const { pathname } = useLocation();
  // The guided tour points at items inside sections, so they're open during it.
  const touring = Boolean(useTutorial()?.active);
  const holdsCurrent = React.Children.toArray(children).some((child) => child?.props?.to && isCurrent(child.props.to, pathname));
  const [isSectionOpen, setIsSectionOpenState] = useState(() => {
    if (!foldable) return true;
    const saved = readFolds()[title];
    return saved === undefined ? !defaultFolded : !saved;
  });
  const setIsSectionOpen = (open) => {
    setIsSectionOpenState(open);
    try {
      const folds = readFolds();
      folds[title] = !open;
      localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
    } catch { /* storage unavailable: the fold just isn't remembered */ }
  };
  const showsItems = isSectionOpen || isCollapsed || touring;

  return (
    <div data-section="" data-tutorial-id={tutorialId} className="space-y-0.5">
      {!isCollapsed && !foldable && (
        <p className="dp-sidebar-group px-3 py-1 text-[11px] font-medium uppercase tracking-[1.2px] text-[var(--dp-text-label)]">{title}</p>
      )}
      {!isCollapsed && foldable && (
        <button
          type="button"
          aria-expanded={isSectionOpen}
          aria-current={!isSectionOpen && holdsCurrent ? 'true' : undefined}
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          className="dp-sidebar-group w-full flex items-center justify-between px-3 py-1 text-[12px] lg:text-[11px] font-medium uppercase tracking-[1.2px] text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] transition-colors"
        >
          <span className="flex items-center gap-1.5">
            {title}
            {/* Folded, but the page you're on is inside. */}
            {!isSectionOpen && holdsCurrent && <span aria-hidden="true" data-current-dot="" className="h-1.5 w-1.5 rounded-full bg-[var(--dp-accent-solid)]" />}
          </span>
          <ChevronDown size={12} aria-hidden="true" className={clsx("transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]", !isSectionOpen && "-rotate-90")} />
        </button>
      )}
      {/* The rows slide open and shut (grid 0fr <-> 1fr); folded rows are inert. */}
      <div
        data-section-body=""
        data-folded={showsItems ? 'false' : 'true'}
        inert={!showsItems}
        className="grid transition-[grid-template-rows,opacity] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
        style={{ gridTemplateRows: showsItems ? '1fr' : '0fr', opacity: showsItems ? 1 : 0 }}
      >
        <div className="-mx-1 min-h-0 overflow-hidden px-1">
          <div className="space-y-0.5 py-px">{children}</div>
        </div>
      </div>
    </div>
  );
};

// Sign Out sits last in the menu, right under a thumb on a phone, so it asks
// once before signing out. Closing the menu forgets the question.
function SignOutRow({ onSignOut }) {
  const [asking, setAsking] = useState(false);
  const row = 'flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[12px] font-medium w-full text-left transition-colors';
  if (!asking) {
    return (
      <button type="button" className={`${row} text-[var(--dp-red-text)] hover:bg-[var(--dp-red-bg)]`} onClick={() => setAsking(true)}>
        <LogOut size={14} aria-hidden="true" className="text-[var(--dp-red-text)] opacity-80" /> Sign Out
      </button>
    );
  }
  return (
    <div role="group" aria-label="Sign out?" className="px-4 py-2">
      <p className="text-[12px] font-medium text-[var(--dp-text-primary)]">Sign out of Profit Tracker?</p>
      <div className="mt-2 flex gap-2">
        <button type="button" autoFocus onClick={() => setAsking(false)} className="flex-1 rounded-md bg-[var(--dp-hover-bg)] px-3 py-1.5 pointer-coarse:min-h-[44px] text-[12px] font-medium text-[var(--dp-text-primary)]">Cancel</button>
        <button type="button" onClick={onSignOut} className="flex-1 rounded-md bg-[var(--dp-red-bg)] px-3 py-1.5 pointer-coarse:min-h-[44px] text-[12px] font-semibold text-[var(--dp-red-text)]">Sign out</button>
      </div>
    </div>
  );
}

// A count on a nav item (the To-Do list). Hidden at zero; 99+ past that.
const badgeText = (count) => (count > 99 ? '99+' : String(count));

// The count pops once when it changes (a to-do done or added), never on load.
function BadgeCount({ count, className }) {
  const [shown, setShown] = useState(count);
  const [ticks, setTicks] = useState(0);
  if (shown !== count) {
    setShown(count);
    setTicks((t) => t + 1);
  }
  return (
    <span key={ticks} aria-hidden="true" data-ticks={ticks} className={clsx(className, ticks > 0 && 'pt-badge-tick')}>
      {badgeText(count)}
    </span>
  );
}

const NavItem = ({ icon: Icon, label, to, isCollapsed, tutorialId, badge = 0 }) => (
  <NavLink
    to={to}
    aria-label={badge ? `${label}, ${badge} to do` : isCollapsed ? label : undefined}
    data-tip={isCollapsed ? (badge ? `${label} · ${badgeText(badge)}` : label) : undefined}
    data-tutorial-id={tutorialId}
    {...usePrefetchProps(to)}
    onClick={(e) => { if (e.currentTarget.getAttribute('aria-current') === 'page') e.preventDefault(); }}
    className={({ isActive }) =>
      clsx(
        "relative flex items-center rounded-md border-l-2 border-l-transparent transition-colors",
        isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5 lg:py-1 text-[15px] lg:text-[12px] font-medium",
        isActive
          ? "text-[var(--dp-accent)] font-semibold cursor-default"
          : "text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)]"
      )
    }
  >
    <Icon size={16} className={clsx("flex-shrink-0", !isCollapsed && "max-lg:size-[18px]")} />
    {!isCollapsed && <span className="truncate flex-1 disabled-link">{label}</span>}
    {badge > 0 && (isCollapsed
      ? <BadgeCount count={badge} className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-[var(--dp-accent-solid)] px-1 text-center text-[10px] font-semibold leading-4 text-white tabular-nums" />
      : <BadgeCount count={badge} className="min-w-[20px] rounded-full bg-[var(--dp-accent-solid)] px-1.5 text-center text-[11px] font-semibold leading-5 text-white tabular-nums" />)}
  </NavLink>
);

const GlassNavItem = ({ icon: Icon, label, to, badge = 0 }) => (
  <NavLink
    to={to}
    title={badge ? `${label} (${badge})` : label}
    aria-label={badge ? `${label}, ${badge} to do` : label}
    {...usePrefetchProps(to)}
    className={({ isActive }) =>
      clsx(
        "group relative flex h-8 w-10 items-center justify-center rounded-xl transition-colors hover:z-10",
        isActive
          ? "text-[#d8a65a] pointer-events-none"
          : "text-white/25 hover:text-[#e8e2d6]"
      )
    }
  >
    <Icon size={18} />
    {badge > 0 && <span aria-hidden="true" className="absolute right-1 top-0.5 min-w-[16px] rounded-full bg-[#d8a65a] px-1 text-center text-[10px] font-semibold leading-4 text-[#111315] tabular-nums">{badgeText(badge)}</span>}
    <GlassBranchLabel label={label} />
  </NavLink>
);

const GlassNavButton = ({ icon: Icon, label, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-white/25 transition-colors hover:z-10 hover:text-[#e8e2d6]"
  >
    <Icon size={18} />
    <GlassBranchLabel label={label} />
  </button>
);

const GlassBranchLabel = ({ label }) => (
  <>
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-[calc(100%-1px)] top-0 h-10 w-2 bg-[#181a1c]/[0.88] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
    />
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-[-12px] h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style={{
        background: 'radial-gradient(circle at 0% 100%, #111315 12px, rgba(24,26,28,0.88) 12px)',
      }}
    />
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full bottom-[-12px] h-3 w-3 opacity-0 transition-opacity duration-150 group-hover:opacity-100"
      style={{
        background: 'radial-gradient(circle at 0% 0%, #111315 12px, rgba(24,26,28,0.88) 12px)',
      }}
    />
    <span className="pointer-events-none absolute left-full top-0 flex h-10 w-0 items-center overflow-hidden rounded-r-xl border-y border-r border-white/[0.04] bg-[#181a1c]/[0.88] transition-[width] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:w-[140px]">
      <span className="translate-x-[-8px] whitespace-nowrap pl-4 pr-5 text-xs font-semibold text-[#e8e2d6] opacity-0 transition-all duration-200 delay-100 group-hover:translate-x-0 group-hover:opacity-100">
        {label}
      </span>
    </span>
  </>
);


// Whether the nav has more rows below what's showing; the nav then fades out
// at the bottom so it's clear there's more to scroll to.
function useMoreBelow(navRef, deps) {
  const [more, setMore] = useState(false);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const check = () => setMore(nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4);
    check();
    nav.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null;
    ro?.observe(nav);
    nav.querySelectorAll('[data-section-body]').forEach((el) => ro?.observe(el));
    return () => { nav.removeEventListener('scroll', check); ro?.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRef, ...deps]);
  return more;
}

// The account menu: Escape or a click/tap outside closes it, and Escape
// puts focus back on the account button.
function useProfileMenu(isOpen, setOpen, rootRef, buttonRef) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPointer = (e) => { if (!rootRef.current?.contains(e.target)) setOpen(false); };
    // On window in the capture phase, so it runs before the phone drawer's
    // own Escape (a capture listener on document) and stops it: one Escape
    // closes only the menu.
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [isOpen, setOpen, rootRef, buttonRef]);
}

// Collapsed sidebar: one label beside the icon on hover and on keyboard
// focus (a native title shows on neither touch nor focus). It's fixed, so
// the nav's scroll box doesn't clip it.
function useCollapsedTooltip(containerRef, enabled) {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!enabled || !root) return undefined;
    const show = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (!el || !root.contains(el)) return;
      if (e.type === 'focusin' && !e.target.matches(':focus-visible')) return;
      const r = el.getBoundingClientRect();
      setTip({ text: el.getAttribute('data-tip'), top: r.top + r.height / 2, left: r.right + 10 });
    };
    const hide = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el && e.relatedTarget && el.contains(e.relatedTarget)) return;
      setTip(null);
    };
    const clear = () => setTip(null);
    root.addEventListener('pointerover', show);
    root.addEventListener('pointerout', hide);
    root.addEventListener('focusin', show);
    root.addEventListener('focusout', hide);
    root.addEventListener('scroll', clear, true);
    return () => {
      root.removeEventListener('pointerover', show);
      root.removeEventListener('pointerout', hide);
      root.removeEventListener('focusin', show);
      root.removeEventListener('focusout', hide);
      root.removeEventListener('scroll', clear, true);
    };
  }, [containerRef, enabled]);
  return enabled && tip ? (
    <span
      aria-hidden="true"
      data-sidebar-tooltip=""
      className="pt-tooltip-in pointer-events-none fixed z-[60] -translate-y-1/2 whitespace-nowrap rounded-md bg-[var(--dp-text-primary)] px-2 py-1 text-[12px] font-medium text-[var(--dp-card-bg)] shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
      style={{ top: tip.top, left: tip.left }}
    >
      {tip.text}
    </span>
  ) : null;
}

// The sidebar doubles as the phone's "More" drawer. While it is open as a
// drawer it behaves like a modal: announced as a dialog, Escape closes it,
// Tab stays inside, and focus returns to the More button afterwards. On
// desktop it is a plain, always-visible sidebar, so none of this applies.
function useMobileDrawer(isOpen, close) {
  const isDrawer = isOpen && typeof window !== 'undefined' && !window.matchMedia?.('(min-width: 1024px)').matches;
  const ref = useModalKeyboard(isDrawer, close);
  useEffect(() => {
    const el = ref.current;
    if (!isDrawer || !el) return undefined;
    el.setAttribute('aria-label', 'Menu');
    return () => {
      el.removeAttribute('role');
      el.removeAttribute('aria-modal');
      el.removeAttribute('aria-label');
      el.removeAttribute('aria-labelledby');
    };
  }, [isDrawer, ref]);
  return ref;
}

export default Sidebar;
