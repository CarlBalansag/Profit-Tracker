import React, { useState } from 'react';
import { Plus, Repeat } from 'lucide-react';
import { localToday } from '../../utils/returnWindow';
import { PANEL, PANEL_TITLE, clockTime, repeatText } from './todoMeta';

const SHOWN = 5;

// A little calendar leaf: "NOV" over "23", red once it's past due.
function DateLeaf({ date }) {
  const d = new Date(`${date}T12:00:00`);
  const late = date < localToday();
  return (
    <span
      className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg border border-white/10 leading-none"
      style={{ background: late ? 'var(--dp-red-bg)' : 'var(--dp-neutral-bg)' }}
    >
      <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: late ? 'var(--dp-red-text)' : 'var(--dp-text-label)' }}>{d.toLocaleDateString('en-US', { month: 'short' })}</span>
      <span className="mt-0.5 text-base font-bold tabular-nums text-[var(--dp-text-primary)]">{d.getDate()}</span>
    </span>
  );
}

// Every open reminder, soonest first -- including ones further out than the
// list's 3-day window -- to see and edit.
export default function RemindersPanel({ reminders, onNew, onEdit }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? reminders : reminders.slice(0, SHOWN);

  return (
    <section aria-labelledby="reminders-title" className={PANEL}>
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
        <h2 id="reminders-title" className={PANEL_TITLE}>
          Reminders <span className="text-[12px] font-semibold tabular-nums text-gray-500">{reminders.length || ''}</span>
        </h2>
        <button type="button" onClick={onNew} className="page-btn page-btn-secondary !h-8 !px-2.5 !text-xs">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> New
        </button>
      </div>

      {reminders.length === 0 ? (
        <p className="px-4 py-5 text-sm text-gray-400">
          Nothing yet. Add one for anything the app can't see on its own: a call to make, a restock run, a certificate to renew.
        </p>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.06]">
            {shown.map((reminder) => (
              <li key={reminder.id}>
                <button type="button" onClick={() => onEdit(reminder)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--dp-hover-bg)]">
                  <DateLeaf date={reminder.due_date} />
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-sm font-medium text-[var(--dp-text-primary)]">{reminder.title}</span>
                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                      {reminder.due_time ? clockTime(reminder.due_time) : 'Any time'}
                      {repeatText(reminder.repeat) && (
                        <>
                          <span aria-hidden="true">·</span>
                          <Repeat size={11} aria-hidden="true" /> {repeatText(reminder.repeat)}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="sr-only">Edit {reminder.title}</span>
                </button>
              </li>
            ))}
          </ul>
          {reminders.length > SHOWN && (
            <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full border-t border-white/[0.06] px-4 py-3 text-left text-xs font-medium text-[var(--accent)]">
              {showAll ? 'Show fewer' : `Show all ${reminders.length}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
