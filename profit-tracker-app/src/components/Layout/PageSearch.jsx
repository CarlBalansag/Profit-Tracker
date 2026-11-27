import React, { useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

function matches(page, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${page.label} ${page.group} ${page.words}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * Jump to any page by typing its name (Ctrl+K or ⌘K, or "Search pages" in
 * the sidebar). Arrow keys move, Enter goes, Escape closes.
 */
export default function PageSearch({ open, onClose, pages }) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const close = () => { setQuery(''); setActive(0); onClose(); };
  const ref = useModalKeyboard(open, close, inputRef);
  const results = useMemo(() => pages.filter((page) => matches(page, query)), [pages, query]);
  const current = Math.min(active, Math.max(results.length - 1, 0));

  if (!open) return null;

  const go = (page) => {
    close();
    navigate(page.to, page.state ? { state: page.state } : undefined);
  };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((current + 1) % Math.max(results.length, 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((current - 1 + results.length) % Math.max(results.length, 1)); }
    else if (e.key === 'Enter' && results[current]) { e.preventDefault(); go(results[current]); }
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={ref} aria-label="Search pages" className="pt-pop-in w-full max-w-md overflow-hidden rounded-2xl border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] dp-elevated" style={{ transformOrigin: 'top center' }}>
        <div className="flex items-center gap-2 border-b border-[color:var(--dp-border)] px-4">
          <Search size={16} aria-hidden="true" className="shrink-0 text-[var(--dp-text-label)]" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="page-search-results"
            aria-activedescendant={results[current] ? `page-search-${current}` : undefined}
            aria-label="Page name"
            placeholder="Go to a page…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            className="h-12 min-w-0 flex-1 bg-transparent text-[16px] text-[var(--dp-text-primary)] outline-none placeholder:text-[var(--dp-text-label)] sm:text-[14px]"
          />
          <kbd className="hidden rounded border border-[color:var(--dp-border)] px-1.5 text-[11px] text-[var(--dp-text-label)] sm:inline">Esc</kbd>
        </div>
        <ul id="page-search-results" role="listbox" aria-label="Pages" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-[var(--dp-text-secondary)]">No page called “{query}”.</li>}
          {results.map((page, i) => (
            <li
              key={`${page.to}-${page.label}`}
              id={`page-search-${i}`}
              role="option"
              aria-selected={i === current}
              onMouseMove={() => setActive(i)}
              onClick={() => go(page)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[14px] pointer-coarse:min-h-[44px] ${i === current ? 'bg-[var(--dp-accent-bg)] text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)]'}`}
            >
              <span className="min-w-0 truncate font-medium">{page.label}</span>
              <span className="flex shrink-0 items-center gap-2 text-[11px] text-[var(--dp-text-label)]">
                {page.group}
                {i === current && <CornerDownLeft size={12} aria-hidden="true" />}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
