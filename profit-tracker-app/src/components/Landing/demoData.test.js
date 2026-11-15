import { describe, expect, it } from 'vitest';
import {
  applyAction, calendarEvents, cardSummary, cashFlow, createSeed, formatMoney, itemProfit, monthlySeries,
  parseDollars, platformFee, totals,
} from './demoData';

const TODAY = new Date(2026, 10, 15); // Nov 15 2026

describe('demo money parsing', () => {
  it('accepts plain, decimal and formatted amounts as cents', () => {
    expect(parseDollars('42')).toBe(4200);
    expect(parseDollars('42.5')).toBe(4250);
    expect(parseDollars('$1,200.99')).toBe(120099);
    expect(parseDollars(' 0.01 ')).toBe(1);
  });

  it('rejects empty, zero, negative, text, too many decimals and huge amounts', () => {
    for (const bad of ['', '0', '0.00', '-5', 'abc', '1.234', '1e5', '100000.01', null, undefined]) {
      expect(parseDollars(bad)).toBeNull();
    }
  });

  it('formats cents with signs', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(-500)).toBe('-$5.00');
    expect(formatMoney(500, { sign: true })).toBe('+$5.00');
    expect(formatMoney(0, { sign: true })).toBe('$0.00');
    expect(formatMoney(123456, { whole: true })).toBe('$1,235');
  });
});

