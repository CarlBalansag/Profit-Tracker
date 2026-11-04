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

async function recordRefund(userId, { inventory_id, sale_id, amount: rawAmount, quantity: rawQuantity, date: rawDate, note }) {
  if (!inventory_id === !sale_id) throw requestError(400, 'A refund belongs to exactly one purchase or one sale');
  const amount = decimal(rawAmount || 0);
  const quantity = Number(rawQuantity || 0);
  if (amount.isZero() && quantity === 0) throw requestError(400, 'Enter a refund amount or the number of units returned');
  const date = parseLocalDate(rawDate) || new Date();
  const refundData = { user_id: userId, amount: amount.toFixed(2), quantity, date, note: note || null };
  const created = inventory_id
    ? await refundPurchase(userId, inventory_id, amount, quantity, refundData)
    : await refundSale(userId, sale_id, amount, quantity, refundData);
  return toJson(created);
}

async function refundPurchase(userId, inventoryId, amount, quantity, refundData) {
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
    return tx.refund.create({ data: { ...refundData, inventory_id: inventoryId } });
  });
}

async function refundSale(userId, saleId, amount, quantity, refundData) {
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
    return tx.refund.create({ data: { ...refundData, sale_id: saleId } });
  });
}

// Undoes a refund exactly: totals and stock go back.
async function removeRefund(userId, refundId) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { sale: true } });
  if (!refund || refund.user_id !== userId) throw requestError(404, 'Refund not found');
  const amount = decimal(refund.amount || 0).toFixed(2);
  const quantity = refund.quantity || 0;

  await prisma.$transaction(async (tx) => {
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
  });
  return toJson(refund);
}

module.exports = { listRefunds, recordRefund, removeRefund };
