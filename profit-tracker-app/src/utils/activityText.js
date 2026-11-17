// Plain-language text for one Activity entry (see
// profit-tracker-api/services/activityLog.js for what each kind stores).
import { displayLabel } from '../data/statusWorkflow';
import { formatMoney } from './money';

// Same wording as the buttons the user pressed (statusTransitions.js labels).
const ACTION_LABELS = {
  mark_purchased: 'Mark Purchased',
  add_tracking: 'Add Tracking',
  mark_on_hand: 'Mark On Hand',
  mark_delivered: 'Mark Delivered',
  cancel: 'Cancel Purchase',
  correct_status: 'Correct Status',
  list_item: 'List Item',
  unlist: 'Unlist',
  restore_inventory: 'Adjust Quantity On Hand',
  add_outbound_tracking: 'Add Outbound Tracking',
  mark_handed_over: 'Mark Handed Over',
  mark_paid: 'Mark Paid',
  mark_authenticating: 'Mark Authenticating',
  mark_authentication_passed: 'Mark Authentication Passed',
  mark_authentication_failed: 'Mark Authentication Failed',
  mark_waiting_for_scan_in: 'Mark Waiting for Scan-In',
  mark_scanned_in: 'Mark Scanned In',
  mark_accepted: 'Mark Accepted',
  mark_waiting_for_payment: 'Mark Waiting for Payment',
  mark_completed: 'Mark Completed',
  reopen_sale: 'Reopen Sale',
  report_return: 'Report Return',
  mark_returned: 'Mark Return Received',
  report_dispute: 'Report Dispute',
  cancel_sale: 'Cancel Sale',
  void_sale: 'Void Mistaken Sale',
};

const humanize = (action = '') => action.split('_').filter(Boolean)
  .map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

export const actionLabel = (action) => ACTION_LABELS[action] || humanize(action);

const units = (n) => `${n} unit${n === 1 ? '' : 's'}`;

function refundText(entry) {
  const { refund = {} } = entry.detail || {};
  const purchase = entry.record_type === 'purchase';
  const amount = `$${formatMoney(Number(refund.amount) || 0)}`;
  const qty = Number(refund.quantity) || 0;
  const unitsPart = qty ? ` · ${units(qty)} ${purchase ? 'sent back' : 'returned by buyer'}` : '';
  let title;
  if (entry.kind === 'refund.add') title = entry.reverts_id ? 'Brought back a refund' : (purchase ? 'Refund from the store' : 'Refund to the buyer');
  else title = entry.reverts_id ? 'Undid a refund' : 'Removed a refund';
  return { title, change: `${amount}${unitsPart}` };
}

function statusText(entry) {
  const d = entry.detail || {};
  const title = `${d.undo ? 'Undid: ' : ''}${actionLabel(d.action)}`;
  const parts = [];
  if (d.from !== d.to && (d.from || d.to)) parts.push(`${displayLabel(d.from)} → ${displayLabel(d.to)}`);
  const qty = d.fields?.qty_on_hand;
  if (qty && !d.stock) parts.push(`On hand ${Number(qty.before) || 0} → ${Number(qty.after) || 0}`);
  const delta = Number(d.stock?.delta) || 0;
  if (delta > 0) parts.push(`${units(delta)} back in stock`);
  if (delta < 0) parts.push(`${units(-delta)} out of stock again`);
  return { title, change: parts.join(' · ') };
}

// { title, change, product } -- e.g. "Cancel Sale", "Paid → Cancelled · 2 units
// back in stock", "Meta Quest 3S".
export function describeActivity(entry) {
  const text = entry.kind === 'status' ? statusText(entry) : refundText(entry);
  return { ...text, product: entry.detail?.product_name || (entry.record_type === 'sale' ? 'Sale' : 'Purchase') };
}
