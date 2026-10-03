// Single shared registry for the status workflow: canonical statuses, display
// labels, the contextual actions valid for a record's current state, and the
// one server-side function that applies a transition.
//
// Scope note (checkpoint 1): nothing in the app imports this file yet. It is
// additive and unused, so it cannot change current behavior. Later checkpoints
// move routes/inventory.js, routes/sales.js, services/tracking.js and the UI
// onto it and retire services/statusHierarchy.js.
//
// This file is pure data + pure-ish functions. No Express, no `prisma` import --
// applyTransition receives the transaction client it must use.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

// Inventory answers one question: did the purchase arrive? ON_HAND is the
// successful terminal receiving status and it stays ON_HAND after a sale --
// availability ("3 available", "Sold Out") is derived from qty_on_hand instead.
const INVENTORY_RECEIVING_STATUSES = ['PRE_ORDER', 'PURCHASED', 'INBOUND', 'ON_HAND'];

const SALE_WORKFLOW_TYPES = ['STANDARD_MARKETPLACE', 'AUTH_MARKETPLACE', 'CASHOUT', 'DIRECT_LOCAL'];

// Ordered normal-path statuses per workflow. Order is meaningful: it is what
// "the next step" and "never move a record backward" are measured against.
const SALE_STATUSES_BY_WORKFLOW = {
  STANDARD_MARKETPLACE: ['AWAITING_SHIPMENT', 'OUTBOUND', 'WAITING_FOR_PAYMENT', 'PAID'],
  AUTH_MARKETPLACE: ['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_AUTHENTICATOR', 'AUTHENTICATING', 'WAITING_FOR_PAYMENT', 'PAID'],
  CASHOUT: ['AWAITING_SHIPMENT', 'OUTBOUND', 'DELIVERED_TO_PROVIDER', 'WAITING_FOR_SCAN_IN', 'SCANNED_IN', 'ACCEPTED', 'WAITING_FOR_PAYMENT', 'PAID'],
  DIRECT_LOCAL: ['AWAITING_HANDOFF', 'HANDED_OVER', 'WAITING_FOR_PAYMENT', 'PAID'],
};

// Off-the-forward-path sale statuses. Reachable from several normal states.
const SALE_EXCEPTION_STATUSES = ['CANCELLED', 'RETURN_IN_PROGRESS', 'RETURNED', 'DISPUTED', 'AUTHENTICATION_FAILED'];

const DEFAULT_SALE_WORKFLOW = 'STANDARD_MARKETPLACE';

// Sale statuses whose money must not count toward realized revenue/profit.
// This is the single source of truth: services/decimalFinance.js currently
// hardcodes its own identical copy in `isRealizedSale`, and a later checkpoint
// replaces that copy with an import of this array. Keep it an exported array so
// adding a status (e.g. a dedicated VOID, once void stops reusing CANCELLED)
// stays a one-line change in one place.
const EXCLUDED_FROM_FINANCIALS = ['CANCELLED', 'RETURNED', 'DISPUTED'];

const isExcludedFromFinancials = (status) =>
  EXCLUDED_FROM_FINANCIALS.includes(String(status || '').toUpperCase());

// Stored status -> user-facing label. Screens must read labels from here rather
// than prettifying the constant themselves, so one rename lands everywhere.
const DISPLAY_LABELS = {
  // Inventory receiving
  PRE_ORDER: 'Pre-order',
  PURCHASED: 'Purchased',
  INBOUND: 'Inbound',
  ON_HAND: 'On Hand',
  // Sale normal path
  AWAITING_SHIPMENT: 'Sold — Waiting to Ship',
  OUTBOUND: 'Outbound',
  DELIVERED_TO_AUTHENTICATOR: 'Delivered to Authenticator',
  AUTHENTICATING: 'Authenticating',
  DELIVERED_TO_PROVIDER: 'Delivered to Provider',
  WAITING_FOR_SCAN_IN: 'Waiting for Scan-In',
  SCANNED_IN: 'Scanned In',
  ACCEPTED: 'Accepted',
  AWAITING_HANDOFF: 'Awaiting Handoff',
  HANDED_OVER: 'Handed Over',
  WAITING_FOR_PAYMENT: 'Waiting for Payment',
  PAID: 'Paid',
  // Sale exceptions
  CANCELLED: 'Cancelled',
  RETURN_IN_PROGRESS: 'Return in Progress',
  RETURNED: 'Returned',
  DISPUTED: 'Disputed',
  AUTHENTICATION_FAILED: 'Authentication Failed',
};

