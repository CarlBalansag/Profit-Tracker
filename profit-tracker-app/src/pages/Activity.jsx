import React, { useState } from 'react';
import { toast } from 'sonner';
import { useInvalidate } from '../hooks/useApi';
import { undoActivity } from '../utils/undoToast';
import ActivityFeed from '../components/Activity/ActivityFeed';
import { useMatchMedia } from '../hooks/useMatchMedia';

// Everything the user did that can be undone, newest first, grouped by day.
// Undo asks the server to reverse that exact entry; it refuses with a reason
// when something changed since (services/activityLog.js), shown as a toast.

// value -> API `group` (undefined = everything).
const FILTERS = [
  { value: 'all', label: 'All', group: undefined },
  { value: 'records', label: 'Buys & sales', group: 'records' },
  { value: 'setup', label: 'Setup', group: 'setup' },
];

const EMPTY_TEXT = {
  all: 'When you add or edit a purchase, sale, expense, card or platform, record a refund, or press a status button, it shows up here so you can undo it.',
  records: 'When you add or edit a purchase, sale, expense or note, record a refund, press a status button, or commit to a cashout deal, it shows up here.',
  setup: 'When you add, edit or remove a card, store account, platform, buyer, goal, recurring expense, cashout connection or calendar event, or change an API key or setting, it shows up here.',
};

function FilterBar({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Show" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-[var(--dp-hover-bg)] border border-[color:var(--dp-border)] p-0.5">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          role="radio"
          aria-checked={value === f.value}
          onClick={() => onChange(f.value)}
          className={`px-3 h-8 rounded-md text-xs font-medium transition-colors ${value === f.value ? 'bg-[var(--dp-card-bg)] text-[var(--dp-accent-text)] shadow-sm' : 'text-[var(--dp-text-label)] hover:text-[var(--dp-text-primary)]'}`}
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

// Wide screens show buys and sales and setup side by side; below 1024px one
// list with a filter (one layout per breakpoint, see AGENTS.md).
export default function Activity() {
  const wide = useMatchMedia('(min-width: 1024px)');
  const [filter, setFilter] = useState('all');
  const { group } = FILTERS.find((f) => f.value === filter);
  const invalidate = useInvalidate();
  const [pendingId, setPendingId] = useState(null);

  const handleUndo = async (entry) => {
    setPendingId(entry.id);
    try {
      await undoActivity(entry.id);
      // Stock, totals and every list here change.
      invalidate.all();
      toast.success('Undone.');
    } catch (err) {
      toast.error(`Could not undo: ${err.message}`);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300 h-full overflow-auto px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity</h1>
        <p className="text-sm text-gray-400 mt-1">
          Everything you added, edited or removed, newest first, from purchases and sales to your cards, platforms and cashouts. Most of it can be undone for 30 days, as long as nothing changed it since.
        </p>
      </div>

      {wide ? (
        <div className="grid grid-cols-2 gap-6 items-start">
          <section aria-labelledby="activity-records">
            <ActivityFeed group="records" heading="Buys & sales" headingId="activity-records" emptyText={EMPTY_TEXT.records} pendingId={pendingId} onUndo={handleUndo} />
          </section>
          <section aria-labelledby="activity-setup">
            <ActivityFeed group="setup" heading="Data setup" headingId="activity-setup" emptyText={EMPTY_TEXT.setup} pendingId={pendingId} onUndo={handleUndo} />
          </section>
        </div>
      ) : (
        <>
          <FilterBar value={filter} onChange={setFilter} />
          <div className="max-w-3xl">
            <ActivityFeed key={filter} group={group} emptyText={EMPTY_TEXT[filter]} pendingId={pendingId} onUndo={handleUndo} />
          </div>
        </>
      )}
    </div>
  );
}
