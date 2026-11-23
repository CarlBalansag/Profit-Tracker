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

// ─── Edits and adds ("change" entries) ───────────────────────────────────────
const MAIN_MODEL = { purchase: 'inventory', sale: 'sales', expense: 'expense' };
const ARTICLE = { purchase: 'a purchase', sale: 'a sale', expense: 'an expense' };

// Fields worth naming in the summary. Anything else (internal mirrors,
// timestamps) is only counted, never shown raw.
const FIELD_LABELS = {
  product_name: ['Name'], name: ['Name'],
  unit_price: ['Price', 'money'], unit_purchase_cost: ['Unit cost', 'money'], amount: ['Amount', 'money'],
  quantity: ['Qty', 'int'], qty_purchased: ['Qty bought', 'int'],
  sales_tax: ['Tax', 'money'], shipping_cost_inbound: ['Shipping', 'money'], sale_shipping: ['Shipping', 'money'],
  fees: ['Fees', 'money'], commission_fee: ['Fees', 'money'], gift_card_amount: ['Gift card', 'money'],
  sale_tax_collected: ['Tax collected', 'money'], cashback_earned: ['Cashback', 'money'],
  purchase_date: ['Date', 'date'], sale_date: ['Date', 'date'], date: ['Date', 'date'],
  payout_date: ['Payout date', 'date'], return_by_date: ['Return by', 'date'],
  category: ['Category'], order_number: ['Order #'], tracking_number: ['Tracking'], notes: ['Notes'],
  platform_id: ['Platform', 'ref'], vendor_id: ['Vendor', 'ref'], account_id: ['Account', 'ref'], payment_method_id: ['Card', 'ref'], buyer_id: ['Buyer', 'ref'],
};

function formatField(kind, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money') return `$${formatMoney(Number(value) || 0)}`;
  if (kind === 'int') return String(Number(value) || 0);
  if (kind === 'date') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  return String(value);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function changeText(entry) {
  const d = entry.detail || {};
  const rows = d.rows || [];
  const main = rows.find((r) => r.model === MAIN_MODEL[entry.record_type]) || rows[0] || {};
  const prefix = d.undo ? 'Undid: ' : '';
  const what = ARTICLE[entry.record_type] || 'a record';
  let title;
  if (d.action === 'create') title = entry.record_type === 'sale' ? 'Recorded a sale' : `Added ${what}`;
  else if (d.action === 'delete') title = `Deleted ${what}`;
  else title = `Edited ${what.replace(/^an? /, '')}`;
  title = prefix + title;

  // Several purchases in one entry (undoing a whole cashout import): count them.
  const many = entry.record_type === 'purchase' && d.action === 'delete'
    ? rows.filter((r) => r.model === 'inventory' && r.op === main.op).length : 0;
  if (many > 1) {
    const sales = rows.filter((r) => r.model === 'sales' && r.op === main.op).length;
    return { title: `${prefix}Deleted ${plural(many, 'purchase')}`, change: sales ? `with ${plural(sales, 'sale')}` : '' };
  }

  if (main.op === 'create' || main.op === 'delete') {
    const v = main.row?.values || {};
    const parts = [];
    if (entry.record_type === 'expense') parts.push(formatField('money', v.amount));
    else if (entry.record_type === 'sale') parts.push(`${Number(v.quantity) || 0} × ${formatField('money', v.unit_price)}`);
    else parts.push(`${Number(v.qty_purchased) || 0} × ${formatField('money', v.unit_purchase_cost)}`);
    const sales = rows.filter((r) => r.model === 'sales' && r.op === main.op).length;
    if (entry.record_type === 'purchase' && sales) parts.push(`with ${plural(sales, 'sale')}`);
    return { title, change: parts.join(' · ') };
  }

  const shown = [];
  let hidden = 0;
  for (const row of rows.filter((r) => r.op === 'update')) {
    for (const [key, f] of Object.entries(row.fields || {})) {
      const label = FIELD_LABELS[key];
      if (!label) { hidden += 1; continue; }
      const [name, kind] = label;
      shown.push(kind === 'ref' ? `${name} changed` : `${name} ${formatField(kind, f.before)} → ${formatField(kind, f.after)}`);
    }
  }
  const parts = shown.slice(0, 3);
  if (shown.length > 3) parts.push(`${shown.length - 3} more`);
  if (!shown.length && hidden) parts.push(`${plural(hidden, 'field')} updated`);
  if (entry.record_type === 'purchase') {
    const added = rows.filter((r) => r.model === 'sales' && r.op === 'create').length;
    const removed = rows.filter((r) => r.model === 'sales' && r.op === 'delete').length;
    if (added) parts.push(`${plural(added, 'sale')} added`);
    if (removed) parts.push(`${plural(removed, 'sale')} removed`);
  }
  return { title, change: parts.join(' · ') };
}

// { title, change, product } -- e.g. "Cancel Sale", "Paid → Cancelled · 2 units
// back in stock", "Meta Quest 3S".
export function describeActivity(entry) {
  const text = entry.kind === 'status' ? statusText(entry)
    : entry.kind === 'change' ? changeText(entry)
      : refundText(entry);
  const fallback = { sale: 'Sale', purchase: 'Purchase', expense: 'Expense' }[entry.record_type] || 'Record';
  return { ...text, product: entry.detail?.product_name || fallback };
}