const displayLabel = (status) => DISPLAY_LABELS[status] || status || '';

// Derived availability label -- deliberately NOT a stored status.
const availabilityLabel = (inventory = {}) =>
  Number(inventory.qty_on_hand) > 0 ? 'Available' : 'Sold Out';

const transitionError = (status, message) => Object.assign(new Error(message), { status });

// ---------------------------------------------------------------------------
// Contextual actions
// ---------------------------------------------------------------------------
// Descriptor shape: { action, label, requiresForm, destructive, secondary }.
//   requiresForm  the action needs information before it can run; the form's
//                 Save button is the confirmation, so no extra "Are you sure?".
//   destructive   needs an explicit confirmation explaining the consequence.
//   secondary     belongs in the "More" menu rather than the primary row.
//   initial       optional, present only when true: this record has no status at
//                 all yet, so the action sets the first one rather than
//                 correcting an existing one. The UI uses it to pick the "set a
//                 status" form over the "correct from X to Y" one. It is added
//                 only when set so every other descriptor keeps its exact
//                 five-key shape.

const act = (action, label, { requiresForm = false, destructive = false, secondary = false, initial = false } = {}) =>
  ({ action, label, requiresForm, destructive, secondary, ...(initial ? { initial: true } : {}) });

// "This record has no status this registry recognises -- set one by hand."
// Deliberately NOT secondary: it is the only action such a record has, so
// hiding it behind the "More" menu is what left these rows unfixable.
const setInitialStatus = (label) => act('correct_status', label, { requiresForm: true, initial: true });

// Mark Paid is always a form (payment date, amount, optional reference) -- there
// is deliberately no one-click Mark Paid anywhere in this registry.
const markPaid = (secondary = false) => act('mark_paid', 'Mark Paid', { requiresForm: true, secondary });

// Shared "More" menu entries for a live (not yet cancelled/returned) sale.
const saleCorrections = ({ outbound = false, paid = false } = {}) => [
  act('void_sale', 'Void Mistaken Sale', { destructive: true, secondary: true }),
  act('cancel_sale', 'Cancel Sale', { destructive: outbound, secondary: true }),
  act('report_return', 'Report Return', { requiresForm: true, destructive: true, secondary: true }),
  act('report_dispute', 'Report Dispute', { destructive: true, secondary: true }),
  ...(paid ? [act('reopen_sale', 'Reopen Sale', { destructive: true, secondary: true })] : []),
  act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true }),
];

function inventoryActions(record = {}) {
  const status = record.receiving_status;
  const inStock = Number(record.qty_on_hand) > 0;
  const cancel = act('cancel', 'Cancel', { destructive: true });
  const correct = act('correct_status', 'Correct Receiving Step', { requiresForm: true, secondary: true });
  const addTracking = act('add_tracking', 'Add Tracking', { requiresForm: true });

  switch (status) {
    case 'PRE_ORDER':
      // Add Tracking is offered here too, not just on PURCHASED: the retired
      // statusHierarchy.autoShippedStatus('inbound') advanced both 'Pre Order'
      // and 'PURCHASED' on a first tracking number, and checkpoint 2 has to
      // prove this registry is a superset of that behavior.
      return [act('mark_purchased', 'Mark Purchased'), addTracking, cancel, correct];
    case 'PURCHASED':
      return [addTracking, act('mark_on_hand', 'Mark On Hand'), cancel, correct];
    case 'INBOUND':
      return [
        act('check_tracking', 'Check Tracking'),
        act('mark_on_hand', 'Mark On Hand'),
        cancel,
        correct,
      ];
    case 'ON_HAND':
      // Listing is an attribute of an on-hand purchase, not its own status, so
      // the plan's separate "Listed" row is expressed through is_listed here.
      // Record Sale needs stock: a sold-out batch shows no Record Sale action.
      // Cancel is deliberately absent: a purchase that already arrived cannot
      // be cancelled, only corrected or adjusted.
      return [
        ...(record.is_listed
          ? [...(inStock ? [act('record_sale', 'Record Sale', { requiresForm: true })] : []), act('unlist', 'Unlist')]
          : [act('list_item', 'List Item'), ...(inStock ? [act('record_sale', 'Record Sale', { requiresForm: true })] : [])]),
        act('restore_inventory', 'Adjust Quantity On Hand', { requiresForm: true, destructive: true, secondary: true }),
        correct,
      ];
    default:
      // No receiving status yet (a legacy row the backfill could not resolve) or
      // an unrecognized value. The registry used to offer nothing here rather
      // than guess, which left the row permanently stuck with no way to act on
      // it. It still does not guess -- it hands the decision to the user, who is
      // the only one who knows where the purchase actually got to.
      return [setInitialStatus('Set Receiving Status')];
  }
}

