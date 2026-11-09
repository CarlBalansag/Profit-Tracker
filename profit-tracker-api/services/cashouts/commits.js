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

  const { adapter, rawKey } = await connectionAndAdapter(userId, record.connection_id);
  await adapter.deleteCommit(rawKey, record.external_commitment_id);

  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { status: 'withdrawn' } });
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

async function listTrackingSubmissions(userId, connectionId, pagination) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId);
  return adapter.listTrackingSubmissions(rawKey, pagination);
}

module.exports = {
  listCommits,
  getCommit,
  createCommitment,
  updateCommitment,
  deleteCommitment,
  listLocalCommitments,
  submitTracking,
  listTrackingSubmissions,
};
