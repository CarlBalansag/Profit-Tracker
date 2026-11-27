import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ArrowLeftRight, Boxes,
  ReceiptText, FileText, ChartLine, Wallet, CreditCard as CreditCardIcon,
  Settings, History, ChevronDown, PanelLeftClose, PanelLeft, Database, LogOut, Search, Plus, DollarSign, RefreshCw, X, BadgeDollarSign, BadgePercent, BookOpen, Target, CalendarDays, Truck, Sparkles, ClipboardList, BanknoteArrowDown, Landmark, HandCoins, ListChecks, Zap
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
import PageSearch from './PageSearch';
import { pageList } from './pageList';
import { useCashoutProviders } from '../../hooks/useCashoutProviders';
import { usePrefetchProps } from '../../hooks/usePrefetchPage';
import { useNavCashFlow, useNavTodosQuery, useTodoCount } from '../../hooks/useApi';
import { navFigures } from './navFigures';
import { useMatchMedia } from '../../hooks/useMatchMedia';
import { useTutorial } from '../../context/TutorialContext';

const MotionDiv = motion.div;

const Sidebar = ({ isOpen, setIsOpen, isCollapsed: collapsedPref, setIsCollapsed, uiStyle = 'neon-dark' }) => {
  // Collapsing is a desktop choice: below 1024px the sidebar is the phone
  // drawer, which always shows its labels (and has no expand button).
  const isNarrow = useMatchMedia('(max-width: 1023px)');
  const isShort = useMatchMedia('(max-height: 860px)');
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
  // Each row's live figure (owed, due, to ship...), from the same to-do list.
  const navQuery = useNavTodosQuery();
  const navTodos = navQuery.data;
  const navCash = useNavCashFlow();
  const figures = React.useMemo(() => navFigures(navTodos, navCash), [navTodos, navCash]);
  const fig = (to) => figures[to];
  const addBuyPrefetch = usePrefetchProps('/add-transaction');
  const recordSalePrefetch = usePrefetchProps('/add-sale');
  const isGlass = uiStyle === 'glassmorphism-brown';
  const reduceMotion = useReducedMotion();
  // Ctrl+K / ⌘K opens page search from anywhere.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pages = pageList({ hasCashoutAccess, scheduleC: SCHEDULE_C_ENABLED });
  const searchKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘K' : 'Ctrl+K';
  const openSearch = () => { setIsOpen(false); setSearchOpen(true); };
  const search = <PageSearch open={searchOpen} onClose={() => setSearchOpen(false)} pages={pages} />;
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
  const tooltip = useCollapsedTooltip(drawerRef, !isGlass, isCollapsed);
  // In the phone drawer, Dashboard, Transactions and Inventory are already on
  // the bottom bar, so the drawer leaves them out (the guided tour still
  // points at them, so they stay while it runs).
  const touring = Boolean(useTutorial()?.active);
  const inBar = isNarrow && !touring;
  const { above: moreAbove, below: moreBelow } = useMoreBelow(navRef, [isCollapsed, isOpen, hasCashoutAccess]);

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
        {search}
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
          "fixed inset-y-0 left-0 z-50 flex shrink-0 flex-col transition-[width,translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none lg:static lg:translate-x-0 border-r border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated dp-sidebar",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-[72px]" : "w-[min(85vw,320px)] lg:w-[248px]"
        )}
        onClick={(e) => { if (e.target.closest('a')) setIsOpen(false); }}
      >
        <div className={clsx("flex items-center py-3 lg:py-3.5 border-b border-[color:var(--dp-border)]", isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4")}>
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

        {/* The two daily actions, as buttons above the places (on phones the
            bottom bar's + already has them, so the drawer leaves them out). */}
        {!inBar && (
          <div data-tutorial-id="sidebar-section-core" className={clsx("px-2 pt-2.5", isCollapsed ? "flex flex-col items-center gap-1.5" : "grid grid-cols-2 gap-1.5")}>
            <NavLink
              to="/add-transaction"
              data-tutorial-id="sidebar-add-transaction"
              aria-label={isCollapsed ? 'Log a buy' : undefined}
              data-tip={isCollapsed ? 'Log a buy' : undefined}
              {...addBuyPrefetch}
              className={({ isActive }) => clsx("dp-action-primary flex items-center justify-center gap-1 rounded-lg font-semibold text-white transition-[filter,transform] hover:brightness-110 active:scale-[0.98]", isCollapsed ? "h-9 w-9" : "h-9 whitespace-nowrap px-1.5 text-[13px] lg:text-[12px] pointer-coarse:h-11", isActive && "ring-2 ring-inset ring-white/60")}
            >
              <Plus size={15} aria-hidden="true" />
              {!isCollapsed && <span>Log a buy</span>}
            </NavLink>
            <NavLink
              to="/add-sale"
              data-tutorial-id="sidebar-record-sale"
              aria-label={isCollapsed ? 'Record sale' : undefined}
              data-tip={isCollapsed ? 'Record sale' : undefined}
              {...recordSalePrefetch}
              className={({ isActive }) => clsx("flex items-center justify-center gap-1 rounded-lg border font-semibold transition-colors", isActive ? "border-[color:var(--dp-accent-text)] text-[var(--dp-accent-text)] bg-[var(--dp-accent-bg)]" : "border-[color:var(--dp-border)] text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)]", isCollapsed ? "h-9 w-9" : "h-9 whitespace-nowrap px-1.5 text-[13px] lg:text-[12px] pointer-coarse:h-11")}
            >
              <DollarSign size={15} aria-hidden="true" />
              {!isCollapsed && <span>Record sale</span>}
            </NavLink>
          </div>
        )}

        <div className={clsx("px-2 pt-2", isCollapsed && "flex justify-center")}>
          <button
            type="button"
            onClick={openSearch}
            aria-label={isCollapsed ? 'Search pages' : undefined}
            aria-keyshortcuts="Control+K Meta+K"
            data-tip={isCollapsed ? `Search pages · ${searchKey}` : undefined}
            className={clsx(
              "flex items-center rounded-md border border-[color:var(--dp-border)] text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors",
              isCollapsed ? "h-9 w-9 justify-center" : "w-full gap-2.5 px-3 py-1.5 pointer-coarse:min-h-[44px] text-[13px] lg:text-[12px]"
            )}
          >
            <Search size={14} aria-hidden="true" />
            {!isCollapsed && (
              <>
                <span className="flex-1 text-left">Search pages</span>
                <kbd className="hidden rounded border border-[color:var(--dp-border)] px-1 text-[10px] lg:inline">{searchKey}</kbd>
              </>
            )}
          </button>
        </div>

        {navQuery.isError && !navTodos && (isCollapsed ? (
          <button type="button" onClick={() => navQuery.refetch()} aria-label="Live numbers didn't load. Retry" data-tip="Live numbers didn't load · Retry" className="mx-auto mt-2 flex h-8 w-8 items-center justify-center rounded-md text-[var(--dp-red-text)] hover:bg-[var(--dp-hover-bg)]">
            <RefreshCw size={14} aria-hidden="true" />
          </button>
        ) : (
          <p role="status" className="mx-3 mt-2 flex items-center justify-between gap-2 text-[12px] text-[var(--dp-text-label)]">
            Live numbers didn&apos;t load.
            <button type="button" onClick={() => navQuery.refetch()} className="font-semibold text-[var(--dp-accent-text)] underline underline-offset-2">Retry</button>
          </p>
        ))}

        <nav ref={navRef} aria-label="Pages" className={clsx("relative flex-1 py-1.5 px-2 space-y-2 overflow-y-auto overflow-x-hidden dp-scrollbar", isCollapsed && "dp-rail", moreBelow && "dp-nav-more", moreAbove && "dp-nav-less")}>
          <NavMarker marker={marker} className="!mt-0 rounded-md bg-[var(--dp-accent-bg)]" />
          {/* A ledger: each place carries the one live figure that says whether
              it needs you, in a single right-aligned column. */}
          <SidebarSection title="Today" isCollapsed={isCollapsed} foldable={false}>
            {!inBar && <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />}
            <NavItem icon={ListChecks} label="To-Do" to="/todos" isCollapsed={isCollapsed} figure={fig('/todos')} />
            <NavItem icon={CalendarDays} label="Calendar" to="/calendar" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Stock" isCollapsed={isCollapsed}>
            {!inBar && <NavItem icon={Boxes} label="Inventory" to="/inventory" isCollapsed={isCollapsed} tutorialId="sidebar-inventory" figure={fig('/inventory')} />}
            {!inBar && <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} tutorialId="sidebar-transactions" />}
            <NavItem icon={Truck} label="Shipping" to="/shipping" isCollapsed={isCollapsed} figure={fig('/shipping')} />
            <NavItem icon={ClipboardList} label="Statuses" to="/statuses" isCollapsed={isCollapsed} />
            <NavItem icon={Zap} label="Email Automation" to="/automation" isCollapsed={isCollapsed} figure={fig('/automation')} />
          </SidebarSection>

          <SidebarSection title="Money" isCollapsed={isCollapsed} tutorialId="sidebar-section-insights">
            <NavItem icon={Wallet} label="Cash Flow" to="/cashflow" isCollapsed={isCollapsed} tutorialId="sidebar-cashflow" figure={fig('/cashflow')} />
            <NavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" isCollapsed={isCollapsed} tutorialId="sidebar-creditcard" figure={fig('/creditcard')} />
            {hasCashoutAccess && <NavItem icon={HandCoins} label="Cashout" to="/cashout" isCollapsed={isCollapsed} figure={fig('/cashout')} />}
            <NavItem icon={ChartLine} label="Analytics" to="/analytics" isCollapsed={isCollapsed} tutorialId="sidebar-analytics" />
            <NavItem icon={Target} label="Goals" to="/goals" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Books" isCollapsed={isCollapsed} tutorialId="sidebar-section-operations" defaultFolded={isNarrow || isShort}>
            <NavItem icon={BanknoteArrowDown} label="Expenses" to="/expenses" isCollapsed={isCollapsed} tutorialId="sidebar-expenses" figure={fig('/expenses')} />
            <NavItem icon={ReceiptText} label="Receipts" to="/receipts" isCollapsed={isCollapsed} tutorialId="sidebar-receipts" />
            <NavItem icon={FileText} label="Invoices" to="/invoices" isCollapsed={isCollapsed} />
            <NavItem icon={BadgePercent} label="Tax Exempt" to="/tax-exempt" isCollapsed={isCollapsed} tutorialId="sidebar-tax-exempt" />
            {SCHEDULE_C_ENABLED && <NavItem icon={Landmark} label="Schedule C" to="/schedule-c" isCollapsed={isCollapsed} />}
          </SidebarSection>
        </nav>

        {/* Desktop footer: one row of icons (each named, with a label on hover
            and focus) so the pages above get the room. On phones these live in
            the account menu. */}
        <div data-footer-tips="" className={clsx("hidden border-t border-[color:var(--dp-border)] p-2 items-center gap-1", !isCollapsed && "lg:flex")}>
          <button
            type="button"
            onClick={() => setShowChangelog(true)}
            aria-label={`What's New, v${CURRENT_VERSION}`}
            data-tip={`What's New · v${CURRENT_VERSION}`}
            className={clsx("flex h-8 items-center gap-1.5 rounded-md text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "w-8 justify-center" : "px-2")}
          >
            <Sparkles size={14} aria-hidden="true" />
            {!isCollapsed && <span aria-hidden="true" className="text-[11px] tabular-nums">v{CURRENT_VERSION}</span>}
          </button>
          <button
            type="button"
            data-tutorial-id="sidebar-datasetup"
            aria-label="Data Setup"
            data-tip="Data Setup"
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors"
          >
            <Database size={14} aria-hidden="true" />
          </button>
          <NavLink
            to="/guide"
            aria-label="Guide"
            data-tip="Guide"
            data-tutorial-id="sidebar-guide"
            className={({ isActive }) => clsx("flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors hover:bg-[var(--dp-hover-bg)]", isActive ? "text-[var(--dp-accent-text)] bg-[var(--dp-accent-bg)]" : "text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]")}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span aria-hidden="true" className="text-[12px]">Guide</span>
          </NavLink>
          <div data-tip="Theme" className={clsx("flex items-center", isCollapsed ? "py-1" : "ml-auto pr-1")}>
            <ThemeSwitch inline />
          </div>
        </div>

        <div ref={profileRootRef} className="p-2 border-t border-[color:var(--dp-border)] relative">
          <button
            ref={profileButtonRef}
            type="button"
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
                  <p className="text-[11px] text-[var(--dp-text-label)]">Account &amp; settings</p>
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
              id={profileMenuId} className={clsx("absolute bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated-hover rounded-lg py-2 z-50 overflow-hidden", isCollapsed ? "bottom-1 left-full ml-2 w-56" : "bottom-full left-2 right-2 mb-2")} data-menu-box="">
               <NavLink to="/settings" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <Settings size={14} className="text-[var(--dp-text-secondary)]" /> Settings
               </NavLink>
               <NavLink to="/activity" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <History size={14} className="text-[var(--dp-text-secondary)]" /> Activity
               </NavLink>
               {/* On phones and on the collapsed rail: the tools the desktop footer shows. */}
               <div className={isCollapsed ? undefined : 'lg:hidden'}>
                 <div className="h-px w-full bg-[var(--dp-border)] my-1"></div>
                 <button type="button" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); setShowChangelog(true); }}>
                   <Sparkles size={14} className="text-[var(--dp-text-secondary)]" /> What's New <span className="ml-auto text-[11px] text-[var(--dp-text-label)]">v{CURRENT_VERSION}</span>
                 </button>
                 <button type="button" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); setIsOpen(false); navigate('/settings', { state: { tab: 'datasetup' } }); }}>
                   <Database size={14} className="text-[var(--dp-text-secondary)]" /> Data Setup
                 </button>
                 <NavLink to="/guide" className="flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                   <BookOpen size={14} className="text-[var(--dp-text-secondary)]" /> Guide
                 </NavLink>
                 <div className="flex items-center justify-between px-4 py-1.5 pointer-coarse:min-h-[44px]">
                   <span className="text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-secondary)]">Theme</span>
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
      {search}

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
  const revealRef = useRef(() => {});
  const revealUntil = useRef(0);
  useLayoutEffect(() => {
    const reveal = () => {
      const container = containerRef.current;
      const current = container?.querySelector('a[aria-current="page"]');
      if (!current) return;
      const folded = current.closest('[data-folded="true"]');
      const link = folded ? folded.closest('[data-section]')?.querySelector('.dp-sidebar-group') : current;
      if (!link) return;
      const c = container.getBoundingClientRect();
      const l = link.getBoundingClientRect();
      // Clear of the 32px fades at the top and bottom edges.
      const pad = 40;
      if (l.top < c.top + pad) container.scrollTop -= c.top + pad - l.top;
      else if (l.bottom > c.bottom - pad) container.scrollTop += l.bottom - (c.bottom - pad);
    };
    reveal();
    // Keep it in view while the layout settles for a moment: a section that
    // opens for this page slides open over 200ms, and the drawer's rows grow
    // to 44px just after it opens. The resize observer below calls this.
    revealRef.current = reveal;
    revealUntil.current = performance.now() + 500;
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
    const follow = () => {
      measure(false);
      if (performance.now() < revealUntil.current) revealRef.current();
    };
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
  // Folded: the heading says what's waiting inside (a late one first).
  const inside = React.Children.toArray(children).map((child) => child?.props?.figure).filter(Boolean);
  const foldedSummary = inside.find((f) => f.problem) || inside[0];
  const [isSectionOpen, setIsSectionOpenState] = useState(() => {
    if (!foldable || holdsCurrent) return true; // the page you're on is never hidden
    const saved = readFolds()[title];
    return saved === undefined ? !defaultFolded : !saved;
  });
  const sectionRef = useRef(null);
  const setIsSectionOpen = (open) => {
    setIsSectionOpenState(open);
    // Once it has slid open, bring its rows into view in the nav.
    if (open) setTimeout(() => sectionRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }), 220);
    try {
      const folds = readFolds();
      folds[title] = !open;
      localStorage.setItem(FOLDS_KEY, JSON.stringify(folds));
    } catch { /* storage unavailable: the fold just isn't remembered */ }
  };
  // Going to a page inside a folded section opens it, so you can see where
  // you are; that isn't saved as your choice.
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (holdsCurrent && !isSectionOpen) setIsSectionOpenState(true);
  }
  const showsItems = isSectionOpen || isCollapsed || touring;

  return (
    <div ref={sectionRef} data-section="" data-tutorial-id={tutorialId} className="space-y-0.5">
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
            {!isSectionOpen && foldedSummary && <span aria-hidden="true" className={clsx("font-normal normal-case tracking-normal", foldedSummary.problem ? "text-[var(--dp-red-text)]" : "opacity-80")}>· {foldedSummary.text}</span>}
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
  const signOutRef = useRef(null);
  const cancel = () => {
    setAsking(false);
    requestAnimationFrame(() => signOutRef.current?.focus());
  };
  const row = 'flex items-center gap-3 px-4 py-2.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium w-full text-left transition-colors';
  if (!asking) {
    return (
      <button ref={signOutRef} type="button" className={`${row} text-[var(--dp-red-text)] hover:bg-[var(--dp-red-bg)]`} onClick={() => setAsking(true)}>
        <LogOut size={14} aria-hidden="true" className="text-[var(--dp-red-text)] opacity-80" /> Sign Out
      </button>
    );
  }
  return (
    <div role="group" aria-label="Sign out?" className="px-4 py-2">
      <p className="text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-primary)]">Sign out of Profit Tracker?</p>
      <div className="mt-2 flex gap-2">
        <button type="button" autoFocus onClick={cancel} className="flex-1 rounded-md border border-[color:var(--dp-border)] px-3 py-1.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-medium text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)]">Cancel</button>
        <button type="button" onClick={onSignOut} className="flex-1 rounded-md bg-[var(--dp-red-bg)] px-3 py-1.5 pointer-coarse:min-h-[44px] text-[15px] lg:text-[12px] font-semibold text-[var(--dp-red-text)]">Sign out</button>
      </div>
    </div>
  );
}

