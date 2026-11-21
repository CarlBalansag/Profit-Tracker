import React from 'react';
import { Link } from 'react-router-dom';
import { BellRing, ChevronRight } from 'lucide-react';
import { PANEL } from './todoMeta';

// A way to Settings > Notifications from the list it notifies about.
export default function PhoneAlertsCard() {
  return (
    <Link
      to="/settings"
      state={{ tab: 'notifications' }}
      className={`${PANEL} dp-clickable-card flex items-center gap-3 p-4`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--dp-accent-bg)]">
        <BellRing size={16} className="text-[var(--dp-accent-light)]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--dp-text-primary)]">Get these on your phone</span>
        <span className="block text-xs text-gray-500">A morning summary, reminder alerts and urgent items</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-500" aria-hidden="true" />
    </Link>
  );
}
