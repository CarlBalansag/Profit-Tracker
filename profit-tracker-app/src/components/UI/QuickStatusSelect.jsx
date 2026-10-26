import React, { useState } from 'react';
import { Check } from 'lucide-react';
import useRecordActions from '../../hooks/useRecordActions';
import { displayLabel, isFullyCompleted } from '../../data/statusWorkflow';
import { QUICK_STATUS_FIELD, quickStatusOptions } from '../../data/statusActions';

/**
 * Inline "change this record's status" control for a Statuses board card.
 *
 * It is an *additional* route to the same `correct_status` action the
 * ContextualActions "Correct Receiving Step" / "Correct Workflow Step" form
 * reaches, not a replacement: that form keeps working exactly as before (it is
 * also the only one that can attach a correction note, or set the workflow type
 * on a sale that has none). This one trades those for one less click.
 *
 * Two rules it exists to honour:
 *
 *  1. SCOPING. The options are only ever the statuses valid for *this* record --
 *     a purchase gets the four receiving statuses, a sale gets its own
 *     workflow_type's path plus the sale exceptions. A mixed list of every status
 *     in the app is what the status-workflow rework replaced, so the list is
 *     derived from statusActions.quickStatusOptions, which mirrors the set the
 *     server validates against.
 *
 *  2. NO WRITE ON A RAW INPUT CHANGE. Picking a value only arms the change; a
 *     separate Apply press commits it. A <select> can be changed by a stray
 *     scroll or arrow key, and this app's policy everywhere else is that a
 *     deliberate submit, never an onChange, is what writes.
 *
 * Props:
 *   record     the inventory or sale row, including `allowed_actions`.
 *   kind       'inventory' | 'sale'.
 *   onSuccess  called with the updated record after a successful apply.
 */

const SELECT = 'min-w-0 flex-1 h-7 rounded-lg bg-[#0d0d18] border border-white/10 px-2 text-xs text-gray-200 focus:outline-none focus:border-indigo-500/50 disabled:opacity-50 transition-colors';
const APPLY = 'flex items-center justify-center w-7 h-7 shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition-colors';

const SELECT_LABEL = {
  inventory: 'Change receiving status',
  sale: 'Change sale status',
};

const QuickStatusSelect = ({ record, kind, onSuccess, className = '' }) => {
  // `draft` is the armed-but-uncommitted choice: { base, value, saved }.
  //   base   the record's status the choice was made against. If the record's own
  //          status changes under us (another action on the card, or the refetch
  //          after this one), the choice is dropped rather than left offering to
  //          put the previous status back.
  //   saved  this value has already been applied; the refetch has just not landed
  //          yet. Keeps the select showing the new status without re-offering
  //          Apply, so a slow refresh cannot be double-posted.
  const [draft, setDraft] = useState(null);
  const { runAction, pendingAction } = useRecordActions({ kind, record, onSuccess });

  const field = QUICK_STATUS_FIELD[kind];
  const current = (field && record?.[field]) || '';

  // The record's own descriptor for the action. The dropdown is a shortcut to it,
  // so it is offered only where the record actually allows it -- applyTransition
  // gates every transition on allowedActions and would answer 409 otherwise. The
  // `initial` variant is excluded on purpose: a record with no status at all gets
  // the dedicated Set Status form, which asks a sale what kind of sale it was
  // before it can know which statuses are even valid.
  const descriptor = (record?.allowed_actions || [])
    .find((entry) => entry.action === 'correct_status' && !entry.initial);

  if (!field || !current || !descriptor) return null;

  const options = quickStatusOptions(kind, record);
  if (options.length === 0) return null;

  const stale = draft !== null && draft.base !== current;
  const selected = stale ? current : (draft?.value ?? current);
  const dirty = !stale && draft !== null && !draft.saved && draft.value !== current;
  const busy = pendingAction === 'correct_status';

  // A stored status outside this record's own option list (a sale whose
  // workflow_type and workflow_status disagree) is still shown, as an unselectable
  // entry, so the control can never display a status the record is not in. It
  // stays unselectable because re-sending it is not a change, and widening the
  // list is exactly what the scoping rule forbids.
  const showsCurrentOutsideList = !options.includes(current);

  // workflow_status stays PAID forever -- Completed is a displayed label over
  // it (data/statusWorkflow.js's isFullyCompleted), not a real option this
  // control could ever send to the server. Only the PAID entry's own text
  // changes; re-selecting it is still a real, valid (no-op) choice.
  const completed = kind === 'sale' && current === 'PAID' && isFullyCompleted(record);
  const optionLabel = (status) => (completed && status === 'PAID' ? 'Completed' : displayLabel(status));

  const apply = async () => {
    if (!dirty || busy) return;
    // No correction_note on this path: the field is optional server-side, and the
    // form remains the place to record why. No workflow_type either -- the sale's
    // own workflow is what scoped the list, so re-sending it would be noise.
    const updated = await runAction(
      'correct_status',
      { [field]: selected },
      { ...descriptor, label: 'Status change' },
    );
    // On failure the choice is deliberately kept so Apply can simply be pressed
    // again; runAction has already surfaced the error.
    if (updated) setDraft((previous) => (previous ? { ...previous, saved: true } : previous));
  };

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <select
        aria-label={SELECT_LABEL[kind]}
        value={selected}
        disabled={busy}
        onChange={(event) => setDraft({ base: current, value: event.target.value, saved: false })}
        className={SELECT}
      >
        {showsCurrentOutsideList && (
          <option value={current} disabled>{optionLabel(current)}</option>
        )}
        {options.map((option) => (
          <option key={option} value={option}>{optionLabel(option)}</option>
        ))}
      </select>

      {dirty && (
        <button
          type="button"
          aria-label="Apply status change"
          title={`Change to ${optionLabel(selected)}`}
          disabled={busy}
          onClick={apply}
          className={APPLY}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

export default QuickStatusSelect;
