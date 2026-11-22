import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Settings2 } from 'lucide-react';
import { useInvalidate } from '../hooks/useApi';
import { undoActivity } from '../utils/undoToast';
import ActivityFeed from '../components/Activity/ActivityFeed';

// Everything ProfitTracker changed on its own from the user's email (links,
// tracking, deliveries, payments, new records), newest first. The same
// entries are in Activity; this is just the automatic ones, with Undo.
const EMPTY_TEXT = 'When ProfitTracker reads your email and links an order, adds tracking, marks a sale paid or adds an expense, it shows up here.';

export default function Automation() {
  const invalidate = useInvalidate();
  const [pendingId, setPendingId] = useState(null);

  const handleUndo = async (entry) => {
    setPendingId(entry.id);
    try {
      await undoActivity(entry.id);
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
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-white">Automation</h1>
          <p className="text-sm text-gray-400 mt-1">
            What ProfitTracker changed on its own from your email, newest first. Each change is also in Activity, and most can be undone for 30 days.
          </p>
        </div>
        <Link to="/settings" state={{ tab: 'email' }} className="page-btn page-btn-secondary shrink-0">
          <Settings2 size={14} aria-hidden="true" /> Automatic actions
        </Link>
      </div>
      <div className="max-w-3xl">
        <ActivityFeed source="email" emptyText={EMPTY_TEXT} pendingId={pendingId} onUndo={handleUndo} />
      </div>
    </div>
  );
}
