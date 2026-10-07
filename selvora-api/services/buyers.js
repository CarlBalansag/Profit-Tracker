// Shared buyer lookup/create, used by services/markSalesPaid.js (mark_sale_paid's
// optional buyer attribution) and routes/mcp.js (update_sale_buyer). Buyers are
// freeform counterparties (a marketplace buyer, a cashout service, a person), so
// -- like vendors, and unlike payment methods -- a new name is created automatically
// rather than rejected.
const defaultClient = require('../prisma');

// `client` defaults to the plain Prisma client, but callers running inside a
// transaction (e.g. services/markSalesPaid.js) pass their `tx` instead, so the
// lookup-or-create participates in and rolls back with the rest of the write.
async function findOrCreateBuyer(userId, name, client = defaultClient) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw Object.assign(new Error('buyer is required'), { toolError: true });
  const existing = await client.buyer.findFirst({
    where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  return client.buyer.create({ data: { user_id: userId, name: trimmed } });
}

module.exports = { findOrCreateBuyer };
