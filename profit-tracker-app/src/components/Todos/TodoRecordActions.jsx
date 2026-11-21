import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import useRecordActions from '../../hooks/useRecordActions';
import MarkPaidModal from '../UI/MarkPaidModal';
import ActionFormModal from '../UI/ActionFormModal';
import { actionNeedsFormFields } from '../../data/statusActions';

// The status action that clears a to-do (Add tracking, Mark paid, Fix
// status...), run right on the item with the same forms the Statuses page
// uses. The API picks the actions (services/todos.js saleRecord) from what
// the sale's current status allows, and checks again when one is sent.
export default function TodoRecordActions({ entry }) {
  const record = entry.record;
  const qc = useQueryClient();
  const { runAction, pendingAction } = useRecordActions({
    kind: record.kind,
    record,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['todos'] }),
  });
  const [open, setOpen] = useState(null); // the descriptor whose form is open

  // Mark paid always asks (date and amount); other actions open a form only
  // when the server keeps something from it (tracking number, status...).
  const press = (descriptor) => {
    if (descriptor.action === 'mark_paid' || (descriptor.requiresForm && actionNeedsFormFields(descriptor.action, record.kind, record, descriptor))) {
      setOpen(descriptor);
    } else {
      runAction(descriptor.action, {}, descriptor);
    }
  };

  const submit = async (payload) => {
    const updated = await runAction(open.action, payload, open);
    if (updated) setOpen(null);
  };

  return (
    <>
      {record.allowed_actions.map((descriptor, index) => (
        <button
          key={descriptor.action}
          type="button"
          disabled={pendingAction !== null}
          onClick={() => press(descriptor)}
          className={`page-btn ${index === 0 ? 'page-btn-primary' : 'page-btn-secondary'} !h-9 !px-3 !text-xs`}
        >
          <span aria-hidden="true">{pendingAction === descriptor.action ? 'Saving…' : descriptor.label}</span>
          <span className="sr-only">{descriptor.label}: {entry.title}, {entry.detail}</span>
        </button>
      ))}
      {open?.action === 'mark_paid' && (
        <MarkPaidModal open sale={record} busy={pendingAction !== null} onSubmit={submit} onClose={() => setOpen(null)} />
      )}
      {open && open.action !== 'mark_paid' && (
        <ActionFormModal
          open
          action={open.action}
          label={open.label}
          kind={record.kind}
          record={record}
          descriptor={open}
          busy={pendingAction !== null}
          onSubmit={submit}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
