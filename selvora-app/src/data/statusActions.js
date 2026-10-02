// Pure, non-component configuration for the contextual-action UI: the form each
// `requiresForm: true` action collects, and the consequence copy each
// `destructive: true` action must state before it runs.
//
// This lives beside the components rather than inside them so the UI files only
// export components (the react-refresh/only-export-components lint rule this
// repo enforces), and so the copy is testable on its own.

import {
  INVENTORY_RECEIVING_STATUSES,
  correctableSaleStatuses,
} from './statusWorkflow';

// ─── Form fields ─────────────────────────────────────────────────────────────
// Derived from what the server actually accepts: validation/schemas.js
// `statusActionBody` allowlists the keys, and services/statusTransitions.js
// decides which of them a given action requires. Fields the chosen action's
// transition would discard are deliberately NOT listed -- a form that collects a
// value the server throws away is worse than no field at all.
//
// Field spec: { name, label, type, required?, hint?, options?, min?, max? }
export function fieldsForAction(action, kind, record = {}) {
  switch (action) {
    case 'add_tracking':
    case 'add_outbound_tracking':
      return [{ name: 'tracking_number', label: 'Tracking number', type: 'text', required: true }];

    case 'correct_status':
      return kind === 'inventory'
        ? [
            {
              name: 'receiving_status',
              label: 'Receiving step',
              type: 'select',
              required: true,
              options: INVENTORY_RECEIVING_STATUSES,
            },
            { name: 'correction_note', label: 'Why (optional)', type: 'text' },
          ]
        : [
            {
              name: 'workflow_status',
              label: 'Workflow step',
              type: 'select',
              required: true,
              options: correctableSaleStatuses(record.workflow_type),
            },
          ];

    case 'restore_inventory':
      return [
        {
          name: 'qty_on_hand',
          label: 'Quantity on hand',
          type: 'number',
          required: true,
          min: 0,
          max: Number(record.qty_purchased) || 0,
          hint: `Between 0 and ${Number(record.qty_purchased) || 0} (the quantity purchased).`,
        },
        { name: 'correction_note', label: 'Why (optional)', type: 'text' },
      ];

    case 'mark_returned':
      return [
        {
          name: 'quantity',
          label: 'Quantity received back',
          type: 'number',
          required: true,
          min: 0,
          max: Number(record.quantity) || 0,
          hint: `Between 0 and ${Number(record.quantity) || 0}. These units go back on hand.`,
        },
      ];

    default:
      // No payload the server would keep (e.g. report_return only stamps
      // return_requested_at). The caller shows the destructive confirmation
      // instead of an empty form.
      return [];
  }
}

export const actionNeedsFormFields = (action, kind, record) =>
  fieldsForAction(action, kind, record).length > 0;

// ─── Consequence copy ────────────────────────────────────────────────────────
// The plan requires a confirmation that states what actually happens, never a
// generic "Are you sure?". Each string describes the concrete effect of the
// matching entry in services/statusTransitions.js.
const units = (n) => `${n} unit${Number(n) === 1 ? '' : 's'}`;

export function consequenceFor(action, kind, record = {}) {
  const qty = Number(record.quantity) || 0;
  switch (action) {
    case 'cancel':
      return 'This purchase is marked cancelled. It keeps the receiving step it reached as a record, and drops out of the active receiving queues.';
    case 'void_sale':
      return `This sale is treated as one that should never have existed. ${units(qty)} will be restored to inventory, and the sale will be excluded from every financial total and report.`;
    case 'cancel_sale':
      return `The sale record is kept but marked cancelled. ${units(qty)} will be restored to inventory, and the sale will be excluded from every financial total and report.`;
    case 'report_return':
      return 'The sale moves to Return in Progress. No units go back on hand yet — that happens when you record the return as received.';
    case 'report_dispute':
      return 'The sale is marked disputed and excluded from every financial total until the dispute is resolved. Inventory quantity is left exactly as it is.';
    case 'reopen_sale':
      return 'The sale goes back to Waiting for Payment. The original payment date and amount are kept, not deleted.';
    case 'mark_authentication_failed':
      return 'The sale is marked Authentication Failed. No units go back on hand until the returned item physically arrives and you record it as received.';
    case 'mark_returned':
      return 'The units you enter go back on hand, and the sale is excluded from every financial total.';
    case 'restore_inventory':
      return 'This overrides the quantity on hand that sales have calculated. Every total built on it changes to match.';
    default:
      return 'This changes the record and the totals built on it.';
  }
}
