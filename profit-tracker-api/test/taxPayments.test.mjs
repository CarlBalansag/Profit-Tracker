// Phase 7: recorded tax payments, each quarter's status, and tax deadlines on
// the calendar (in the app and in the published feed, without amounts).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { trackInstallments, buildTaxOverview, taxDeadlines } from '../../shared/tax/index.mjs';

const require = createRequire(import.meta.url);

describe('trackInstallments', () => {
  const plan = { supported: true, installments: [
    { period: 'Q1', due: '2026-04-15', amount: 100 }, { period: 'Q2', due: '2026-06-15', amount: 100 },
    { period: 'Q3', due: '2026-09-15', amount: 100 }, { period: 'Q4', due: '2027-01-15', amount: 100 },
  ] };
  it('applies payments to the oldest quarters first', () => {
    const t = trackInstallments(plan, 150, '2026-08-01');
    expect(t.map((i) => [i.period, i.paid, i.remaining, i.status])).toEqual([
      ['Q1', 100, 0, 'paid'], ['Q2', 50, 50, 'overdue'], ['Q3', 0, 100, 'upcoming'], ['Q4', 0, 100, 'upcoming']]);
    expect(trackInstallments(plan, 230, '2026-05-01')[2]).toMatchObject({ paid: 30, status: 'partly_paid' });
    expect(trackInstallments(plan, 999, '2027-03-01').every((i) => i.status === 'paid')).toBe(true);
    expect(trackInstallments(null, 10, '2026-01-01')).toEqual([]);
  });
});

describe('buildTaxOverview with recorded payments', () => {
  const profile = { filing_status: 'single', state: 'CO', non_business_income: '0' };
  const pay = (jurisdiction, amount, period = 'Q1') => ({ jurisdiction, period, amount, paid_date: '2026-04-10' });

  it('counts IRS and home-state payments, and catches up on missed quarters', () => {
    const o = buildTaxOverview({ profile, year: 2026, businessProfit: 50000, today: '2026-07-01',
      payments: [pay('US', '2000'), pay('CO', '300'), pay('AZ', '999')] });
    expect([o.federalPaid, o.statePaid, o.estimatedPaid]).toEqual([2000, 300, 2300]);
    // The engine sees the payments too.
    expect(o.impact.withBusiness.federal.estimatedPayments).toBe(2000);
    expect(o.federalInstallments.map((i) => i.status)).toEqual(['overdue', 'overdue', 'upcoming', 'upcoming']);
    const fed = o.nextDue.find((d) => d.code === 'US');
    expect(fed.period).toBe('Q3');
    expect(fed.catchUp).toBe(Math.round((o.federalInstallments[0].remaining + o.federalInstallments[1].remaining) * 100) / 100);
    expect(o.overdue.filter((d) => d.code === 'US').map((d) => d.period)).toEqual(['Q1', 'Q2']);
  });

  it('has nothing overdue once the quarters are paid', () => {
    const first = buildTaxOverview({ profile, year: 2026, businessProfit: 50000, today: '2026-07-01' });
    const owed = first.federalInstallments.slice(0, 2).reduce((t, i) => t + i.amount, 0);
    const o = buildTaxOverview({ profile: { ...profile, state: 'TX' }, year: 2026, businessProfit: 50000, today: '2026-07-01', payments: [pay('US', String(owed))] });
    expect(o.overdue).toEqual([]);
    expect(o.nextDue[0]).toMatchObject({ period: 'Q3', catchUp: 0 });
  });
});

describe('taxDeadlines', () => {
  it('lists the IRS quarters, the filing date and the state quarters where verified', () => {
    const d = taxDeadlines({ year: 2026, state: 'CO' });
    expect(d.map((x) => x.id)).toEqual(['tax_US_2026_Q1', 'tax_CO_2026_Q1', 'tax_US_2026_Q2', 'tax_CO_2026_Q2', 'tax_US_2026_Q3', 'tax_CO_2026_Q3', 'tax_US_2026_Q4', 'tax_CO_2026_Q4', 'tax_US_2026_filing']);
    expect(d.find((x) => x.id === 'tax_US_2026_filing')).toMatchObject({ date: '2027-04-15', title: '2026 tax return due' });
    // No-tax states and states without estimated payments add nothing.
    expect(taxDeadlines({ year: 2026, state: 'TX' })).toHaveLength(5);
    expect(taxDeadlines({ year: 2025, state: 'ID' })).toHaveLength(5);
    expect(taxDeadlines({ year: 2030 })).toEqual([]);
  });
});

