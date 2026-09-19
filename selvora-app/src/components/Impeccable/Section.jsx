import React from 'react';

/**
 * The Impeccable "card replacement": a flat, 1px-bordered container with an
 * optional header row. Children are expected to be Row-like items that
 * self-divide (border-t + first:border-t-0), not padded card content —
 * use `bare` for arbitrary content (e.g. a chart) that shouldn't get the
 * default vertical list treatment.
 */
export function Section({ title, action, children, className = '', bare = false, ...rest }) {
  return (
    <div className={`rounded-[6px] border border-[color:var(--border-default)] bg-[var(--bg-surface)] ${className}`} {...rest}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[color:var(--border-default)]">
          {title && (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.7px] text-[var(--text-muted)]">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      <div className={bare ? 'p-4' : ''}>{children}</div>
    </div>
  );
}

export default Section;
