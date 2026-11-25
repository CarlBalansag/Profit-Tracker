import { afterEach, describe, expect, it } from 'vitest';
import { buildCards, loadCardPage, rankForStore, rateAtStore, rewardSummary, saveCardPage, sortCards, storeSuggestions } from './cardWallet';
import { fallbackTheme, productName } from './cardThemes';

const NOW = new Date(2026, 10, 25);
const row = (over = {}) => ({
  id: '1', name: 'Test Card', last4: '1234', rewardType: 'cashback', pointValueCents: null, rewardsLabel: null,
  totalSpend: 100, amountToPay: 90, cashbackEarned: 5, cashbackToRedeem: 1, cashbackToKeep: 4, uncoveredLoss: 0, txnCount: 1, items: [],
  credit_limit: 1000, statement_close_day: 4, due_day: 1, min_payment_pct: 2, ...over,
});
const method = (over = {}) => ({ id: '1', type: 'Credit', reward_type: 'cashback', default_cashback_rate: 1, category_rates: [{ store: 'Amazon', rate: 5 }], catalog_card_id: 'us-a', ...over });
const flow = (over = {}) => ({ id: '1', balance: 250, statementBalance: 200, currentCycle: 50, statementOpen: true, statementDue: '2026-12-01', ...over });
const build = ({ d, m, f, paidBills } = {}) => buildCards({
  dashboard: { cards: [row(d)] }, methods: [method(m)], cashflow: { cards: [flow(f)] },
  catalog: [{ id: 'us-a', issuer: 'Chase', network: 'visa' }], paidBills, now: NOW,
})[0];

describe('buildCards', () => {
  it('keeps the month and today apart', () => {
    expect(build()).toMatchObject({ netToPay: 90, spend: 100, balance: 250, available: 750, utilization: 25, bill: 200, minPayment: 2, dueDate: '2026-12-01', dueInDays: 6, issuer: 'Chase' });
  });
  it('leaves missing values empty instead of inventing them', () => {
    expect(build({ d: { credit_limit: null, due_day: null, statement_close_day: null, min_payment_pct: null, last4: 'x' }, m: { catalog_card_id: null } }))
      .toMatchObject({ limit: null, available: null, utilization: null, dueLabel: null, statementBalance: null, bill: null, minPayment: null, last4: null, issuer: null });
  });
  it('still shows a card when payment methods, cash flow and the catalog are missing', () => {
    const [card] = buildCards({ dashboard: { cards: [row({ rewardType: 'points', pointValueCents: 2 })] }, now: NOW });
    expect(card).toMatchObject({ netToPay: 90, balance: null, points: true, earnedPoints: 250, method: null });
    expect(buildCards({})).toEqual([]);
  });
  it('takes a bill marked paid off the balance, and undoes it', () => {
    const paid = build({ paidBills: [{ card_id: '1', due_date: '2026-12-01' }] });
    expect(paid).toMatchObject({ billPaid: true, balance: 50, available: 950, payNext: false });
    expect(build({ paidBills: [{ card_id: '1', due_date: '2026-11-01' }, { card_id: '2', due_date: '2026-12-01' }] })).toMatchObject({ billPaid: false, balance: 250 });
  });
  it('has no bill before the statement closes, after it is past due, or at zero', () => {
    expect(build({ f: { statementOpen: false } }).bill).toBe(null);
    expect(build({ f: { statementDue: '2027-01-01' } }).bill).toBe(null);
    expect(build({ f: { statementBalance: 0 } }).bill).toBe(null);
    expect(build({ f: { statementBalance: -20 } }).bill).toBe(null);
  });
  it('shows over-limit cards and credits as they are', () => {
    expect(build({ d: { credit_limit: 5 } }).available).toBe(-245);
    expect(build({ f: { balance: -20 } })).toMatchObject({ utilization: 0, available: 1020 });
  });
  it('tags one card to pay next: soonest, then the larger bill, skipping paid ones', () => {
    const cards = (paidBills) => buildCards({
      dashboard: { cards: [row({ id: 'a', due_day: 5 }), row({ id: 'b', due_day: 1 }), row({ id: 'c', due_day: 1 })] },
      cashflow: { cards: [flow({ id: 'a', statementDue: '2026-12-05' }), flow({ id: 'b' }), flow({ id: 'c', statementBalance: 300 })] },
      paidBills, now: NOW,
    }).filter((x) => x.payNext).map((x) => x.id);
    expect(cards()).toEqual(['c']);
    expect(cards([{ card_id: 'c', due_date: '2026-12-01' }])).toEqual(['b']);
    expect(cards(['a', 'b', 'c'].map((id) => ({ card_id: id, due_date: id === 'a' ? '2026-12-05' : '2026-12-01' })))).toEqual([]);
  });
  it('never carries card numbers through', () => {
    const card = build({ m: { number: '4111111111111111', cvv: '987' } });
    expect(JSON.stringify({ ...card, method: undefined })).not.toMatch(/4111111111111111|987/);
  });
});

