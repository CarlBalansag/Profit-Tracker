// One automatic change from the email sync, in plain words for the Automation
// page: what kind it was (for the filter and icon), a short title, the record
// it touched, an amount when money moved, a few short facts, and any long
// detail (serial numbers) kept for a "show" toggle. Builds on describeActivity.
import { describeActivity } from './activityText';

export const AUTOMATION_KINDS = [
  { id: 'paid', label: 'Payments' },
  { id: 'shipping', label: 'Shipping' },
  { id: 'link', label: 'Links' },
  { id: 'created', label: 'New records' },
  { id: 'details', label: 'Details' },
  { id: 'sorted', label: 'Set aside' },
];

const STATUS_TITLES = { add_tracking: 'Added tracking', mark_delivered: 'Marked delivered', cancel: 'Cancelled the purchase' };
const FIELD_LABELS = { order_number: 'Order #', tracking_number: 'Tracking', carrier: 'Carrier', return_by_date: 'Return by' };
const SERIALS = /^Serials \(([^)]*)\): (.+)$/m;

const shortDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function changedFields(detail) {
  return Object.assign({}, ...(detail.rows || []).map((row) => row.fields || {}));
}

export function describeAutomation(entry) {
  const base = describeActivity(entry);
  const d = entry.detail || {};
  const subject = base.product;

  if (entry.record_type === 'email_sort') {
    const items = (d.items || []).filter(Boolean);
    return {
      kind: 'sorted', title: 'Set aside as personal', subject, amount: d.total != null ? Number(d.total) : null,
      facts: [d.reason, items.length ? items.join(', ') : null].filter(Boolean), details: [],
    };
  }
  if (entry.record_type === 'email_link') {
    return { kind: 'link', title: base.title, subject, facts: [base.change].filter(Boolean), details: [] };
  }

  if (entry.kind === 'status') {
    const tracking = d.fields?.tracking_number?.after;
    const kind = d.action === 'cancel' ? 'details' : 'shipping';
    return { kind, title: STATUS_TITLES[d.action] || base.title, subject, facts: [tracking, base.change].filter(Boolean), details: [] };
  }

  if (d.action === 'create') {
    return { kind: 'created', title: base.title, subject, facts: [base.change].filter(Boolean), details: [] };
  }

  const fields = changedFields(d);
  const after = (name) => fields[name]?.after;

  if (after('paid_amount') != null) {
    return {
      kind: 'paid', title: 'Marked paid', subject, amount: Number(after('paid_amount')),
      facts: [after('payout_account') && `To ${after('payout_account')}`, after('paid_reference')].filter(Boolean),
      details: [],
    };
  }
  if (/check/i.test(after('payout_account') || '') && fields.payout_account?.before) {
    return { kind: 'paid', title: 'Moved to a check', subject, facts: [`From ${fields.payout_account.before}`, `To ${after('payout_account')}`], details: [] };
  }

  const facts = [];
  const details = [];
  for (const [name, change] of Object.entries(fields)) {
    if (name === 'notes') {
      const serials = String(change.after || '').match(SERIALS);
      if (serials) {
        const list = serials[2].split(/,\s*/).filter(Boolean);
        facts.push(`${list.length} ${list.length === 1 ? 'serial' : 'serials'}`);
        details.push(`From ${serials[1]}: ${list.join(', ')}`);
      } else {
        facts.push('Notes');
      }
    } else if (FIELD_LABELS[name] && change.after) {
      facts.push(`${FIELD_LABELS[name]} ${name === 'return_by_date' ? shortDate(change.after) : change.after}`);
    }
  }
  if (facts.length) return { kind: 'details', title: 'Filled in details', subject, facts, details };
  return { kind: 'details', title: base.title, subject, facts: [base.change].filter(Boolean), details: [] };
}
