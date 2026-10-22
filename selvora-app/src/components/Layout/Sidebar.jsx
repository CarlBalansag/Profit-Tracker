import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CirclePlus, ArrowLeftRight, Package,
  Receipt, FileText, ChartColumn, Wallet, CreditCard as CreditCardIcon,
  Settings, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft, X, DollarSign, ShieldCheck, BookOpen, Target, CalendarDays, Truck, Sparkles, ListChecks
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { SCHEDULE_C_ENABLED } from '../../config/features';
import { CURRENT_VERSION } from '../../data/changelog';
import VersionHistoryModal from '../VersionHistoryModal';

const Sidebar = ({ isOpen, setIsOpen, isCollapsed, setIsCollapsed, uiStyle = 'neon-dark' }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [showChangelog, setShowChangelog] = useState(false);
  const navigate = useNavigate();
  const { logout, user } = useAuth();

  // ── Glassmorphism sidebar — unchanged from original ───────────────────────
  if (uiStyle === 'glassmorphism-brown') {
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
          <div className="flex flex-col items-center gap-1 rounded-[24px] border border-white/[0.07] bg-[#181a1c]/[0.88] px-2 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.28)] backdrop-blur-sm">
            <button
              onClick={() => navigate('/')}
              className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#d8a65a,#c4873a)] text-sm font-bold text-[#101114] shadow-[0_6px_16px_rgba(216,166,90,0.16)]"
              title="Profit Tracker"
            >
              P
            </button>

            <GlassNavItem icon={LayoutDashboard} label="Dashboard" to="/" />
            <GlassNavItem icon={CirclePlus} label="Add Transaction" to="/add-transaction" />
            <GlassNavItem icon={DollarSign} label="Record Sale" to="/add-sale" />
            <GlassNavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" />
            <GlassNavItem icon={Package} label="Inventory" to="/inventory" />
            <GlassNavItem icon={Truck} label="Shipping" to="/shipping" />
            <GlassNavItem icon={ListChecks} label="Statuses" to="/statuses" />
            <GlassNavItem icon={Receipt} label="Expenses" to="/expenses" />
            {SCHEDULE_C_ENABLED && <GlassNavItem icon={FileText} label="Schedule C" to="/schedule-c" />}
            <GlassNavItem icon={ChartColumn} label="Analytics" to="/analytics" />
            <GlassNavItem icon={Wallet} label="Cash Flow" to="/cashflow" />
            <GlassNavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" />
            <GlassNavItem icon={Target} label="Goals" to="/goals" />
            <GlassNavItem icon={CalendarDays} label="Calendar" to="/calendar" />

            <div className="my-2 h-px w-7 bg-white/[0.07]" />

            <GlassNavItem icon={BookOpen} label="Guide" to="/guide" />
            <GlassNavButton icon={Settings} label="Settings" onClick={() => navigate('/settings')} />
          </div>
        </aside>
      </>
    );
  }

  // ── Carbon / default sidebar — Step 2 redesign ────────────────────────────
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
          // Step 2: unified width (no lg breakpoint split), slimmer collapsed state.
          // All existing color/shadow tokens preserved unchanged.
          "fixed inset-y-0 left-0 z-50 flex flex-col",
          "transition-all duration-300 ease-in-out",
          "lg:static lg:translate-x-0",
          "border-r border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated",
          isOpen ? "translate-x-0" : "-translate-x-full",
          // Step 2: 232 px expanded (was 256 / 224 px breakpoint split),
          //          56 px collapsed (was 72 px) — slimmer collapsed rail
          isCollapsed ? "w-[56px]" : "w-[232px]"
        )}
        onClick={(e) => { if (e.target.closest('a')) setIsOpen(false); }}
      >
        {/* ── Brand header ───────────────────────────────────────────────── */}
        <div
          className={clsx(
            // Step 2: py-4 (was py-5) — slightly tighter header row
            "flex items-center py-4 border-b border-[color:var(--dp-border)]",
            isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4"
          )}
        >
          {/* Step 2: logo mark — rounded-xl (was rounded-lg), w-9 h-9 (was w-10 h-10),
              text-lg (was text-xl). Rounder and proportionally scaled to the header. */}
          <div className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-[var(--dp-accent)]">
            <span className="text-[#ffffff] font-semibold text-lg">P</span>
          </div>

          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              {/* Step 2: text-[15px] (was text-[17px]), tracking-[-0.4px] (was -0.3px) */}
              <h1 className="text-[15px] font-semibold text-[var(--dp-text-primary)] tracking-[-0.4px] leading-tight">
                Profit Tracker
              </h1>
              <p className="text-[9px] text-[var(--dp-text-label)] uppercase tracking-[1px] mt-0.5">
                Reselling
              </p>
            </div>
          )}

          {/* Mobile close */}
          <button
            className="lg:hidden p-1.5 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-lg hover:bg-[var(--dp-hover-bg)]"
            onClick={() => setIsOpen(false)}
          >
            <X size={18} />
          </button>

          {/* Desktop collapse toggle */}
          <button
            className="hidden lg:flex items-center justify-center p-1.5 text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] rounded-lg hover:bg-[var(--dp-hover-bg)]"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        {/* ── Main navigation ─────────────────────────────────────────────── */}
        {/* Step 2: py-3 (was py-4), space-y-5 (was space-y-4) for more
            breathing room between section groups */}
        <nav className="flex-1 py-3 px-2 space-y-5 overflow-y-auto overflow-x-hidden theme-scrollbar">
          <SidebarSection title="Core" isCollapsed={isCollapsed} tutorialId="sidebar-section-core">
            <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />
            <NavItem icon={CirclePlus} label="Add Transaction" to="/add-transaction" isCollapsed={isCollapsed} tutorialId="sidebar-add-transaction" />
            <NavItem icon={DollarSign} label="Record Sale" to="/add-sale" isCollapsed={isCollapsed} tutorialId="sidebar-record-sale" />
            <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} tutorialId="sidebar-transactions" />
          </SidebarSection>

          <SidebarSection title="Operations" isCollapsed={isCollapsed} tutorialId="sidebar-section-operations">
            <NavItem icon={Package} label="Inventory On Hand" to="/inventory" isCollapsed={isCollapsed} tutorialId="sidebar-inventory" />
            <NavItem icon={Truck} label="Shipping" to="/shipping" isCollapsed={isCollapsed} />
            <NavItem icon={ListChecks} label="Statuses" to="/statuses" isCollapsed={isCollapsed} />
            <NavItem icon={Receipt} label="Expenses" to="/expenses" isCollapsed={isCollapsed} tutorialId="sidebar-expenses" />
            {SCHEDULE_C_ENABLED && <NavItem icon={FileText} label="Schedule C" to="/schedule-c" isCollapsed={isCollapsed} />}
            <NavItem icon={FileText} label="Receipts" to="/receipts" isCollapsed={isCollapsed} tutorialId="sidebar-receipts" />
            <NavItem icon={ShieldCheck} label="Tax Exempt" to="/tax-exempt" isCollapsed={isCollapsed} tutorialId="sidebar-tax-exempt" />
          </SidebarSection>

          <SidebarSection title="Insights" isCollapsed={isCollapsed} tutorialId="sidebar-section-insights">
            <NavItem icon={ChartColumn} label="Analytics & Insights" to="/analytics" isCollapsed={isCollapsed} tutorialId="sidebar-analytics" />
            <NavItem icon={Wallet} label="Cash Flow" to="/cashflow" isCollapsed={isCollapsed} tutorialId="sidebar-cashflow" />
            <NavItem icon={CreditCardIcon} label="Credit Card" to="/creditcard" isCollapsed={isCollapsed} tutorialId="sidebar-creditcard" />
            <NavItem icon={Target} label="Goals" to="/goals" isCollapsed={isCollapsed} />
            <NavItem icon={CalendarDays} label="Calendar" to="/calendar" isCollapsed={isCollapsed} />
          </SidebarSection>
        </nav>

        {/* ── Footer utility links ────────────────────────────────────────── */}
        <div className="px-2 py-2 border-t border-[color:var(--dp-border)]">
          {/* Changelog / What's New */}
          <button
            onClick={() => setShowChangelog(true)}
            title={isCollapsed ? `v${CURRENT_VERSION} — What's New` : undefined}
            className={clsx(
              // Step 2: rounded-xl (was rounded-md), no border-l-2
              "flex items-center rounded-xl text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors",
              isCollapsed
                ? "w-9 h-9 justify-center mx-auto"
                : "w-full gap-2.5 py-2 px-3"
            )}
          >
            <Sparkles size={15} className="flex-shrink-0" />
            {!isCollapsed && <span className="truncate text-[13px]">v{CURRENT_VERSION}</span>}
          </button>

          {/* Data Setup */}
          <button
            data-tutorial-id="sidebar-datasetup"
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className={clsx(
              "flex items-center rounded-xl text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] transition-colors",
              isCollapsed
                ? "w-9 h-9 justify-center mx-auto"
                : "w-full gap-2.5 py-2 px-3"
            )}
          >
            <Settings size={15} className="flex-shrink-0" />
            {!isCollapsed && <span className="truncate text-[13px]">Data Setup</span>}
          </button>

          {/* Guide */}
          <NavItem icon={BookOpen} label="Guide" to="/guide" isCollapsed={isCollapsed} tutorialId="sidebar-guide" />
        </div>

        {/* ── Profile / account ──────────────────────────────────────────── */}
        <div className="px-2 py-2 border-t border-[color:var(--dp-border)] relative">
          <button
            className={clsx(
              // Step 2: rounded-xl (was rounded-md)
              "flex items-center rounded-xl hover:bg-[var(--dp-hover-bg)] transition-colors",
              isCollapsed
                ? "w-9 h-9 justify-center mx-auto"
                : "w-full gap-3 py-2 px-3 text-left"
            )}
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          >
            {/* Step 2: avatar is rounded-lg (was rounded-full) for geometric
                consistency; w-7 h-7 (was w-8 h-8) scaled to the tighter row */}
            <div className="w-7 h-7 rounded-lg bg-[var(--dp-bg)] flex-shrink-0 text-[var(--dp-accent)] flex items-center justify-center text-[11px] font-bold">
              {(user?.username || '?').slice(0, 2).toUpperCase()}
            </div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[var(--dp-text-primary)] truncate leading-tight">
                    {user?.username || 'Account'}
                  </p>
                  <p className="text-[10px] text-[var(--dp-text-label)] leading-tight">Online</p>
                </div>
                <ChevronDown
                  size={14}
                  className={clsx(
                    "text-[var(--dp-text-label)] transition-transform flex-shrink-0",
                    isProfileMenuOpen ? "rotate-180" : ""
                  )}
                />
              </>
            )}
          </button>

          {/* Profile pop-up — layout and colors identical to original */}
          {isProfileMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] dp-elevated-hover rounded-xl py-1.5 z-50 overflow-hidden">
              <NavLink
                to="/settings"
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] w-full text-left transition-colors"
                onClick={() => setIsProfileMenuOpen(false)}
              >
                <Settings size={15} className="text-[var(--dp-text-secondary)]" />
                Settings
              </NavLink>
              <div className="h-px w-full bg-[var(--dp-border)] my-1" />
              <button
                className="flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium text-[var(--dp-red-text)] hover:bg-[var(--dp-red-bg)] w-full text-left transition-colors"
                onClick={() => { setIsProfileMenuOpen(false); logout(); }}
              >
                <PanelLeftClose size={15} className="rotate-180 text-[var(--dp-red-text)] opacity-80" />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </aside>

      <VersionHistoryModal open={showChangelog} onClose={() => setShowChangelog(false)} />
    </>
  );
};

