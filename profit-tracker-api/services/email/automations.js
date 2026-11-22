// What later emails do to records already linked to an order (E5), and the
// purchases made from order emails nobody entered. Every change goes through
// the same status actions and Activity log as a person's change, with Undo.
//   shipped   -> purchase gets its tracking number (Add Tracking)
//   delivered -> purchase marked delivered; blank return-by date filled
//   cancelled / refund -> a To-Do item; cancelling automatically is a
//                 separate switch, off by default (it changes stock)
const statusTransitions = require('../statusTransitions');
const activityLog = require('../activityLog');
const { trackChange } = activityLog;
const { carrierFor, nameMatches } = require('./match');
const { labelFor } = require('./rules');

// Days a store usually allows for returns, when the user hasn't set one on
// the vendor. Used only to fill a blank return-by date.
const RETURN_DAYS = { amazon: 30, walmart: 90, bestbuy: 15, target: 90, apple: 14, costco: 90, samsclub: 90, homedepot: 90, lowes: 90, gamestop: 30, nike: 60 };
const DAY = 86400000;

async function runAction(prisma, userId, row, action, payload) {
  if (!statusTransitions.isActionAllowed(row, 'inventory', action) && !(statusTransitions.SYSTEM_ACTION_FROM.inventory[action] || []).includes(row.receiving_status)) return false;
  await prisma.$transaction(async (tx) => {
    const fresh = await tx.inventory.findFirst({ where: { id: row.id, user_id: userId } });
    if (!fresh) return;
    const result = await statusTransitions.applyTransition(tx, 'inventory', fresh, action, { ...payload, user_id: userId });
    await activityLog.logStatus(tx, userId, 'inventory', fresh, result, { source: 'email' });
  });
  return true;
}

async function fillReturnBy(prisma, userId, rows, order) {
  const blanks = rows.filter((r) => !r.return_by_date);
  if (!blanks.length || !order.last_seen) return;
  await prisma.$transaction((tx) => trackChange(tx, userId, {
    action: 'edit', recordType: 'purchase', source: 'email', recordId: blanks[0].id,
    refs: async () => ({ inventory: blanks.map((r) => r.id) }),
  }, async () => {
    for (const r of blanks) {
      const days = r.vendor?.default_return_days ?? RETURN_DAYS[order.merchant];
      if (!days) continue;
      await tx.inventory.update({ where: { id: r.id }, data: { return_by_date: new Date(order.last_seen.getTime() + days * DAY) } });
    }
    return null;
  }));
}

// Applies each linked order's newest status once.
async function applyOrderUpdates(prisma, userId, settings) {
  const orders = await prisma.emailOrder.findMany({
    where: { user_id: userId, match_state: 'linked', type: 'purchase' },
    include: { matches: { where: { state: 'linked', record_type: 'purchase' } } },
    take: 500,
  });
  const summary = { tracking: 0, delivered: 0, cancelled: 0, attention: 0 };
  for (const order of orders.filter((o) => o.applied_status !== o.status)) {
    const ids = order.matches.flatMap((m) => m.record_ids);
    const rows = await prisma.inventory.findMany({ where: { id: { in: ids }, user_id: userId }, include: { vendor: { select: { default_return_days: true } } } });
    const tracking = order.tracking_numbers[0];
    try {
      if (settings.updateShipping && ['shipped', 'delivered'].includes(order.status) && tracking) {
        for (const r of rows.filter((x) => ['PRE_ORDER', 'PURCHASED'].includes(x.receiving_status))) {
          if (await runAction(prisma, userId, r, 'add_tracking', { tracking_number: r.tracking_number || tracking })) summary.tracking += 1;
        }
      }
      if (settings.updateShipping && order.status === 'delivered') {
        const fresh = await prisma.inventory.findMany({ where: { id: { in: ids }, user_id: userId } });
        for (const r of fresh.filter((x) => statusTransitions.SYSTEM_ACTION_FROM.inventory.mark_delivered.includes(x.receiving_status))) {
          if (await runAction(prisma, userId, r, 'mark_delivered', { delivered_at: order.last_seen })) summary.delivered += 1;
        }
      }
      if (settings.returnReminders && order.status === 'delivered') await fillReturnBy(prisma, userId, rows, order);

      let attention = null;
      if (order.status === 'cancelled') {
        const open = rows.filter((r) => !r.cancelled_at && statusTransitions.isActionAllowed(r, 'inventory', 'cancel'));
        if (settings.cancellations && open.length === rows.length && rows.length) {
          for (const r of open) if (await runAction(prisma, userId, r, 'cancel', {})) summary.cancelled += 1;
        } else if (rows.some((r) => !r.cancelled_at)) {
          attention = 'cancelled';
        }
      }
      if (['refund', 'return'].includes(order.status)) attention = 'refund';
      if (attention) summary.attention += 1;
      await prisma.emailOrder.update({ where: { id: order.id }, data: { applied_status: order.status, attention } });
    } catch (err) {
      // A record that changed under us (or a refused action) is left as is.
      console.error(`[email] update for order ${order.id} skipped: ${err?.status || err?.code || 'error'}`);
      await prisma.emailOrder.update({ where: { id: order.id }, data: { applied_status: order.status } });
    }
  }
  return summary;
}