function saleActions(record = {}) {
  const status = record.workflow_status;
  const workflow = SALE_STATUSES_BY_WORKFLOW[record.workflow_type] ? record.workflow_type : DEFAULT_SALE_WORKFLOW;

  switch (status) {
    case 'AWAITING_SHIPMENT':
      return [act('add_outbound_tracking', 'Add Outbound Tracking', { requiresForm: true }), ...saleCorrections()];
    case 'AWAITING_HANDOFF':
      // Payment can legitimately land before the handoff; recording it keeps the
      // sale actionable until the item actually changes hands.
      return [act('mark_handed_over', 'Mark Handed Over'), markPaid(), ...saleCorrections()];
    case 'HANDED_OVER':
      return [markPaid(), ...saleCorrections({ outbound: true })];
    case 'OUTBOUND':
      return [act('check_tracking', 'Check Tracking'), ...saleCorrections({ outbound: true })];
    case 'DELIVERED_TO_AUTHENTICATOR':
      return [
        act('check_tracking', 'Check Tracking'),
        act('mark_authenticating', 'Mark Authenticating'),
        ...saleCorrections({ outbound: true }),
      ];
    case 'AUTHENTICATING':
      return [
        act('mark_authentication_passed', 'Mark Passed'),
        act('mark_authentication_failed', 'Mark Failed', { destructive: true }),
        ...saleCorrections({ outbound: true }),
      ];
    case 'DELIVERED_TO_PROVIDER':
      return [
        act('check_tracking', 'Check Tracking'),
        act('mark_waiting_for_scan_in', 'Mark Waiting for Scan-In'),
        ...saleCorrections({ outbound: true }),
      ];
    case 'WAITING_FOR_SCAN_IN':
      return [act('mark_scanned_in', 'Mark Scanned In'), ...saleCorrections({ outbound: true })];
    case 'SCANNED_IN':
      return [act('mark_accepted', 'Mark Accepted'), ...saleCorrections({ outbound: true })];
    case 'ACCEPTED':
      return [act('mark_waiting_for_payment', 'Mark Waiting for Payment'), ...saleCorrections({ outbound: true })];
    case 'WAITING_FOR_PAYMENT':
      return [markPaid(), ...saleCorrections({ outbound: workflow !== 'DIRECT_LOCAL' })];
    case 'PAID':
      // No normal action required. A paid sale is still correctable.
      return saleCorrections({ outbound: true, paid: true });
    case 'AUTHENTICATION_FAILED':
      // Inventory is NOT restored merely because authentication failed -- only
      // once the returned item physically arrives and is accepted.
      return [
        act('report_return', 'Report Return', { requiresForm: true, destructive: true }),
        act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true }),
      ];
    case 'RETURN_IN_PROGRESS':
      return [
        act('mark_returned', 'Mark Return Received', { requiresForm: true, destructive: true }),
        act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true }),
      ];
    case 'RETURNED':
    case 'DISPUTED':
    case 'CANCELLED':
      return [act('correct_status', 'Correct Workflow Step', { requiresForm: true, secondary: true })];
    default:
      // Same as the inventory default: a sale whose workflow status is missing or
      // unrecognized (the ambiguous rows scripts/migrateStatusWorkflow.js leaves
      // alone) gets one primary action to set it by hand. Its form also offers
      // the workflow type, because a sale with no workflow_status usually has no
      // workflow_type either and the two have to be chosen together.
      return [setInitialStatus('Set Sale Status')];
  }
}

// `kind` is 'inventory' or 'sale'. Pure: no I/O, no clock.
function allowedActions(record = {}, kind = 'inventory') {
  if (kind === 'inventory') return inventoryActions(record);
  if (kind === 'sale') return saleActions(record);
  return [];
}

const isActionAllowed = (record, kind, action) =>
  allowedActions(record, kind).some((descriptor) => descriptor.action === action);

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------
// Actions that are reads (check_tracking) or that already have their own route
// and quantity accounting (record_sale) are intentionally absent: they are
// allowed actions but not state transitions this function owns.

const SALE_NEXT_AFTER_OUTBOUND = {
  STANDARD_MARKETPLACE: 'WAITING_FOR_PAYMENT',
  AUTH_MARKETPLACE: 'DELIVERED_TO_AUTHENTICATOR',
  CASHOUT: 'DELIVERED_TO_PROVIDER',
};

