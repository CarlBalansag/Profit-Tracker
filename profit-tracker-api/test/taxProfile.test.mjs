// Tax profile (per user and year), the Simple / Detailed tax-math preference,
// the shared overview built from them, and Sentry scrubbing for tax routes.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { buildTaxOverview, profileToEstimateInput, stateSupport, stateOptions } from '../../shared/tax/index.mjs';

const require = createRequire(import.meta.url);

describe('buildTaxOverview', () => {
  const single = { filing_status: 'single', state: 'TX', non_business_income: '0' };

  it('answers what the business adds, what to set aside and when the next payment is due', () => {
    // Same case as the engine walk-through: $50,000 profit, single, 2026.
    const o = buildTaxOverview({ profile: single, year: 2026, businessProfit: 50000, today: '2026-11-21' });
    expect(o.impact.additionalTaxFromBusiness).toBe(9732.07);
    expect(o.impact.effectiveBusinessTaxRate).toBe(0.1946);
    expect(o.recommended).toBe(9732.07);
    expect(o.reserves).toEqual({ personalized: 9732.07, flat: 12500, conservative: 10705.28 });
    // Texas: no state payments, so only the IRS's Q4 installment remains.
    // Nothing recorded yet: Q4's $2,189.70 plus the three missed quarters to catch up.
    expect(o.nextDue).toEqual([{ who: 'Federal (IRS)', code: 'US', period: 'Q4', due: '2027-01-15', amount: 8758.86, installment: 2189.7, catchUp: 6569.16, remainingForYear: 8758.86 }]);
    expect(o.overdue.map((d) => d.period)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(o.missing.map((m) => m.field)).toEqual(['federal_withholding', 'prior_year_tax']);
    expect(o.filingDue).toBe('2027-04-15');
  });

  it('takes estimated payments off what is still to set aside, and uses the chosen mode', () => {
    const o = buildTaxOverview({ profile: { ...single, reserve_mode: 'conservative', buffer_rate: '0.2' }, year: 2026, businessProfit: 50000, today: '2026-11-21', payments: [{ jurisdiction: 'US', period: 'Q1', amount: '3000' }] });
    expect(o.recommended).toBe(11678.48); // 9732.07 x 1.2
    expect(o.stillToSetAside).toBe(8678.48);
    const flat = buildTaxOverview({ profile: { ...single, reserve_mode: 'flat', flat_rate: '0.3' }, year: 2026, businessProfit: 50000, today: '2026-11-21' });
    expect([flat.effectiveMode, flat.recommended]).toEqual(['flat', 15000]);
  });

  it('lists no payment when withholding already covers it', () => {
    // $40,000 of other income in Colorado, $3,000 withheld: federal owes less
    // than $1,000 after withholding, so only Colorado's installment is due.
    const o = buildTaxOverview({ profile: { filing_status: 'single', state: 'CO', non_business_income: '40000', federal_withholding: '3000' }, year: 2026, businessProfit: 130.96, today: '2026-11-21' });
    expect(o.federalPlan.requiredFromEstimatedPayments).toBe(0);
    expect(o.nextDue).toEqual([{ who: 'Colorado', code: 'CO', period: 'Q4', due: '2027-01-15', amount: 739.35, installment: 184.83, catchUp: 554.52, remainingForYear: 739.35 }]);
    const none = buildTaxOverview({ profile: { filing_status: 'single', state: 'TX', non_business_income: '40000', federal_withholding: '6000' }, year: 2026, businessProfit: 100, today: '2026-11-21' });
    expect(none.nextDue).toEqual([]);
  });

  it('splits other income into wages and the rest, never more wages than income', () => {
    const input = profileToEstimateInput({ filing_status: 'mfj', non_business_income: '80000', wages: '120000', age65: true }, { year: 2026, businessProfit: 10 });
    expect([input.wages, input.otherIncome]).toEqual([80000, 0]);
    expect(input.age65).toEqual({ taxpayer: true, spouse: false });
    const partial = profileToEstimateInput({ filing_status: 'single', non_business_income: '60000', wages: '45000.5' }, { year: 2026, businessProfit: 0 });
    expect([partial.wages, partial.otherIncome]).toEqual([45000.5, 14999.5]);
  });

  it('falls back to a flat percentage without a profile or for an unsupported year', () => {
    const none = buildTaxOverview({ profile: null, year: 2026, businessProfit: 1000, today: '2026-11-21' });
    expect([none.personalizedAvailable, none.effectiveMode, none.recommended]).toEqual([false, 'flat', 250]);
    const future = buildTaxOverview({ profile: single, year: 2027, businessProfit: 1000, today: '2026-11-21' });
    expect(future.supportedYear).toBe(false);
    expect(future.limitations[0]).toMatch(/2027 isn't supported yet/);
  });

  it('says so when the state is not supported, and sets aside nothing on a loss', () => {
    const ny = buildTaxOverview({ profile: { ...single, state: 'NY' }, year: 2026, businessProfit: 20000, today: '2026-11-21' });
    expect(ny.stateSupport).toBe('unsupported');
    expect(ny.limitations.join(' ')).toMatch(/New York/);
    const loss = buildTaxOverview({ profile: { ...single, non_business_income: '50000', wages: '50000' }, year: 2026, businessProfit: -5000, today: '2026-11-21' });
    expect(loss.impact.additionalTaxFromBusiness).toBeLessThan(0);
    expect([loss.recommended, loss.stillToSetAside]).toEqual([0, 0]);
    expect(loss.impact.effectiveBusinessTaxRate).toBeNull();
  });

  it('lists every state with its coverage', () => {
    expect(stateOptions(2026)).toHaveLength(51);
    expect([stateSupport(2026, 'TX'), stateSupport(2026, 'CO'), stateSupport(2026, 'AZ'), stateSupport(2026, 'NY'), stateSupport(2025, 'CA'), stateSupport(2026, 'CA')]).toEqual(['none', 'verified', 'provisional', 'unsupported', 'verified', 'provisional']);
  });
});

describe('Sentry scrubbing', () => {
  const { scrubEvent } = require('../monitoring');
  it('drops bodies, query strings and cookies from tax and Schedule C requests only', () => {
    for (const url of ['https://api.example/api/tax/profile/2026?x=1', 'https://api.example/api/schedule-c/years/2026/1099-k', 'https://api.example/api/schedule-c?year=2026']) {
      const event = scrubEvent({ request: { url, data: '{"wages":"50000"}', query_string: 'x=1', cookies: { sid: 'a' } } });
      expect(event.request).toEqual({ url: url.split('?')[0] });
    }
    expect(scrubEvent({ request: { url: 'https://api.example/api/sales', data: 'kept' } }).request.data).toBe('kept');
    expect(scrubEvent({ request: { url: 'https://api.example/api/taxes-elsewhere', data: 'kept' } }).request.data).toBe('kept');
    expect(scrubEvent({ message: 'no request' })).toEqual({ message: 'no request' });
  });
});

describe('tax profile and tax-math routes', () => {
  const harness = require('../../qa/harness.cjs');
  let server; let base;
  beforeAll(async () => { server = harness.app().listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r)); base = `http://127.0.0.1:${server.address().port}`; });
  afterAll(() => server.close());
  beforeEach(() => { harness.reset(); harness.db.user[0].schedule_c_enabled = true; });
  const send = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const profile = { state: 'CO', filing_status: 'mfj', non_business_income: '90000', wages: '85000', federal_withholding: '6000', qualifying_children: 2, age65: false, reserve_mode: 'conservative', buffer_rate: '0.15' };

  it('saves, reads back, replaces and deletes a year\'s profile', async () => {
    expect((await send('GET', '/api/tax/profile/2026')).body).toEqual({ profile: null });
    const saved = await send('PUT', '/api/tax/profile/2026', profile);
    expect(saved.status).toBe(200);
    expect(saved.body.profile).toMatchObject({ year: 2026, state: 'CO', filing_status: 'mfj', non_business_income: 90000, qualifying_children: 2, reserve_mode: 'conservative', prior_year_tax: null, spouse_age65: false });
    // A save is a full replace: fields left out are cleared.
    await send('PUT', '/api/tax/profile/2026', { filing_status: 'single', non_business_income: '' });
    expect(harness.db.taxProfile).toHaveLength(1);
    expect(harness.db.taxProfile[0]).toMatchObject({ filing_status: 'single', state: null, non_business_income: null, federal_withholding: null, qualifying_children: null, reserve_mode: 'personalized' });
    // Years are separate.
    await send('PUT', '/api/tax/profile/2025', profile);
    expect((await send('GET', '/api/tax/profile/2025')).body.profile.state).toBe('CO');
    expect((await send('DELETE', '/api/tax/profile/2026')).body).toEqual({ deleted: 1 });
    expect((await send('GET', '/api/tax/profile/2026')).body.profile).toBeNull();
    expect(harness.db.taxProfile).toHaveLength(1);
  });

  it('refuses anything outside the allowed fields, including identity details', async () => {
    for (const bad of [{ ...profile, ssn: '123-45-6789' }, { ...profile, name: 'Pat' }, { ...profile, date_of_birth: '1960-01-01' },
      { ...profile, filing_status: 'married' }, { ...profile, state: 'XX' }, { ...profile, wages: '95000' }, { ...profile, federal_withholding: -1 },
      { ...profile, qualifying_children: 1.5 }, { ...profile, buffer_rate: 2 }, { ...profile, reserve_mode: 'guess' }, { state: 'CO' }]) {
      expect((await send('PUT', '/api/tax/profile/2026', bad)).status).toBe(400);
    }
    expect((await send('PUT', '/api/tax/profile/26', profile)).status).toBe(400);
    expect(harness.db.taxProfile).toHaveLength(0);
  });

  it('keeps each user\'s profile private and needs Schedule C turned on', async () => {
    harness.db.taxProfile.push({ id: 'theirs', user_id: harness.ids.other, year: 2026, filing_status: 'single', state: 'TX', non_business_income: 1 });
    expect((await send('GET', '/api/tax/profile/2026')).body.profile).toBeNull();
    expect((await send('DELETE', '/api/tax/profile/2026')).body).toEqual({ deleted: 0 });
    await send('PUT', '/api/tax/profile/2026', profile);
    expect(harness.db.taxProfile.find((r) => r.id === 'theirs')).toMatchObject({ user_id: harness.ids.other, state: 'TX' });
    harness.db.user[0].schedule_c_enabled = false;
    expect((await send('GET', '/api/tax/profile/2026')).status).toBe(403);
    expect((await send('PUT', '/api/tax/profile/2026', profile)).status).toBe(403);
    expect((await send('DELETE', '/api/tax/profile/2026')).status).toBe(403);
  });

  it('stores the Simple / Detailed choice with the other preferences', async () => {
    harness.db.user[0].accounting_preferences = JSON.stringify({ theme: 'x' });
    expect((await send('GET', '/api/preferences/tax-math')).body).toEqual({ taxMath: 'simple' });
    expect((await send('PUT', '/api/preferences/tax-math', { taxMath: 'detailed' })).body).toEqual({ taxMath: 'detailed' });
    expect(JSON.parse(harness.db.user[0].accounting_preferences)).toEqual({ theme: 'x', taxMath: 'detailed' });
    expect((await send('PUT', '/api/preferences/tax-math', { taxMath: 'verbose' })).status).toBe(400);
    expect((await send('PUT', '/api/preferences/tax-math', { taxMath: 'simple', extra: 1 })).status).toBe(400);
    expect((await send('GET', '/api/preferences/tax-math')).body).toEqual({ taxMath: 'detailed' });
  });
});
