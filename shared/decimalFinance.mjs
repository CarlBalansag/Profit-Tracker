export const isRealizedSale = sale => !['CANCELLED', 'RETURNED', 'DISPUTED'].includes((sale.status || '').toUpperCase());
export function createFinance(Decimal, { strict = false } = {}) {
  const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
  const value = input => { try { const result = new D(input ?? 0); return result.isFinite() ? result : new D(0); } catch { return new D(0); } };
  const field = (record, name, scale = 2) => value(record[`${name}_decimal`] ?? record[name]).toDecimalPlaces(scale);
  const numeric = input => {
    const result = value(input).toDecimalPlaces(2);
    if (strict && result.abs().greaterThan('999999999999.99')) throw new Error('Financial total exceeds the supported currency range.');
    return result.toNumber();
  };
  const sumMoney = (...amounts) => numeric(amounts.reduce((total, amount) => total.plus(value(amount)), new D(0)));
  const subtractMoney = (left, right) => numeric(value(left).minus(value(right)));
  const multiplyMoney = (left, right) => numeric(value(left).times(value(right)));
  const percentageMoney = (amount, rate) => numeric(value(amount).times(value(rate)).div(100));
  const allocateMoney = (total, quantity, units, offset = 0) => Number(units) > 0
    ? numeric(value(total).times(Number(offset) + Number(quantity)).div(units).toDecimalPlaces(2)
      .minus(value(total).times(offset).div(units).toDecimalPlaces(2))) : 0;
  const batchCost = (inventory = {}) => numeric(field(inventory, 'unit_purchase_cost').times(value(inventory.qty_purchased))
    .plus(field(inventory, 'sales_tax')).plus(field(inventory, 'shipping_cost_inbound'))
    .plus(field(inventory, 'fees')).minus(field(inventory, 'gift_card_amount')));
  const allocatedCost = (inventory = {}, quantity = 0, offset = Math.max(0, Number(inventory.qty_purchased || 0) - Number(quantity))) =>
    allocateMoney(batchCost(inventory), quantity, inventory.qty_purchased, offset);
  function effectiveCashbackRate(inventory = {}, today = new Date()) {
    const card = inventory.payment_method;
    if (!card) return 0;
    let rates = card.category_rates;
    if (typeof rates === 'string') { try { rates = JSON.parse(rates); } catch { rates = []; } }
    const vendor = (inventory.vendor?.name || '').trim().toLowerCase();
    if (vendor && Array.isArray(rates)) {
      const match = rates.find(rate => {
        const store = typeof rate?.store === 'string' ? rate.store.trim().toLowerCase() : '';
        if (!store || !Number.isFinite(Number(rate.rate)) || Number(rate.rate) < 0 || Number(rate.rate) > 100) return false;
        if (rate.expires && (!Number.isFinite(Date.parse(rate.expires)) || new Date(rate.expires) < today)) return false;
        return vendor.includes(store) || store.includes(vendor);
      });
      if (match) return value(match.rate).toDecimalPlaces(6).toNumber();
    }
    return Math.max(0, field(card, 'default_cashback_rate', 6).toNumber());
  }
  const batchCashback = (inventory, rate = effectiveCashbackRate(inventory)) => numeric(value(batchCost(inventory)).times(value(rate)).div(100));
  function saleOffset(inventory, sale) {
    const timestamp = input => Number.isFinite(new Date(input).getTime()) ? new Date(input).getTime() : 0;
    const ordered = [...inventory.sales || []].sort((left, right) => timestamp(left.sale_date) - timestamp(right.sale_date) || String(left.id || '').localeCompare(String(right.id || '')));
    const index = sale.id ? ordered.findIndex(item => item.id === sale.id) : -1;
    if (index >= 0) return ordered.slice(0, index).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return Math.max(0, Number(inventory.qty_purchased || 0) - Number(inventory.qty_on_hand ?? inventory.qty_purchased ?? 0));
  }
  function saleEconomics(inventory = {}, sale = {}, rate = effectiveCashbackRate(inventory)) {
    const offset = saleOffset(inventory, sale);
    const cost = allocatedCost(inventory, sale.quantity, offset);
    const revenue = numeric(field(sale, 'unit_price').times(value(sale.quantity)).minus(field(sale, 'commission_fee')).minus(field(sale, 'sale_shipping')));
    const cashback = allocateMoney(batchCashback(inventory, rate), sale.quantity, inventory.qty_purchased, offset);
    const grossProfit = subtractMoney(revenue, cost);
    return { cost, revenue, cashback, grossProfit, netProfit: sumMoney(grossProfit, cashback) };
  }
  function realizedSummary(inventory = {}, sales = [], rate = effectiveCashbackRate(inventory)) {
    return sales.filter(isRealizedSale).reduce((totals, sale) => {
      const economics = saleEconomics({ ...inventory, sales }, sale, rate);
      for (const key of Object.keys(totals)) totals[key] = sumMoney(totals[key], economics[key]);
      return totals;
    }, { cost: 0, revenue: 0, cashback: 0, grossProfit: 0, netProfit: 0 });
  }
  return { batchCost, allocatedCost, effectiveCashbackRate, saleEconomics, realizedSummary, isRealizedSale,
    sumMoney, subtractMoney, multiplyMoney, percentageMoney, allocateMoney, batchCashback, saleOffset };
}
