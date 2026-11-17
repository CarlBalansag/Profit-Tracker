// The rules for refunds on purchases (money back from the store) and on sales
// (money back to a buyer), shared by the app's routes/refunds.js and the AI
// assistant's tools in routes/mcp.js. Each refund is its own row; the owning
// Inventory/Sales row keeps running totals (refunded_amount, refunded_qty) that
// the shared money formulas read. Every write changes the refund row, those
// totals and stock in one transaction, guarded on the values it read, so a
// concurrent edit or a double-submit can never leave them out of step.
const prisma = require('../prisma');
const { decimal, grossBatchCost, isRealizedSale } = require('./decimalFinance');
const { withExactFields, MAPPINGS } = require('./decimalRead');
const { unitsHeld } = require('./statusTransitions');
const activityLog = require('./activityLog');

const requestError = (status, message) => Object.assign(new Error(message), { status });
const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};
const toJson = (refund) => refund && ({ ...refund, amount: Number(refund.amount) });
const money = (value) => decimal(value || 0).toFixed(2);
const EXCLUDED_SALE_MESSAGE = "This sale is cancelled, returned or disputed, so it no longer counts toward your totals and its refunds can't be changed.";

async function listRefunds(userId, { inventory_id, sale_id }) {
  if (!inventory_id === !sale_id) throw requestError(400, 'Pass exactly one of inventory_id or sale_id');
  const refunds = await prisma.refund.findMany({
    where: { user_id: userId, ...(inventory_id ? { inventory_id } : { sale_id }) },
    orderBy: { date: 'desc' },
  });
  return refunds.map(toJson);
}

// `options` -- { source, revertsId }: where the write came from ('web' /
// 'assistant') and, for an Undo, the activity entry it reverses. Every write
// logs one activity entry in its own transaction; its id comes back as
// `activity_id` so the app can offer Undo right away.
async function recordRefund(userId, { inventory_id, sale_id, amount: rawAmount, quantity: rawQuantity, date: rawDate, note }, options = {}) {
  if (!inventory_id === !sale_id) throw requestError(400, 'A refund belongs to exactly one purchase or one sale');
  const amount = decimal(rawAmount || 0);
  const quantity = Number(rawQuantity || 0);
  if (amount.isZero() && quantity === 0) throw requestError(400, 'Enter a refund amount or the number of units returned');
  const date = parseLocalDate(rawDate) || new Date();
  const refundData = { user_id: userId, amount: amount.toFixed(2), quantity, date, note: note || null };
  const { refund: created, activity } = inventory_id
    ? await refundPurchase(userId, inventory_id, amount, quantity, refundData, options)
    : await refundSale(userId, sale_id, amount, quantity, refundData, options);
  return { ...toJson(created), activity_id: activity.id };
}

async function refundPurchase(userId, inventoryId, amount, quantity, refundData, options) {
  const raw = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!raw || raw.user_id !== userId) throw requestError(404, 'Purchase not found or access denied');
  const inv = withExactFields(raw, MAPPINGS.inventory);
  if (quantity > inv.qty_on_hand) {
    throw requestError(400, `Only ${inv.qty_on_hand} unit${inv.qty_on_hand === 1 ? ' is' : 's are'} in stock to send back; sold units can't be returned to the store`);
  }
  const gross = grossBatchCost(inv);
  const refunded = decimal(inv.refunded_amount || 0);
  if (refunded.plus(amount).greaterThan(gross)) {
    throw requestError(400, `Refunds can't add up to more than the purchase cost ($${money(gross)}; $${money(refunded)} already refunded)`);
  }
  return prisma.$transaction(async (tx) => {
    const claim = await tx.inventory.updateMany({
      where: { id: inventoryId, user_id: userId, qty_on_hand: inv.qty_on_hand, refunded_qty: inv.refunded_qty || 0, refunded_amount: raw.refunded_amount ?? 0 },
      data: { qty_on_hand: { decrement: quantity }, refunded_qty: { increment: quantity }, refunded_amount: { increment: amount.toFixed(2) } },
    });
    if (claim.count !== 1) throw requestError(409, 'Purchase changed while saving. Reload and retry.');
    const refund = await tx.refund.create({ data: { ...refundData, inventory_id: inventoryId } });
    const activity = await activityLog.logRefund(tx, userId, 'refund.add', refund, { ...options, productName: inv.product_name });
    return { refund, activity };
  });
}

async function refundSale(userId, saleId, amount, quantity, refundData, options) {
  const raw = await prisma.sales.findUnique({ where: { id: saleId }, include: { inventory: true } });
  if (!raw || raw.inventory?.user_id !== userId) throw requestError(404, 'Sale not found or access denied');
  if (!isRealizedSale(raw)) throw requestError(409, EXCLUDED_SALE_MESSAGE);
  const sale = withExactFields(raw, MAPPINGS.sales);
  // Units a cancel/void/return action already restored can't come back again.
  const returnable = Math.max(unitsHeld(sale), 0);
  if (quantity > returnable) {
    throw requestError(400, `Only ${returnable} unit${returnable === 1 ? '' : 's'} of this sale can still be returned`);
  }
  const salePrice = decimal(sale.unit_price || 0).times(sale.quantity);
  const refunded = decimal(sale.refunded_amount || 0);
  if (refunded.plus(amount).greaterThan(salePrice)) {
    throw requestError(400, `Refunds can't add up to more than the sale price ($${money(salePrice)}; $${money(refunded)} already refunded)`);
  }
  return prisma.$transaction(async (tx) => {
    // Inventory before sale: the same lock order as routes/sales.js.
    const stock = await tx.inventory.updateMany({
      where: { id: sale.inventory_id, user_id: userId },
      data: { qty_on_hand: { increment: quantity } },
    });
    if (stock.count !== 1) throw requestError(404, 'Purchase not found or access denied');
    const claim = await tx.sales.updateMany({
      where: {
        id: saleId, quantity: sale.quantity, refunded_qty: sale.refunded_qty || 0, refunded_amount: raw.refunded_amount ?? 0,
        ...(raw.restored_qty !== undefined ? { restored_qty: raw.restored_qty } : {}),
        inventory: { user_id: userId },
      },
      data: { refunded_qty: { increment: quantity }, refunded_amount: { increment: amount.toFixed(2) } },
    });
    if (claim.count !== 1) throw requestError(409, 'Sale changed while saving. Reload and retry.');
    const refund = await tx.refund.create({ data: { ...refundData, sale_id: saleId } });
    const activity = await activityLog.logRefund(tx, userId, 'refund.add', refund, { ...options, productName: raw.inventory?.product_name ?? null });
    return { refund, activity };
  });
}

