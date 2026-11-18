// Commitments and tracking submissions against a connected cashout's own
// API. Separate from service.js (which only ever reads deals) because these
// are real, binding writes against a third party -- kept in their own file
// so that boundary stays obvious at a glance.
const prisma = require('../../prisma');
const { decryptKey } = require('./crypto');
const { getAdapter } = require('./registry');
const { getConnection } = require('./service');

const notFound = (label) => Object.assign(new Error(`${label} not found or access denied`), { status: 404 });

async function connectionAndAdapter(userId, connectionId) {
  const conn = await getConnection(userId, connectionId);
  const adapter = getAdapter(conn.provider);
  if (typeof adapter.createCommit !== 'function') {
    throw Object.assign(new Error(`Commitments and tracking aren't supported for ${adapter.name} yet. Commit on its website.`), { status: 400 });
  }
  return { conn, adapter, rawKey: decryptKey(conn.encrypted_key) };
}

async function listCommits(userId, connectionId, filters) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  return adapter.listCommits(rawKey, filters);
}

async function getCommit(userId, connectionId, commitmentId) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  return adapter.getCommit(rawKey, commitmentId);
}

// Commits with the provider, then saves the link locally. Does not touch
// Inventory/Sales -- see logPurchase.js, which calls this and then those.
async function createCommitment(userId, connectionId, { dealId, itemId, quantity, saleId = null }) {
  if (!dealId || !itemId) throw Object.assign(new Error('dealId and itemId are required.'), { status: 400 });
  if (!(Number(quantity) > 0)) throw Object.assign(new Error('quantity must be a positive number.'), { status: 400 });

  const { conn, adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  const preview = await adapter.createCommit(rawKey, { itemId: Number(itemId), quantity: Number(quantity) });

  return prisma.cashoutCommitment.create({
    data: {
      user_id: userId,
      connection_id: conn.id,
      sale_id: saleId,
      external_deal_id: String(dealId),
      external_item_id: String(itemId),
      open_item_id: String(itemId),
      external_commitment_id: preview.id,
      quantity: preview.quantity,
      status: 'active',
    },
  });
}

async function updateCommitment(userId, commitmentRecordId, { quantity }) {
  if (!(Number(quantity) > 0)) throw Object.assign(new Error('quantity must be a positive number.'), { status: 400 });
  const record = await prisma.cashoutCommitment.findFirst({ where: { id: commitmentRecordId, user_id: userId } });
  if (!record) throw notFound('Commitment');
  // Not committed with the provider yet: only our own row changes.
  if (record.status === 'pending') {
    return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { quantity: Number(quantity) } });
  }

  const { adapter, rawKey } = await connectionAndAdapter(userId, record.connection_id);
  const preview = await adapter.updateCommit(rawKey, record.external_commitment_id, { quantity: Number(quantity) });

  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { quantity: preview.quantity } });
}

// Withdraws with the provider -- which frees the quantity back to the deal
// immediately on their side -- then marks the local row withdrawn rather
// than deleting it, so the purchase/sale it may be linked to keeps its history.
async function deleteCommitment(userId, commitmentRecordId) {
  const record = await prisma.cashoutCommitment.findFirst({ where: { id: commitmentRecordId, user_id: userId } });
  if (!record) throw notFound('Commitment');
  if (record.status === 'committing') {
    throw Object.assign(new Error('This commitment is being sent to the cashout right now. Try again in a moment.'), { status: 409 });
  }
  // Never committed with the provider, so there's nothing to withdraw there.
  // The row goes, so the item can be committed again later; the purchase and
  // sale stay.
  if (record.status === 'pending') {
    await prisma.cashoutCommitment.delete({ where: { id: record.id } });
    return { ...record, status: 'removed' };
  }

  const { adapter, rawKey } = await connectionAndAdapter(userId, record.connection_id);
  await adapter.deleteCommit(rawKey, record.external_commitment_id);

  // open_item_id clears so this item can be committed again later.
  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { status: 'withdrawn', open_item_id: null } });
}

async function listLocalCommitments(userId, { connectionId, saleId, status } = {}) {
  return prisma.cashoutCommitment.findMany({
    where: {
      user_id: userId,
      ...(connectionId ? { connection_id: connectionId } : {}),
      ...(saleId ? { sale_id: saleId } : {}),
      ...(status ? { status } : {}),
    },
    include: { connection: true, sale: { include: { inventory: true } } },
    orderBy: { created_at: 'desc' },
  });
}

async function submitTracking(userId, connectionId, { trackingCodes, description, insuredValue }) {
  if (!Array.isArray(trackingCodes) || trackingCodes.length === 0) {
    throw Object.assign(new Error('At least one tracking code is required.'), { status: 400 });
  }
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  return adapter.submitTracking(rawKey, { trackingCodes, description, insuredValue });
}

// Tracking codes already sent to this cashout with another commitment. Two
// items in one box share a tracking number, and the cashout only needs it
// once: EB's tracking submission is per account, not per commitment, so a
// second send would just make a duplicate entry there.
async function trackingAlreadySent(userId, connectionId, codes) {
  const wanted = new Set((codes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
  if (!wanted.size) return [];
  const sent = await prisma.cashoutCommitment.findMany({
    where: { user_id: userId, connection_id: connectionId, tracking_submitted_at: { not: null } },
  });
  const found = new Set();
  for (const row of sent) {
    for (const code of row.tracking_codes || []) {
      const key = String(code).trim().toUpperCase();
      if (wanted.has(key)) found.add(key);
    }
  }
  return (codes || []).filter((c) => found.has(String(c).trim().toUpperCase()));
}

async function listTrackingSubmissions(userId, connectionId, pagination) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  return adapter.listTrackingSubmissions(rawKey, pagination);
}

module.exports = {
  connectionAndAdapter,
  listCommits,
  getCommit,
  createCommitment,
  updateCommitment,
  deleteCommitment,
  listLocalCommitments,
  submitTracking,
  trackingAlreadySent,
  listTrackingSubmissions,
};