describe('tax payment routes and the calendar', () => {
  const harness = require('../../qa/harness.cjs');
  const { buildCalendarFeed } = require('../services/calendarFeed');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const send = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const payment = (over) => ({ jurisdiction: 'US', period: 'Q3', amount: '1200.50', paid_date: '2026-09-14', reference: 'DP-1', ...over });

  it('records, lists newest first, and deletes payments by year', async () => {
    const first = await send('POST', '/api/tax/payments/2026', payment());
    expect(first.status).toBe(201);
    await send('POST', '/api/tax/payments/2026', payment({ jurisdiction: 'CO', period: 'Q4', amount: '80', paid_date: '2027-01-10', reference: '' }));
    await send('POST', '/api/tax/payments/2025', payment({ period: 'extension', paid_date: '2026-04-15' }));
    const list = (await send('GET', '/api/tax/payments/2026')).body.payments;
    expect(list.map((p) => [p.jurisdiction, p.period, p.amount, p.paid_date, p.reference])).toEqual([['CO', 'Q4', '80', '2027-01-10', null], ['US', 'Q3', '1200.5', '2026-09-14', 'DP-1']]);
    const after = await send('DELETE', `/api/tax/payments/entry/${list[0].id}`);
    expect(after.body.payments).toHaveLength(1);
    expect((await send('DELETE', `/api/tax/payments/entry/${list[0].id}`)).status).toBe(404);
    expect((await send('GET', '/api/tax/payments/2025')).body.payments[0].period).toBe('extension');
  });

  it('refuses bad payments and saves nothing', async () => {
    for (const bad of [payment({ jurisdiction: 'XX' }), payment({ period: 'Q5' }), payment({ amount: '0' }), payment({ amount: '-1' }), payment({ amount: '1.001' }),
      payment({ paid_date: '2026-02-31' }), payment({ reference: 'x'.repeat(101) }), payment({ ssn: '123-45-6789' }), payment({ amount: undefined })]) {
      expect((await send('POST', '/api/tax/payments/2026', bad)).status).toBe(400);
    }
    expect(harness.db.taxPayment).toHaveLength(0);
  });

  it('keeps payments private and needs Schedule C on', async () => {
    harness.db.taxPayment.push({ id: 'theirs', user_id: harness.ids.other, year: 2026, jurisdiction: 'US', period: 'Q1', amount: 5, paid_date: new Date('2026-04-01'), created_at: new Date() });
    expect((await send('GET', '/api/tax/payments/2026')).body.payments).toEqual([]);
    expect((await send('DELETE', '/api/tax/payments/entry/theirs')).status).toBe(404);
    expect(harness.db.taxPayment).toHaveLength(1);
    harness.db.user[0].schedule_c_enabled = false;
    expect((await send('POST', '/api/tax/payments/2026', payment())).status).toBe(403);
  });

  it('stops accepting the old typed-in payment totals on the profile', async () => {
    expect((await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', federal_estimated_paid: '100' })).status).toBe(400);
  });

  it('puts tax deadlines on the in-app calendar and in the feed, without amounts', async () => {
    const year = new Date().getUTCFullYear();
    await send('PUT', `/api/tax/profile/${year}`, { filing_status: 'single', state: 'CO' });
    const month = `${year}-09`;
    const events = (await send('GET', `/api/calendar-events/auto?month=${month}`)).body;
    const tax = events.filter((e) => e.type === 'tax');
    expect(tax.map((e) => [e.id, e.date])).toEqual([[`tax_US_${year}_Q3`, `${year}-09-15`], [`tax_CO_${year}_Q3`, `${year}-09-15`]]);
    const feed = await buildCalendarFeed(harness.ids.user);
    expect(feed).toContain(`UID:tax_US_${year}_Q1@profittracker`);
    expect(feed).toContain(`UID:tax_US_${year - 1}_filing@profittracker`);
    expect(feed).toContain(`SUMMARY:Colorado estimated tax due: Q4 ${year}`);
    // Deadlines carry no dollar amounts (the feed is reachable by a link).
    const taxLines = feed.split('\r\n').filter((l) => /estimated tax|tax return due|federal estimated|File your/i.test(l));
    expect(taxLines.length).toBeGreaterThan(8);
    // ("$1,000 or more", comma-escaped in ICS, is the IRS's general threshold,
    // not the user's money.)
    expect(taxLines.join('\n').replace(/\$1\\?,000 or more/g, '')).not.toMatch(/\$\d/);
    // Schedule C off: no tax deadlines anywhere.
    harness.db.user[0].schedule_c_enabled = false;
    expect((await send('GET', `/api/calendar-events/auto?month=${month}`)).body.some((e) => e.type === 'tax')).toBe(false);
    expect(await buildCalendarFeed(harness.ids.user)).not.toContain('tax_US_');
  });
});
