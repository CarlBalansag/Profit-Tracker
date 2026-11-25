// Store refunds in the Cash Flow card estimates (services/cashFlow.js):
// statement, current cycle, balance, utilization, bills, coverage and the
// 30-day total, which the Cash Flow page and the Credit Card page's "Card
// payments due" banner show.
//
// Harness data: one card (closes 15th, due 10th, $5,000 limit) with one $520
// purchase on 2026-09-01, so the Aug 15 - Sep 15 statement is $520, due Oct 10.
import { beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { computeCashFlow, _internal } = require('../services/cashFlow');
const { computeCardDashboard } = require('../services/cardNetToPay');
const { Decimal } = require('../services/money');
const { ids, prisma } = harness;

beforeEach(() => harness.reset());

const noon = (iso) => new Date(`${iso}T12:00:00Z`);
const at = (iso) => computeCashFlow(prisma, ids.user, noon(iso));
const cardAt = async (iso) => (await at(iso)).cards.find((c) => c.id === ids.card);
const addRefund = (amount, date, over = {}) => harness.db.refund.push({
  id: `refund-${harness.db.refund.length}`, user_id: ids.user, inventory_id: ids.inventory, sale_id: null,
  amount, quantity: 0, date: noon(date), note: null, created_at: new Date(), ...over,
});
const addPurchase = (id, cost, date, over = {}) => harness.db.inventory.push({
  ...harness.db.inventory[0], id, unit_purchase_cost: cost, qty_purchased: 1, qty_on_hand: 1, sales_tax: 0,
  shipping_cost_inbound: 0, fees: 0, gift_card_amount: 0, purchase_date: noon(date), ...over,
});
const finalBill = (cf) => cf.coverage.find((b) => b.final);
const openBill = (cf) => cf.coverage.find((b) => !b.final);

describe('store refunds on the card estimates', () => {
  it('takes a refund before the statement closes off that statement, everywhere it shows', async () => {
    addRefund('200', '2026-09-10');
    const cf = await at('2026-09-20');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 320, currentCycle: 0, balance: 320, utilizationPct: 6.4 });
    expect(finalBill(cf)).toMatchObject({ amount: 320, billsSoFar: 320, payoutsBefore: 273, gap: -47, covered: false });
    expect(cf.summary).toMatchObject({ billsDue30: 320, coverageGap: -47 });
  });

  it('counts a refund on the close date in that statement, and the day after on its own date', async () => {
    addRefund('20', '2026-09-15');
    expect(await cardAt('2026-09-15')).toMatchObject({ statementBalance: 500, currentCycle: 0 });
    harness.db.refund.length = 0;
    addPurchase('p2', 100, '2026-09-16');
    addRefund('20', '2026-09-16');
    expect(await cardAt('2026-09-15')).toMatchObject({ statementBalance: 520, currentCycle: 0 });
    expect(await cardAt('2026-09-16')).toMatchObject({ statementBalance: 500, currentCycle: 100, balance: 600 });
  });

  it('clears an open statement that was fully refunded after it closed', async () => {
    addRefund('520', '2026-09-25');
    const cf = await at('2026-09-28');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 0, currentCycle: 0, balance: 0, utilizationPct: 0, statementOpen: true });
    expect(cf.coverage).toEqual([]);
    expect(cf.summary.billsDue30).toBe(0);
  });

  it('pays the open statement down first, so a later charge never brings its bill back', async () => {
    addRefund('520', '2026-09-25');
    addPurchase('p2', 300, '2026-09-27');
    const cf = await at('2026-09-28');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 0, currentCycle: 300, balance: 300 });
    expect(finalBill(cf)).toBeUndefined();
    expect(openBill(cf)).toMatchObject({ amount: 300, dueDate: '2026-11-10' });
  });

  it('takes a partial refund after close off the open bill', async () => {
    addRefund('104.10', '2026-09-20');
    addRefund('0.20', '2026-09-21');
    addPurchase('p2', 50, '2026-09-22');
    const cf = await at('2026-09-28');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 415.7, currentCycle: 50, balance: 465.7 });
    expect(finalBill(cf).amount).toBe(415.7);
    expect(openBill(cf)).toMatchObject({ amount: 50, billsSoFar: 465.7 });
  });

  it('counts a refund on the due date toward the bill, and later ones as credit on the new cycle', async () => {
    addPurchase('p2', 600, '2026-09-20');
    addRefund('520', '2026-10-10');
    expect(await cardAt('2026-10-10')).toMatchObject({ statementBalance: 0, currentCycle: 600, balance: 600 });
    // The day after its due date the bill counts as paid: nothing more to credit.
    expect(await cardAt('2026-10-12')).toMatchObject({ statementOpen: false, statementBalance: 0, currentCycle: 600, balance: 600 });
    harness.db.refund.length = 0;
    addRefund('520', '2026-10-11');
    expect(await cardAt('2026-10-12')).toMatchObject({ statementOpen: false, statementBalance: 520, currentCycle: 80, balance: 80 });
    // It closes on Oct 15 as an $80 statement.
    const cf = await at('2026-10-20');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 80, currentCycle: 0, balance: 80, statementDue: '2026-11-10' });
    expect(cf.summary.billsDue30).toBe(80);
  });

  it('shows a credit, not a negative bill, when a refund after the due date exceeds the cycle', async () => {
    addPurchase('p2', 100, '2026-10-05');
    addRefund('520', '2026-10-12');
    const cf = await at('2026-10-13');
    expect(cf.cards[0]).toMatchObject({ currentCycle: -420, balance: -420, utilizationPct: 0 });
    expect(cf.coverage).toEqual([]);
    expect(cf.summary.billsDue30).toBe(0);
  });

  it('carries that credit through later cycles, empty ones included, until charges use it up', async () => {
    addRefund('520', '2026-10-12');
    addPurchase('p2', 200, '2027-01-05'); // Dec 15 - Jan 15
    addPurchase('p3', 400, '2027-02-01'); // Jan 15 - Feb 15
    expect(await cardAt('2026-12-01')).toMatchObject({ statementBalance: 0, currentCycle: -520, balance: -520 });
    expect(await cardAt('2027-01-10')).toMatchObject({ statementBalance: 0, currentCycle: -320, balance: -320 });
    expect(await cardAt('2027-02-05')).toMatchObject({ statementBalance: 0, currentCycle: 80, balance: 80 });
    expect(await cardAt('2027-02-20')).toMatchObject({ statementBalance: 80, currentCycle: 0, balance: 80 });
    // Used up: nothing carries past it.
    expect(await cardAt('2027-04-01')).toMatchObject({ statementBalance: 0, currentCycle: 0, balance: 0 });
  });

  it('does not carry a refund forward once it has paid down a past statement', async () => {
    addRefund('520', '2026-09-25'); // while the statement was open
    addPurchase('p2', 300, '2026-12-20');
    expect(await cardAt('2026-12-22')).toMatchObject({ balance: 300, currentCycle: 300 });
    expect(await cardAt('2027-01-20')).toMatchObject({ statementBalance: 300, balance: 300 });
  });

  it('never double counts a refund larger than the open statement', async () => {
    addPurchase('p2', 700, '2026-09-18');
    addRefund('700', '2026-09-26', { inventory_id: 'p2' });
    addRefund('100', '2026-09-27');
    // $1,220 charged, $800 back.
    expect(await cardAt('2026-09-28')).toMatchObject({ statementBalance: 0, currentCycle: 420, balance: 420 });
  });

  it('handles a refund dated before its purchase, and ignores one dated in the future', async () => {
    addRefund('100', '2026-08-10');
    expect(await cardAt('2026-09-20')).toMatchObject({ statementBalance: 420, balance: 420 });
    addRefund('50', '2026-09-21');
    expect(await cardAt('2026-09-20')).toMatchObject({ statementBalance: 420, balance: 420 });
    expect(await cardAt('2026-09-21')).toMatchObject({ statementBalance: 370, balance: 370 });
  });

  it('uses calendar months on a card with no close day', async () => {
    harness.db.paymentMethod[0].statement_close_day = null;
    addRefund('100', '2026-09-30');
    addRefund('20', '2026-10-01');
    addPurchase('p2', 60, '2026-10-02');
    expect(await cardAt('2026-09-30')).toMatchObject({ currentCycle: 420, balance: 420 });
    // Closed Sep 30 at $420; due Oct 10, so the Oct 1 refund still pays it down.
    expect(await cardAt('2026-10-05')).toMatchObject({ statementBalance: 400, currentCycle: 60, balance: 460, statementDue: '2026-10-10' });
    addRefund('50', '2026-10-12');
    expect(await cardAt('2026-10-13')).toMatchObject({ statementOpen: false, currentCycle: 10, balance: 10 });
  });

  it('credits the current cycle on a card with no due day, where a closed statement counts as paid', async () => {
    harness.db.paymentMethod[0].due_day = null;
    addRefund('100', '2026-09-10');
    addRefund('50', '2026-09-20');
    addPurchase('p2', 80, '2026-09-21');
    const cf = await at('2026-09-25');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 420, currentCycle: 30, balance: 30, statementDue: null });
    expect(cf.coverage).toEqual([]);
  });

  it('keeps month-end close days in step through short months', async () => {
    Object.assign(harness.db.paymentMethod[0], { statement_close_day: 31, due_day: 25 });
    harness.db.inventory[0].purchase_date = noon('2027-01-30');
    addRefund('100', '2027-02-25'); // due date of the Jan 31 statement
    addRefund('50', '2027-02-28'); // closes that day
    addPurchase('p2', 60, '2027-02-27');
    expect(await cardAt('2027-02-25')).toMatchObject({ statementBalance: 420, balance: 420 });
    expect(await cardAt('2027-03-10')).toMatchObject({ statementBalance: 10, currentCycle: 0, balance: 10 });
  });

  it('credits only the card that paid, and leaves cash and unassigned purchases out', async () => {
    harness.db.paymentMethod.push(
      { ...harness.db.paymentMethod[0], id: 'card-2', name: 'Second card' },
      { ...harness.db.paymentMethod[0], id: 'cash', name: 'Cash', type: 'Debit' },
    );
    addPurchase('p2', 300, '2026-09-05', { payment_method_id: 'card-2' });
    addPurchase('p3', 300, '2026-09-05', { payment_method_id: 'cash' });
    addPurchase('p4', 300, '2026-09-05', { payment_method_id: null });
    ['p2', 'p3', 'p4'].forEach((inventory_id) => addRefund('75', '2026-09-08', { inventory_id }));
    const { cards } = await at('2026-09-20');
    expect(cards.map((c) => [c.id, c.balance])).toEqual([[ids.card, 520], ['card-2', 225]]);
  });

  it('does not subtract buyer refunds', async () => {
    addRefund('150', '2026-09-10', { inventory_id: null, sale_id: ids.sale });
    const cf = await at('2026-09-20');
    expect(cf.cards[0]).toMatchObject({ statementBalance: 520, balance: 520 });
    expect(cf.monthly.find((m) => m.month === '2026-09').buyerRefunds).toBe(150);
  });

  it('ignores refunds that are another user\'s, or on another user\'s purchase', async () => {
    addPurchase('theirs', 400, '2026-09-05', { user_id: ids.other });
    addRefund('400', '2026-09-08', { user_id: ids.other, inventory_id: 'theirs' });
    addRefund('99', '2026-09-08', { user_id: ids.other });
    addRefund('88', '2026-09-08', { inventory_id: 'theirs' });
    expect(await cardAt('2026-09-20')).toMatchObject({ statementBalance: 520, balance: 520 });
  });

  it('leaves the monthly money in and out rows as they were', async () => {
    addRefund('200', '2026-09-10');
    const sep = (await at('2026-09-30')).monthly.find((m) => m.month === '2026-09');
    expect(sep).toMatchObject({ purchases: 520, storeRefunds: 200 });
  });

  it('agrees with the Credit Card page when the cycle is that calendar month', async () => {
    harness.db.paymentMethod[0].statement_close_day = null;
    harness.db.sales.length = 0;
    addPurchase('p2', 33.33, '2026-09-12');
    addRefund('104.17', '2026-09-30');
    const page = (await computeCardDashboard(prisma, ids.user, '2026-09')).cards[0];
    expect(page.totalSpend).toBe(449.16);
    expect((await cardAt('2026-10-01')).statementBalance).toBe(449.16);
  });
});

