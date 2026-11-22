// Groups emails about the same order: same store and order number, or the
// same tracking number (a carrier email joins the store order it ships).
const CARRIERS = new Set(['ups', 'usps', 'fedex']);
const MARKETPLACES = new Set(['ebay', 'stockx', 'goat']);
const RECEIPT_ONLY = new Set(['pirateship']);

// Later steps win; a cancellation wins over everything.
const RANK = { other: 0, order: 10, receipt: 10, sale: 10, delayed: 15, pickup: 30, shipped: 40, delivered: 50, return: 60, refund: 65, payout: 70, check: 75, cancelled: 99 };
const rank = (kind) => RANK[kind] ?? 0;

function groupType(messages) {
  const kinds = new Set(messages.map((m) => m.kind));
  const merchants = new Set(messages.map((m) => m.merchant));
  // A cash-out paying its balance out as a check: no record of its own.
  if (kinds.has('check')) return 'check';
  if (kinds.has('sale') || kinds.has('payout')) return 'sale';
  if ([...merchants].every((m) => CARRIERS.has(m))) return 'shipment';
  if ([...merchants].every((m) => RECEIPT_ONLY.has(m)) || (kinds.size === 1 && kinds.has('receipt'))) return 'receipt';
  if ([...merchants].every((m) => MARKETPLACES.has(m)) && !kinds.has('order')) return 'sale';
  return 'purchase';
}

// The order's money and items come from the confirmation (or receipt/sale
// email) with a total; status from the furthest step reached.
function summarize(messages) {
  const sorted = [...messages].sort((a, b) => (a.sent_at?.getTime() || 0) - (b.sent_at?.getTime() || 0));
  const primary = sorted.find((m) => ['order', 'receipt', 'sale', 'check'].includes(m.kind) && m.total != null)
    || sorted.find((m) => m.total != null) || sorted[0];
  const status = sorted.reduce((best, m) => (rank(m.kind) > rank(best) ? m.kind : best), 'other');
  const storeMessage = sorted.find((m) => !CARRIERS.has(m.merchant)) || sorted[0];
  return {
    merchant: storeMessage.merchant,
    order_number: sorted.find((m) => m.order_number && !CARRIERS.has(m.merchant))?.order_number || null,
    type: groupType(sorted),
    status,
    first_seen: sorted[0].sent_at,
    last_seen: sorted[sorted.length - 1].sent_at,
    currency: primary.currency || 'USD',
    total: primary.total, subtotal: primary.subtotal, tax: primary.tax, shipping: primary.shipping, discount: primary.discount,
    items: sorted.find((m) => Array.isArray(m.items) && m.items.length)?.items || null,
    payment_hint: sorted.find((m) => m.payment_hint)?.payment_hint || null,
    tracking_numbers: [...new Set(sorted.flatMap((m) => m.tracking_numbers || []))].slice(0, 10),
  };
}

function keyFor(m) {
  if (m.order_number && !CARRIERS.has(m.merchant)) return `${m.merchant}:${m.order_number}`;
  if (m.tracking_numbers?.length) return `track:${m.tracking_numbers[0]}`;
  return `msg:${m.id}`;
}

async function recompute(prisma, orderId) {
  const messages = await prisma.emailMessage.findMany({ where: { order_id: orderId } });
  if (!messages.length) { await prisma.emailOrder.delete({ where: { id: orderId } }).catch(() => {}); return null; }
  return prisma.emailOrder.update({ where: { id: orderId }, data: summarize(messages) });
}

// Puts every read email of the user that has no order yet into one; returns
// the ids of orders that changed (for matching).
async function groupMessages(prisma, userId) {
  // Repair first: an email that is no longer an order email, or whose store
  // order number now points at another order, leaves its order.
  const grouped = await prisma.emailMessage.findMany({
    where: { user_id: userId, order_id: { not: null } },
    select: { id: true, status: true, merchant: true, order_number: true, order_id: true },
  });
  const keys = new Map((await prisma.emailOrder.findMany({
    where: { user_id: userId, id: { in: [...new Set(grouped.map((m) => m.order_id))] } },
    select: { id: true, key: true },
  })).map((o) => [o.id, o.key]));
  const misplaced = grouped.filter((m) => m.status !== 'extracted'
    || (m.order_number && !CARRIERS.has(m.merchant) && `${m.merchant}:${m.order_number}` !== keys.get(m.order_id)));
  const emptied = new Set(misplaced.map((m) => m.order_id));
  if (misplaced.length) await prisma.emailMessage.updateMany({ where: { id: { in: misplaced.map((m) => m.id) } }, data: { order_id: null } });

  const loose = await prisma.emailMessage.findMany({
    where: { user_id: userId, status: 'extracted', order_id: null, NOT: { kind: 'tax_form' } },
    orderBy: { sent_at: 'asc' },
    take: 1000,
  });
  const touched = new Set();
  for (const m of loose) {
    let order = null;
    // A tracking-only email joins a store order that already has that number.
    if (!(m.order_number && !CARRIERS.has(m.merchant)) && m.tracking_numbers?.length) {
      order = await prisma.emailOrder.findFirst({
        where: { user_id: userId, tracking_numbers: { hasSome: m.tracking_numbers }, NOT: { key: { startsWith: 'track:' } } },
      });
    }
    if (!order) {
      const key = keyFor(m);
      order = await prisma.emailOrder.upsert({
        where: { user_id_key: { user_id: userId, key } },
        create: { user_id: userId, key, merchant: m.merchant, order_number: m.order_number, type: 'purchase', status: m.kind || 'other' },
        update: {},
      });
    }
    await prisma.emailMessage.update({ where: { id: m.id }, data: { order_id: order.id } });
    touched.add(order.id);
  }
  // Orders the repair took emails from: worked out again, or removed when empty.
  for (const id of emptied) if (!touched.has(id) && await recompute(prisma, id)) touched.add(id);

  // A store order that now knows a tracking number takes over the carrier
  // emails grouped under that number.
  for (const id of touched) {
    const order = await recompute(prisma, id);
    if (!order || order.key.startsWith('track:') || !order.tracking_numbers.length) continue;
    const strays = await prisma.emailOrder.findMany({
      where: { user_id: userId, key: { in: order.tracking_numbers.map((t) => `track:${t}`) } },
      select: { id: true },
    });
    for (const stray of strays) {
      await prisma.emailMessage.updateMany({ where: { order_id: stray.id }, data: { order_id: order.id } });
      await prisma.emailOrder.delete({ where: { id: stray.id } });
      touched.delete(stray.id);
    }
    if (strays.length) await recompute(prisma, order.id);
  }
  return [...touched];
}

module.exports = { groupMessages, summarize, recompute, keyFor, RANK, CARRIERS };