describe('best card at a store', () => {
  const at = (m, store) => rateAtStore(m, store, NOW);
  it('matches stores the way purchases do', () => {
    expect(at(method(), 'amazon').rate).toBe(5);
    expect(at(method(), 'Amazon Business').rate).toBe(5);
    expect(at(method(), 'Walmart')).toMatchObject({ rate: 1, matched: false });
    expect(at(method(), '  ').rate).toBe(1);
  });
  it('ignores expired, broken and negative rates', () => {
    const m = method({ category_rates: [{ store: 'Amazon', rate: 9, expires: '2026-06-30' }, { store: 'Amazon', rate: 8, expires: 'soon' }, { store: 'Amazon', rate: -3 }, { store: '', rate: 7 }, { store: 'Amazon', rate: 4, expires: '2026-12-31' }] });
    expect(at(m, 'Amazon').rate).toBe(4);
    expect(at(null, 'Amazon').rate).toBe(0);
  });
  it('compares points cards in dollars and shows both', () => {
    const m = method({ reward_type: 'points', points_base_rate: 1, category_rates: [{ store: 'Dining', rate: 6, points: 3 }] });
    expect(at(m, 'dining')).toMatchObject({ rate: 6, label: '3x ≈ 6%' });
  });
  it('ranks best first, marks ties, and marks none when all earn the same', () => {
    const cards = [{ id: 'a', method: method({ category_rates: [] }) }, { id: 'b', method: method() }, { id: 'c', method: method() }];
    expect(rankForStore(cards, 'Amazon', NOW).map((c) => [c.id, c.atStore.best])).toEqual([['b', true], ['c', true], ['a', false]]);
    expect(rankForStore(cards, 'Nowhere', NOW).some((c) => c.atStore.best)).toBe(false);
    expect(rankForStore([], 'Amazon', NOW)).toEqual([]);
  });
  it('suggests your stores and rated stores once each', () => {
    expect(storeSuggestions([method()], [{ type: 'Vendor', name: 'Best Buy' }, { type: 'Vendor', name: 'Amazon' }, { type: 'Marketplace', name: 'eBay' }])).toEqual(['Amazon', 'Best Buy']);
    expect(storeSuggestions(undefined, undefined)).toEqual([]);
  });
});

describe('sorting', () => {
  const cards = [{ id: 'a', name: 'A', balance: 5 }, { id: 'b', name: 'B', balance: null }, { id: 'c', name: 'C', balance: 9 }];
  const ids = (list) => list.map((c) => c.id).join('');
  it('puts cards with no value last', () => expect(ids(sortCards(cards, 'balance'))).toBe('cab'));
  it('follows the saved order; new cards go to the end, removed ones are ignored', () => {
    expect(ids(sortCards(cards, 'custom', ['c', 'gone', 'a']))).toBe('cab');
    expect(ids(sortCards(cards, 'nonsense', []))).toBe('abc');
  });
});

describe('what the device remembers', () => {
  afterEach(() => localStorage.clear());
  it('round-trips, and starts fresh from anything unreadable', () => {
    saveCardPage({ view: 'deck', sort: 'due', order: ['b', 'a'] });
    expect(loadCardPage()).toEqual({ view: 'deck', sort: 'due', order: ['b', 'a'] });
    localStorage.setItem('credit_card_page', '{bad');
    expect(loadCardPage()).toEqual({ view: 'wallet', sort: 'custom', order: [] });
    localStorage.setItem('credit_card_page', JSON.stringify({ view: 'x', sort: 'y', order: [1, 'a', null] }));
    expect(loadCardPage()).toEqual({ view: 'wallet', sort: 'custom', order: ['a'] });
  });
});

describe('labels', () => {
  it('summarises rewards', () => {
    expect(rewardSummary(method()).short).toBe('1% – 5%');
    expect(rewardSummary({ reward_type: 'points', points_base_rate: 2 }).short).toBe('2x');
    expect(rewardSummary(null).short).toBe('0%');
  });
  it('falls back to the issuer, then the network', () => {
    expect(fallbackTheme({ issuer: 'U.S. Bank' }).tier).toBe('issuer');
    expect(fallbackTheme({ issuer: 'Citizens', network: 'visa' }).tier).toBe('network');
    expect(fallbackTheme({}).tier).toBe('network');
    expect(productName({ name: 'Chase Freedom Flex Card', issuer: 'Chase' })).toBe('Freedom Flex');
    expect(productName({ name: 'Card', issuer: 'Chase' })).toBe('Card');
  });
});
