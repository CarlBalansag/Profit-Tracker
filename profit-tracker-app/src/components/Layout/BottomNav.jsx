import React, { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeftRight, Boxes, CirclePlus, DollarSign, LayoutDashboard, Menu, Plus } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import { usePrefetchProps } from '../../hooks/usePrefetchPage';
import { useTodoCount } from '../../hooks/useApi';

const ITEM = 'flex flex-1 flex-col items-center justify-center gap-0.5 h-14 min-w-0 px-0.5 text-[11px] max-[359px]:text-[10.5px] max-[359px]:tracking-tight font-medium';

const QUICK_ADD = [
  { to: '/add-transaction', label: 'Add Transaction', icon: CirclePlus },
  { to: '/add-sale', label: 'Record Sale', icon: DollarSign },
];

const Tab = ({ to, label, icon, end, colors }) => {
  const Icon = icon;
  const prefetch = usePrefetchProps(to);
  return (
    <NavLink to={to} end={end} {...prefetch} className={({ isActive }) => clsx(ITEM, isActive ? colors.active : colors.idle)}>
      <Icon size={20} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
};

const QuickAddLink = ({ to, label, icon, onClick, isGlass }) => {
  const Icon = icon;
  const prefetch = usePrefetchProps(to);
  return (
    <Link
      to={to}
      onClick={onClick}
      {...prefetch}
      className={clsx(
        'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium',
        isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]',
      )}
    >
      <Icon size={18} aria-hidden="true" />
      {label}
    </Link>
  );
};

// Phone navigation: the places used most, one tap away, with the full menu under More.
// Pages with their own tab; every other page lives in the More drawer, so
// More lights up there to say where you are.
const TAB_PATHS = ['/transactions', '/inventory'];
const inMore = (pathname) => pathname !== '/' && !TAB_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

const BottomNav = ({ onMoreClick, isGlass }) => {
  const { pathname } = useLocation();
  const moreIsHere = inMore(pathname);
  // The To-Do list lives in the menu, so its count shows on More.
  const todoCount = useTodoCount();
  const [addOpen, setAddOpen] = useState(false);
  const close = () => setAddOpen(false);
  const menuRef = useModalKeyboard(addOpen, close);

  const colors = isGlass
    ? { active: 'text-[#d8a65a]', idle: 'text-[#e8e2d6]/70' }
    : { active: 'text-[var(--dp-accent)]', idle: 'text-[var(--dp-text-secondary)]' };

  // Shown below 1024px (phones and tablets); the sidebar is always visible from there up.
  return (
    <div className="relative lg:hidden">
      {addOpen && (
        <>
          <button type="button" aria-label="Close quick add" tabIndex={-1} onClick={close} className="fixed inset-0 z-30 cursor-default" />
          <div
            ref={menuRef}
            aria-label="Quick add"
            className={clsx(
              'absolute bottom-full left-1/2 z-40 mb-2 w-56 -translate-x-1/2 overflow-hidden rounded-xl border p-1 shadow-lg',
              isGlass ? 'border-white/10 bg-[#181a1c]' : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]',
            )}
          >
            {QUICK_ADD.map(({ to, label, icon }) => (
              <QuickAddLink key={to} to={to} label={label} icon={icon} onClick={close} isGlass={isGlass} />
            ))}
          </div>
        </>
      )}

      <nav
        aria-label="Main"
        className={clsx(
          'flex items-stretch border-t pb-[env(safe-area-inset-bottom)]',
          isGlass ? 'border-white/10 bg-[#111315]' : 'border-[color:var(--dp-border)] bg-[var(--dp-card-bg)]',
        )}
      >
        <Tab to="/" end label="Dashboard" icon={LayoutDashboard} colors={colors} />
        <Tab to="/transactions" label="Transactions" icon={ArrowLeftRight} colors={colors} />
        <button
          type="button"
          aria-label="Quick add"
          aria-expanded={addOpen}
          onClick={() => setAddOpen(open => !open)}
          className={clsx(ITEM, colors.idle)}
        >
          <span className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-full',
            isGlass ? 'bg-[#d8a65a] text-[#111315]' : 'bg-[var(--dp-accent-solid)] text-white',
          )}>
            <Plus size={20} className={clsx('transition-transform', addOpen && 'rotate-45')} aria-hidden="true" />
          </span>
        </button>
        <Tab to="/inventory" label="Inventory" icon={Boxes} colors={colors} />
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={todoCount ? `More, ${todoCount} to do` : undefined}
          data-here={moreIsHere || undefined}
          onClick={onMoreClick}
          className={clsx(ITEM, moreIsHere ? colors.active : colors.idle)}
        >
          <span className="relative">
            <Menu size={20} aria-hidden="true" />
            {todoCount > 0 && (
              <span
                aria-hidden="true"
                className={clsx(
                  'absolute -right-2.5 -top-1.5 min-w-[16px] rounded-full px-1 text-center text-[10px] font-semibold leading-4 tabular-nums',
                  isGlass ? 'bg-[#d8a65a] text-[#111315]' : 'bg-[var(--dp-text-primary)] text-[var(--dp-card-bg)]',
                )}
              >
                {todoCount > 99 ? '99+' : todoCount}
              </span>
            )}
          </span>
          <span>More</span>
        </button>
      </nav>
    </div>
  );
};

export default BottomNav;
