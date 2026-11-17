// GET /api/analytics/cashflow (services/cashFlow.js) and the Analytics
// additions that came with the Cash Flow / Analytics overhaul: store ROI,
// cashback by card, business expenses, last-period stats.
//
// Harness data: one card (closes 15th, due 10th, $5,000 limit); one purchase
// on it on 2026-09-01 (5 x $100 + $40 tax + $20 ship + $10 fees - $50 gift
// card = $520 charged); one unpaid sale of 2 units on 2026-09-03 for
// $150 x 2 - $15 commission - $12 shipping = $273; one $25 expense.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { computeCashFlow, _internal } = require('../services/cashFlow');

let server;
let baseUrl;

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => harness.reset());
afterAll(() => server.close());

const get = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  return { status: response.status, body: await response.json() };
};

// Runs the service against the harness's in-memory database at a fixed "now".
const at = (iso) => computeCashFlow(harness.prisma, harness.ids.user, new Date(iso));

describe('cash flow dates', () => {
  it('clamps a day past the end of a short month', () => {
    expect(_internal.dayInMonth(2026, 1, 31).toISOString().slice(0, 10)).toBe('2026-02-28');
  });
  it('finds the last close and next due around month edges', () => {
    const today = new Date('2026-09-20T00:00:00Z');
    expect(_internal.lastOccurrence(15, today).toISOString().slice(0, 10)).toBe('2026-09-15');
    expect(_internal.lastOccurrence(25, today).toISOString().slice(0, 10)).toBe('2026-08-25');
    expect(_internal.nextOccurrenceAfter(10, new Date('2026-09-15T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-10-10');
  });
});

describe('GET /api/analytics/cashflow', () => {
  it('responds for the signed-in user', async () => {
    const res = await get('/api/analytics/cashflow');
    expect(res.status).toBe(200);
    expect(res.body.summary.owedTotal).toBeCloseTo(273, 2);
    expect(res.body.monthly).toHaveLength(12);
    expect(res.body.tiedUp).toHaveLength(16);
  });

  it('lists the unpaid sale as owed, late once its expected payout date passes', async () => {
    const cf = await at('2026-09-30T12:00:00Z');
    expect(cf.owed).toHaveLength(1);
    const g = cf.owed[0];
    expect(g.name).toBe('QA Marketplace');
    expect(g.amount).toBeCloseTo(273, 2);
    expect(g.expectedDays).toBe(14); // no paid history, no buyer setting
    expect(g.items[0].expectedDate).toBe('2026-09-17');
    expect(g.items[0].lateDays).toBe(13);
    expect(g.state).toBe('late');
    expect(cf.summary.lateCount).toBe(1);
  });

  it('drops a paid sale from owed and counts its payout as money in that month', async () => {
    Object.assign(harness.db.sales[0], { paid_at: new Date('2026-09-12T12:00:00Z'), workflow_status: 'PAID' });
    const cf = await at('2026-09-30T12:00:00Z');
    expect(cf.owed).toHaveLength(0);
    const sep = cf.monthly.find((m) => m.month === '2026-09');
    expect(sep.payouts).toBeCloseTo(273, 2);
    expect(sep.purchases).toBeCloseTo(520, 2);
    expect(sep.expenses).toBeCloseTo(25, 2);
    expect(sep.net).toBeCloseTo(273 - 520 - 25, 2);
    expect(cf.map.paidBack).toBeCloseTo(273, 2);
  });

  it('counts only the short amount of a short-paid sale as owed', async () => {
    Object.assign(harness.db.sales[0], { paid_at: new Date('2026-09-12T12:00:00Z'), paid_amount: 250, payout_short_amount: 23 });
    const cf = await at('2026-09-30T12:00:00Z');
    expect(cf.summary.owedTotal).toBeCloseTo(23, 2);
    expect(cf.monthly.find((m) => m.month === '2026-09').payouts).toBeCloseTo(250, 2);
  });

  it('leaves cancelled sales out of owed and money in', async () => {
    harness.db.sales[0].status = 'CANCELLED';
    const cf = await at('2026-09-30T12:00:00Z');
    expect(cf.owed).toHaveLength(0);
    expect(cf.summary.owedTotal).toBe(0);
  });

  it('estimates the card bill from the closed statement and checks payouts against it', async () => {
    // Statement Aug 15 -> Sep 15 holds the Sep 1 purchase; due Oct 10.
    const cf = await at('2026-09-20T12:00:00Z');
    const card = cf.cards[0];
    expect(card.statementBalance).toBeCloseTo(520, 2); // the $50 gift card was not charged to the card
    expect(card.statementDue).toBe('2026-10-10');
    expect(card.statementOpen).toBe(true);
    expect(card.utilizationPct).toBeCloseTo(card.balance / 50, 2);
    const bill = cf.coverage.find((b) => b.final);
    expect(bill.dueDate).toBe('2026-10-10');
    expect(bill.payoutsBefore).toBeCloseTo(273, 2);
    expect(bill.covered).toBe(false);
    expect(bill.gap).toBeCloseTo(273 - card.statementBalance, 2);
  });

  it('shows no open bill once the statement due date has passed', async () => {
    const cf = await at('2026-10-12T12:00:00Z');
    expect(cf.cards[0].statementOpen).toBe(false);
    expect(cf.coverage.filter((b) => b.final)).toHaveLength(0);
  });

  it('tracks stock and unpaid sales in cash tied up', async () => {
    const cf = await at('2026-09-30T12:00:00Z');
    const last = cf.tiedUp[cf.tiedUp.length - 1];
    expect(last.inventory).toBeCloseTo(520 * 3 / 5, 2);
    expect(last.unpaid).toBeCloseTo(273, 2);
    const beforePurchase = cf.tiedUp.find((w) => w.date < '2026-09-01');
    expect(beforePurchase.total).toBe(0);
  });

  it('only reads the signed-in user\'s records', async () => {
    harness.db.expense.push({ id: 'other-exp', user_id: harness.ids.other, name: 'Not mine', amount: 999, date: new Date('2026-09-05T12:00:00Z'), tax_version: 0 });
    const cf = await at('2026-09-30T12:00:00Z');
    expect(cf.monthly.find((m) => m.month === '2026-09').expenses).toBeCloseTo(25, 2);
  });
});

describe('GET /api/analytics/dashboard overhaul fields', () => {
  it('adds profit and ROI per store from sold units', async () => {
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const store = res.body.vendorBreakdown.find((v) => v.name === 'QA Store');
    expect(store.soldCost).toBeCloseTo(208, 2);
    expect(store.profit).toBeCloseTo(69.16, 2);
    expect(store.roi).toBeCloseTo(69.16 / 208 * 100, 1);
    expect(store.unitsSold).toBe(2);
  });

  it('adds cashback and its rate per card', async () => {
    const res = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    const card = res.body.topCards[0];
    expect(card.cashback).toBeGreaterThan(0);
    expect(card.cashbackRate).toBeCloseTo(card.cashback / card.amount * 100, 1);
  });

  it('subtracts business expenses in the All view only', async () => {
    const all = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(all.body.stats.businessExpenses).toBeCloseTo(25, 2);
    expect(all.body.stats.profitAfterExpenses).toBeCloseTo(all.body.stats.profit - 25, 2);
    const mk = await get('/api/analytics/dashboard?mode=Marketplace&date=All%20Time');
    expect(mk.body.stats.businessExpenses).toBeNull();
  });

  it('has no last period for All Time, and one for 30 Days', async () => {
    const all = await get('/api/analytics/dashboard?mode=All&date=All%20Time');
    expect(all.body.priorStats).toBeNull();
    const d30 = await get('/api/analytics/dashboard?mode=All&date=30%20Days');
    expect(d30.body.priorStats).not.toBeNull();
    expect(Array.isArray(d30.body.priorTrend)).toBe(true);
  });

  it('counts today and the 6 days before it as 7 Days, the same days as the calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-09T12:00:00Z'));
    try {
      const week = async () => (await get('/api/analytics/dashboard?mode=All&date=7%20Days')).body;
      // Sep 3 is the first of the 7 days (Sep 3 - Sep 9).
      harness.db.sales[0].sale_date = new Date('2026-09-03T00:00:00Z');
      let res = await week();
      expect(res.stats.salesCount).toBe(1);
      expect(res.trendMeta).toEqual({ windowStart: '2026-09-03', windowEnd: '2026-09-09' });
      expect(res.profitCalendar.from).toBe('2026-09-03');
      // Sep 2 is the 8th day back: outside this week, inside the prior one.
      harness.db.sales[0].sale_date = new Date('2026-09-02T23:59:00Z');
      res = await week();
      expect(res.stats.salesCount).toBe(0);
      expect(res.priorStats).toMatchObject({ from: '2026-08-27', to: '2026-09-02', salesCount: 1 });
      const month = (await get('/api/analytics/dashboard?mode=All&date=30%20Days')).body;
      expect(month.trendMeta.windowStart).toBe('2026-08-11');
      expect(month.profitCalendar.from).toBe('2026-08-11');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the profit calendar for exactly the days the filter covers', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'));
    try {
      const range = async (date) => (await get(`/api/analytics/dashboard?mode=All&date=${encodeURIComponent(date)}`)).body.profitCalendar;
      expect(await range('7 Days')).toMatchObject({ from: '2026-08-30', to: '2026-09-05' });
      expect(await range('30 Days')).toMatchObject({ from: '2026-08-07', to: '2026-09-05' });
      expect(await range('YTD')).toMatchObject({ from: '2026-01-01', to: '2026-09-05' });
      const all = await range('All Time');
      expect(all.from).toBe('2026-09-03'); // All Time starts at the first sale
      // The Sep 3 sale: 2 units at $150, less $15 commission and $12 shipping.
      expect(all.days).toEqual([{
        date: '2026-09-03', profit: 69.16, revenue: 273, cost: 208, sales: 1, units: 2,
        items: [{ id: harness.ids.sale, product: 'QA Multi-unit Sneaker', platform: 'QA Marketplace', units: 2, revenue: 273, cost: 208, profit: 69.16 }],
      }]);
      // An older sale moves the start back with it.
      harness.db.sales.push({ ...harness.db.sales[0], id: 'sale-old', sale_date: new Date('2024-02-10T12:00:00Z') });
      expect((await range('All Time')).from).toBe('2024-02-10');
      harness.db.sales.pop();
      harness.db.sales[0].sale_date = new Date('2026-08-20T12:00:00Z');
      expect((await range('7 Days')).days).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('moves a sale from the prior 30 days onto the matching day of this window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    try {
      const d30 = await get('/api/analytics/dashboard?mode=All&date=30%20Days');
      // Window starts Aug 21; prior window Jul 22 - Aug 20. The Sep 3 sale is in this window.
      expect(d30.body.priorStats.salesCount).toBe(0);
      harness.db.sales[0].sale_date = new Date('2026-08-10T12:00:00Z');
      const again = await get('/api/analytics/dashboard?mode=All&date=30%20Days');
      expect(again.body.priorStats.salesCount).toBe(1);
      expect(again.body.priorStats.totalRevenue).toBeCloseTo(273, 2);
      expect(again.body.priorTrend[0].date).toBe('2026-09-09');
    } finally {
      vi.useRealTimers();
    }
  });
});
