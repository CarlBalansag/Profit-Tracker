export const moneyKeys = new Set(['unit_purchase_cost', 'sales_tax', 'shipping_cost_inbound', 'fees', 'cashback_earned', 'gift_card_amount', 'unit_price', 'commission_fee', 'sale_shipping', 'sale_tax_collected', 'credit_limit', 'amount', 'total_amount', 'last_sold_price', 'target_7d', 'target_30d', 'target_ytd', 'totalCost', 'soldCost', 'totalRevenue', 'totalCashback', 'grossProfit', 'profit', 'commissionFees', 'saleShipping', 'totalTax', 'inventoryValue', 'cashback', 'netProfit', 'cost', 'revenue', 'commission', 'totalSpend', 'cashbackEarned', 'totalLosses', 'netPnl', 'lossAmount', 'lossToRedeem', 'cashbackToRedeem', 'cashbackToKeep', 'uncoveredLoss', 'amountToPay', 'totalCashbackEarned', 'totalCashbackToRedeem', 'totalCashbackToKeep', 'totalAmountToPay', 'totalUncoveredLoss']);
export const rateKeys = new Set(['fee_pct', 'default_cashback_rate', 'min_payment_pct', 'cashbackRate', 'avgCashbackRate', 'roi', 'rate']);
moneyKeys.add('sale');
export function displayCurrencyJSON(input) {
  if (Array.isArray(input)) return input.map(displayCurrencyJSON);
  if (!input || typeof input !== 'object') return input;
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key,
    (moneyKeys.has(key) || rateKeys.has(key)) && typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value)
      ? Number(value) : displayCurrencyJSON(value)]));
}
