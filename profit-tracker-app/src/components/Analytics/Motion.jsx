// Motion pieces shared by Analytics and Cash Flow, in the same feel as the
// Dashboard: quick rises, a springy sliding pill (like the sidebar marker),
// bars that grow from zero, and numbers that count and flash when they change.
// Like the Dashboard's CountUp and the logo, these play even when the device
// asks for reduced motion: they are short and nothing loops except where noted.
import React, { useId, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import CountUp from '../UI/CountUp';

const EASE = [0.16, 1, 0.3, 1];
const SPRING = { type: 'spring', stiffness: 520, damping: 34, mass: 0.9 };
const MotionDiv = motion.div;
const MotionSpan = motion.span;

// A container whose direct <RiseItem> children fade and rise in a quick wave.
const riseParent = { hidden: {}, shown: { transition: { staggerChildren: 0.06 } } };
const riseChild = {
  hidden: { opacity: 0, y: 12 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};
export function Rise({ as = 'div', className, children, ...rest }) {
  const Comp = as === 'div' ? MotionDiv : motion[as];
  return <Comp className={className} variants={riseParent} initial="hidden" animate="shown" {...rest}>{children}</Comp>;
}
export function RiseItem({ className, children, ...rest }) {
  return <MotionDiv className={className} variants={riseChild} {...rest}>{children}</MotionDiv>;
}

// A row of options with a highlight that springs to the chosen one.
// options: [{ key, label, icon? }]
export function SlidingTabs({ options, value, onChange, ariaLabel, size = 'md', className = '' }) {
  const group = useId();
  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm';
  return (
    <div role="tablist" aria-label={ariaLabel} className={`relative flex gap-1 p-1 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] overflow-x-auto max-w-full ${className}`}>
      {options.map(({ key, label, icon: Icon }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={`relative flex-1 whitespace-nowrap rounded-lg font-medium transition-colors ${pad} ${active ? 'text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)] hover:text-[var(--dp-text-primary)]'}`}
          >
            {active && (
              <MotionSpan
                layoutId={`pill-${group}`}
                className="absolute inset-0 rounded-lg bg-[var(--accent-bg)] border border-[color:var(--accent)]"
                transition={SPRING}
              />
            )}
            <span className="relative z-[1] flex items-center justify-center gap-2">
              {Icon && <Icon size={size === 'sm' ? 13 : 15} />}{label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// A horizontal bar that grows from zero to `pct` (0–100).
export function GrowBar({ pct, color = 'var(--accent)', delay = 0, height = 8, track = true }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0));
  return (
    <div className={`w-full rounded-full overflow-hidden ${track ? 'bg-[var(--dp-hover-bg)]' : ''}`} style={{ height }}>
      <MotionDiv
        className="h-full rounded-full origin-left"
        style={{ backgroundColor: color, width: `${width}%` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.9, ease: EASE, delay }}
      />
    </div>
  );
}

// A formatted number ("$1,234.56") that counts to its value and, when the
// value goes up or down after a filter change, glows green or red briefly.
export function FlashNumber({ value, number, pending = false, className = '' }) {
  // The last settled value, kept in state so a change is noticed while
  // rendering (React's "store information from previous renders" pattern).
  const [settled, setSettled] = useState(number);
  const [flash, setFlash] = useState(null);
  if (!pending && Number.isFinite(number) && number !== settled) {
    if (Number.isFinite(settled)) setFlash((f) => ({ dir: number > settled ? 'up' : 'down', n: (f?.n ?? 0) + 1 }));
    setSettled(number);
  }
  return (
    <span className={`relative inline-block rounded-md ${className}`}>
      <AnimatePresence>
        {flash && (
          <MotionSpan
            key={flash.n}
            aria-hidden="true"
            className="absolute -inset-x-1.5 -inset-y-0.5 rounded-md"
            style={{ backgroundColor: flash.dir === 'up' ? 'var(--dp-green-bg)' : 'var(--dp-red-bg)' }}
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <span className="relative"><CountUp value={value} pending={pending} /></span>
    </span>
  );
}

// Content that grows open and closed instead of popping.
export function Expand({ open, children }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <MotionDiv
          key="expand"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1, transition: { height: { duration: 0.4, ease: EASE }, opacity: { duration: 0.25, delay: 0.08 } } }}
          exit={{ height: 0, opacity: 0, transition: { height: { duration: 0.3, ease: EASE }, opacity: { duration: 0.15 } } }}
          style={{ overflow: 'hidden' }}
        >
          {children}
        </MotionDiv>
      )}
    </AnimatePresence>
  );
}

// Section card used on both pages.
export function Panel({ title, sub, right, className = '', children }) {
  return (
    <section className={`card p-5 min-w-0 ${className}`}>
      {(title || right) && (
        <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
          <div className="min-w-0">
            {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">{title}</h3>}
            {sub && <p className="text-xs text-[var(--dp-text-muted)] mt-1">{sub}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ children }) {
  return <div className="py-10 text-center text-sm text-[var(--dp-text-muted)]">{children}</div>;
}

// A soft red glow that breathes slowly, for rows that need attention (a late
// payout). The one looping animation on these pages.
export function LateGlow({ active, className = '', children, ...rest }) {
  if (!active) return <div className={className} {...rest}>{children}</div>;
  return (
    <MotionDiv
      className={className}
      animate={{ boxShadow: ['0 0 0 0 rgba(248,113,113,0)', '0 0 0 3px rgba(248,113,113,0.28)', '0 0 0 0 rgba(248,113,113,0)'] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      {...rest}
    >
      {children}
    </MotionDiv>
  );
}
