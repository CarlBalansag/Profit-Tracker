// Task 8 read cutover: substitutes each Decimal column's exact value into its
// paired Float field's *name* in API responses, and drops the raw `_decimal`
// key. The response shape (field names, plain-number values) is unchanged --
// only the precision of the value improves -- so no frontend code needs to
// change. The Float columns themselves are untouched in the database; the
// Task 3 sync triggers keep `_decimal` current on every write regardless of
// which route performed it, so this is safe for every existing row.
function toExactNumber(value) {
  if (value === null || value === undefined) return value;
  return typeof value.toNumber === 'function' ? value.toNumber() : Number(value);
}

// mapping: { floatFieldName: 'decimalFieldName' }
// A goal's unitsSold target intentionally has a null decimal mirror (it's a
// count, not money) -- toExactNumber passes null through unchanged, so the
// original (integer) float value is correctly left in place for those.
function withExactFields(record, mapping) {
  if (!record) return record;
  const result = { ...record };
  for (const [floatField, decimalField] of Object.entries(mapping)) {
    if (!(decimalField in result)) continue;
    const exact = toExactNumber(result[decimalField]);
    if (exact !== null && exact !== undefined) result[floatField] = exact;
    delete result[decimalField];
  }
  return result;
}

const MAPPINGS = {
  inventory: {
    unit_purchase_cost: 'unit_purchase_cost_decimal',
    sales_tax: 'sales_tax_decimal',
    shipping_cost_inbound: 'shipping_cost_inbound_decimal',
    fees: 'fees_decimal',
    cashback_earned: 'cashback_earned_decimal',
    cashback_rate: 'cashback_rate_decimal',
    gift_card_amount: 'gift_card_amount_decimal',
  },
  sales: {
    unit_price: 'unit_price_decimal',
    commission_fee: 'commission_fee_decimal',
    sale_shipping: 'sale_shipping_decimal',
    sale_tax_collected: 'sale_tax_collected_decimal',
  },
  platform: {
    fee_pct: 'fee_pct_decimal',
  },
  paymentMethod: {
    default_cashback_rate: 'default_cashback_rate_decimal',
    credit_limit: 'credit_limit_decimal',
    min_payment_pct: 'min_payment_pct_decimal',
  },
  expense: {
    amount: 'amount_decimal',
  },
  recurringExpense: {
    amount: 'amount_decimal',
  },
  goal: {
    target_7d: 'target_7d_decimal',
    target_30d: 'target_30d_decimal',
    target_ytd: 'target_ytd_decimal',
  },
  ebayPriceCache: {
    last_sold_price: 'last_sold_price_decimal',
  },
};

// Applies a model's mapping to every record in an array.
const withExactList = (records, mapping) => records.map(r => withExactFields(r, mapping));

module.exports = { toExactNumber, withExactFields, withExactList, MAPPINGS };
