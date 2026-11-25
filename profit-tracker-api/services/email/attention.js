// Orders from email the user has to act on: the store cancelled or refunded an
// order whose purchase is still on the books, or a check waits to be deposited
// (EmailOrder.attention). This adds the purchases each one is linked to, and
// works out which are already dealt with, so they clear on their own.
const { allowedActions } = require('../statusTransitions');

// What an order's status asks for. Used to bring a handled note back (Undo).
const ATTENTION_FOR_STATUS = { cancelled: 'cancelled', refund: 'refund', return: 'refund', check: 'deposit_check' };

// Cancelled: every linked purchase is cancelled. Refunded: the same, or a
// refund was recorded on one of them since the store's email. A note with no
// linked purchase left stays until the user marks it done.
function isSettled(order, records, refunds) {
  if (order.attention === 'deposit_check' || !records.length) return false;
  if (records.every((r) => r.cancelled_at)) return true;
  if (order.attention !== 'refund' || !order.last_seen) return false;
  const ids = new Set(records.map((r) => r.id));
  const day = order.last_seen.toISOString().slice(0, 10);
  return refunds.some((r) => ids.has(r.inventory_id)
    && (r.created_at >= order.last_seen || r.date.toISOString().slice(0, 10) >= day));
}

// `orders` carry id, attention and last_seen. Returns a Map from order id to
// { settled, records }, records being the user's own purchases only.
async function attentionDetails(prisma, userId, orders) {
  const open = orders.filter((o) => o.attention);
  const out = new Map();
  if (!open.length) return out;
  const matches = await prisma.emailMatch.findMany({
    where: { user_id: userId, order_id: { in: open.map((o) => o.id) }, state: 'linked', record_type: 'purchase' },
    select: { order_id: true, record_ids: true },
  });
  const ids = [...new Set(matches.flatMap((m) => m.record_ids))];
  const [purchases, refunds] = ids.length ? await Promise.all([
    prisma.inventory.findMany({ where: { user_id: userId, id: { in: ids } } }),
    prisma.refund.findMany({ where: { user_id: userId, inventory_id: { in: ids }, sale_id: null }, select: { inventory_id: true, date: true, created_at: true } }),
  ]) : [[], []];
  const byId = new Map(purchases.map((p) => [p.id, p]));
  for (const order of open) {
    const linked = [...new Set(matches.filter((m) => m.order_id === order.id).flatMap((m) => m.record_ids))]
      .map((id) => byId.get(id)).filter(Boolean);
    out.set(order.id, {
      settled: isSettled(order, linked, refunds),
      records: linked.map((p) => ({
        id: p.id,
        name: p.product_name,
        quantity: p.qty_purchased,
        amount: Number(p.unit_purchase_cost_decimal ?? p.unit_purchase_cost) * p.qty_purchased,
        date: p.purchase_date,
        cancelled: Boolean(p.cancelled_at),
        // The Cancel step, when the purchase's status still allows it.
        cancel: order.attention === 'cancelled' && !p.cancelled_at
          ? allowedActions(p, 'inventory').find((a) => a.action === 'cancel') || null
          : null,
      })),
    });
  }
  return out;
}

module.exports = { ATTENTION_FOR_STATUS, attentionDetails };
