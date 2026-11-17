import React, { useId, useState } from 'react';
import { Info } from 'lucide-react';

// A small (i) next to a field label. Hover or keyboard focus shows the
// explanation; a tap opens it on touch screens. `align` keeps the bubble
// inside the panel for fields in the right-hand column.
export default function InfoTip({ name, text, align = 'left', width = 'w-56' }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  return (
    <span className="relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`What is ${name}?`}
        aria-describedby={open ? tipId : undefined}
        // A tap fires hover and focus before the click, so a toggle here would
        // open and instantly close it on touch screens. Click only ever opens;
        // tapping elsewhere (blur), moving the mouse away or Escape closes it.
        onClick={() => setOpen(true)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); } }}
        className="flex items-center justify-center w-4 h-4 rounded-full text-[var(--dp-text-muted)] hover:text-[var(--dp-text-primary)] focus:outline-none focus-visible:text-[var(--dp-text-primary)] transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={`absolute bottom-full mb-1.5 ${align === 'right' ? 'right-0' : 'left-0'} z-50 ${width} max-w-[calc(100vw-2rem)] rounded-lg px-3 py-2 text-xs font-normal normal-case tracking-normal leading-snug text-[var(--dp-text-primary)] bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] shadow-xl`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
