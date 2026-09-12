const fields = {
  Inventory: { money: ['unit_purchase_cost', 'sales_tax', 'shipping_cost_inbound', 'fees', 'cashback_earned', 'gift_card_amount'] },
  Sales: { money: ['unit_price', 'commission_fee', 'sale_shipping', 'sale_tax_collected'] },
  Platform: { rate: ['fee_pct'] },
  PaymentMethod: { money: ['credit_limit'], rate: ['default_cashback_rate', 'min_payment_pct'] },
  Expense: { money: ['amount'] }, RecurringExpense: { money: ['amount'] },
  Invoice: { money: ['total_amount'] }, Goal: { money: ['target_7d', 'target_30d', 'target_ytd'] },
  EbayPriceCache: { money: ['last_sold_price'], table: 'ebay_price_cache' },
};
module.exports = fields;
