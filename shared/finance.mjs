// Current product convention: batch overhead, gift cards, and snapshotted
// transaction cashback are allocated by units. Legacy purchases without a
// snapshot continue to fall back to the current stored card configuration.
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
// Deliberate copy of profit-tracker-api/services/statusTransitions.js
// EXCLUDED_FROM_FINANCIALS: this module is isomorphic (the Vite frontend imports
// it for live previews) and so cannot require a CommonJS backend service. The
// two are pinned together by profit-tracker-api/test/statusFinancialExclusion.test.mjs.
const EXCLUDED_FROM_FINANCIALS = ['CANCELLED', 'RETURNED', 'DISPUTED'];
export const isExcludedFromFinancials = status => EXCLUDED_FROM_FINANCIALS.includes(String(status || '').toUpperCase());
// Both status columns are checked, matching services/decimalFinance.js exactly:
// the new status-workflow actions write workflow_status, the legacy status
// dropdown still writes `status`, and a sale excluded by either must not count.
export const isRealizedSale = sale => !isExcludedFromFinancials(sale.workflow_status) && !isExcludedFromFinancials(sale.status);
// What the purchase cost before any refund -- the amount on the receipt and
// the amount the card was originally charged.
export function grossBatchCost(inventory = {}) {
  return number(inventory.unit_purchase_cost) * number(inventory.qty_purchased)
    + number(inventory.sales_tax) + number(inventory.shipping_cost_inbound)
    + number(inventory.fees) - number(inventory.gift_card_amount);
}
// Refunds from the store (refunded_amount, the running total of the purchase's
// Refund rows) lower what the batch cost; units sent back (refunded_qty) leave
// the batch, so the remaining cost is spread over the units actually kept.
export function batchCost(inventory = {}) {
  return grossBatchCost(inventory) - number(inventory.refunded_amount);
}
export const keptQuantity = (inventory = {}) => number(inventory.qty_purchased) - number(inventory.refunded_qty);
export function allocatedCost(inventory = {}, quantity = 0) {
  const kept = keptQuantity(inventory);
  return kept > 0 ? batchCost(inventory) * number(quantity) / kept : 0;
}
export function effectiveCashbackRate(inventory = {}, today = new Date()) {
  if (inventory.cashback_rate !== null && inventory.cashback_rate !== undefined) {
    return Math.max(0, number(inventory.cashback_rate));
  }
  const card = inventory.payment_method;
  if (!card) return 0;
  let rates = card.category_rates;
  if (typeof rates === 'string') { try { rates = JSON.parse(rates); } catch { rates = []; } }
  const vendor = (inventory.vendor?.name || '').trim().toLowerCase();
  if (vendor && Array.isArray(rates)) {
    const match = rates.find(rate => {
      const store = typeof rate?.store === 'string' ? rate.store.trim().toLowerCase() : '';
      if (!store || !Number.isFinite(Number(rate.rate)) || number(rate.rate) < 0) return false;
      if (rate.expires && (!Number.isFinite(Date.parse(rate.expires)) || new Date(rate.expires) < today)) return false;
      return vendor.includes(store) || store.includes(vendor);
    });
    if (match) return number(match.rate);
  }
  return Math.max(0, number(card.default_cashback_rate));
}
export function inventoryCashback(inventory = {}, rate = effectiveCashbackRate(inventory)) {
  if (inventory.cashback_rate !== null && inventory.cashback_rate !== undefined) {
    // A snapshot is the cashback on the full charge; a refund claws back its share.
    const gross = grossBatchCost(inventory);
    const earned = Math.max(0, number(inventory.cashback_earned));
    return gross > 0 ? earned * Math.max(0, batchCost(inventory)) / gross : earned;
  }
  return batchCost(inventory) * number(rate) / 100;
}
export function allocatedCashback(inventory = {}, quantity = 0, rate = effectiveCashbackRate(inventory)) {
  const kept = keptQuantity(inventory);
  return kept > 0 ? inventoryCashback(inventory, rate) * number(quantity) / kept : 0;
}
// Units of a sale the buyer did not send back. Returned units are back in
// stock, so their cost belongs to inventory again, not to this sale.
export const keptSaleQuantity = (sale = {}) => number(sale.quantity) - number(sale.refunded_qty);
export function saleEconomics(inventory = {}, sale = {}, rate = effectiveCashbackRate(inventory)) {
  const kept = keptSaleQuantity(sale);
  const cost = allocatedCost(inventory, kept);
  // Refunds to the buyer come off revenue; fees and the label stay as costs.
  const revenue = number(sale.unit_price) * number(sale.quantity) - number(sale.commission_fee) - number(sale.sale_shipping)
    - number(sale.refunded_amount);
  const cashback = allocatedCashback(inventory, kept, rate);
  const grossProfit = revenue - cost;
  return { cost, revenue, cashback, grossProfit, netProfit: grossProfit + cashback };
}
export function realizedSummary(inventory = {}, sales = [], rate = effectiveCashbackRate(inventory)) {
  return sales.filter(isRealizedSale).reduce((totals, sale) => {
    const economics = saleEconomics(inventory, sale, rate);
    for (const key of Object.keys(totals)) totals[key] += economics[key];
    return totals;
  }, { cost: 0, revenue: 0, cashback: 0, grossProfit: 0, netProfit: 0 });
}