const money = (v) => (v == null ? 0 : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

// One purchase per item in the email (or one for the whole order when the
// items couldn't be read). Tax and shipping are shared by item cost.
async function createPurchasesFromOrder(prisma, userId, order, { auto = false } = {}) {
  if (order.type !== 'purchase' || order.total == null || ['cancelled', 'refund'].includes(order.status)) return null;
  const existing = await prisma.emailMatch.findFirst({ where: { order_id: order.id, state: 'linked' } });
  if (existing) return null;
  const vendors = await prisma.platform.findMany({ where: { user_id: userId, type: 'Vendor' }, select: { id: true, name: true } });
  const vendor = vendors.find((v) => nameMatches(order.merchant, v.name) === true) || null;
  const last4 = (String(order.payment_hint || '').match(/(\d{4})$/) || [])[1];
  const card = last4 ? await prisma.paymentMethod.findFirst({ where: { user_id: userId, last4 }, select: { id: true } }) : null;

  const items = Array.isArray(order.items) ? order.items.filter((i) => i && i.name) : [];
  const tax = money(order.tax);
  const shipping = money(order.shipping);
  const lines = items.length
    ? items.map((i) => {
      const quantity = Math.max(1, Number(i.quantity) || 1);
      const lineTotal = i.total != null ? Number(i.total) : i.unit_price != null ? Number(i.unit_price) * quantity : null;
      return { name: String(i.name).slice(0, 200), quantity, lineTotal };
    })
    : [{ name: `${labelFor(order.merchant)} order${order.order_number ? ` ${order.order_number}` : ''}`, quantity: 1, lineTotal: money(order.subtotal ?? order.total) - (order.subtotal != null ? 0 : tax + shipping) }];
  // Lines without a price share what's left of the item cost evenly.
  const itemsCost = money(order.subtotal ?? (money(order.total) - tax - shipping + money(order.discount)));
  const known = lines.reduce((t, l) => t + (l.lineTotal || 0), 0);
  const unknown = lines.filter((l) => l.lineTotal == null);
  for (const l of unknown) l.lineTotal = Math.max(0, (itemsCost - known) / unknown.length);
  const base = lines.reduce((t, l) => t + l.lineTotal, 0) || 1;
  const discount = money(order.discount);

  const { result: created } = await prisma.$transaction((tx) => trackChange(tx, userId, {
    action: 'create', recordType: 'purchase', source: 'email',
    recordId: (made) => made?.[0]?.id,
    refs: async (_t, made) => ({ inventory: (made || []).map((r) => r.id) }),
  }, async () => {
    const out = [];
    for (const l of lines) {
      const share = l.lineTotal / base;
      const unit = round2((l.lineTotal - discount * share) / l.quantity);
      const lineTax = round2(tax * share);
      const lineShip = round2(shipping * share);
      out.push(await tx.inventory.create({ data: {
        user_id: userId, product_name: l.name, vendor_id: vendor?.id || null, payment_method_id: card?.id || null,
        purchase_date: order.first_seen || new Date(),
        unit_purchase_cost: unit, unit_purchase_cost_decimal: unit, qty_purchased: l.quantity, qty_on_hand: l.quantity,
        sales_tax: lineTax, sales_tax_decimal: lineTax, shipping_cost_inbound: lineShip, shipping_cost_inbound_decimal: lineShip,
        order_number: order.order_number, tracking_number: order.tracking_numbers[0] || null,
        carrier: order.tracking_numbers[0] ? carrierFor(order.tracking_numbers[0]) : null,
        receiving_status: order.tracking_numbers.length ? 'INBOUND' : 'PURCHASED',
        notes: 'Created from an order email',
      } }));
    }
    return out;
  }));
  await prisma.emailMatch.create({ data: {
    user_id: userId, order_id: order.id, record_type: 'purchase', record_ids: created.map((r) => r.id).sort(), score: 100, band: 'high',
    reasons: [{ code: 'created', text: auto ? 'Created automatically from the order email' : 'Created from this email', points: 100 }],
    state: 'linked', auto, decided_at: new Date(),
  } });
  await prisma.emailOrder.update({ where: { id: order.id }, data: { match_state: 'linked', applied_status: null } });
  return created;
}

// Automatic purchases wait a day after the first email, so a purchase the user
// enters themselves gets matched instead of copied.
async function createMissingPurchases(prisma, userId) {
  const orders = await prisma.emailOrder.findMany({
    where: { user_id: userId, type: 'purchase', match_state: 'unmatched', status: { notIn: ['cancelled', 'refund', 'return'] }, total: { not: null }, first_seen: { lte: new Date(Date.now() - DAY) } },
    take: 50,
  });
  let created = 0;
  for (const order of orders) if (await createPurchasesFromOrder(prisma, userId, order, { auto: true })) created += 1;
  return created;
}

module.exports = { applyOrderUpdates, createPurchasesFromOrder, createMissingPurchases, RETURN_DAYS };