describe('cardBalances', () => {
  // Every bill, taken on its due date, plus what is left must always add up to
  // charges less refunds: no refund dropped, none counted twice.
  const day = (n) => new Date(Date.UTC(2026, 0, 1 + n));
  const windowsAt = (closeDay, today) => {
    const lastClose = closeDay ? _internal.lastOccurrence(closeDay, today) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    return { lastClose, prevClose: _internal.dayInMonth(lastClose.getUTCFullYear(), lastClose.getUTCMonth() - 1, closeDay || 31) };
  };

  it.each([[15, 10], [31, 25], [5, 2], [28, 22], [null, 10], [1, 26]])('accounts for every cent (close %s, due %s)', (closeDay, dueDay) => {
    let seed = 7;
    const random = (n) => { seed = (seed * 48271) % 2147483647; return seed % n; };
    for (let run = 0; run < 10; run += 1) {
      const entries = [];
      for (let i = 0; i < 40; i += 1) {
        const cents = new Decimal(1 + random(90000)).div(100);
        entries.push({ day: day(random(330)), [random(5) < 3 ? 'charge' : 'credit']: cents });
      }
      let paid = new Decimal(0);
      const wrong = [];
      for (let n = 0; n <= 400; n += 1) {
        const today = day(n);
        const { lastClose, prevClose } = windowsAt(closeDay, today);
        const { statement, sinceClose } = _internal.cardBalances(entries, { closeDay, dueDay, lastClose, prevClose, today });
        const due = _internal.nextOccurrenceAfter(dueDay, lastClose);
        const balance = (due >= today ? statement : new Decimal(0)).plus(sinceClose);
        const charged = entries.reduce((s, e) => (e.day > today ? s : s.plus(e.charge || 0).minus(e.credit || 0)), new Decimal(0));
        if (statement.lt(0) || !balance.plus(paid).eq(charged)) wrong.push({ run, n, balance: balance.toFixed(2), paid: paid.toFixed(2), charged: charged.toFixed(2) });
        if (due.getTime() === today.getTime()) paid = paid.plus(statement);
      }
      expect(wrong).toEqual([]);
    }
  }, 60000);
});