// Undoes a refund exactly: totals and stock go back. Returns the removed
// refund with the `activity_id` of the entry that logged it.
async function removeRefund(userId, refundId, options = {}) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { sale: { include: { inventory: true } }, inventory: true } });
  if (!refund || refund.user_id !== userId) throw requestError(404, 'Refund not found');
  const amount = decimal(refund.amount || 0).toFixed(2);
  const quantity = refund.quantity || 0;

  const activity = await prisma.$transaction(async (tx) => {
    if (refund.inventory_id) {
      const claim = await tx.inventory.updateMany({
        where: { id: refund.inventory_id, user_id: userId, refunded_qty: { gte: quantity }, refunded_amount: { gte: amount } },
        data: { qty_on_hand: { increment: quantity }, refunded_qty: { decrement: quantity }, refunded_amount: { decrement: amount } },
      });
      if (claim.count !== 1) throw requestError(409, 'Purchase changed while saving. Reload and retry.');
    } else {
      if (!refund.sale || !isRealizedSale(refund.sale)) throw requestError(409, EXCLUDED_SALE_MESSAGE);
      // Units the buyer sent back went into stock; if they've been sold
      // again they can't be taken back out.
      const stock = await tx.inventory.updateMany({
        where: { id: refund.sale.inventory_id, user_id: userId, qty_on_hand: { gte: quantity } },
        data: { qty_on_hand: { decrement: quantity } },
      });
      if (stock.count !== 1) throw requestError(409, 'The returned units are no longer in stock (sold again?), so this refund can\'t be removed.');
      const claim = await tx.sales.updateMany({
        where: { id: refund.sale_id, refunded_qty: { gte: quantity }, refunded_amount: { gte: amount } },
        data: { refunded_qty: { decrement: quantity }, refunded_amount: { decrement: amount } },
      });
      if (claim.count !== 1) throw requestError(409, 'Sale changed while saving. Reload and retry.');
    }
    const removed = await tx.refund.deleteMany({ where: { id: refund.id, user_id: userId } });
    if (removed.count !== 1) throw requestError(409, 'Refund was already removed.');
    const productName = refund.inventory?.product_name ?? refund.sale?.inventory?.product_name ?? null;
    return activityLog.logRefund(tx, userId, 'refund.remove', refund, { ...options, productName });
  });
  return { ...toJson(refund), activity_id: activity.id };
}

// A full refund of everything still refundable on one purchase or sale -- the
// same numbers as the website's "Returning everything" prefill
// (profit-tracker-app/src/utils/refundPrefill.js; keep the two in step):
//   purchase -> each unit still in stock, at its price plus its share of the
//               sales tax (what a store gives back; shipping and fees stay a cost)
//   sale     -> each unit the buyer still holds, at the price they paid
// capped at what is left to refund. keep: the units stay where they are (you
// keep them, or the buyer does), so the refund moves no stock.
// Returns { amount, quantity, units } or throws when nothing can be refunded.
async function fullRefund(userId, { inventory_id, sale_id }, { keep = false } = {}) {
  const round2 = (v) => Math.round(v * 100) / 100;
  const num = (v) => Number(v) || 0;
  let unitPrice;
  let units;
  let ceiling;
  if (inventory_id) {
    const raw = await prisma.inventory.findUnique({ where: { id: inventory_id } });
    if (!raw || raw.user_id !== userId) throw requestError(404, 'Purchase not found or access denied');
    const inv = withExactFields(raw, MAPPINGS.inventory);
    unitPrice = round2(num(inv.unit_purchase_cost) + num(inv.sales_tax) / (num(inv.qty_purchased) || 1));
    units = Math.max(0, num(inv.qty_on_hand));
    ceiling = num(grossBatchCost(inv)) - num(raw.refunded_amount);
  } else {
    const raw = await prisma.sales.findUnique({ where: { id: sale_id }, include: { inventory: true } });
    if (!raw || raw.inventory?.user_id !== userId) throw requestError(404, 'Sale not found or access denied');
    const sale = withExactFields(raw, MAPPINGS.sales);
    unitPrice = round2(num(sale.unit_price));
    units = Math.max(0, unitsHeld(sale));
    ceiling = num(sale.unit_price) * num(sale.quantity) - num(raw.refunded_amount);
  }
  if (units < 1) {
    throw requestError(400, inventory_id
      ? 'No units of this purchase are still in stock to send back -- give an amount instead'
      : 'No units of this sale can still be returned -- give an amount instead');
  }
  const amount = Math.min(round2(unitPrice * units), Math.max(0, round2(ceiling)));
  return { amount, quantity: keep ? 0 : units, units };
}

module.exports = { listRefunds, recordRefund, removeRefund, fullRefund };