describe('demo actions', () => {
  it('logging a sale moves an in-stock item to sold and raises profit by exactly that sale', () => {
    const s0 = createSeed(TODAY);
    const item = s0.items.find((x) => !x.sale);
    const before = totals(s0.items);
    const { state, error } = applyAction(s0, { type: 'logSale', itemId: item.id, price: '300', platform: 'eBay', shipping: '12.50', date: '2026-11-15' });
    expect(error).toBeNull();
    const sold = state.items.find((x) => x.id === item.id);
    const fee = platformFee('eBay', 30000);
    expect(sold.sale.fees).toBe(fee);
    expect(itemProfit(sold)).toBe(30000 - fee - 1250 - item.cost);
    const after = totals(state.items);
    expect(after.profit - before.profit).toBe(itemProfit(sold));
    expect(after.revenue - before.revenue).toBe(30000);
    expect(after.unitsSold).toBe(before.unitsSold + 1);
    expect(after.inStockCount).toBe(before.inStockCount - 1);
    expect(after.inventoryValue).toBe(before.inventoryValue - item.cost);
    // The new sale is unpaid, so it shows as an incoming payout.
    expect(cashFlow(state.items).pending.some((x) => x.id === item.id)).toBe(true);
    // The original state is untouched.
    expect(s0.items.find((x) => x.id === item.id).sale).toBeNull();
  });

  it('rejects bad sales without changing anything', () => {
    const s0 = createSeed(TODAY);
    const stock = s0.items.find((x) => !x.sale);
    const sold = s0.items.find((x) => x.sale);
    const cases = [
      [{ itemId: 'nope', price: '10', platform: 'eBay', date: '2026-11-15' }, /Pick an item/],
      [{ itemId: sold.id, price: '10', platform: 'eBay', date: '2026-11-15' }, /already sold/],
      [{ itemId: stock.id, price: '', platform: 'eBay', date: '2026-11-15' }, /sale price/],
      [{ itemId: stock.id, price: '10', platform: 'Craigslist', date: '2026-11-15' }, /where it sold/],
      [{ itemId: stock.id, price: '10', platform: 'eBay', shipping: 'x', date: '2026-11-15' }, /Shipping/],
      [{ itemId: stock.id, price: '10', platform: 'eBay', shipping: '10', date: '2026-11-15' }, /more than the sale price/],
      [{ itemId: stock.id, price: '10', platform: 'eBay', date: '' }, /sale date/],
      [{ itemId: stock.id, price: '10', platform: 'eBay', date: '2020-01-01' }, /before you bought/],
    ];
    for (const [a, msg] of cases) {
      const res = applyAction(s0, { type: 'logSale', ...a });
      expect(res.error).toMatch(msg);
      expect(res.state).toBe(s0);
    }
  });

  it('selling the same item twice only counts once', () => {
    const s0 = createSeed(TODAY);
    const item = s0.items.find((x) => !x.sale);
    const sale = { type: 'logSale', itemId: item.id, price: '200', platform: 'Facebook', date: '2026-11-15' };
    const first = applyAction(s0, sale);
    const second = applyAction(first.state, sale);
    expect(second.error).toMatch(/already sold/);
    expect(totals(second.state.items)).toEqual(totals(first.state.items));
  });

  it('logging a purchase adds stock, card spend and cashback', () => {
    const s0 = createSeed(TODAY);
    const before = totals(s0.items);
    const cardBefore = cardSummary(s0.items, TODAY).find((c) => c.id === 'flex');
    const { state, error, item } = applyAction(s0, { type: 'logPurchase', name: '  Jordan 1  ', cost: '180', card: 'flex', store: '', date: '2026-11-15' });
    expect(error).toBeNull();
    expect(item.name).toBe('Jordan 1');
    expect(item.store).toBe('Retail');
    const after = totals(state.items);
    expect(after.inStockCount).toBe(before.inStockCount + 1);
    expect(after.inventoryValue - before.inventoryValue).toBe(18000);
    expect(after.cashback - before.cashback).toBe(900); // 5%
    const cardAfter = cardSummary(state.items, TODAY).find((c) => c.id === 'flex');
    expect(cardAfter.monthSpend - cardBefore.monthSpend).toBe(18000);
    expect(cardAfter.purchases).toBe(cardBefore.purchases + 1);
    expect(calendarEvents(state.items)['2026-11-15'].some((e) => e.item.id === item.id && e.kind === 'bought')).toBe(true);
    // ids never collide
    const again = applyAction(state, { type: 'logPurchase', name: 'B', cost: '1', card: 'flex', date: '2026-11-15' });
    expect(again.item.id).not.toBe(item.id);
  });

  it('rejects bad purchases', () => {
    const s0 = createSeed(TODAY);
    expect(applyAction(s0, { type: 'logPurchase', name: ' ', cost: '5', card: 'flex', date: '2026-11-15' }).error).toMatch(/name/);
    expect(applyAction(s0, { type: 'logPurchase', name: 'x'.repeat(61), cost: '5', card: 'flex', date: '2026-11-15' }).error).toMatch(/60/);
    expect(applyAction(s0, { type: 'logPurchase', name: 'A', cost: '0', card: 'flex', date: '2026-11-15' }).error).toMatch(/paid/);
    expect(applyAction(s0, { type: 'logPurchase', name: 'A', cost: '5', card: 'zzz', date: '2026-11-15' }).error).toMatch(/card/);
    expect(applyAction(s0, { type: 'logPurchase', name: 'A', cost: '5', card: 'flex', date: '' }).error).toMatch(/date/);
  });

  it('marking a payout paid moves it from pending to money in, once', () => {
    const s0 = createSeed(TODAY);
    const f0 = cashFlow(s0.items);
    const target = f0.pending[0];
    const { state } = applyAction(s0, { type: 'markPaid', itemId: target.id });
    const f1 = cashFlow(state.items);
    expect(f1.pending).toHaveLength(f0.pending.length - 1);
    expect(f1.moneyIn + f1.pendingTotal).toBe(f0.moneyIn + f0.pendingTotal);
    const twice = applyAction(state, { type: 'markPaid', itemId: target.id });
    expect(twice.state).toBe(state);
  });

  it('reset returns to the seed', () => {
    const s0 = createSeed(TODAY);
    const changed = applyAction(s0, { type: 'logPurchase', name: 'A', cost: '5', card: 'flex', date: '2026-11-15' }).state;
    const { state } = applyAction(changed, { type: 'reset', today: TODAY });
    expect(totals(state.items)).toEqual(totals(s0.items));
  });
});

describe('demo totals agree across screens', () => {
  it('monthly profit adds up to the dashboard profit for sales in range', () => {
    const { items } = createSeed(TODAY);
    const months = monthlySeries(items, TODAY, 6);
    const inRange = items.filter((x) => x.sale && months.some((m) => x.sale.soldOn.startsWith(m.key)));
    expect(months.reduce((s, m) => s + m.profit, 0)).toBe(inRange.reduce((s, x) => s + itemProfit(x), 0));
    // Seed data fits in the six months shown.
    expect(inRange.length).toBe(items.filter((x) => x.sale).length);
  });

  it('card cashback adds up to the total cashback', () => {
    const { items } = createSeed(TODAY);
    expect(cardSummary(items, TODAY).reduce((s, c) => s + c.cashback, 0)).toBe(totals(items).cashback);
  });
});
