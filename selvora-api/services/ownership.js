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

module.exports = { requireOwned };
