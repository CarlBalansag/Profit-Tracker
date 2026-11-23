// The Automation page's review of what the email sync did on its own.
//   confirm  the user agrees; the change stays and moves to Completed.
//   reject   "No": the change is taken back (Undo), and the order is unlinked
//            or set aside so the next sync doesn't do it again.
// Emails themselves are never touched.
const prisma = require('../../prisma');
const { undoActivity, UNDO_WINDOW_DAYS } = require('../activityLog');

const requestError = (status, message) => Object.assign(new Error(message), { status });

const OPEN = { source: 'email', review_state: null, undone_at: null };

async function toConfirmCount(userId) {
  return prisma.activityLog.count({ where: { user_id: userId, ...OPEN } });
}

async function confirmEntries(userId, ids) {
  const { count } = await prisma.activityLog.updateMany({
    where: { user_id: userId, id: { in: ids }, ...OPEN },
    data: { review_state: 'confirmed', reviewed_at: new Date() },
  });
  return count;
}

// The email order an automatic change came from: tagged on the entry, the
// order itself (links, set-asides), or the order linked to the record it changed.
async function orderIdFor(userId, entry) {
  const d = entry.detail || {};
  if (d.email_order_id) return d.email_order_id;
  if (entry.record_type === 'email_link' || entry.record_type === 'email_sort') return entry.record_id;
  const ids = [entry.record_id, ...(d.rows || []).map((r) => r.id)].filter(Boolean);
  const match = await prisma.emailMatch.findFirst({ where: { user_id: userId, state: 'linked', record_ids: { hasSome: ids } }, orderBy: { decided_at: 'desc' } });
  return match?.order_id || null;
}

const isCreate = (entry) => entry.kind === 'change' && entry.detail?.action === 'create';

// Unlinks an order and keeps it from being linked or added again on its own.
async function unlink(userId, orderId, { declined }) {
  await prisma.$transaction([
    prisma.emailMatch.updateMany({ where: { user_id: userId, order_id: orderId, state: { in: ['linked', 'suggested'] } }, data: { state: 'rejected', decided_at: new Date() } }),
    prisma.emailOrder.updateMany({
      where: { id: orderId, user_id: userId },
      data: { match_state: 'unmatched', applied_status: null, ...(declined ? { leaning: 'declined', leaning_reason: 'You said no to the automatic one' } : {}) },
    }),
  ]);
}

const TABLE = { inventory: 'inventory', sales: 'sales' };
async function undoIfOpen(userId, entry) {
  if (entry.kind === 'event' || entry.undone_at) return;
  await undoActivity(userId, entry.id);
  // Undo leaves the carrier alone (tracking refreshes rewrite it), so the
  // carrier that came with a tracking number the email added goes with it.
  const rows = (entry.detail?.rows || []).filter((r) => TABLE[r.model] && r.fields?.tracking_number && !r.fields.tracking_number.before);
  for (const r of rows) {
    const owner = r.model === 'sales' ? { inventory: { user_id: userId } } : { user_id: userId };
    await prisma[TABLE[r.model]].updateMany({ where: { id: r.id, tracking_number: null, ...owner }, data: { carrier: null } });
  }
  if (entry.kind === 'status' && entry.detail?.fields?.tracking_number && !entry.detail.fields.tracking_number.before) {
    await prisma.inventory.updateMany({ where: { id: entry.record_id, user_id: userId, tracking_number: null }, data: { carrier: null } });
  }
}

async function rejectEntry(userId, entryId) {
  const entry = await prisma.activityLog.findFirst({ where: { id: entryId, user_id: userId, source: 'email' } });
  if (!entry) throw requestError(404, 'This change was not found.');
  if (entry.review_state === 'rejected') throw requestError(409, 'You already said no to this one.');
  if (entry.undone_at) throw requestError(409, 'This was already undone.');
  if (entry.kind !== 'event' && Date.now() - new Date(entry.created_at).getTime() > UNDO_WINDOW_DAYS * 86400000) {
    throw requestError(409, `Only the last ${UNDO_WINDOW_DAYS} days can be taken back.`);
  }
  const orderId = await orderIdFor(userId, entry);

  if (entry.record_type === 'email_sort') {
    // Set aside as personal -> it's business after all.
    await prisma.emailOrder.updateMany({ where: { id: entry.record_id, user_id: userId, match_state: 'dismissed' }, data: { match_state: 'unmatched', leaning: 'kept', leaning_reason: "You said it's business" } });
  } else if (entry.record_type === 'email_link') {
    // The link and everything the email did through it (the fill is logged
    // just before the link), newest first.
    if (orderId) {
      const related = await prisma.activityLog.findMany({ where: { user_id: userId, source: 'email', undone_at: null, kind: { not: 'event' } }, orderBy: { created_at: 'desc' }, take: 500 });
      for (const other of related) {
        if (other.id === entry.id || isCreate(other)) continue;
        if ((other.detail || {}).email_order_id !== orderId) continue;
        await undoIfOpen(userId, other);
        await prisma.activityLog.update({ where: { id: other.id }, data: { review_state: 'rejected', reviewed_at: new Date() } });
      }
      await unlink(userId, orderId, { declined: false });
    }
  } else {
    await undoIfOpen(userId, entry);
    // A record made from the email: never made again on its own.
    if (isCreate(entry) && orderId) await unlink(userId, orderId, { declined: true });
  }
  await prisma.activityLog.update({ where: { id: entry.id }, data: { review_state: 'rejected', reviewed_at: new Date() } });
  return { rejected: true };
}

module.exports = { toConfirmCount, confirmEntries, rejectEntry, orderIdFor };
