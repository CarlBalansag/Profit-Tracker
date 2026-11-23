// Plain-language text for one Activity entry (see
// profit-tracker-api/services/activityLog.js for what each kind stores).
import { displayLabel } from '../data/statusWorkflow';
import { formatMoney } from './money';
import { orderRef } from './emailRefs';

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
export const FIELD_LABELS = {
  product_name: ['Name'], name: ['Name'],
  unit_price: ['Price', 'money'], unit_purchase_cost: ['Unit cost', 'money'], amount: ['Amount', 'money'],
  quantity: ['Qty', 'int'], qty_purchased: ['Qty bought', 'int'],
  sales_tax: ['Tax', 'money'], shipping_cost_inbound: ['Shipping', 'money'], sale_shipping: ['Shipping', 'money'],
  fees: ['Fees', 'money'], commission_fee: ['Fees', 'money'], gift_card_amount: ['Gift card', 'money'], gift_card_cost: ['Gift card cost', 'money'],
  sale_tax_collected: ['Tax collected', 'money'], cashback_earned: ['Cashback', 'money'],
  purchase_date: ['Date', 'date'], sale_date: ['Date', 'date'], date: ['Date', 'date'],
  payout_date: ['Payout date', 'date'], return_by_date: ['Return by', 'date'],
  category: ['Category'], order_number: ['Order #'], tracking_number: ['Tracking'], notes: ['Notes'],
  platform_id: ['Platform', 'ref'], vendor_id: ['Vendor', 'ref'], account_id: ['Account', 'ref'], payment_method_id: ['Card', 'ref'], buyer_id: ['Buyer', 'ref'],
};

