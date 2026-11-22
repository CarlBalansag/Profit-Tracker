// California income tax (FTB Form 540) and estimated payments (540-ES), from
// FTB's published 2025 and 2026 rate schedules and instructions.
import { describe, expect, it } from 'vitest';
import { stateIncomeTax, stateEstimatedPayments, STATE_RULES, buildTaxOverview, taxDeadlines } from '../../shared/tax/index.mjs';

const ctx = (agi, filingStatus = 'single', extra = {}) => ({
  filingStatus, agi: Math.round(agi * 100), federalTaxable: 0, federalDeduction: 0, qbi: 0,
  qualifyingChildren: 0, otherDependents: 0, age65: {}, blind: {}, ...extra,
});
const ca = (year, agi, fs, extra) => stateIncomeTax('CA', year, ctx(agi, fs, extra));

describe('California rate schedules as transcribed', () => {
  it('chain: each row\'s base tax is the previous base plus its rate across the bracket', () => {
    for (const year of [2025, 2026]) {
      for (const [name, rows] of Object.entries(STATE_RULES[year].CA.brackets)) {
        for (let i = 1; i < rows.length; i++) {
          const [over0, base0, rate0] = rows[i - 1];
          const [over1, base1] = rows[i];
          expect(Math.abs(base0 + rate0 * (over1 - over0) - base1), `${year} ${name} row ${i}`).toBeLessThan(0.011);
        }
        expect(rows.map((r) => r[2])).toEqual([0.01, 0.02, 0.04, 0.06, 0.08, 0.093, 0.103, 0.113, 0.123]);
      }
    }
  });
});

describe('California income tax', () => {
  it('AGI less the standard deduction, on schedule X/Y/Z, less exemption credits', () => {
    // 2025 single, AGI 50,000: taxable 44,294 -> 1,022.01 + 6% x 2,842 = 1,192.53, less 153.
    const single = ca(2025, 50000, 'single');
    expect([single.supported, single.status, single.taxableIncome / 100, single.tax / 100]).toEqual([true, 'verified', 44294, 1039.53]);
    // 2025 joint, AGI 100,000: taxable 88,588 -> 2,044.02 + 6% x 5,684 = 2,385.06, less 306.
    expect(ca(2025, 100000, 'mfj').tax / 100).toBe(2079.06);
    // Head of household uses schedule Z and the joint-sized standard deduction.
    const hoh = ca(2025, 60000, 'hoh');
    expect(hoh.taxableIncome / 100).toBe(48588);
    // 221.73 + 2% x (48,588 - 22,173) = 750.03, less 153.
    expect(hoh.tax / 100).toBe(597.03);
    expect(hoh.steps.find((s) => s.label.startsWith('Tax from schedule Z'))).toBeTruthy();
  });

  it('adds senior and blind boxes and dependents (2026 amounts)', () => {
    // Joint, AGI 120,000, one spouse 65+, two children: taxable 108,200 ->
    // 2,113.48 + 6% x 22,478 = 3,462.16; credits 3 x 158 + 2 x 491 = 1,456.
    const r = ca(2026, 120000, 'mfj', { age65: { taxpayer: true }, qualifyingChildren: 2 });
    expect([r.status, r.taxableIncome / 100, r.tax / 100]).toEqual(['provisional', 108200, 2006.16]);
    expect(r.notes[0]).toMatch(/2025's are used/);
  });

  it('phases the credits out above the AGI threshold ($1,250 steps when filing separately)', () => {
    // Single 300,000: 47,797 over -> 20 steps x $6 = $120 off the $153 credit.
    const s = ca(2025, 300000, 'single');
    expect(s.tax / 100).toBe(23774.98);
    expect(s.steps.find((x) => x.label === 'Exemption credits').amount / 100).toBe(-33);
    // Separate 260,000: 7,797 over -> 7 steps of $1,250 -> $42 off.
    expect(ca(2025, 260000, 'mfs').tax / 100).toBe(19976.98);
  });

  it('adds the 1% Behavioral Health Services Tax over $1,000,000 of taxable income', () => {
    const r = ca(2025, 1200000, 'single');
    expect(r.steps.find((x) => x.label.startsWith('Behavioral Health')).amount / 100).toBe(1942.94);
    expect(r.tax / 100).toBe(129677.72);
    expect(r.rate).toBeCloseTo(0.133, 6);
  });

  it('is part of the estimate, with its own sources and limits', () => {
    const o = buildTaxOverview({ profile: { filing_status: 'single', state: 'CA', non_business_income: '0' }, year: 2026, businessProfit: 40000, today: '2026-11-22' });
    expect(o.stateSupport).toBe('provisional');
    expect(o.impact.withBusiness.state).toMatchObject({ name: 'California', supported: true });
    expect(o.impact.withBusiness.state.tax).toBeGreaterThan(0);
    expect(o.sources.state.map((s) => s.url).join(' ')).toMatch(/ftb\.ca\.gov/);
    expect(o.impact.withBusiness.state.notes.join(' ')).toMatch(/renter's credit, CalEITC/);
  });
});

describe('California estimated payments', () => {
  const est = (args) => stateEstimatedPayments({ taxYear: 2026, state: 'CA', filingStatus: 'single', ...args });

  it('splits 30% / 40% / 30% in April, June and January, with no September payment', () => {
    const r = est({ currentYearTax: 2000, agi: 60000 });
    expect(r.installments.map((i) => [i.period, i.due, i.amount])).toEqual([['Q1', '2026-04-15', 540], ['Q2', '2026-06-15', 720], ['Q4', '2027-01-15', 540]]);
    expect(r.notes.join(' ')).toMatch(/nothing in September/);
    expect(stateEstimatedPayments({ taxYear: 2025, state: 'CA', filingStatus: 'single', currentYearTax: 1000 }).installments[1].due).toBe('2025-06-16');
  });

  it('is required from $500 owed ($250 when filing separately)', () => {
    expect(est({ currentYearTax: 499 }).required).toBe(false);
    expect(est({ currentYearTax: 500 }).required).toBe(true);
    expect(est({ filingStatus: 'mfs', currentYearTax: 260 }).required).toBe(true);
    expect(est({ filingStatus: 'mfs', currentYearTax: 249 }).required).toBe(false);
  });

  it('uses 110% of last year over $150,000 AGI, and only this year from $1,000,000', () => {
    const high = est({ currentYearTax: 20000, agi: 200000, priorYear: { totalTax: 10000, agi: 160000 } });
    expect([high.basis, high.requiredAnnualPayment]).toEqual(['prior-year-high-income', 11000]);
    const million = est({ currentYearTax: 100000, agi: 1000000, priorYear: { totalTax: 10000, agi: 900000 } });
    expect([million.basis, million.requiredAnnualPayment]).toEqual(['current-year', 90000]);
    expect(million.notes.join(' ')).toMatch(/based on this year's tax/);
  });

  it('puts the three California dates on the calendar', () => {
    const d = taxDeadlines({ year: 2026, state: 'CA' }).filter((x) => x.jurisdiction === 'CA');
    expect(d.map((x) => [x.period, x.date])).toEqual([['Q1', '2026-04-15'], ['Q2', '2026-06-15'], ['Q4', '2027-01-15']]);
  });
});