const saleWorkflowOf = (record = {}) =>
  SALE_STATUSES_BY_WORKFLOW[record.workflow_type] ? record.workflow_type : DEFAULT_SALE_WORKFLOW;

// Every entry returns the `data` for the single state change, or throws a
// 400 when the payload is incomplete. `restores` names the quantity a sale
// transition gives back to inventory, which is what triggers the optimistic
// concurrency guard below.
// Carrier-driven transitions. They are not user menu entries (the user only
// presses "Check Tracking"; the normalized carrier result decides), so they are
// gated on an explicit set of source statuses instead of allowedActions. Listing
// them here is what keeps a repeated or late carrier check from moving a record
// backward: once the status has left the set, the action is rejected.
const SYSTEM_ACTION_FROM = {
  inventory: { mark_delivered: ['PRE_ORDER', 'PURCHASED', 'INBOUND'] },
  sale: { mark_delivered: ['OUTBOUND'] },
};

const INVENTORY_TRANSITIONS = {
  mark_purchased: () => ({ data: { receiving_status: 'PURCHASED' } }),
  add_tracking: (record, payload) => {
    const tracking = String(payload.tracking_number || '').trim();
    if (!tracking) throw transitionError(400, 'Tracking number is required');
    // Superset of the retired statusHierarchy.autoShippedStatus('inbound'):
    // both PRE_ORDER and PURCHASED advance, anything later does not (the
    // allowedActions gate above only offers this action in those two states).
    return { data: { receiving_status: 'INBOUND', tracking_number: tracking } };
  },
  mark_on_hand: (record, payload, now) => ({
    data: { receiving_status: 'ON_HAND', received_at: payload.received_at ? new Date(payload.received_at) : now },
  }),
  // Inbound carrier delivery. Inventory keeps one milestone (received_at)
  // rather than a separate delivered_at, because for a purchase the two mean
  // the same thing: it arrived.
  mark_delivered: (record, payload, now) => ({
    data: { receiving_status: 'ON_HAND', received_at: payload.delivered_at ? new Date(payload.delivered_at) : now },
  }),
  list_item: () => ({ data: { is_listed: true } }),
  unlist: () => ({ data: { is_listed: false } }),
  // A cancelled purchase has no receiving status of its own: cancelled_at is
  // the marker, and the receiving status records how far it had got.
  cancel: (record, payload, now) => ({ data: { cancelled_at: now } }),
  // Manual quantity correction. Guarded on the quantity it was computed from so
  // two people adjusting the same batch cannot both win.
  restore_inventory: (record, payload) => {
    const target = Number(payload.qty_on_hand);
    if (!Number.isInteger(target) || target < 0 || target > record.qty_purchased) {
      throw transitionError(400, 'Quantity on hand must be between 0 and the quantity purchased');
    }
    return {
      data: {
        qty_on_hand: target,
        correction_note: payload.correction_note ? String(payload.correction_note).slice(0, 1000) : null,
      },
      guardQuantity: true,
    };
  },
  correct_status: (record, payload) => {
    if (!INVENTORY_RECEIVING_STATUSES.includes(payload.receiving_status)) {
      throw transitionError(400, 'A valid receiving status is required');
    }
    return {
      data: {
        receiving_status: payload.receiving_status,
        correction_note: payload.correction_note ? String(payload.correction_note).slice(0, 1000) : null,
      },
    };
  },
};

const paidFields = (payload, now) => {
  const data = { paid_at: payload.paid_at ? new Date(payload.paid_at) : now };
  if (payload.paid_amount !== undefined && payload.paid_amount !== null && payload.paid_amount !== '') {
    data.paid_amount = payload.paid_amount;
  }
  if (payload.paid_reference !== undefined) data.paid_reference = payload.paid_reference || null;
  return data;
};

