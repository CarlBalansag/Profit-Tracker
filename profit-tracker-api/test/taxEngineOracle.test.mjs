// Cross-checks shared/tax against an independent model: PSLmodels
// Tax-Calculator (CC0), run offline on synthetic households by
// scripts/tax-oracle/generate_fixtures.py. Tax-Calculator rounds some
// intermediate steps differently, so amounts must agree within $2.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { estimateTaxes } from '../../shared/tax/index.mjs';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/taxcalcOracle.json', import.meta.url), 'utf8'));
const TOLERANCE = 2;

function ours({ taxYear, filingStatus, businessProfit, wages, qualifyingChildren, age65 }) {
  const r = estimateTaxes({ taxYear, filingStatus, state: 'TX', businessProfit, wages,
    dependents: { qualifyingChildren }, age65: { taxpayer: age65, spouse: age65 && filingStatus === 'mfj' } });
  return {
    agi: r.federal.agi,
    taxableIncome: r.federal.taxableIncome,
    qbiDeduction: r.federal.qbiDeduction,
    incomeTaxBeforeCredits: r.federal.incomeTax,
    selfEmploymentTax: r.federal.selfEmployment.total,
    additionalMedicareTax: r.federal.additionalMedicareTax,
  };
}

describe(`federal engine vs ${fixtures.generator}`, () => {
  it(`has fixtures for both years and every filing status (${fixtures.cases.length} households)`, () => {
    expect(new Set(fixtures.cases.map((f) => f.input.taxYear))).toEqual(new Set([2025, 2026]));
    expect(new Set(fixtures.cases.map((f) => f.input.filingStatus))).toEqual(new Set(['single', 'mfj', 'mfs', 'hoh']));
  });

  it('agrees on AGI, taxable income, QBI, income tax, SE tax and Additional Medicare tax', () => {
    const mismatches = [];
    for (const { input, taxcalc } of fixtures.cases) {
      const mine = ours(input);
      for (const [key, expected] of Object.entries(taxcalc)) {
        // Known difference: with under $400 of net SE earnings, Schedule SE
        // stops before line 6, so Form 8959 Part II has no SE income to tax.
        // Tax-Calculator still applies 0.9% to it. The engine follows the forms.
        if (key === 'additionalMedicareTax' && input.businessProfit > 0 && input.businessProfit * 0.9235 < 400) continue;
        if (Math.abs(mine[key] - expected) > TOLERANCE) mismatches.push({ input, key, ours: mine[key], taxcalc: expected });
      }
    }
    expect(mismatches.slice(0, 10)).toEqual([]);
  });
});
