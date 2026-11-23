import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Zap } from 'lucide-react';
import { useAutomationReview } from '../../hooks/useApi';
import { PANEL } from './todoMeta';

// Optional: what the email did on its own, waiting for a double check on the
// Automation page. Its count shows only here, never on the sidebar badge,
// since every change already happened and can stay as it is.
export default function EmailAutomationCard() {
  const { data } = useAutomationReview();
  const count = data?.to_confirm ?? 0;
  if (!count) return null;
  return (
    <section aria-labelledby="todo-email-automation" className={`${PANEL} px-4 py-3.5`}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="todo-email-automation" className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <Zap size={13} aria-hidden="true" style={{ color: 'var(--dp-accent-text)' }} /> Email automation
        </h2>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-300">Optional</span>
      </div>
      <p className="mt-2 text-sm text-[var(--dp-text-primary)]">
        <span className="font-semibold tabular-nums">{count}</span> {count === 1 ? 'change' : 'changes'} to confirm
      </p>
      <p className="mt-0.5 text-xs text-gray-500">Email already made these on its own. Check them when you have time, or leave them.</p>
      <Link to="/automation" className="page-btn page-btn-secondary mt-3 w-full justify-center !h-9 !text-xs">
        Review changes <ChevronRight size={14} aria-hidden="true" />
      </Link>
    </section>
  );
}
