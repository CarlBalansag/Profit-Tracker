// Current product convention: batch overhead, gift cards, and snapshotted
// transaction cashback are allocated by units. Legacy purchases without a
// snapshot continue to fall back to the current stored card configuration.
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
// Deliberate copy of selvora-api/services/statusTransitions.js
// EXCLUDED_FROM_FINANCIALS: this module is isomorphic (the Vite frontend imports
// it for live previews) and so cannot require a CommonJS backend service. The
// two are pinned together by selvora-api/test/statusFinancialExclusion.test.mjs.
const EXCLUDED_FROM_FINANCIALS = ['CANCELLED', 'RETURNED', 'DISPUTED'];
const isExcludedFromFinancials = status => EXCLUDED_FROM_FINANCIALS.includes(String(status || '').toUpperCase());
// Both status columns are checked, matching services/decimalFinance.js exactly:
// the new status-workflow actions write workflow_status, the legacy status
// dropdown still writes `status`, and a sale excluded by either must not count.
export const isRealizedSale = sale => !isExcludedFromFinancials(sale.workflow_status) && !isExcludedFromFinancials(sale.status);
export function batchCost(inventory = {}) {
  return number(inventory.unit_purchase_cost) * number(inventory.qty_purchased)
    + number(inventory.sales_tax) + number(inventory.shipping_cost_inbound)
    + number(inventory.fees) - number(inventory.gift_card_amount);
}
export function allocatedCost(inventory = {}, quantity = 0) {
  const purchased = number(inventory.qty_purchased);
  return purchased > 0 ? batchCost(inventory) * number(quantity) / purchased : 0;
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
    return Math.max(0, number(inventory.cashback_earned));
  }
  return batchCost(inventory) * number(rate) / 100;
}
export function allocatedCashback(inventory = {}, quantity = 0, rate = effectiveCashbackRate(inventory)) {
  const purchased = number(inventory.qty_purchased);
  return purchased > 0 ? inventoryCashback(inventory, rate) * number(quantity) / purchased : 0;
}
export function saleEconomics(inventory = {}, sale = {}, rate = effectiveCashbackRate(inventory)) {
  const cost = allocatedCost(inventory, sale.quantity);
  const revenue = number(sale.unit_price) * number(sale.quantity) - number(sale.commission_fee) - number(sale.sale_shipping);
  const cashback = allocatedCashback(inventory, sale.quantity, rate);
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
