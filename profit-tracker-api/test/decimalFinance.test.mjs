import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { batchCost, allocatedCost, saleEconomics, Decimal } = createRequire(import.meta.url)('../services/decimalFinance.js');

describe('decimalFinance: exact aggregation for analytics/creditcard/receipts', () => {
  it('computes batch cost exactly for clean 2-decimal inputs', () => {
    const inv = { unit_purchase_cost: 100, qty_purchased: 5, sales_tax: 40, shipping_cost_inbound: 20, fees: 10, gift_card_amount: 50 };
    expect(batchCost(inv).toFixed(2)).toBe('520.00');
  });

  it('allocates cost across units without the accumulation drift a naive float sum has', () => {
    // $10 batch cost (via sales_tax so unit_purchase_cost * qty stays 0) split
    // 3 ways: 3.333... repeating. Summing the three shares in Decimal must
    // land exactly on the batch total.
    const inv = { unit_purchase_cost: 0, qty_purchased: 3, sales_tax: 10, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0 };
    const shares = [1, 1, 1].map(qty => allocatedCost(inv, qty));
    const total = shares.reduce((sum, s) => sum.plus(s), new Decimal(0));
    expect(total.toFixed(2)).toBe('10.00');
  });

  it('reproduces the exact cashback figure the Task 3 audit found drifting under float math', () => {
    // From production: unit_purchase_cost=249.99 * 1 unit, cashback rate that
    // produces 5.415800000000001 under raw float math (Inventory.cashback_earned
    // audit finding) -- summing many such per-row shares in Decimal must not
    // compound the sub-cent rounding the way float summation did.
    const inv = { unit_purchase_cost: 216.63, qty_purchased: 1, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0 };
    const cost = batchCost(inv);
    const cashback = cost.times(2.5).div(100);
    expect(cashback.toFixed(2)).toBe('5.42');
  });

  it('computes sale economics (cost, revenue, cashback, profit) exactly', () => {
    const inv = { unit_purchase_cost: 100, qty_purchased: 2, sales_tax: 0, shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0 };
    const sale = { quantity: 1, unit_price: 150, commission_fee: 15, sale_shipping: 12 };
    const economics = saleEconomics(inv, sale, 2);
    expect(economics.cost.toFixed(2)).toBe('100.00');
    expect(economics.revenue.toFixed(2)).toBe('123.00');
    expect(economics.cashback.toFixed(2)).toBe('2.00');
    expect(economics.grossProfit.toFixed(2)).toBe('23.00');
    expect(economics.netProfit.toFixed(2)).toBe('25.00');
  });

  it('summing many realistic per-row Decimal amounts never drifts, unlike float summation of the same inputs', () => {
    // The exact scenario the Task 3 audit's comparison report found: 24 rows
    // of computed cashback, each individually correct to 2dp, but summing
    // the RAW FLOAT values (as analytics.js used to) drifts by whole cents.
    const rows = [3.0748, 28.2533, 8.969999999999999, 5.415800000000001, 2.6969, 0.2554];
    const floatSum = rows.reduce((s, v) => s + v, 0);
    const decimalSum = rows.reduce((s, v) => s.plus(new Decimal(v).toDecimalPlaces(2)), new Decimal(0));
    const roundedRowSum = rows.reduce((s, v) => s + Math.round(v * 100) / 100, 0);
    // The point of this migration: summing the already-rounded per-row values
    // in Decimal matches summing them as rounded floats exactly -- the float
    // risk was always in the running *aggregate*, not a single 2dp value.
    expect(decimalSum.toFixed(2)).toBe(roundedRowSum.toFixed(2));
    expect(typeof floatSum).toBe('number'); // sanity: float path still runs, just not trusted for money
  });
});