// ── SidebarSection ──────────────────────────────────────────────────────────────
// Step 2 changes vs original:
//   • Section label: text-[10px] (was text-[9px]), tracking-[0.1em] (was 1.2px)
//     font-semibold (was font-medium) — slightly more readable, more deliberate
//   • Chevron size: 12 (was 14) — proportionally scaled to the smaller label
//   • Item spacing: space-y-0.5 (was space-y-1) — tighter within each group
//   • Collapsed top margin: mt-3 (was mt-4)
//   • Section collapse toggle logic is completely unchanged
const SidebarSection = ({ title, children, isCollapsed, tutorialId }) => {
  const [isSectionOpen, setIsSectionOpen] = useState(true);

  return (
    <div
      data-tutorial-id={tutorialId}
      className={clsx("space-y-0.5", isCollapsed ? "mt-3 first:mt-0" : "")}
    >
      {!isCollapsed && (
        <button
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          className="w-full flex items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] transition-colors"
        >
          <span>{title}</span>
          {isSectionOpen
            ? <ChevronDown size={12} className="flex-shrink-0" />
            : <ChevronRight size={12} className="flex-shrink-0" />
          }
        </button>
      )}
      <div className={clsx("space-y-0.5", !isSectionOpen && !isCollapsed ? "hidden" : "block")}>
        {children}
      </div>
    </div>
  );
};

