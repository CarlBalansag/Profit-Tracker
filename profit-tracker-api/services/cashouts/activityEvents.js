// Activity entries for cashout writes the provider has already accepted.
const prisma = require('../../prisma');
const activityLog = require('../activityLog');

// Commitments and Log Purchase are sent to the cashout provider, which undo
// can't take back, so they are log-only Activity entries. Written after the
// provider call succeeded and never allowed to fail the request: the write
// already happened. Returns the entry, or null.
async function logCashout(userId, action, commitment, { name, quantity } = {}) {
  try {
    let product = name || null;
    // recordEvent below never throws; these lookups are guarded too.
    if (!product && commitment?.sale_id) {
      const sale = await prisma.sales.findUnique({ where: { id: commitment.sale_id }, select: { inventory: { select: { product_name: true } } } });
      product = sale?.inventory?.product_name ?? null;
    }
    const connection = commitment?.connection_id
      ? await prisma.cashoutConnection.findUnique({ where: { id: commitment.connection_id }, select: { provider: true, display_name: true } })
      : null;
    return await activityLog.recordEvent(userId, {
      recordType: 'cashout',
      recordId: commitment?.id,
      action,
      name: product || (commitment?.external_deal_id ? `Deal ${commitment.external_deal_id}` : null),
      detail: {
        quantity: quantity ?? commitment?.quantity ?? null,
        cashout: connection ? (connection.display_name || connection.provider) : null,
      },
    });
  } catch (err) {
    console.error('[activity] could not log cashout action:', err.message);
    return null;
  }
}

module.exports = { logCashout };
