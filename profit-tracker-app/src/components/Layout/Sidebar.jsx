import React from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ArrowLeftRight, Boxes,
  ReceiptText, FileText, ChartLine, Wallet, CreditCard as CreditCardIcon,
  Settings, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft, X, BadgeDollarSign, BadgePercent, BookOpen, Target, CalendarDays, Truck, Sparkles, ClipboardList, BanknoteArrowDown, Landmark, HandCoins
} from 'lucide-react';
import clsx from 'clsx';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { useAuth } from '../../context/AuthContext';
import { SCHEDULE_C_ENABLED } from '../../config/features';
import { CURRENT_VERSION } from '../../data/changelog';
import VersionHistoryModal from '../VersionHistoryModal';
import ThemeSwitch from '../UI/ThemeSwitch';
import AnimatedLogo from '../UI/AnimatedLogo';
import { useCashoutProviders } from '../../hooks/useCashoutProviders';
import { usePrefetchProps } from '../../hooks/usePrefetchPage';

const Sidebar = ({ isOpen, setIsOpen, isCollapsed, setIsCollapsed, uiStyle = 'neon-dark' }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const navigate = useNavigate();
  const { logout, user } = useAuth();
  const { data: cashoutProviders = [] } = useCashoutProviders();
  const hasCashoutAccess = Array.isArray(cashoutProviders) && cashoutProviders.length > 0;
  const isGlass = uiStyle === 'glassmorphism-brown';
  const navRef = useRef(null);
  const marker = useNavMarker(navRef, [isCollapsed, isGlass, hasCashoutAccess]);

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
              {/* Keyed on open state so the intro replays when the menu opens or closes. */}
              <AnimatedLogo key={isOpen ? 'open' : 'closed'} size={28} label={null} />
            </button>

            <NavMarker marker={marker} className="rounded-xl bg-[#d8a65a]/10" />

            <GlassNavItem icon={LayoutDashboard} label="Dashboard" to="/" />
            <GlassNavItem icon={ShoppingCart} label="Add Transaction" to="/add-transaction" />
            <GlassNavItem icon={BadgeDollarSign} label="Record Sale" to="/add-sale" />
            <GlassNavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" />
            <GlassNavItem icon={Boxes} label="Inventory" to="/inventory" />
            <GlassNavItem icon={Truck} label="Shipping" to="/shipping" />
            <GlassNavItem icon={ClipboardList} label="Statuses" to="/statuses" />
            <GlassNavItem icon={BanknoteArrowDown} label="Expenses" to="/expenses" />
            {SCHEDULE_C_ENABLED && <GlassNavItem icon={Landmark} label="Schedule C" to="/schedule-c" />}
            <GlassNavItem icon={ReceiptText} label="Receipts" to="/receipts" />
            <GlassNavItem icon={FileText} label="Invoices" to="/invoices" />
            <GlassNavItem icon={BadgePercent} label="Tax Exempt" to="/tax-exempt" />
            <GlassNavItem icon={ChartLine} label="Analytics" to="/analytics" />
            <GlassNavItem icon={Wallet} label="Cash Flow" to="/cashflow" />
            <GlassNavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" />
            <GlassNavItem icon={Target} label="Goals" to="/goals" />
            <GlassNavItem icon={CalendarDays} label="Calendar" to="/calendar" />
            {hasCashoutAccess && <GlassNavItem icon={HandCoins} label="Cashout" to="/cashout" />}

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
        className={clsx(
          "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out lg:static lg:translate-x-0 border-r border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated dp-sidebar",
          isOpen ? "translate-x-0" : "-translate-x-full",
          isCollapsed ? "w-[72px]" : "w-64 lg:w-60"
        )}
        onClick={(e) => { if (e.target.closest('a')) setIsOpen(false); }}
      >
        <div className={clsx("flex items-center py-5 border-b border-[color:var(--dp-border)]", isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4")}>
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
            {/* Keyed on the sidebar's state so the intro replays when it is
                collapsed or expanded, or opened or closed on mobile. */}
            <AnimatedLogo
              key={`${isCollapsed ? 'collapsed' : 'expanded'}-${isOpen ? 'open' : 'closed'}`}
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

          <button aria-label="Close menu" className="lg:hidden p-1.5 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-md hover:bg-[var(--dp-hover-bg)]" onClick={() => setIsOpen(false)}>
            <X size={18} />
          </button>

          <button
            className="hidden lg:block p-1.5 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-md hover:bg-[var(--dp-hover-bg)]"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav ref={navRef} className="relative flex-1 py-3 px-2 space-y-3 overflow-y-auto overflow-x-hidden dp-scrollbar">
          <NavMarker marker={marker} className="!mt-0 rounded-md bg-[var(--dp-accent-bg)]" />
          <SidebarSection title="Core" isCollapsed={isCollapsed} tutorialId="sidebar-section-core">
            <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />
            <NavItem icon={ShoppingCart} label="Add Transaction" to="/add-transaction" isCollapsed={isCollapsed} tutorialId="sidebar-add-transaction" />
            <NavItem icon={BadgeDollarSign} label="Record Sale" to="/add-sale" isCollapsed={isCollapsed} tutorialId="sidebar-record-sale" />
            <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} tutorialId="sidebar-transactions" />
          </SidebarSection>

          <SidebarSection title="Operations" isCollapsed={isCollapsed} tutorialId="sidebar-section-operations">
            <NavItem icon={Boxes} label="Inventory On Hand" to="/inventory" isCollapsed={isCollapsed} tutorialId="sidebar-inventory" />
            <NavItem icon={Truck} label="Shipping" to="/shipping" isCollapsed={isCollapsed} />
            <NavItem icon={ClipboardList} label="Statuses" to="/statuses" isCollapsed={isCollapsed} />
            <NavItem icon={BanknoteArrowDown} label="Expenses" to="/expenses" isCollapsed={isCollapsed} tutorialId="sidebar-expenses" />
            {SCHEDULE_C_ENABLED && <NavItem icon={Landmark} label="Schedule C" to="/schedule-c" isCollapsed={isCollapsed} />}
            <NavItem icon={ReceiptText} label="Receipts" to="/receipts" isCollapsed={isCollapsed} tutorialId="sidebar-receipts" />
            <NavItem icon={FileText} label="Invoices" to="/invoices" isCollapsed={isCollapsed} />
            <NavItem icon={BadgePercent} label="Tax Exempt" to="/tax-exempt" isCollapsed={isCollapsed} tutorialId="sidebar-tax-exempt" />
          </SidebarSection>

          <SidebarSection title="Insights" isCollapsed={isCollapsed} tutorialId="sidebar-section-insights">
            <NavItem icon={ChartLine} label="Analytics & Insights" to="/analytics" isCollapsed={isCollapsed} tutorialId="sidebar-analytics" />
            <NavItem icon={Wallet} label="Cash Flow" to="/cashflow" isCollapsed={isCollapsed} tutorialId="sidebar-cashflow" />
            <NavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" isCollapsed={isCollapsed} tutorialId="sidebar-creditcard" />
            <NavItem icon={Target} label="Goals" to="/goals" isCollapsed={isCollapsed} />
            <NavItem icon={CalendarDays} label="Calendar" to="/calendar" isCollapsed={isCollapsed} />
            {hasCashoutAccess && <NavItem icon={HandCoins} label="Cashout" to="/cashout" isCollapsed={isCollapsed} />}
          </SidebarSection>

        </nav>

        <div className="p-2 border-t border-[color:var(--dp-border)]">
          <button
            onClick={() => setShowChangelog(true)}
            title={isCollapsed ? `v${CURRENT_VERSION} — What's New` : undefined}
            className={clsx("flex items-center rounded-md border-l-2 border-transparent text-[12px] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Sparkles size={14} />
            {!isCollapsed && <span className="truncate">v{CURRENT_VERSION}</span>}
          </button>
          <button
            data-tutorial-id="sidebar-datasetup"
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className={clsx("flex items-center rounded-md border-l-2 border-transparent text-[12px] text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Settings size={14} />
            {!isCollapsed && <span className="truncate">Data Setup</span>}
          </button>
          <NavItem icon={BookOpen} label="Guide" to="/guide" isCollapsed={isCollapsed} tutorialId="sidebar-guide" />
          <div className={clsx("flex items-center py-1.5", isCollapsed ? "justify-center" : "justify-between px-3")}>
            {!isCollapsed && <span className="text-[12px] text-[var(--dp-text-secondary)]">Theme</span>}
            <ThemeSwitch inline />
          </div>
        </div>

        <div className="p-2 border-t border-[color:var(--dp-border)] relative">
          <button
            className={clsx("flex items-center rounded-md hover:bg-[var(--dp-hover-bg)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-3 py-2 px-3 text-left")}
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

          {isProfileMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated-hover rounded-lg py-2 z-50 overflow-hidden">
               <NavLink to="/settings" className="flex items-center gap-3 px-4 py-2.5 text-[12px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <Settings size={14} className="text-[var(--dp-text-secondary)]" /> Settings
               </NavLink>
               <div className="h-px w-full bg-[var(--dp-border)] my-1"></div>
               <button className="flex items-center gap-3 px-4 py-2.5 text-[12px] font-medium text-[var(--dp-red-text)] hover:bg-[var(--dp-red-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); logout(); }}>
                 <PanelLeftClose size={14} className="rotate-180 text-[var(--dp-red-text)] opacity-80" /> Sign Out
               </button>
            </div>
          )}
        </div>
      </aside>

      <VersionHistoryModal open={showChangelog} onClose={() => setShowChangelog(false)} />
    </>
  );
};

// The active-item highlight is ONE element per sidebar that glides to the
// active link: it measures the link (NavLink marks it aria-current="page")
// inside the nav and moves there with a springy CSS transition. A route
// change animates; everything else that moves the link (collapsing the
// sidebar, folding a section, resizing) just follows it with no animation.
// With reduced motion the glide is a short ease with no overshoot. No marker
// shows when the active page has no item, or its section is folded.
const MARKER_GLIDE = 'cubic-bezier(.3,1.35,.5,1)';

function useNavMarker(containerRef, deps) {
  const { pathname } = useLocation();
  const [box, setBox] = useState(null);
  const lastPath = useRef(null);

  const measure = useCallback((animate) => {
    const container = containerRef.current;
    if (!container) return;
    const link = container.querySelector('a[aria-current="page"]');
    if (!link || link.closest('.hidden')) {
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
      container.querySelectorAll('a').forEach((a) => ro.observe(a));
    }
    // Folding a section flips a class without resizing the nav.
    const mo = new MutationObserver(follow);
    mo.observe(container, { attributes: true, attributeFilter: ['class'], subtree: true });
    return () => { ro?.disconnect(); mo.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...deps]);

  return box;
}

const NavMarker = ({ marker, className }) => {
  const reduceMotion = useReducedMotion();
  const glide = reduceMotion ? '0.15s ease-out' : `0.45s ${MARKER_GLIDE}`;
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

const SidebarSection = ({ title, children, isCollapsed, tutorialId }) => {
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  const showsItems = isSectionOpen || isCollapsed;

  return (
    <div data-tutorial-id={tutorialId} className={clsx("space-y-0.5", isCollapsed ? "mt-4 first:mt-0" : "")}>
      {!isCollapsed && (
        <button
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          className="w-full flex items-center justify-between px-3 py-1 text-[11px] font-medium uppercase tracking-[1.2px] text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] transition-colors"
        >
          <span>{title}</span>
          {isSectionOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
      )}
      <div className={clsx("space-y-0.5", showsItems ? "block" : "hidden")}>
        {children}
      </div>
    </div>
  );
};

const NavItem = ({ icon: Icon, label, to, isCollapsed, tutorialId }) => (
  <NavLink
    to={to}
    title={isCollapsed ? label : undefined}
    data-tutorial-id={tutorialId}
    {...usePrefetchProps(to)}
    className={({ isActive }) =>
      clsx(
        "relative flex items-center rounded-md border-l-2 border-l-transparent transition-colors",
        isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5 lg:py-1 text-[12px] font-medium",
        isActive
          ? "text-[var(--dp-accent)] pointer-events-none"
          : "text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)]"
      )
    }
  >
    <Icon size={16} className="flex-shrink-0" />
    {!isCollapsed && <span className="truncate flex-1 disabled-link">{label}</span>}
  </NavLink>
);

const GlassNavItem = ({ icon: Icon, label, to }) => (
  <NavLink
    to={to}
    title={label}
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

export default Sidebar;
