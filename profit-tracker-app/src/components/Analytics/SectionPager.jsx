import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Phone navigation for a page split into sections (Analytics: Overview,
 * Products & Stores, Channels, Cards). The current section is named in the
 * middle with the neighbouring names peeking in, faded, from each edge, so
 * it's clear there is more either side. Arrows and dots (like the
 * dashboard's Goals / Top Cards pager) move between sections, and
 * SwipeArea lets the content itself be swiped left or right.
 *
 * options: [{ key, label, icon? }]
 */
export function SectionPager({ options, value, onChange, ariaLabel = 'Sections', className = '' }) {
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const prev = options[index - 1];
  const next = options[index + 1];
  const current = options[index];
  const go = (i) => { if (i >= 0 && i < options.length) onChange(options[i].key); };
  const CurrentIcon = current?.icon;

  const arrow = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--dp-text-secondary)] transition-colors hover:bg-[var(--dp-hover-bg)] disabled:opacity-25 disabled:hover:bg-transparent';

  return (
    <nav aria-label={ariaLabel} className={`card p-1.5 ${className}`}>
      <div className="flex items-center gap-1">
        <button type="button" className={arrow} onClick={() => go(index - 1)} disabled={!prev} aria-label={prev ? `Previous: ${prev.label}` : 'Previous section'}>
          <ChevronLeft size={18} />
        </button>

        {/* Label rail: neighbours fade out at the edges (the "there's more" peek). */}
        <div
          className="relative flex min-w-0 flex-1 items-center justify-center gap-3 overflow-hidden"
          style={{ WebkitMaskImage: 'linear-gradient(90deg, transparent 0, #000 22%, #000 78%, transparent 100%)', maskImage: 'linear-gradient(90deg, transparent 0, #000 22%, #000 78%, transparent 100%)' }}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => go(index - 1)}
            className={`shrink-0 whitespace-nowrap text-xs text-[var(--dp-text-muted)] ${prev ? '' : 'invisible'}`}
          >
            {prev?.label ?? 'none'}
          </button>
          <span
            aria-live="polite"
            className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[color:var(--accent)] bg-[var(--accent-bg)] px-3 py-2 text-sm font-semibold text-[var(--dp-text-primary)]"
          >
            {CurrentIcon && <CurrentIcon size={14} />}
            {current?.label}
          </span>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => go(index + 1)}
            className={`shrink-0 whitespace-nowrap text-xs text-[var(--dp-text-muted)] ${next ? '' : 'invisible'}`}
          >
            {next?.label ?? 'none'}
          </button>
        </div>

        <button type="button" className={arrow} onClick={() => go(index + 1)} disabled={!next} aria-label={next ? `Next: ${next.label}` : 'Next section'}>
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Position dots */}
      <div className="flex items-center justify-center gap-1.5 pb-1">
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            onClick={() => go(i)}
            className="page-dot flex items-center justify-center p-1.5"
            aria-label={`Go to ${o.label}`}
            aria-current={i === index ? 'true' : undefined}
          >
            <span className={`block h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-[var(--dp-accent)]' : 'w-1.5 bg-[var(--dp-border-hover)]'}`} />
          </button>
        ))}
      </div>
    </nav>
  );
}

/**
 * Wraps section content so a horizontal swipe moves to the next or previous
 * section. Vertical scrolling is left alone: a swipe only counts when it is
 * mostly sideways and at least 50px long, and it never starts on a control
 * that scrolls sideways itself (charts, tables).
 */
export function SwipeArea({ onPrev, onNext, children, className = '' }) {
  const start = useRef(null);

  const onTouchStart = (e) => {
    const t = e.touches[0];
    const scroller = e.target.closest?.('[data-no-swipe], .overflow-x-auto');
    start.current = scroller ? null : { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e) => {
    if (!start.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    start.current = null;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0) onNext?.(); else onPrev?.();
  };

  return (
    <div className={className} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {children}
    </div>
  );
}