const SALE_TRANSITIONS = {
  add_outbound_tracking: (record, payload) => {
    const tracking = String(payload.tracking_number || '').trim();
    if (!tracking) throw transitionError(400, 'Tracking number is required');
    // Superset of the retired statusHierarchy.autoShippedStatus('outbound').
    return { data: { workflow_status: 'OUTBOUND', tracking_number: tracking } };
  },
  // The carrier reported delivery. Advances to whatever follows OUTBOUND in
  // this sale's own stored workflow, and is idempotent because allowedActions
  // only offers check_tracking/mark_delivered while the sale is still OUTBOUND.
  mark_delivered: (record, payload, now) => ({
    data: {
      delivered_at: payload.delivered_at ? new Date(payload.delivered_at) : now,
      workflow_status: SALE_NEXT_AFTER_OUTBOUND[saleWorkflowOf(record)] || 'WAITING_FOR_PAYMENT',
    },
  }),
  mark_handed_over: (record, payload, now) => ({
    // Handoff plus an already-recorded payment completes the sale outright.
    data: record.paid_at
      ? { workflow_status: 'PAID', delivered_at: record.delivered_at || now }
      : { workflow_status: 'HANDED_OVER', delivered_at: now },
  }),
  mark_authenticating: () => ({ data: { workflow_status: 'AUTHENTICATING' } }),
  mark_authentication_passed: () => ({ data: { workflow_status: 'WAITING_FOR_PAYMENT' } }),
  mark_authentication_failed: () => ({ data: { workflow_status: 'AUTHENTICATION_FAILED' } }),
  mark_waiting_for_scan_in: () => ({ data: { workflow_status: 'WAITING_FOR_SCAN_IN' } }),
  mark_scanned_in: () => ({ data: { workflow_status: 'SCANNED_IN' } }),
  mark_accepted: () => ({ data: { workflow_status: 'ACCEPTED' } }),
  mark_waiting_for_payment: () => ({ data: { workflow_status: 'WAITING_FOR_PAYMENT' } }),
  mark_paid: (record, payload, now) => {
    const data = paidFields(payload, now);
    // Payment before handoff records the payment but keeps the sale actionable
    // until the item changes hands.
    if (record.workflow_status !== 'AWAITING_HANDOFF') data.workflow_status = 'PAID';
    return { data };
  },
  // Reopening never deletes the original payment -- paid_at stays.
  reopen_sale: () => ({ data: { workflow_status: 'WAITING_FOR_PAYMENT' } }),
  // A return request does not restore inventory; mark_returned does, once the
  // item has physically arrived.
  report_return: (record, payload, now) => ({
    data: { workflow_status: 'RETURN_IN_PROGRESS', return_requested_at: now },
  }),
  mark_returned: (record, payload, now) => {
    const quantity = payload.quantity === undefined ? record.quantity : Number(payload.quantity);
    if (!Number.isInteger(quantity) || quantity < 0 || quantity > record.quantity) {
      throw transitionError(400, 'Returned quantity must be between 0 and the sale quantity');
    }
    return { data: { workflow_status: 'RETURNED', returned_at: now }, restores: quantity };
  },
  // A dispute preserves the current inventory position until it is resolved.
  report_dispute: (record, payload, now) => ({ data: { workflow_status: 'DISPUTED', disputed_at: now } }),
  cancel_sale: (record, payload, now) => ({
    data: { workflow_status: 'CANCELLED', cancelled_at: now },
    restores: record.quantity,
  }),
  // The sale should never have existed. voided_at is what distinguishes it from
  // a real cancellation; both are excluded from financials via CANCELLED until
  // a later checkpoint introduces a dedicated VOID status.
  void_sale: (record, payload, now) => ({
    data: { workflow_status: 'CANCELLED', voided_at: now },
    restores: record.quantity,
  }),
  // `workflow_type` in the payload is optional and only ever sent by the "set a
  // status on a sale that has none" form. A sale the backfill could not resolve
  // usually has no workflow_type either, so saleWorkflowOf would fall back to
  // DEFAULT_SALE_WORKFLOW and validate the chosen status against the wrong path
  // (and leave the sale labelled as a standard marketplace sale it never was).
  // When it is supplied, it decides the valid status list and is written in the
  // same guarded update as the status, so the pair can never land half-applied.
  // When it is absent the behaviour is byte-identical to before: the record's own
  // workflow decides, and `data` carries workflow_status alone.
  correct_status: (record, payload) => {
    const requested = payload.workflow_type;
    const explicit = requested !== undefined && requested !== null && requested !== '';
    if (explicit && !SALE_STATUSES_BY_WORKFLOW[requested]) {
      throw transitionError(400, 'A valid sale workflow is required');
    }
    const workflow = explicit ? requested : saleWorkflowOf(record);
    const valid = [...SALE_STATUSES_BY_WORKFLOW[workflow], ...SALE_EXCEPTION_STATUSES];
    if (!valid.includes(payload.workflow_status)) {
      throw transitionError(400, 'A valid workflow status is required');
    }
    return {
      data: {
        workflow_status: payload.workflow_status,
        ...(explicit ? { workflow_type: workflow } : {}),
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Request payloads
// ---------------------------------------------------------------------------
// Date-only input is read as local noon, the same rule routes/inventory.js and
// routes/sales.js already use, so a payment dated today cannot land on the
// previous day in a negative UTC offset.
const parseActionDate = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T12:00:00.000Z`) : new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

// Mark Paid is the one action with a server-enforced required payload. The plan
// is explicit that there is no one-click Mark Paid anywhere, so a request that
// omits the payment date or amount is rejected rather than quietly defaulted to
// "now" for nothing. The plan's form field names (paid_date, amount, reference)
// and the stored column names are both accepted.
const REQUIRED_ACTION_PAYLOADS = {
  mark_paid: (body) => {
    const paid_at = parseActionDate(body.paid_at ?? body.paid_date);
    if (!paid_at) throw transitionError(400, 'Payment date is required');
    const rawAmount = body.paid_amount ?? body.amount;
    if (rawAmount === undefined || rawAmount === null || rawAmount === '') {
      throw transitionError(400, 'Payment amount is required');
    }
    const amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount < 0) throw transitionError(400, 'Payment amount must be a non-negative number');
    return {
      paid_at,
      paid_amount: amount.toFixed(2),
      paid_reference: body.paid_reference ?? body.reference ?? null,
    };
  },
};

const DATE_PAYLOAD_FIELDS = ['received_at', 'delivered_at'];

/**
 * Turns a request body into the payload applyTransition expects, enforcing the
 * fields an action cannot be performed without.
 */
function actionPayload(action, body = {}) {
  if (REQUIRED_ACTION_PAYLOADS[action]) return REQUIRED_ACTION_PAYLOADS[action](body);
  const payload = { ...body };
  // A caller must never set the transition clock or the owner the concurrency
  // guard is built from, whatever it sends.
  delete payload.now;
  delete payload.user_id;
  for (const field of DATE_PAYLOAD_FIELDS) {
    if (payload[field] !== undefined) payload[field] = parseActionDate(payload[field]);
  }
  return payload;
}

const ownerOf = (kind, record = {}, payload = {}) =>
  payload.user_id || (kind === 'inventory' ? record.user_id : record.user_id || record.inventory?.user_id);

/**
 * Applies exactly one state change, using `tx` (a Prisma transaction client).
 *
 * Concurrency: every write is a conditional updateMany guarded on the status the
 * decision was made from, and a count check -- the same pattern routes/sales.js
 * and routes/inventory.js already use. A sale transition that restores quantity
 * additionally claims the inventory row first (same lock order as the existing
 * routes, so the two cannot deadlock), then guards the sale on its quantity as
 * well, so two concurrent voids can never both restore the same units.
 *
 * Returns { kind, action, from, to, data, record }.
 */
async function applyTransition(tx, kind, record, action, payload = {}) {
  if (kind !== 'inventory' && kind !== 'sale') throw transitionError(400, 'Unknown record kind');
  if (!record || !record.id) throw transitionError(400, 'A stored record is required');
  const currentStatus = kind === 'inventory' ? record.receiving_status : record.workflow_status;
  const systemFrom = SYSTEM_ACTION_FROM[kind][action];
  const permitted = systemFrom
    ? systemFrom.includes(currentStatus)
    : isActionAllowed(record, kind, action);
  if (!permitted) {
    throw transitionError(409, `Action "${action}" is not available for this record's current status`);
  }

  const transitions = kind === 'inventory' ? INVENTORY_TRANSITIONS : SALE_TRANSITIONS;
  const build = transitions[action];
  if (!build) throw transitionError(400, `Action "${action}" is not a stored state transition`);

  const now = payload.now ? new Date(payload.now) : new Date();
  const user_id = ownerOf(kind, record, payload);
  if (!user_id) throw transitionError(400, 'Record owner is required');

  const { data: change, restores, guardQuantity } = build(record, payload, now);
  // Dual-write (checkpoint 3): the legacy `status` column is still what every
  // financial screen reads (services/decimalFinance.js, shared/finance.mjs), so
  // a sale transition landing on an exception status that has a legacy
  // equivalent writes both columns in the one guarded statement below. Without
  // this, a sale voided through an action endpoint restores its inventory but
  // keeps counting as realized revenue everywhere.
  const data = kind === 'sale' ? { ...change, ...legacySaleStatusPatch(change.workflow_status) } : change;
  const from = currentStatus;
  const to = (kind === 'inventory' ? data.receiving_status : data.workflow_status) ?? from;

  if (kind === 'inventory') {
    const claim = await tx.inventory.updateMany({
      where: {
        id: record.id,
        user_id,
        receiving_status: record.receiving_status ?? null,
        ...(guardQuantity ? { qty_on_hand: record.qty_on_hand } : {}),
      },
      data,
    });
    if (claim.count !== 1) throw transitionError(409, 'Purchase changed while saving. Reload and retry.');
    const updated = await tx.inventory.findUnique({ where: { id: record.id } });
    return { kind, action, from, to, data, record: updated };
  }

  // Claim the inventory row before the sale row, matching the lock order in
  // routes/sales.js so a concurrent sale edit cannot deadlock against this.
  if (restores) {
    const inventoryClaim = await tx.inventory.updateMany({
      where: { id: record.inventory_id, user_id },
      data: { qty_on_hand: { increment: 0 } },
    });
    if (inventoryClaim.count !== 1) throw transitionError(404, 'Inventory not found or access denied');
  }

  // Guard on the status this decision was made from, and on the quantity the
  // restore was computed from, so a concurrent edit cannot have the restore
  // applied twice or silently clobber a status someone else already advanced.
  const claim = await tx.sales.updateMany({
    where: {
      id: record.id,
      quantity: record.quantity,
      workflow_status: record.workflow_status ?? null,
      inventory: { user_id },
    },
    data,
  });
  if (claim.count !== 1) throw transitionError(409, 'Sale changed while saving. Reload and retry.');

  if (restores) {
    await tx.inventory.update({
      where: { id: record.inventory_id },
      data: { qty_on_hand: { increment: restores } },
    });
  }

  const updated = await tx.sales.findUnique({ where: { id: record.id } });
  return { kind, action, from, to, data, restored: restores || 0, record: updated };
}

// ---------------------------------------------------------------------------
// Legacy `status` column bridge (checkpoint 2, temporary)
// ---------------------------------------------------------------------------
// Every live screen still reads the legacy Inventory.status / Sales.status
// column, so checkpoint 2 writes the new columns *alongside* it rather than
// switching over. Two pieces live here so the legacy rules sit next to the new
// ones and cannot drift apart; checkpoint 5 deletes this whole section with the
// legacy column.

// Unambiguous legacy -> new receiving status. Only the rules
// scripts/migrateStatusWorkflow.js already applies to historical rows are
// repeated (test/statusWorkflowCutover.test.mjs asserts the two agree).
// Anything the migration calls ambiguous -- the sale-only statuses, CANCELLED,
// RETURNED/DISPUTED -- maps to nothing rather than being guessed at.
const LEGACY_TO_RECEIVING_STATUS = {
  'Pre Order': 'PRE_ORDER',
  PURCHASED: 'PURCHASED',
  SHIPPED_IN: 'INBOUND',
  'On Hand': 'ON_HAND',
  DELIVERED: 'ON_HAND',
  SCANNED_IN: 'ON_HAND',
  LISTED: 'ON_HAND',
};

const LEGACY_TO_WORKFLOW_STATUS = {
  SOLD: 'AWAITING_SHIPMENT',
  SHIPPED_OUT: 'OUTBOUND',
  AUTHENTICATION: 'AUTHENTICATING',
  PAID: 'PAID',
  RETURNED: 'RETURNED',
  DISPUTED: 'DISPUTED',
  CANCELLED: 'CANCELLED',
};

// Returns the new-column patch for a row whose legacy status is `legacyStatus`,
// or {} when there is no unambiguous equivalent. A patch, not a bare status,
// because legacy LISTED carries the listing attribute as well.
function legacyReceivingPatch(legacyStatus) {
  const receiving_status = LEGACY_TO_RECEIVING_STATUS[legacyStatus];
  if (!receiving_status) return {};
  return legacyStatus === 'LISTED' ? { receiving_status, is_listed: true } : { receiving_status };
}

const resolveSaleWorkflow = (preset) =>
  SALE_STATUSES_BY_WORKFLOW[preset] ? preset : DEFAULT_SALE_WORKFLOW;

// The legacy sale vocabulary only ever described the standard ship-out path, so
// a non-standard workflow takes the status at the same position in its own path
// (legacy SOLD on a DIRECT_LOCAL sale is AWAITING_HANDOFF, not AWAITING_SHIPMENT).
function legacyWorkflowStatus(legacyStatus, workflowType) {
  const base = LEGACY_TO_WORKFLOW_STATUS[legacyStatus];
  if (!base) return null;
  if (SALE_EXCEPTION_STATUSES.includes(base)) return base;
  const path = SALE_STATUSES_BY_WORKFLOW[resolveSaleWorkflow(workflowType)];
  if (path.includes(base)) return base;
  const position = SALE_STATUSES_BY_WORKFLOW[DEFAULT_SALE_WORKFLOW].indexOf(base);
  return position >= 0 ? path[position] || null : null;
}

// New sale status -> legacy `status` value, for the exception statuses only.
// The legacy vocabulary (validation/schemas.js SALE_STATUSES) contains exactly
// these three of the new exception statuses, and they mean the same thing in
// both, so an exception transition can safely write them to both columns.
//
// RETURN_IN_PROGRESS and AUTHENTICATION_FAILED are deliberately absent: the
// legacy vocabulary has no equivalent, and inventing one (RETURNED for a return
// that has only been requested, CANCELLED for a failed authentication) would
// take money out of the realized totals before the item is actually back. Those
// two keep whatever legacy status the row already had, which is also what
// EXCLUDED_FROM_FINANCIALS says about them: neither is excluded.
const WORKFLOW_TO_LEGACY_SALE_STATUS = {
  CANCELLED: 'CANCELLED',
  RETURNED: 'RETURNED',
  DISPUTED: 'DISPUTED',
};

// Returns the legacy-column patch for a transition that lands on
// `workflowStatus`, or {} when that status has no legacy equivalent. A patch
// rather than a bare value so the caller can spread it unconditionally.
function legacySaleStatusPatch(workflowStatus) {
  const status = WORKFLOW_TO_LEGACY_SALE_STATUS[workflowStatus];
  return status ? { status } : {};
}

// The retired services/statusHierarchy.autoShippedStatus table, verbatim. It is
// kept only so the legacy column keeps advancing exactly as it does today.
const LEGACY_AUTO_SHIP = {
  inventory: { from: ['Pre Order', 'PURCHASED'], to: 'SHIPPED_IN' },
  sale: { from: ['SOLD'], to: 'SHIPPED_OUT' },
};

const TRACKING_ATTACHED_ACTION = { inventory: 'add_tracking', sale: 'add_outbound_tracking' };

/**
 * "A tracking number was attached" as one entry point, for the create/update
 * routes that write a whole row in a single guarded statement and so need a
 * patch to merge rather than a transition of their own.
 *
 * Returns { legacy_status, data }: the legacy value the retired engine produced
 * (or null), and the new-column change this registry produces (or {}). The two
 * sides are decided independently, because a row the backfill has not reached
 * has a legacy status but no receiving_status/workflow_status yet -- it must
 * still advance its legacy column exactly as it does today.
 */
function trackingAttached(kind, record = {}, trackingNumber) {
  const result = { legacy_status: null, data: {} };
  const legacy = LEGACY_AUTO_SHIP[kind];
  const tracking = String(trackingNumber || '').trim();
  if (!legacy || !tracking) return result;

  if (legacy.from.includes(record.status)) result.legacy_status = legacy.to;

  const action = TRACKING_ATTACHED_ACTION[kind];
  if (isActionAllowed(record, kind, action)) {
    const transitions = kind === 'inventory' ? INVENTORY_TRANSITIONS : SALE_TRANSITIONS;
    // The caller writes tracking_number itself; only the status change is ours.
    const { tracking_number, ...statusChange } = transitions[action](record, { tracking_number: tracking }, new Date()).data;
    result.data = statusChange;
  }
  return result;
}

module.exports = {
  INVENTORY_RECEIVING_STATUSES,
  SALE_WORKFLOW_TYPES,
  SALE_STATUSES_BY_WORKFLOW,
  SALE_EXCEPTION_STATUSES,
  DEFAULT_SALE_WORKFLOW,
  SYSTEM_ACTION_FROM,
  EXCLUDED_FROM_FINANCIALS,
  DISPLAY_LABELS,
  isExcludedFromFinancials,
  displayLabel,
  availabilityLabel,
  allowedActions,
  isActionAllowed,
  actionPayload,
  applyTransition,
  // Legacy-column bridge (checkpoint 2, removed with the legacy column)
  LEGACY_TO_RECEIVING_STATUS,
  LEGACY_TO_WORKFLOW_STATUS,
  WORKFLOW_TO_LEGACY_SALE_STATUS,
  LEGACY_AUTO_SHIP,
  legacyReceivingPatch,
  legacySaleStatusPatch,
  legacyWorkflowStatus,
  resolveSaleWorkflow,
  trackingAttached,
};
