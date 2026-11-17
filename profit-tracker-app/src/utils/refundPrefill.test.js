import { describe, expect, it } from 'vitest';
import { fullRefundPrefill, refundUnitPrice } from './refundPrefill';

const purchase = { unit_purchase_cost: 249.99, qty_purchased: 2, sales_tax: 40, shipping_cost_inbound: 10, fees: 0, gift_card_amount: 0, refunded_amount: 0 };
const sale = { unit_price: 300, quantity: 2, refunded_amount: 0 };

describe('refundUnitPrice', () => {
  it('counts item price plus its share of the tax for a purchase, not shipping', () => {
    expect(refundUnitPrice('purchase', purchase)).toBe(269.99);
  });
  it('uses the price the buyer paid for a sale', () => {
    expect(refundUnitPrice('sale', sale)).toBe(300);
  });
  it('treats missing numbers as zero instead of NaN', () => {
    expect(refundUnitPrice('purchase', {})).toBe(0);
  });
});

describe('fullRefundPrefill', () => {
  it('returns every unit for the full item + tax price', () => {
    expect(fullRefundPrefill('purchase', purchase, 2)).toEqual({ amount: '539.98', quantity: '2' });
  });
  it('covers only the units still on hand when some were sold', () => {
    expect(fullRefundPrefill('purchase', purchase, 1)).toEqual({ amount: '269.99', quantity: '1' });
  });
  it('keeps the units in stock when the item is kept', () => {
    expect(fullRefundPrefill('purchase', purchase, 2, { keep: true })).toEqual({ amount: '539.98', quantity: '0' });
  });
  it('never suggests more than is still refundable', () => {
    expect(fullRefundPrefill('purchase', { ...purchase, refunded_amount: 500 }, 2).amount).toBe('49.98');
    expect(fullRefundPrefill('sale', { ...sale, refunded_amount: 550 }, 2).amount).toBe('50.00');
  });
  it('fills a sale with the units the buyer still holds, or none if they kept them', () => {
    expect(fullRefundPrefill('sale', sale, 2)).toEqual({ amount: '600.00', quantity: '2' });
    expect(fullRefundPrefill('sale', sale, 2, { keep: true })).toEqual({ amount: '600.00', quantity: '0' });
  });
  it('fills nothing when no units can come back', () => {
    expect(fullRefundPrefill('purchase', purchase, 0)).toEqual({ amount: '0.00', quantity: '0' });
  });
});
