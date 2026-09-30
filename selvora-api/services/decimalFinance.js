// Backend-only exact-decimal mirror of shared/finance.mjs, for routes that
// aggregate money across many rows (analytics, credit card, receipts).
// shared/finance.mjs stays float-based because it's isomorphic (the frontend
// imports it too, for live previews) and can't depend on Prisma.Decimal.
//
// Aggregating in Decimal and converting to Number only once, at the JSON
// response boundary, is what Task 7 means by "exact by construction": every
// number a client receives is already rounded correctly, with no float
// accumulation error from summing many rows along the way.
const { Decimal, decimal } = require('./money');

const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isRealizedSale = sale => !['CANCELLED', 'RETURNED', 'DISPUTED'].includes((sale.status || '').toUpperCase());

function batchCost(inventory = {}) {
  return decimal(inventory.unit_purchase_cost || 0)
    .times(number(inventory.qty_purchased))
    .plus(decimal(inventory.sales_tax || 0))
    .plus(decimal(inventory.shipping_cost_inbound || 0))
    .plus(decimal(inventory.fees || 0))
    .minus(decimal(inventory.gift_card_amount || 0));
}

function allocatedCost(inventory = {}, quantity = 0) {
  const purchased = number(inventory.qty_purchased);
  return purchased > 0 ? batchCost(inventory).times(number(quantity)).div(purchased) : new Decimal(0);
}

// Rate lookup is unchanged from shared/finance.mjs -- a single percentage
// value doesn't accumulate float error the way a running sum does, so this
// stays a plain number rather than a Decimal.
function effectiveCashbackRate(inventory = {}, today = new Date()) {
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

function saleEconomics(inventory = {}, sale = {}, rate = effectiveCashbackRate(inventory)) {
  const cost = allocatedCost(inventory, sale.quantity);
  const revenue = decimal(sale.unit_price || 0).times(number(sale.quantity))
    .minus(decimal(sale.commission_fee || 0))
    .minus(decimal(sale.sale_shipping || 0));
  const cashback = cost.times(number(rate)).div(100);
  const grossProfit = revenue.minus(cost);
  return { cost, revenue, cashback, grossProfit, netProfit: grossProfit.plus(cashback) };
}

module.exports = { Decimal, decimal, isRealizedSale, batchCost, allocatedCost, effectiveCashbackRate, saleEconomics };
