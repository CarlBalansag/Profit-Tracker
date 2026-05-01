import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, CirclePlus, ArrowLeftRight, Package, 
  Receipt, FileText, ChartColumn, Wallet, TrendingUp, 
  Settings, ChevronDown, ChevronRight, PanelLeftClose, PanelLeft, X, DollarSign
} from 'lucide-react';
import clsx from 'clsx';
import { useState } from 'react';

const Sidebar = ({ isOpen, setIsOpen, isCollapsed, setIsCollapsed }) => {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const navigate = useNavigate();
  
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
        "fixed inset-y-0 left-0 z-50 flex flex-col transition-all duration-300 ease-in-out lg:static lg:translate-x-0 border-r border-white/10",
        isOpen ? "translate-x-0" : "-translate-x-full",
        isCollapsed ? "w-[72px]" : "w-64 lg:w-56 3xl:w-60",
        "[background:linear-gradient(180deg,var(--sidebar-bg-start)_0%,var(--sidebar-bg-end)_100%)]"
      )}>
        <div className={clsx("flex items-center py-5 border-b border-white/10", isCollapsed ? "justify-center px-0 flex-col gap-2" : "gap-3 px-4")}>
          <div className="w-10 h-10 flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
            <span className="text-white font-bold text-xl">P</span>
          </div>
          
          {!isCollapsed && (
            <div className="flex-1 min-w-0">
              <h1 className="text-lg font-bold text-white tracking-tight">Profit Tracker</h1>
              <p className="text-[10px] text-gray-500 uppercase tracking-widest">Reselling</p>
            </div>
          )}
          
          <button className="lg:hidden p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" onClick={() => setIsOpen(false)}>
            <X size={20} />
          </button>
          
          <button 
            className="hidden lg:block p-1.5 text-gray-400 hover:text-white rounded-lg hover:bg-white/5" 
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="flex-1 py-4 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
          <SidebarSection title="Core" isCollapsed={isCollapsed}>
            <NavItem icon={LayoutDashboard} label="Dashboard" to="/" isCollapsed={isCollapsed} />
            <NavItem icon={CirclePlus} label="Add Transaction" to="/add-transaction" isCollapsed={isCollapsed} />
            <NavItem icon={DollarSign} label="Record Sale" to="/add-sale" isCollapsed={isCollapsed} />
            <NavItem icon={ArrowLeftRight} label="Transactions" to="/transactions" isCollapsed={isCollapsed} />
          </SidebarSection>
          
          <SidebarSection title="Operations" isCollapsed={isCollapsed}>
            <NavItem icon={Package} label="Inventory On Hand" to="/inventory" isCollapsed={isCollapsed} />
            <NavItem icon={Receipt} label="Expenses" to="/expenses" isCollapsed={isCollapsed} />
            <NavItem icon={FileText} label="Receipts" to="/receipts" isCollapsed={isCollapsed} />
            <NavItem icon={FileText} label="Invoices" to="/invoices" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Insights" isCollapsed={isCollapsed}>
            <NavItem icon={ChartColumn} label="Analytics & Insights" to="/analytics" isCollapsed={isCollapsed} />
            <NavItem icon={Wallet} label="Cash Flow" to="/cashflow" isCollapsed={isCollapsed} />
          </SidebarSection>

          <SidebarSection title="Tools" isCollapsed={isCollapsed}>
            <NavItem icon={TrendingUp} label="Forecast Planner" to="/forecast" isCollapsed={isCollapsed} />
          </SidebarSection>
        </nav>

        <div className="p-2 border-t border-white/10">
          <button 
            onClick={() => navigate('/settings', { state: { tab: 'datasetup' } })}
            className={clsx("flex items-center rounded-lg text-sm text-gray-400 hover:text-white hover:bg-white/5 transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-2.5 py-2 px-3")}>
            <Settings size={16} />
            {!isCollapsed && <span className="truncate">Data Setup</span>}
          </button>
        </div>

        <div className="p-2 border-t border-white/10 relative">
          <button 
            className={clsx("flex items-center rounded-lg hover:bg-white/5 transition-colors", isCollapsed ? "p-2 justify-center w-full" : "w-full gap-3 py-2 px-3 text-left")}
            onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
          >
            <div className="w-8 h-8 rounded-full bg-purple-500 flex-shrink-0 text-white flex items-center justify-center text-xs font-bold ring-2 ring-purple-500/30">CB</div>
            {!isCollapsed && (
              <>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-200 truncate">CarlBBB</p>
                  <p className="text-xs text-gray-500">Online</p>
                </div>
                <ChevronDown size={16} className={clsx("text-gray-500 transition-transform", isProfileMenuOpen ? "rotate-180" : "")} />
              </>
            )}
          </button>
          
          {isProfileMenuOpen && (
            <div className="absolute bottom-full left-2 right-2 mb-2 bg-[#12121A] border border-gray-800 rounded-xl shadow-2xl py-2 z-50 overflow-hidden">
               <NavLink to="/settings" className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-300 hover:text-white hover:bg-white/5 w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <Settings size={16} className="text-gray-400" /> Settings
               </NavLink>
               <div className="h-px w-full bg-gray-800/50 my-1"></div>
               <button className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 w-full text-left transition-colors" onClick={() => setIsProfileMenuOpen(false)}>
                 <PanelLeftClose size={16} className="rotate-180 text-red-500 opacity-80" /> Sign Out
               </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

const SidebarSection = ({ title, children, isCollapsed }) => {
  const [isSectionOpen, setIsSectionOpen] = useState(true);
  
  return (
    <div className={clsx("space-y-1", isCollapsed ? "mt-4 first:mt-0" : "")}>
      {!isCollapsed && (
        <button 
          onClick={() => setIsSectionOpen(!isSectionOpen)}
          className="w-full flex items-center justify-between px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500 hover:text-gray-300 transition-colors"
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

const NavItem = ({ icon: Icon, label, to, isCollapsed }) => (
  <NavLink
    to={to}
    title={isCollapsed ? label : undefined}
    className={({ isActive }) =>
      clsx(
        "flex items-center rounded-xl transition-all",
        isCollapsed ? "justify-center p-2.5" : "gap-3 px-3 py-2.5 text-sm font-medium",
        isActive
          ? "text-white bg-[image:var(--active-gradient)] border border-[color:var(--active-border-color)] shadow-[0_0_15px_rgba(139,92,246,0.3)] pointer-events-none"
          : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
      )
    }
  >
    <Icon size={18} className="flex-shrink-0" />
    {!isCollapsed && <span className="truncate flex-1 disabled-link">{label}</span>}
  </NavLink>
);

export default Sidebar;
