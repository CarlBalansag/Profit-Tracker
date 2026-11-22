import { RiseItem } from '../Analytics/Motion';
import InfoTip from '../UI/InfoTip';

/**
 * A number tile in the Cash Flow style: small label, big number, one short
 * line under it. The longer explanation lives in the (i) next to the label.
 */
export function Tile({ label, tip, tipAlign = 'left', value, sub, tone = 'text-[var(--dp-text-primary)]', icon: Icon, highlight = false }) {
  return (
    <RiseItem className={`card relative min-w-0 p-4 ${highlight ? 'ring-1 ring-[color:var(--accent)]' : ''}`}>
      {Icon && <Icon size={16} aria-hidden="true" className="absolute right-4 top-4 text-[var(--dp-text-label)]" />}
      <span className="flex items-center gap-1.5 pr-6 text-[11px] font-semibold uppercase tracking-wider text-[var(--dp-text-label)]">
        {label}{tip && <InfoTip name={label} text={tip} align={tipAlign} />}
      </span>
      <p className={`mt-2 text-xl font-bold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] text-[var(--dp-text-muted)]">{sub}</p>}
    </RiseItem>
  );
}

/** A small uppercase pill, as on the Cash Flow and To-Do pages. */
export function Pill({ tone = 'muted', children }) {
  const cls = {
    good: 'bg-[var(--dp-green-bg)] text-[var(--dp-green-text)]',
    warn: 'bg-[var(--dp-warning-bg)] text-[var(--dp-warning-text)]',
    bad: 'bg-[var(--dp-red-bg)] text-[var(--dp-red-text)]',
    accent: 'bg-[var(--accent-bg)] text-[var(--dp-accent-text)]',
    muted: 'bg-[var(--dp-hover-bg)] text-[var(--dp-text-secondary)]',
  }[tone];
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{children}</span>;
}
