import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Clock } from 'lucide-react';
import { SNOOZES } from './todoMeta';

// "Later" on a to-do: snooze it for a while, or dismiss it. Opens below the
// button, or above when there isn't room (near the bottom of a phone screen).
export default function SnoozeMenu({ entry, canSnooze, canDismiss, busy, onAct }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const toggle = () => {
    if (!open && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const height = 8 + 44 * ((canSnooze ? SNOOZES.length : 0) + (canDismiss ? 1 : 0));
      setUp(window.innerHeight - rect.bottom < height + 16 && rect.top > height);
    }
    setOpen((value) => !value);
  };

  const pick = (action, days) => {
    setOpen(false);
    onAct(entry, action, days);
  };

  const item = 'block w-full rounded-lg px-3 py-2.5 text-left text-sm text-[var(--dp-text-primary)] hover:bg-[var(--dp-hover-bg)] disabled:opacity-50';

  return (
    <div ref={rootRef} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="true" onClick={toggle} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
        <Clock className="h-3.5 w-3.5" aria-hidden="true" /> {canSnooze ? 'Later' : 'Hide'}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="group"
          aria-label={`Hide ${entry.title}`}
          className={`absolute right-0 z-30 w-44 rounded-xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] p-1 shadow-xl ${up ? 'bottom-full mb-2' : 'top-full mt-2'}`}
        >
          {canSnooze && SNOOZES.map(({ label, days }) => (
            <button key={days} type="button" disabled={busy} onClick={() => pick('snooze', days)} className={item}>{label}</button>
          ))}
          {canDismiss && (
            <button type="button" disabled={busy} onClick={() => pick('dismiss')} className={`${item} text-gray-400`}>Dismiss</button>
          )}
        </div>
      )}
    </div>
  );
}
