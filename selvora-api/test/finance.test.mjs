import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { allocatedCost, batchCost, effectiveCashbackRate, realizedSummary, saleEconomics } = await createRequire(import.meta.url)('../services/finance.js');
const purchase = { unit_purchase_cost: 100, qty_purchased: 2, sales_tax: 10,
  shipping_cost_inbound: 6, fees: 4, gift_card_amount: 20,
  payment_method: { default_cashback_rate: 2 }, vendor: { name: 'Test Store' } };
const sale = { quantity: 1, unit_price: 140, commission_fee: 10, sale_shipping: 8, status: 'SOLD' };
describe('shared financial conventions', () => {
  it('allocates every batch cost and cashback to partial sales', () => {
    expect(batchCost(purchase)).toBe(200);
    expect(saleEconomics(purchase, sale)).toEqual({ cost: 100, revenue: 122, cashback: 2, grossProfit: 22, netProfit: 24 });
    expect(allocatedCost(purchase, 1)).toBe(100);
  });
  it('sums split sales consistently and excludes cancelled, returned and disputed records', () => {
    const sales = [sale, { ...sale, unit_price: 160 }, ...['CANCELLED', 'RETURNED', 'DISPUTED'].map(status => ({ ...sale, status }))];
    expect(realizedSummary(purchase, sales)).toEqual({ cost: 200, revenue: 264, cashback: 4, grossProfit: 64, netProfit: 68 });
  });
  it('handles empty, optional, numeric-string and zero-quantity inputs without invalid numbers', () => {
    expect(batchCost()).toBe(0);
    expect(allocatedCost({ qty_purchased: 0 }, 1)).toBe(0);
    expect(realizedSummary(purchase, [])).toMatchObject({ cost: 0, netProfit: 0 });
    expect(batchCost({ unit_purchase_cost: '10', qty_purchased: '3' })).toBe(30);
    expect(saleEconomics({}, {})).toMatchObject({ cost: 0, netProfit: 0 });
  });
  it('uses the same stored cashback rates for parsed/raw data without preset fallback', () => {
    const rates = [{ store: 'Test', rate: 5, expires: '2027-01-01' }];
    const card = { ...purchase.payment_method, category_rates: rates };
    expect(effectiveCashbackRate({ ...purchase, payment_method: card }, new Date('2026-09-11'))).toBe(5);
    expect(effectiveCashbackRate({ ...purchase, payment_method: { ...card, category_rates: JSON.stringify(rates) } }, new Date('2026-09-11'))).toBe(5);
    expect(effectiveCashbackRate({ ...purchase, payment_method: card }, new Date('2027-02-01'))).toBe(2);
    expect(effectiveCashbackRate({ ...purchase, payment_method: { ...card, category_rates: '{bad' } })).toBe(2);
  });
  it('ignores malformed rates and does not mutate inputs', () => {
    const original = structuredClone(purchase);
    effectiveCashbackRate({ ...purchase, payment_method: { default_cashback_rate: 2, category_rates: [null, { store: '', rate: 8 }, { store: 'Test', rate: -1 }] } });
    saleEconomics(purchase, sale);
    expect(purchase).toEqual(original);
  });
});
