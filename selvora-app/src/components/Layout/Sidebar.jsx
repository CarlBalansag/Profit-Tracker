import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, CirclePlus, ArrowLeftRight, Package,
  Receipt, FileText, ChartColumn, Wallet, CreditCard as CreditCardIcon,
  Settings, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft, X, DollarSign, ShieldCheck, BookOpen, Target, CalendarDays
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';

const Sidebar = ({ isOpen, setIsOpen, isCollapsed, setIsCollapsed, uiStyle = 'neon-dark' }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAuth();

  if (uiStyle === 'glassmorphism-brown') {
    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm lg:hidden"
            onClick={() => setIsOpen(false)}
          />
        )}

        <aside className={clsx(
          "fixed left-4 top-1/2 z-50 -translate-y-1/2 transition-transform duration-300 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-24 lg:translate-x-0"
        )}>
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
            <GlassNavItem icon={Receipt} label="Expenses" to="/expenses" />
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
  
  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm lg:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
      
      <aside className={clsx(
        "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out lg:static lg:translate-x-0 border-r border-[color:var(--border-default)]",
        isOpen ? "translate-x-0" : "-translate-x-full",
        isCollapsed ? "w-[72px]" : "w-64 lg:w-56 3xl:w-60",
        "[background:linear-gradient(180deg,var(--sidebar-bg-start)_0%,var(--sidebar-bg-end)_100%)]"
      )}>
        <div className={clsx("flex items-center py-5 border-b border-[color:var(--border-default)]", isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4")}>
          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-lg bg-[var(--accent)]">
            <span className="text-white font-semibold text-xl">P</span>
          </div>
          
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-[17px] font-medium text-[var(--text-primary)] tracking-[-0.3px]">Profit Tracker</h1>
              <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-[1.2px]">Reselling</p>
            </div>
          )}
          
          <button className="lg:hidden p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)]" onClick={() => setIsOpen(false)}>
            <X size={20} />
          </button>
          
          <button 
            className="hidden lg:block p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded-md hover:bg-[var(--bg-hover)]"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
          <SidebarSection title="Core" isCollapsed={isCollapsed} tutorialId="sidebar-section-core">
            <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />
            <NavItem icon={CirclePlus} label="Add Transaction" to="/add-transaction" isCollapsed={isCollapsed} tutorialId="sidebar-add-transaction" />
            <NavItem icon={DollarSign} label="Record Sale" to="/add-sale" isCollapsed={isCollapsed} tutorialId="sidebar-record-sale" />
            <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} tutorialId="sidebar-transactions" />
          </SidebarSection>

          <SidebarSection title="Operations" isCollapsed={isCollapsed} tutorialId="sidebar-section-operations">
            <NavItem icon={Package} label="Inventory On Hand" to="/inventory" isCollapsed={isCollapsed} tutorialId="sidebar-inventory" />
            <NavItem icon={Receipt} label="Expenses" to="/expenses" isCollapsed={isCollapsed} tutorialId="sidebar-expenses" />
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

        <div className="p-2 border-t border-[color:var(--border-default)]">
          <button
            data-tutorial-id="sidebar-datasetup"
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className={clsx("flex items-center rounded-md border-l-2 border-transparent text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Settings size={16} />
            {!isCollapsed && <span className="truncate">Data Setup</span>}
          </button>
          <NavItem icon={BookOpen} label="Guide" to="/guide" isCollapsed={isCollapsed} tutorialId="sidebar-guide" />
        </div>

        <div className="p-2 border-t border-[color:var(--border-default)] relative">
          <button 
            className={clsx("flex items-center rounded-md hover:bg-[var(--bg-hover)] transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-3 py-2 px-3 text-left")}
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          >
            <div className="w-8 h-8 rounded-full bg-[var(--bg-elevated)] flex-shrink-0 text-[var(--accent)] flex items-center justify-center text-xs font-semibold">CB</div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)] truncate">CarlBBB</p>
                  <p className="text-xs text-[var(--text-muted)]">Online</p>
                </div>
                <ChevronDown size={16} className={clsx("text-[var(--text-muted)] transition-transform", isProfileMenuOpen ? "rotate-180" : "")} />
              </>
            )}
          </button>
          
          {isProfileMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-[var(--bg-elevated)] border border-[color:var(--border-default)] rounded-lg py-2 z-50 overflow-hidden">
               <NavLink to="/settings" className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <Settings size={16} className="text-[var(--text-secondary)]" /> Settings
               </NavLink>
               <div className="h-px w-full bg-[var(--border-default)] my-1"></div>
               <button className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-[var(--red)] hover:bg-[var(--red-bg)] w-full text-left transition-colors" onClick={() => { setIsProfileMenuOpen(false); logout(); }}>
                 <PanelLeftClose size={16} className="rotate-180 text-[var(--red)] opacity-80" /> Sign Out
               </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

const SidebarSection = ({ title, children, isCollapsed, tutorialId }) => {
  const [isSectionOpen, setIsSectionOpen] = useState(true);

  return (
    <div data-tutorial-id={tutorialId} className={clsx("space-y-1", isCollapsed ? "mt-4 first:mt-0" : "")}>
      {!isCollapsed && (
        <button 
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          className="w-full flex items-center justify-between px-3 py-1 text-[9px] font-medium uppercase tracking-[1.2px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
        >
          <span>{title}</span>
          {isSectionOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
      )}
      <div className={clsx("space-y-1", !isSectionOpen && !isCollapsed ? "hidden" : "block")}>
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
    className={({ isActive }) =>
      clsx(
        "flex items-center rounded-md border-l-2 transition-colors",
        isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5 text-sm font-medium",
        isActive
          ? "text-[var(--accent)] bg-[var(--accent-bg)] [border-left-color:var(--accent)] pointer-events-none"
          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] border-l-transparent"
      )
    }
  >
    <Icon size={18} className="flex-shrink-0" />
    {!isCollapsed && <span className="truncate flex-1 disabled-link">{label}</span>}
  </NavLink>
);

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
