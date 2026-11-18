const prisma = require('../prisma');

const ownershipError = (label) => Object.assign(
  new Error(`${label} not found or access denied`),
  { status: 404 }
);

async function requireOwned(model, id, userId, label) {
  if (!id) return null;
  const record = await prisma[model].findFirst({ where: { id, user_id: userId } });
  if (!record) throw ownershipError(label);
  return record;
}

// A purchase's store account must be one of this user's accounts AND belong to
// the purchase's store (vendor). Returns null when no account is given.
async function requireStoreAccount(accountId, vendorId, userId) {
  if (!accountId) return null;
  const account = await requireOwned('account', accountId, userId, 'Store account');
  if (!vendorId || account.platform_id !== vendorId) {
    throw Object.assign(new Error('That account belongs to a different store'), { status: 400 });
  }
  return account;
}

// Which account_id an update should write, given the purchase as stored and the
// incoming change. An explicitly sent account is checked against the store the
// purchase will end up with. When only the store changes, an account from the
// old store is cleared instead of rejecting the save. Returns undefined when
// account_id should be left as it is.
async function resolveStoreAccountUpdate(existing, incoming, userId) {
  const vendorId = incoming.vendor_id !== undefined ? (incoming.vendor_id || null) : existing.vendor_id;
  if (incoming.account_id !== undefined) {
    await requireStoreAccount(incoming.account_id, vendorId, userId);
    return incoming.account_id || null;
  }
  if (!existing.account_id || vendorId === existing.vendor_id) return undefined;
  const account = await prisma.account.findFirst({ where: { id: existing.account_id, user_id: userId } });
  return account && account.platform_id === vendorId ? undefined : null;
}

module.exports = { requireOwned, requireStoreAccount, resolveStoreAccountUpdate };