// A count on a nav item (the To-Do list). Hidden at zero; 99+ past that.
const badgeText = (count) => (count > 99 ? '99+' : String(count));

// A figure pops once when it changes (a to-do done or added), never on load.
function BadgeCount({ count, text, className, ...rest }) {
  const value = text ?? badgeText(count);
  const [shown, setShown] = useState(value);
  const [ticks, setTicks] = useState(0);
  if (shown !== value) {
    setShown(value);
    setTicks((t) => t + 1);
  }
  return (
    <span key={ticks} aria-hidden="true" data-ticks={ticks} className={clsx(className, ticks > 0 && 'pt-badge-tick')} {...rest}>
      {value}
    </span>
  );
}

const NavItem = ({ icon: Icon, label, to, isCollapsed, tutorialId, figure }) => (
  <NavLink
    to={to}
    aria-label={figure ? `${label}, ${figure.text}` : isCollapsed ? label : undefined}
    data-tip={isCollapsed ? (figure ? `${label} · ${figure.text}` : label) : undefined}
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
    {/* The ledger column: one live figure, right-aligned in tabular numbers. */}
    {figure && !isCollapsed && (
      <span className={clsx("dp-nav-figure flex shrink-0 items-center gap-1", figure.problem ? "dp-nav-figure-problem" : "dp-nav-figure-muted")}>
        {figure.problem && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />}
        <BadgeCount text={figure.text} data-figure="" className="text-right text-[13px] lg:text-[12px] font-semibold tabular-nums" />
      </span>
    )}
    {/* Collapsed rail: To-Do keeps its count; every other figure is a dot
        (red when late), with its words in the label. */}
    {figure?.count > 0 && isCollapsed && (
      <BadgeCount count={figure.count} className={clsx("absolute -right-1 -top-1 min-w-[16px] rounded-full px-1 text-center text-[10px] font-semibold leading-[14px] tabular-nums", figure.problem ? "border border-transparent bg-[var(--dp-red-text)] text-[#2a0a0e]" : "border border-[color:var(--dp-text-label)] bg-[var(--dp-card-bg)] text-[var(--dp-text-secondary)]")} />
    )}
    {figure && !(figure.count > 0) && isCollapsed && (
      <span aria-hidden="true" data-figure-dot="" className={clsx("absolute right-1 top-1 h-2 w-2 rounded-full", figure.problem ? "bg-[var(--dp-red-text)]" : "border border-[color:var(--dp-text-label)]")} />
    )}
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
  const [more, setMore] = useState({ above: false, below: false });
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;
    const check = () => {
      const next = { above: nav.scrollTop > 4, below: nav.scrollTop + nav.clientHeight < nav.scrollHeight - 4 };
      setMore((prev) => (prev.above === next.above && prev.below === next.below ? prev : next));
    };
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
function useCollapsedTooltip(containerRef, enabled, collapsed) {
  const [tip, setTip] = useState(null);
  useEffect(() => {
    const root = containerRef.current;
    if (!enabled || !root) return undefined;
    const show = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (!el || !root.contains(el)) return;
      // Expanded, only the footer's icons need labels; collapsed, everything.
      if (!collapsed && !el.closest('[data-footer-tips]')) return;
      if (e.type === 'focusin' && !e.target.matches(':focus-visible')) return;
      // Beside the icon on the rail; above it in the expanded footer row.
      const focus = e.type === 'focusin';
      // A focused icon can scroll the rail first, so measure a frame later.
      const place = () => {
        const r2 = el.getBoundingClientRect();
        setTip(collapsed
          ? { text: el.getAttribute('data-tip'), top: r2.top + r2.height / 2, left: r2.right + 10, side: 'right', focus }
          : { text: el.getAttribute('data-tip'), top: r2.top - 8, left: r2.left + r2.width / 2, side: 'top', focus });
      };
      place();
      if (focus) requestAnimationFrame(place);
    };
    const hide = (e) => {
      const el = e.target.closest?.('[data-tip]');
      if (el && e.relatedTarget && el.contains(e.relatedTarget)) return;
      setTip(null);
    };
    const clear = () => setTip((t) => (t?.focus ? t : null));
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
  }, [containerRef, enabled, collapsed]);
  return enabled && tip ? (
    <span
      aria-hidden="true"
      data-sidebar-tooltip=""
      data-side={tip.side}
      className="pt-tooltip-in pointer-events-none fixed z-[60] whitespace-nowrap rounded-md bg-[var(--dp-text-primary)] px-2 py-1 text-[12px] font-medium text-[var(--dp-card-bg)] shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
      style={{ top: tip.top, left: tip.left, transform: tip.side === 'top' ? 'translate(-50%, -100%)' : 'translateY(-50%)' }}
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
