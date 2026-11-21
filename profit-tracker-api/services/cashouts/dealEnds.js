// When a commitment's deal ends, kept on the commitment so the To-Do list can
// warn before it does (services/todos.js) without asking the provider. The
// provider only gives a deal's end with its live deal list, so it's saved
// when a purchase is logged or committed, and refreshed for open commitments
// whenever that list is fetched.
const prisma = require('../../prisma');

const OPEN = ['pending', 'committing', 'active'];

// The deal's end as a Date, or null when the provider gives none (LA and P4D
// don't) or it isn't a real date.
function dealEndOf(deal) {
  if (!deal?.expiresAt) return null;
  const end = new Date(deal.expiresAt);
  return Number.isNaN(end.getTime()) ? null : end;
}

// Bring the saved end up to date on this connection's open commitments.
// Best effort: the deal list still loads if this fails.
async function syncDealEnds(userId, connectionId, deals) {
  const ends = new Map((deals || []).map((deal) => [String(deal.id), dealEndOf(deal)]));
  const open = await prisma.cashoutCommitment.findMany({
    where: { user_id: userId, connection_id: connectionId, status: { in: OPEN } },
    select: { id: true, external_deal_id: true, deal_expires_at: true },
  });
  let changed = 0;
  for (const row of open) {
    const end = ends.get(String(row.external_deal_id));
    if (!end || row.deal_expires_at?.getTime() === end.getTime()) continue;
    await prisma.cashoutCommitment.update({ where: { id: row.id }, data: { deal_expires_at: end } });
    changed += 1;
  }
  return changed;
}

module.exports = { dealEndOf, syncDealEnds };
