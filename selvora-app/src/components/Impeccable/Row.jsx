import React from 'react';

/**
 * A dense list item inside a Section — icon, label/sublabel, and a
 * right-aligned value. Self-dividing (each row draws its own top border,
 * the first row in a Section skips it), so Rows can be dropped straight
 * into a Section's children with no extra wrapper.
 */
export function Row({ icon: Icon, label, sublabel, value, valueColor, onClick, className = '' }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 border-t border-[color:var(--border-default)] first:border-t-0 text-left transition-colors ${
        onClick ? 'cursor-pointer hover:bg-[var(--bg-hover)]' : ''
      } ${className}`}
    >
      {Icon && <Icon size={15} className="shrink-0 text-[var(--text-secondary)]" />}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-[var(--text-primary)] truncate">{label}</p>
        {sublabel && <p className="text-[11px] text-[var(--text-muted)] truncate">{sublabel}</p>}
      </div>
      {value !== undefined && value !== null && (
        <span
          className="shrink-0 text-[13px] font-medium tabular-nums"
          style={{ color: valueColor || 'var(--text-primary)', fontFamily: "'Geist Mono', ui-monospace, monospace" }}
        >
          {value}
        </span>
      )}
    </Tag>
  );
}

export default Row;
