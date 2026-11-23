// Everything one automatic change wrote, field by field, for the Automation
// page's Details view: what each field was before and what it is now. Built
// from the Activity entry's own snapshot (api services/activityLog.js), so it
// shows exactly what was written, nothing guessed.
import { FIELD_LABELS, formatField } from './activityText';

// Fields the email writes that the Activity summary doesn't name.
const MORE_LABELS = {
  carrier: ['Carrier'], paid_amount: ['Paid', 'money'], paid_at: ['Paid on', 'date'], payout_account: ['Paid to'],
  paid_reference: ['Reference'], receiving_status: ['Status', 'status'], status: ['Status', 'status'], workflow_status: ['Status', 'status'],
  delivered_at: ['Delivered', 'date'], qty_on_hand: ['On hand', 'int'], payout_amount: ['Payout', 'money'],
};
const LABELS = { ...FIELD_LABELS, ...MORE_LABELS };
// Internal mirrors and bookkeeping columns: never shown.
const HIDDEN = /(_decimal|_changed_at|_id)$|^(id|user_id|created_at|updated_at|inventory_id)$/;
const MODEL = { inventory: 'Purchase', sales: 'Sale', expense: 'Expense' };

const humanize = (v) => String(v ?? '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
function show(key, value) {
  const [, kind] = LABELS[key] || [];
  if (kind === 'status') return value ? humanize(value) : '—';
  return formatField(kind, value);
}
const labelOf = (key) => (LABELS[key] || [humanize(key)])[0];

function fieldRows(fields = {}) {
  return Object.entries(fields)
    .filter(([key]) => !HIDDEN.test(key))
    .map(([key, f]) => ({ label: labelOf(key), before: show(key, f.before), after: show(key, f.after) }));
}

// A new or removed record: the fields that matter first, no empty or zero
// amounts, and each label once (a purchase has two status columns).
const FIRST = ['product_name', 'name', 'qty_purchased', 'quantity', 'unit_purchase_cost', 'unit_price', 'amount', 'sales_tax', 'shipping_cost_inbound', 'purchase_date', 'sale_date', 'date', 'order_number', 'tracking_number', 'receiving_status', 'status', 'notes'];
const rank = (key) => { const i = FIRST.indexOf(key); return i < 0 ? FIRST.length : i; };
const isEmpty = (key, v) => v === null || v === '' || v === undefined || v === false
  || (['money', 'int'].includes((LABELS[key] || [])[1]) && Number(v) === 0 && key !== 'qty_purchased' && key !== 'quantity');
function valueRows(values = {}) {
  const seen = new Set();
  return Object.entries(values)
    .filter(([key, v]) => LABELS[key] && !HIDDEN.test(key) && !isEmpty(key, v))
    .sort(([a], [b]) => rank(a) - rank(b))
    .map(([key, v]) => ({ label: labelOf(key), after: show(key, v) }))
    .filter((row) => (seen.has(row.label) ? false : seen.add(row.label)));
}

export function changeDetails(entry) {
  const d = entry.detail || {};
  const name = d.product_name || null;

  if (entry.record_type === 'email_sort') {
    return {
      note: 'Nothing on your records changed. The order was moved to Not business, so it isn\'t added as a purchase.',
      sections: [{ title: 'Order set aside', rows: [
        { label: 'Why', after: d.reason || '—' },
        ...(d.total != null ? [{ label: 'Total', after: formatField('money', d.total) }] : []),
        ...((d.items || []).length ? [{ label: 'Items', after: d.items.join(', ') }] : []),
      ] }],
    };
  }
  if (entry.record_type === 'email_link') {
    const what = { purchase: 'purchase', sale: 'sale', expense: 'expense' }[d.linked_to] || 'record';
    return {
      note: 'Linking connects the email to your record. Any blanks it filled in show as their own change.',
      sections: [{ title: 'Linked', rows: [
        { label: 'Store', after: d.store || '—' },
        ...(d.order_number ? [{ label: 'Order #', after: d.order_number }] : []),
        { label: 'Linked to', after: `${d.count > 1 ? `${d.count} ${what}s` : `Your ${what}`}${name ? `: ${name}` : ''}` },
      ] }],
    };
  }
  if (entry.kind === 'status') {
    const rows = [];
    if (d.from !== d.to) rows.push({ label: 'Status', before: d.from ? humanize(d.from) : '—', after: d.to ? humanize(d.to) : '—' });
    rows.push(...fieldRows(d.fields).filter((r) => r.label !== 'Status'));
    return { sections: [{ title: name || 'Purchase', rows }] };
  }

  const changes = d.rows || [];
  const sections = changes.map((row, i) => {
    const many = changes.filter((r) => r.model === row.model).length > 1;
    const title = `${MODEL[row.model] || humanize(row.model)}${many ? ` ${changes.filter((r) => r.model === row.model).indexOf(row) + 1}` : ''}${!many && name && i === 0 ? `: ${name}` : ''}`;
    if (row.op === 'create') return { title: `New ${title.toLowerCase()}`, created: true, rows: valueRows(row.row?.values) };
    if (row.op === 'delete') return { title: `Removed ${title.toLowerCase()}`, removed: true, rows: valueRows(row.row?.values) };
    return { title, rows: fieldRows(row.fields) };
  }).filter((s) => s.rows.length);
  return { sections };
}