export function formatField(kind, value) {
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

// ─── Setup records (cards, store accounts, platforms, ...) ───────────────────
// record_type -> [model the entry is about, what to call it, fallback name]
const SETUP = {
  card: ['paymentMethod', 'card', 'Card'],
  account: ['account', 'store account', 'Store account'],
  platform: ['platform', 'platform', 'Platform'],
  buyer: ['buyer', 'buyer', 'Buyer'],
  goal: ['goal', 'goal', 'Goal'],
  recurring_expense: ['recurringExpense', 'recurring expense', 'Recurring expense'],
  cashout_connection: ['cashoutConnection', 'cashout connection', 'Cashout connection'],
  calendar_event: ['calendarEvent', 'calendar event', 'Calendar event'],
  // Notes are tracked the same way but listed with buys and sales.
  product_note: ['productNote', 'note', 'Note'],
  transaction_note: ['transactionNote', 'note', 'Note'],
};
const NOTE_TYPES = new Set(['product_note', 'transaction_note']);
export const isSetupEntry = (entry) => Boolean(SETUP[entry?.record_type]) && !NOTE_TYPES.has(entry.record_type);

const GOAL_NAMES = { netProfit: 'Net profit goal', totalRevenue: 'Revenue goal', unitsSold: 'Units sold goal' };

const SETUP_FIELDS = {
  name: ['Name'], type: ['Type'], last4: ['Last 4'], default_cashback_rate: ['Cashback %'],
  points_base_rate: ['Points per $'], point_value_cents: ['Point value ¢'],
  statement_close_day: ['Statement closes'], due_day: ['Due day'], credit_limit: ['Limit', 'money'],
  min_payment_pct: ['Min payment %'], is_personal: ['Personal', 'bool'], category_rates: ['Store rates', 'ref'],
  catalog_card_id: ['Linked card', 'ref'], reward_type: ['Rewards'],
  fee_pct: ['Fee %'], address: ['Address'], notes: ['Notes'], tax_exempt_place: ['Tax-exempt', 'bool'],
  default_return_days: ['Return days'], email: ['Email'], username: ['Username'], status: ['Status'],
  avg_days_to_payout: ['Days to payout'], metric: ['Goal'],
  target_7d: ['7-day target'], target_30d: ['30-day target'], target_ytd: ['Year target'], active: ['Active', 'bool'],
  amount: ['Amount', 'money'], category: ['Category'], frequency: ['Frequency'],
  start_date: ['Starts', 'date'], end_date: ['Ends', 'date'], payment_method_id: ['Card', 'ref'], platform_id: ['Platform', 'ref'],
  display_name: ['Name'], title: ['Title'], date: ['Date', 'date'], color: ['Colour'],
  note: ['Note', 'text'], body: ['Note', 'text'], pinned: ['Pinned', 'bool'],
};

// A note's text, shortened for one line.
const snippet = (text) => {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > 40 ? `“${s.slice(0, 39)}…”` : `“${s}”`;
};

// What the records that lost (or got back) the link are called.
function linkNoun(row) {
  if (row.model === 'sales') return row.fields?.sale_shipping_payment_method_id ? 'shipping label' : 'sale';
  return {
    inventory: 'purchase', expense: 'expense', recurringExpense: 'recurring expense', cashoutConnection: 'cashout connection', account: 'store account',
    cashoutCommitment: 'commitment', cashoutItemMatch: 'matched item',
  }[row.model] || 'record';
}

function setupText(entry) {
  const [model, noun] = SETUP[entry.record_type];
  const d = entry.detail || {};
  const rows = d.rows || [];
  const main = rows.find((r) => r.model === model) || {};
  const prefix = d.undo ? 'Undid: ' : '';
  const article = /^[aeiou]/.test(noun) ? 'an' : 'a';
  const verb = d.action === 'create' ? 'Added' : d.action === 'delete' ? 'Removed' : 'Edited';
  const title = `${prefix}${verb} ${verb === 'Edited' ? '' : `${article} `}${noun}`;
  const parts = [];

  if (main.op === 'create' || main.op === 'delete') {
    const v = main.row?.values || {};
    if (entry.record_type === 'card' && v.type) parts.push(v.type);
    if (entry.record_type === 'platform' && v.type) parts.push(v.type);
    if (entry.record_type === 'recurring_expense') parts.push(`${formatField('money', v.amount)} ${v.frequency || ''}`.trim());
    if (entry.record_type === 'calendar_event' && v.date) parts.push(formatField('date', v.date));
    if (NOTE_TYPES.has(entry.record_type)) parts.push(snippet(v.note ?? v.body));
    const others = rows.filter((r) => r.model === model && r !== main && r.op === main.op).length;
    if (others) parts.push(`+ ${others} more`);
    // Records that came or went with it (a platform's store accounts, a
    // recurring expense's generated expenses).
    const along = {};
    for (const r of rows.filter((x) => x.model !== model && (x.op === 'create' || x.op === 'delete'))) along[linkNoun(r)] = (along[linkNoun(r)] || 0) + 1;
    for (const [what, n] of Object.entries(along)) parts.push(`with ${plural(n, what)}`);
  } else {
    for (const [key, f] of Object.entries(main.fields || {})) {
      const label = SETUP_FIELDS[key];
      if (!label) continue;
      const [name, kind] = label;
      if (kind === 'ref') parts.push(`${name} changed`);
      else if (kind === 'bool') parts.push(`${name} ${f.after ? 'on' : 'off'}`);
      else if (kind === 'text') parts.push(`${name} ${snippet(f.after)}`);
      else parts.push(`${name} ${formatField(kind, f.before)} → ${formatField(kind, f.after)}`);
    }
    if (parts.length > 3) parts.splice(3, parts.length - 3, `${parts.length - 3} more`);
    const sales = rows.filter((r) => r.model === 'sales' && !r.link).length;
    if (sales) parts.push(`${plural(sales, 'sale')} updated`);
  }

  // Links a removal cleared, or an undo put back.
  const links = {};
  for (const r of rows.filter((x) => x.link)) links[linkNoun(r)] = (links[linkNoun(r)] || 0) + 1;
  const linkList = Object.entries(links).map(([what, n]) => plural(n, what)).join(', ');
  if (linkList) {
    const restoring = rows.some((r) => r.link && Object.values(r.fields || {}).some((f) => f.after));
    parts.push(restoring ? `Put back on ${linkList}` : `Taken off ${linkList}`);
  }
  if (d.key_replaced) parts.push('Key replaced');
  if (d.key_needed) parts.push('Enter its key again to sync');
  return { title, change: parts.join(' · ') };
}

// ─── Log-only entries (kind 'event'): undo can't reverse these ───────────────
const RESET_COUNTS = [['purchases', 'purchase'], ['sales', 'sale'], ['expenses', 'expense'], ['paymentMethods', 'card'], ['platforms', 'platform']];

function eventText(entry) {
  const d = entry.detail || {};
  const type = entry.record_type;
  if (type === 'api_key') {
    const titles = {
      create: 'Created an API key', rotate: 'Replaced an API key', revoke: 'Revoked an API key',
      cashout_writes: d.allowed ? 'Allowed cashout actions for an API key' : 'Stopped cashout actions for an API key',
      ai_guide_reset: 'Set an API key to re-read the AI guide',
    };
    return { title: titles[d.action] || 'Changed an API key', change: '', product: d.product_name || 'API key' };
  }
  if (type === 'setting') {
    return { title: `Turned ${d.enabled ? 'on' : 'off'} ${d.product_name || 'a setting'}`, change: '', product: 'Settings' };
  }
  if (type === 'data_reset') {
    const deleted = d.deleted || {};
    const counts = RESET_COUNTS.filter(([k]) => Number(deleted[k]) > 0).map(([k, word]) => plural(Number(deleted[k]), word));
    return {
      title: d.action === 'everything' ? 'Reset all data' : 'Reset purchases and sales',
      change: counts.length ? `${counts.join(', ')} deleted` : '',
      product: d.product_name || 'Data',
    };
  }
  if (type === 'email_sort') {
    return { title: 'Set aside as personal', change: [d.reason, d.total != null ? `${formatMoney(d.total)}` : null].filter(Boolean).join(' · '), product: d.product_name || 'Order from email' };
  }
  if (type === 'email_link') {
    const what = { purchase: 'purchase', sale: 'sale', expense: 'expense' }[d.linked_to] || 'record';
    const email = { check: 'check', receipt: 'receipt', purchase: 'order' }[d.order_type] || 'email';
    const many = Number(d.count) > 1;
    const number = d.order_number ? orderRef(d.order_number) : '';
    return {
      title: `Linked a${/^[aeiou]/i.test(d.store || '') ? 'n' : ''} ${d.store || 'store'} ${email} to your ${many ? `${d.count} ${what}s` : what}`,
      change: number,
      product: d.product_name || 'Email',
    };
  }
  if (type === 'cashout_connection') return { title: 'Replaced a cashout key', change: '', product: d.product_name || 'Cashout connection' };
  if (type === 'cashout') {
    const titles = { commit: 'Committed to a cashout deal', change_quantity: 'Changed a cashout commitment', withdraw: 'Withdrew a cashout commitment', log_purchase: 'Logged a purchase with a cashout' };
    const parts = [];
    if (Number(d.quantity) > 0) parts.push(`Qty ${Number(d.quantity)}`);
    if (d.cashout) parts.push(d.cashout);
    return { title: titles[d.action] || 'Cashout action', change: parts.join(' · '), product: d.product_name || 'Cashout' };
  }
  return { title: 'Activity', change: '', product: d.product_name || 'Record' };
}

// { title, change, product } -- e.g. "Cancel Sale", "Paid → Cancelled · 2 units
// back in stock", "Meta Quest 3S".
export function describeActivity(entry) {
  if (entry.kind === 'event') return eventText(entry);
  const setup = SETUP[entry.record_type];
  const text = setup && entry.kind === 'change' ? setupText(entry)
    : entry.kind === 'status' ? statusText(entry)
      : entry.kind === 'change' ? changeText(entry)
        : refundText(entry);
  const fallback = setup ? setup[2] : ({ sale: 'Sale', purchase: 'Purchase', expense: 'Expense' }[entry.record_type] || 'Record');
  const name = entry.detail?.product_name;
  const product = entry.record_type === 'goal' ? (GOAL_NAMES[name] || fallback) : (name || fallback);
  return { ...text, product };
}
