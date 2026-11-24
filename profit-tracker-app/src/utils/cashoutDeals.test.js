import { describe, expect, it } from 'vitest';
import { bestCardForDeal, estimateDealProfit, formatDealRoi, groupDealsByProduct } from './cashoutDeals';

const link = (name) => ({ name, url: `https://${name.toLowerCase().replace(/\s/g, '')}.com/item` });
const deal = (stores, { payout = 210, retail = 200 } = {}) => ({
  id: 'd1', name: 'Deal', payout, retail,
  items: [{ id: 'i1', name: 'Deal', purchaseLinks: stores.map(link) }],
});

const flat = { id: 'flat', name: 'Flat 2%', default_cashback_rate: 2, category_rates: [] };
const prime = { id: 'prime', name: 'Prime Visa', default_cashback_rate: 1, category_rates: [{ store: 'Amazon', rate: 5 }] };
const target = { id: 'redcard', name: 'Target Card', default_cashback_rate: 0, category_rates: [{ store: 'Target', rate: 6 }] };

describe('bestCardForDeal', () => {
  it('adds the best card\'s cashback on retail to the deal profit', () => {
    const best = bestCardForDeal(deal(['Amazon']), [flat, prime]);
    expect(best.card.id).toBe('prime');
    expect(best.store).toBe('Amazon');
    expect(best.rate).toBe(5);
    expect(best.cashback).toBe(10);
    expect(best.profit).toEqual({ amount: 20, pct: 10 });
  });

  it('tries every card at every store and keeps the best pair', () => {
    const best = bestCardForDeal(deal(['Amazon', 'Target', 'Walmart']), [flat, prime, target]);
    expect(best.card.id).toBe('redcard');
    expect(best.store).toBe('Target');
    expect(best.cashback).toBe(12);
  });

  it('uses the base rate at a store with no store rate, and when the deal lists no store', () => {
    expect(bestCardForDeal(deal(['Walmart']), [flat, prime])).toMatchObject({ store: 'Walmart', rate: 2 });
    expect(bestCardForDeal(deal([]), [flat, prime])).toMatchObject({ store: null, rate: 2, cashback: 4 });
  });

  it('matches store names the same way a logged purchase does', () => {
    const card = { ...prime, category_rates: [{ store: 'amazon', rate: 5 }] };
    expect(bestCardForDeal(deal(['Amazon.com']), [card]).rate).toBe(5);
  });

  it('ignores an expired store rate', () => {
    const expired = { ...prime, category_rates: [{ store: 'Amazon', rate: 5, expires: '2026-01-01' }] };
    const best = bestCardForDeal(deal(['Amazon']), [flat, expired], new Date('2026-11-17'));
    expect(best.card.id).toBe('flat');
    const current = { ...prime, category_rates: [{ store: 'Amazon', rate: 5, expires: '2026-12-31' }] };
    expect(bestCardForDeal(deal(['Amazon']), [flat, current], new Date('2026-11-17')).card.id).toBe('prime');
  });

  it('reads store rates saved as a JSON string', () => {
    const stringRates = { ...prime, category_rates: JSON.stringify([{ store: 'Amazon', rate: 5 }]) };
    expect(bestCardForDeal(deal(['Amazon']), [flat, stringRates]).card.id).toBe('prime');
  });

  it('values a points card by its saved dollar rate', () => {
    // 3x at 1.5 cents a point: the server stores 4.5 as the dollar rate.
    const points = { id: 'pts', name: 'Points Card', reward_type: 'points', points_base_rate: 3, point_value_cents: 1.5, default_cashback_rate: 4.5 };
    expect(bestCardForDeal(deal(['Walmart']), [flat, points])).toMatchObject({ rate: 4.5, cashback: 9 });
  });

  it('has a card but no profit when the deal has no retail price', () => {
    const best = bestCardForDeal(deal(['Amazon'], { retail: null }), [prime]);
    expect(best.card.id).toBe('prime');
    expect(best.cashback).toBeNull();
    expect(best.profit).toBeNull();
  });

  it('turns a small loss into a gain when the cashback covers it', () => {
    const best = bestCardForDeal(deal(['Amazon'], { payout: 195, retail: 200 }), [prime]);
    expect(best.profit).toEqual({ amount: 5, pct: 2.5 });
  });

  it('returns null with no cards, and no card when none earns anything', () => {
    expect(bestCardForDeal(deal(['Amazon']), [])).toBeNull();
    expect(bestCardForDeal(deal(['Amazon']), undefined)).toBeNull();
    expect(bestCardForDeal(deal(['Amazon']), [{ id: 'debit', name: 'Checking', default_cashback_rate: 0 }])).toMatchObject({ card: null, profit: null });
  });

  it('uses every cashout\'s stores and the merged retail on a product listed by several cashouts', () => {
    const eb = { ...deal(['Best Buy'], { payout: 220, retail: null }), id: 'eb', connectionId: 'c1' };
    eb.items[0].upcs = ['123456789012'];
    const p4d = { ...deal(['Amazon'], { payout: 210, retail: 200 }), id: 'p4d', connectionId: 'c2' };
    p4d.items[0].upcs = ['123456789012'];
    const [group] = groupDealsByProduct([eb, p4d]);
    const best = bestCardForDeal(group, [flat, prime]);
    expect(best).toMatchObject({ store: 'Amazon', rate: 5, cashback: 10 });
    // $220 best payout - $200 retail + $10 cashback
    expect(best.profit.amount).toBe(30);
  });
});

describe('formatDealRoi', () => {
  it('labels the profit as a percent of retail', () => {
    expect(formatDealRoi(estimateDealProfit({ payout: 120, retail: 110 }))).toBe('+9.09% ROI');
    expect(formatDealRoi(estimateDealProfit({ payout: 95, retail: 100 }))).toBe('-5% ROI');
    expect(formatDealRoi(estimateDealProfit({ payout: 100, retail: 100 }))).toBe('0% ROI');
    expect(formatDealRoi(estimateDealProfit({ payout: 1000.01, retail: 1000 }))).toBe('~0% ROI');
  });

  it("includes the best card's rewards when given that profit", () => {
    const best = bestCardForDeal(deal(['Amazon'], { payout: 210, retail: 200 }), [prime]);
    expect(formatDealRoi(best.profit)).toBe('+10% ROI');
  });

  it('shows nothing with no retail price or no cost', () => {
    expect(formatDealRoi(estimateDealProfit({ payout: 100, retail: null }))).toBeNull();
    expect(formatDealRoi(estimateDealProfit({ payout: 100, retail: 0 }))).toBeNull();
    expect(formatDealRoi(null)).toBeNull();
    expect(formatDealRoi({ amount: 5, pct: NaN })).toBeNull();
  });
});
