import React, { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { ArrowLeftRight, CirclePlus, DollarSign, LayoutDashboard, Menu, Package, Plus } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const ITEM = 'flex flex-1 flex-col items-center justify-center gap-0.5 h-14 min-w-0 text-[11px] font-medium';

const QUICK_ADD = [
  { to: '/add-transaction', label: 'Add Transaction', icon: CirclePlus },
  { to: '/add-sale', label: 'Record Sale', icon: DollarSign },
];

const Tab = ({ to, label, icon, end, colors }) => {
  const Icon = icon;
  return (
    <NavLink to={to} end={end} className={({ isActive }) => clsx(ITEM, isActive ? colors.active : colors.idle)}>
      <Icon size={20} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </NavLink>
  );
};

// Phone navigation: the places used most, one tap away, with the full menu under More.
const BottomNav = ({ onMoreClick, isGlass }) => {
  const [addOpen, setAddOpen] = useState(false);
  const close = () => setAddOpen(false);
  const menuRef = useModalKeyboard(addOpen, close);

  const colors = isGlass
    ? { active: 'text-[#d8a65a]', idle: 'text-[#e8e2d6]/70' }
    : { active: 'text-[var(--dp-accent)]', idle: 'text-[var(--dp-text-secondary)]' };

  return (
    <div className="relative md:hidden">
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
            {QUICK_ADD.map(({ to, label, icon }) => {
              const Icon = icon;
              return (
                <Link
                  key={to}
                  to={to}
                  onClick={close}
                  className={clsx(
                    'flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium',
                    isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]',
                  )}
                >
                  <Icon size={18} aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
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
        <Tab to="/inventory" label="Inventory" icon={Package} colors={colors} />
        <button type="button" aria-label="Open menu" onClick={onMoreClick} className={clsx(ITEM, colors.idle)}>
          <Menu size={20} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
};

export default BottomNav;
