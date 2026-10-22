import React from 'react';

// Prev/next arrows + dot indicators for paging through a list in place,
// instead of showing everything at once or scrolling. Shared by any
// dashboard section that needs this (Goals widget, mobile Status Pipeline,
// mobile Top Cards).
export default function PageNav({ count, index, onChange, isGlass = false, label = 'page' }) {
  if (count <= 1) return null;
  const safeIndex = ((index % count) + count) % count;

  const arrowClass = isGlass
    ? 'text-white/20 hover:text-white/50 hover:bg-white/[0.06]'
    : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-secondary)] hover:bg-[var(--dp-bg)]';

  return (
    <div className="flex items-center justify-between mt-4">
      <button
        type="button"
        onClick={() => onChange((safeIndex - 1 + count) % count)}
        className={`w-7 h-7 flex items-center justify-center rounded-full text-lg transition-colors ${arrowClass}`}
        aria-label={`Previous ${label}`}
      >‹</button>

      <div className="flex items-center gap-1.5">
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`rounded-full transition-all ${
              i === safeIndex
                ? `w-4 h-1.5 ${isGlass ? 'bg-[#d8a65a]' : 'bg-[var(--dp-accent)]'}`
                : `w-1.5 h-1.5 ${isGlass ? 'bg-white/[0.15]' : 'bg-[var(--dp-border)]'}`
            }`}
            aria-label={`Go to ${label} ${i + 1}`}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => onChange((safeIndex + 1) % count)}
        className={`w-7 h-7 flex items-center justify-center rounded-full text-lg transition-colors ${arrowClass}`}
        aria-label={`Next ${label}`}
      >›</button>
    </div>
  );
}