// ── NavItem ─────────────────────────────────────────────────────────────────────
// Step 2 changes vs original:
//   • rounded-xl  (was rounded-md)  — rounder pill shape
//   • NO border-l-2 active indicator — dropped entirely; active state is
//     communicated by accent bg + accent text alone, without a border stripe
//   • gap-2.5 (was gap-3) — tighter icon-to-label spacing
//   • py-2 (was py-2.5) — slightly reduced item height
//   • text-[13px] (was text-sm / 14px) — scaled to the tighter layout
//   • icon size={16} (was 18) — proportionally scaled to the smaller item
//   • collapsed: explicit w-9 h-9 with mx-auto for perfect rail centering
const NavItem = ({ icon: Icon, label, to, isCollapsed, tutorialId }) => (
  <NavLink
    to={to}
    title={isCollapsed ? label : undefined}
    data-tutorial-id={tutorialId}
    className={({ isActive }) =>
      clsx(
        "flex items-center rounded-xl transition-colors",
        isCollapsed
          ? "w-9 h-9 justify-center mx-auto"
          : "gap-2.5 px-3 py-2 text-[13px] font-medium",
        isActive
          ? "text-[var(--dp-accent)] bg-[var(--dp-accent-bg)] pointer-events-none"
          : "text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)]"
      )
    }
  >
    <Icon size={16} className="flex-shrink-0" />
    {!isCollapsed && <span className="truncate flex-1 disabled-link">{label}</span>}
  </NavLink>
);

// ── Glass sidebar sub-components — completely unchanged from original ────────────
const GlassNavItem = ({ icon: Icon, label, to }) => (
  <NavLink
    to={to}
    title={label}
    className={({ isActive }) =>
      clsx(
        "group relative flex h-10 w-10 items-center justify-center rounded-xl transition-colors hover:z-10",
        isActive
          ? "bg-[#d8a65a]/10 text-[#d8a65a] pointer-events-none"
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
