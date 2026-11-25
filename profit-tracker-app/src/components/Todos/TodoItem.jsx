import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CircleCheck, Pencil } from 'lucide-react';
import { openTodoLink } from '../../utils/todoLink';
import { GROUP_BY_ID, URGENCY_BY_ID, money } from './todoMeta';
import SnoozeMenu from './SnoozeMenu';
import TodoRecordActions from './TodoRecordActions';
import EmailMatchActions from './EmailMatchActions';
import EmailOrderActions from './EmailOrderActions';
import EmailAttentionModal from './EmailAttentionModal';


export function GroupIcon({ group, urgency }) {
  const { icon: Icon } = GROUP_BY_ID[group] || GROUP_BY_ID.bookkeeping;
  const tone = URGENCY_BY_ID[urgency] || URGENCY_BY_ID.info;
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: tone.bg }}>
      <Icon size={16} style={{ color: tone.color }} aria-hidden="true" />
    </span>
  );
}

// The buttons for one to-do: its main action first (the sale step that
// clears it, Mark paid, Done), then Open, Edit and Later. Open on a store's
// cancellation, refund or check email shows what it is about in a window.
function TodoActions({ entry, busy, onAct, onEdit }) {
  const navigate = useNavigate();
  const [reviewing, setReviewing] = useState(false);
  const has = (action) => entry.actions?.includes(action);
  return (
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
      {entry.record && <TodoRecordActions entry={entry} />}
      {entry.email_match && <EmailMatchActions entry={entry} />}
      {entry.email_order && <EmailOrderActions entry={entry} />}
      {has('mark_paid') && (
        <button type="button" disabled={busy} onClick={() => onAct(entry, 'done')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Mark paid
        </button>
      )}
      {has('complete') && (
        <button type="button" disabled={busy} onClick={() => onAct(entry, 'complete')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /> Done
        </button>
      )}
      {has('handled') && entry.email_attention && (
        <button type="button" disabled={busy} onClick={() => onAct(entry, 'handled')} className="page-btn page-btn-primary !h-9 !px-3 !text-xs">
          <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" /><span aria-hidden="true">Done</span><span className="sr-only">Mark done: {entry.title}</span>
        </button>
      )}
      {/* Named by hidden text, not aria-label: touch screens give text
          buttons the full 44px height (index.css, pointer: coarse). */}
      {entry.link && (
        <button type="button" onClick={() => (entry.email_attention ? setReviewing(true) : openTodoLink(navigate, entry.link))} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
          <span aria-hidden="true">Open</span><span className="sr-only">Open {entry.title}, {entry.detail}</span>
        </button>
      )}
      {has('edit') && entry.reminder && (
        <button type="button" onClick={() => onEdit(entry.reminder)} className="page-btn page-btn-secondary !h-9 !px-3 !text-xs">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
        </button>
      )}
      {(has('snooze') || has('dismiss')) && (
        <SnoozeMenu entry={entry} canSnooze={has('snooze')} canDismiss={has('dismiss')} canHold={has('hold')} canWaitPaid={has('until_paid')} busy={busy} onAct={onAct} />
      )}
      {reviewing && <EmailAttentionModal entry={entry} busy={busy} onAct={onAct} onClose={() => setReviewing(false)} />}
    </div>
  );
}

// One to-do. `nested` is a row inside a folded group: the group already shows
// the title and icon, so the row leads with its own detail -- or, when the
// group's items read alike, with what tells them apart (the purchase lot).
export default function TodoItem({ entry, busy, onAct, onEdit, nested = false, alike = false }) {
  const tone = URGENCY_BY_ID[entry.urgency] || URGENCY_BY_ID.info;
  if (nested) {
    return (
      <li data-todo={entry.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm text-gray-200">
            {alike ? (entry.lot || entry.detail) : entry.detail}
            {entry.amount != null && <span className="ml-2 text-xs tabular-nums text-gray-400">{money(entry.amount)}</span>}
          </p>
          {!alike && entry.lot && <p className="mt-0.5 text-xs text-gray-500">{entry.lot}</p>}
        </div>
        <TodoActions entry={entry} busy={busy} onAct={onAct} onEdit={onEdit} />
      </li>
    );
  }
  return (
    <li data-todo={entry.key} className="relative flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4 sm:pl-5">
      <span aria-hidden="true" className="absolute bottom-3 left-0 top-3 w-[3px] rounded-r-full" style={{ background: tone.color }} />
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <GroupIcon group={entry.group} urgency={entry.urgency} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-semibold text-[var(--dp-text-primary)]">{entry.title}</p>
            {entry.amount != null && (
              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-gray-300">{money(entry.amount)}</span>
            )}
          </div>
          <p className="mt-0.5 break-words text-xs text-gray-400">{entry.detail}</p>
        </div>
      </div>
      <div className="pl-12 sm:pl-0">
        <TodoActions entry={entry} busy={busy} onAct={onAct} onEdit={onEdit} />
      </div>
    </li>
  );
}
