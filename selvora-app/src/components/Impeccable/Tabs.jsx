import React from 'react';

/**
 * Underline-style tab strip for Impeccable — replaces pill/background tabs
 * used elsewhere. tabs: [{ id, label }]
 */
export function Tabs({ tabs, active, onChange, className = '' }) {
  return (
    <div className={`flex items-center gap-5 border-b border-[color:var(--border-default)] ${className}`}>
      {tabs.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`relative pb-2.5 text-[13px] font-medium transition-colors ${
              isActive ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {tab.label}
            {isActive && <span className="absolute left-0 right-0 -bottom-px h-[2px] bg-[var(--accent)]" />}
          </button>
        );
      })}
    </div>
  );
}

export default Tabs;
