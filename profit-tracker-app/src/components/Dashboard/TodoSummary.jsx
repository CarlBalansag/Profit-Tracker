import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, ListChecks } from 'lucide-react';
import { useTodos } from '../../hooks/useApi';
import { openTodoLink } from '../../utils/todoLink';

const SHOWN = 3;
const DOT = { overdue: 'bg-red-500', today: 'bg-amber-400', soon: 'bg-sky-400', info: 'bg-gray-500' };

// The Dashboard's "Needs attention" card: the most urgent few to-dos and a way
// to the full list. Renders nothing when the list is empty or still loading.
export default function TodoSummary({ isGlass = false }) {
  const navigate = useNavigate();
  const { data } = useTodos();
  const items = data?.items ?? [];
  if (!items.length) return null;

  const urgent = data.counts?.urgent || 0;
  const card = isGlass
    ? 'rounded-[24px] border border-white/[0.06] bg-[#181a1c]/78 p-4 text-[#e8e2d6]'
    : 'rounded-[24px] bg-[var(--dp-card-bg)] dp-elevated p-4';
  const muted = isGlass ? 'text-white/40' : 'text-[var(--dp-text-secondary)]';
  const strong = isGlass ? 'text-[#e8e2d6]' : 'text-[var(--dp-text-primary)]';
  const accent = isGlass ? 'text-[#d8a65a]' : 'text-[var(--dp-accent-text)]';
  const hover = isGlass ? 'hover:bg-white/[0.04]' : 'hover:bg-[var(--dp-hover-bg)]';

  return (
    <section aria-label="Needs attention" className={card}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={`flex items-center gap-2 text-sm font-semibold ${strong}`}>
          <ListChecks className={`w-4 h-4 ${accent}`} aria-hidden="true" />
          Needs attention
          <span className={`text-xs font-medium tabular-nums ${muted}`}>
            {items.length}{urgent ? ` · ${urgent} urgent` : ''}
          </span>
        </h2>
        <Link to="/todos" className={`flex items-center gap-0.5 text-xs font-medium ${accent} min-h-[44px] sm:min-h-0`}>
          View all <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-2 grid gap-1 md:grid-cols-3">
        {items.slice(0, SHOWN).map((entry) => (
          <li key={entry.key}>
            <button
              type="button"
              onClick={() => (entry.link ? openTodoLink(navigate, entry.link) : navigate('/todos'))}
              className={`flex w-full items-start gap-2.5 rounded-xl px-2 py-2 text-left transition-colors ${hover}`}
            >
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[entry.urgency] || DOT.info}`} aria-hidden="true" />
              <span className="min-w-0">
                <span className={`block text-[13px] font-medium ${strong}`}>{entry.title}</span>
                <span className={`block truncate text-xs ${muted}`}>{entry.detail}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
