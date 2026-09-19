// Shared Impeccable input/select/textarea treatment: flat surface, 1px
// hairline border, 4px radius, no glow on focus — per DESIGN.md's Inputs
// spec. Pages that hardcode literal input classes per-field should swap
// them for this under isImpeccable rather than relying on the generic
// CSS retrofit, which can only reskin colors, not resize/redensify.
export const impeccableInputClass =
  'w-full bg-[var(--bg-surface)] border border-[color:var(--border-default)] rounded-[4px] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[color:var(--text-primary)] transition-colors';
