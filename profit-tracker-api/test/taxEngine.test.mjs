// Tax engine tests. Expected values come from official IRS/statute figures
// (named on each test), from form rules applied step by step, or from the
// Tax-Calculator oracle fixtures in taxEngineOracle.test.mjs -- never from
// numbers made up for the test.
import { describe, expect, it } from 'vitest';
import {
  bracketTax, businessTaxImpact, estimateTaxes, federalEstimatedPayments, qbiDeduction,
  reserveRecommendations, selfEmploymentTax, FEDERAL_RULES, FILING_STATUSES, STATE_NAMES, STATE_RULES,
} from '../../shared/tax/index.mjs';

const c = (dollars) => Math.round(dollars * 100);
const R25 = FEDERAL_RULES[2025];
const R26 = FEDERAL_RULES[2026];

describe('rate schedules', () => {
  // Rev. Proc. 2024-40 §2.01: "The tax is" amount at the bottom of each band.
  const published2025 = {
    single: [[11925, 1192.5], [48475, 5578.5], [103350, 17651], [197300, 40199], [250525, 57231], [626350, 188769.75]],
    mfj: [[23850, 2385], [96950, 11157], [206700, 35302], [394600, 80398], [501050, 114462], [751600, 202154.5]],
    hoh: [[17000, 1700], [64850, 7442], [103350, 15912], [197300, 38460], [250500, 55484], [626350, 187031.5]],
    mfs: [[11925, 1192.5], [48475, 5578.5], [103350, 17651], [197300, 40199], [250525, 57231], [375800, 101077.25]],
  };
  for (const [status, rows] of Object.entries(published2025)) {
    it(`2025 ${status} matches Rev. Proc. 2024-40 at every bracket boundary`, () => {
      for (const [income, tax] of rows) expect(bracketTax(c(income), R25.brackets[status], R25.brackets.rates)).toBe(c(tax));
    });
  }

  // Pub. 505 (2026) "2026 Tax Rate Schedules" base amounts. Read from a
  // summary of the page, not verbatim -- re-confirm against the printed page.
  const published2026 = {
    single: [[12400, 1240], [50400, 5800], [105700, 17966], [201775, 41024], [256225, 58448], [640600, 192979.25]],
    mfj: [[24800, 2480], [100800, 11600], [211400, 35932], [403550, 82048], [512450, 116896], [768700, 206583.5]],
    hoh: [[17700, 1770], [67450, 7740], [105700, 16155], [201750, 39207], [256200, 56631], [640600, 191171]],
    mfs: [[12400, 1240], [50400, 5800], [105700, 17966], [201775, 41024], [256225, 58448], [384350, 103291.75]],
  };
  for (const [status, rows] of Object.entries(published2026)) {
    it(`2026 ${status} matches the Pub. 505 rate schedule at every bracket boundary`, () => {
      for (const [income, tax] of rows) expect(bracketTax(c(income), R26.brackets[status], R26.brackets.rates)).toBe(c(tax));
    });
  }

  it('applies the next rate one dollar past a boundary and handles zero', () => {
    expect(bracketTax(c(12401), R26.brackets.single, R26.brackets.rates)).toBe(c(1240.12));
    expect(bracketTax(0, R26.brackets.single, R26.brackets.rates)).toBe(0);
    expect(bracketTax(c(1000000), R26.brackets.single, R26.brackets.rates)).toBe(c(192979.25 + 0.37 * (1000000 - 640600)));
  });
});

describe('self-employment tax (Schedule SE)', () => {
  const se = (profit, opts = {}) => selfEmploymentTax(c(profit), { rules: R26, filingStatus: 'single', ...opts });

  it('owes nothing below $400 of net earnings (line 4a = profit x 92.35%)', () => {
    expect(se(433).total).toBe(0); // 433 x 0.9235 = 399.88
    expect(se(434).total).toBeGreaterThan(0); // 400.80
    expect(se(-2000).total).toBe(0);
  });

  it('computes 12.4% + 2.9% of net earnings and deducts half', () => {
    const r = se(50000); // net 46,175.00
    expect(r.netEarnings).toBe(c(46175));
    expect(r.socialSecurity).toBe(c(5725.7));
    expect(r.medicare).toBe(c(1339.08));
    expect(r.deduction).toBe(c(3532.39));
  });

  it('stops the 12.4% at the wage base, reduced by W-2 social security wages (lines 8a-9)', () => {
    expect(se(300000).socialSecurity).toBe(c(184500 * 0.124));
    expect(se(50000, { ssWagesCents: c(184500) }).socialSecurity).toBe(0);
    expect(se(50000, { ssWagesCents: c(160000) }).socialSecurity).toBe(c(24500 * 0.124));
    expect(selfEmploymentTax(c(300000), { rules: R25, filingStatus: 'single' }).socialSecurity).toBe(c(176100 * 0.124));
  });

  it('matches the Form 8959 instructions example: $130,000 wages, $140,000 SE income, MFJ = $180', () => {
    // Profit chosen so Schedule SE line 6 is $140,000.
    const r = selfEmploymentTax(c(151597.185), { rules: R25, filingStatus: 'mfj', ssWagesCents: c(130000), medicareWagesCents: c(130000) });
    expect(r.netEarnings).toBe(c(140000));
    expect(r.additionalMedicare).toBe(c(180));
  });
});

describe('QBI deduction (Form 8995 / 8995-A)', () => {
  const q = (qbi, taxable, opts = {}) => qbiDeduction(c(qbi), c(taxable), { rules: R26, filingStatus: 'single', ...opts });

  it('is 20% of QBI below the threshold, capped at 20% of taxable income', () => {
    expect(q(40000, 100000).deduction).toBe(c(8000));
    expect(q(40000, 20000)).toMatchObject({ deduction: c(4000), limitedBy: 'taxable-income' });
  });

  it('phases out with no W-2 wages or property above the threshold (non-service business)', () => {
    // Midpoint of the $201,750 - $276,750 range removes half of the $8,000.
    expect(q(40000, 239250)).toMatchObject({ deduction: c(4000), limitedBy: 'phase-in' });
    expect(q(40000, 276750).component).toBe(0);
  });

  it('keeps the wage/property limit when it is higher than zero', () => {
    expect(q(40000, 300000, { w2WagesCents: c(10000) }).deduction).toBe(c(5000));
    expect(q(40000, 300000, { ubiaCents: c(100000) }).deduction).toBe(c(2500));
  });

  it('applies the 2026 $400 minimum only with at least $1,000 of QBI, and not in 2025', () => {
    expect(q(1500, 100000).deduction).toBe(c(400)); // 20% = $300
    expect(q(999, 100000).deduction).toBe(c(199.8));
    expect(q(40000, 300000)).toMatchObject({ deduction: c(400), limitedBy: 'minimum' });
    expect(qbiDeduction(c(1500), c(100000), { rules: R25, filingStatus: 'single' }).deduction).toBe(c(300));
  });

  it('gives nothing for a loss and says it carries forward', () => {
    const r = q(-5000, 50000);
    expect(r.deduction).toBe(0);
    expect(r.notes.join(' ')).toMatch(/carries forward/);
  });

  it('uses the joint and separate thresholds', () => {
    expect(q(40000, 400000, { filingStatus: 'mfj' }).deduction).toBe(c(8000));
    expect(q(40000, 239275, { filingStatus: 'mfs' }).deduction).toBe(c(4000));
  });
});

describe('estimateTaxes', () => {
  const base = { taxYear: 2026, filingStatus: 'single', state: 'TX' };

  it('walks a single filer with only business profit through every step', () => {
    const r = estimateTaxes({ ...base, businessProfit: 50000 });
    const f = r.federal;
    expect(f.selfEmployment.total).toBe(7064.78);
    expect(f.agi).toBe(50000 - 3532.39);
    expect(f.taxableBeforeQbi).toBe(46467.61 - 16100);
    // QBI $46,467.61 x 20% = $9,293.52, capped at 20% of $30,367.61 taxable income.
    expect(f.qbiDeduction).toBe(6073.52);
    expect(f.qbiLimitedBy).toBe('taxable-income');
    expect(f.taxableIncome).toBe(24294.09);
    // Schedule X: $1,240 + 12% of ($24,294.09 - $12,400).
    expect(f.incomeTax).toBe(2667.29);
    expect(f.totalTax).toBe(9732.07);
    expect(r.state).toMatchObject({ code: 'TX', supported: true, tax: 0 });
    expect(r.limitations).toEqual([]);
    expect(r.ruleVersions.federal).toBe('federal-2026.1');
  });

  it('calculates every filing status without invalid numbers', () => {
    for (const filingStatus of FILING_STATUSES) {
      const r = estimateTaxes({ ...base, filingStatus, businessProfit: 80000, wages: 40000 });
      expect(r.supported).toBe(true);
      expect(Number.isFinite(r.totalTax)).toBe(true);
      expect(r.federal.deduction).toBe(R26.standardDeduction[filingStatus]);
    }
  });

  it('refuses unsupported years and missing filing status with a reason', () => {
    expect(estimateTaxes({ ...base, taxYear: 2027 })).toMatchObject({ supported: false });
    expect(estimateTaxes({ ...base, taxYear: 2027 }).limitations[0]).toMatch(/2027 is not supported/);
    expect(estimateTaxes({ taxYear: 2026 }).limitations[0]).toMatch(/filing status/);
  });

  it('treats blank and missing numbers as zero', () => {
    const r = estimateTaxes({ ...base, businessProfit: '', wages: undefined, otherIncome: 'abc' });
    expect(r.totalTax).toBe(0);
  });

  it('lets a business loss offset wages, with no SE tax and no QBI', () => {
    const r = estimateTaxes({ ...base, wages: 60000, businessProfit: -5000 });
    expect(r.federal.agi).toBe(55000);
    expect(r.federal.selfEmployment.total).toBe(0);
    expect(r.federal.qbiDeduction).toBe(0);
    expect(r.notes.join(' ')).toMatch(/carries forward/);
    expect(r.assumptions.join(' ')).toMatch(/loss is assumed to be fully deductible/);
  });

  it('adds the aged/blind amounts by marital status (Rev. Proc. 2025-32 §4.14(3))', () => {
    expect(estimateTaxes({ ...base, age65: { taxpayer: true } }).federal.deduction).toBe(16100 + 2050);
    expect(estimateTaxes({ ...base, filingStatus: 'mfj', age65: { taxpayer: true, spouse: true }, blind: { spouse: true } }).federal.deduction).toBe(32200 + 3 * 1650);
  });

  it('applies the senior deduction with the 6% phase-out (IRC §151(d)(5)(C))', () => {
    // MAGI $85,000: 6% of $10,000 = $600 off the $6,000.
    expect(estimateTaxes({ ...base, wages: 85000, age65: { taxpayer: true } }).federal.seniorDeduction).toBe(5400);
    expect(estimateTaxes({ ...base, wages: 175000, age65: { taxpayer: true } }).federal.seniorDeduction).toBe(0);
    expect(estimateTaxes({ ...base, filingStatus: 'mfj', wages: 160000, age65: { taxpayer: true, spouse: true } }).federal.seniorDeduction).toBe(2 * 5400);
    expect(estimateTaxes({ ...base, filingStatus: 'mfs', wages: 50000, age65: { taxpayer: true } }).federal.seniorDeduction).toBe(0);
  });

  it('applies the child tax credit, its $50-per-$1,000 phase-out and the refundable part', () => {
    const two = { qualifyingChildren: 2 };
    expect(estimateTaxes({ ...base, filingStatus: 'mfj', wages: 120000, dependents: two }).federal.nonrefundableCredits).toBe(4400);
    // $10,000.01 over $200,000 counts as 11 steps of $1,000 (fraction rounds up).
    const phased = estimateTaxes({ ...base, filingStatus: 'hoh', wages: 210000.01, dependents: two });
    expect(phased.federal.nonrefundableCredits).toBe(4400 - 11 * 50);
    // Little income tax: refundable part is 15% of earned income over $2,500, capped at $1,700 a child.
    const low = estimateTaxes({ ...base, filingStatus: 'hoh', wages: 20000, dependents: two });
    expect(low.federal.incomeTax).toBe(0);
    expect(low.federal.refundableCredits).toBe(2625);
    expect(low.federal.totalTax).toBe(-2625);
  });

  it('adds Additional Medicare tax on wages over the threshold', () => {
    expect(estimateTaxes({ ...base, wages: 250000 }).federal.additionalMedicareTax).toBe(450);
  });

  it('subtracts withholding and estimated payments from the balance', () => {
    const r = estimateTaxes({ ...base, businessProfit: 50000, federalWithholding: 1000, federalEstimatedPayments: 2000 });
    expect(r.federal.balance).toBe(Math.round((r.federal.totalTax - 3000) * 100) / 100);
    expect(r.remainingBalance).toBe(r.federal.balance);
  });

  it('lists unsupported situations as limitations instead of estimating them', () => {
    const r = estimateTaxes({ ...base, flags: { hasCapitalGains: true, claimsEitc: true } });
    expect(r.limitations).toHaveLength(2);
  });
});

describe('states', () => {
  it('covers all 50 states and DC for each supported year', () => {
    for (const year of [2025, 2026]) expect(Object.keys(STATE_RULES[year]).sort()).toEqual(Object.keys(STATE_NAMES).sort());
    expect(Object.keys(STATE_NAMES)).toHaveLength(51);
  });

  it('charges no state tax in the nine no-income-tax states', () => {
    for (const code of ['AK', 'FL', 'NV', 'NH', 'SD', 'TN', 'TX', 'WA', 'WY']) {
      const r = estimateTaxes({ taxYear: 2026, filingStatus: 'single', state: code, businessProfit: 90000 });
      expect(r.state).toMatchObject({ supported: true, tax: 0 });
      expect(r.limitations).toEqual([]);
    }
  });

  it('never estimates an unverified state; it says it is not included', () => {
    const unsupported = Object.entries(STATE_RULES[2026]).filter(([, rule]) => rule.status === 'unsupported').map(([code]) => code);
    expect(unsupported).toHaveLength(27); // California added 2026-11-22
    for (const code of unsupported) {
      const r = estimateTaxes({ taxYear: 2026, filingStatus: 'single', state: code, businessProfit: 90000 });
      expect(r.state.supported).toBe(false);
      expect(r.state.tax).toBe(0);
      expect(r.limitations.join(' ')).toMatch(/not supported yet/);
    }
  });

  it('asks for a state when none or an unknown code is given', () => {
    expect(estimateTaxes({ taxYear: 2026, filingStatus: 'single' }).limitations[0]).toMatch(/Choose a state/);
    expect(estimateTaxes({ taxYear: 2026, filingStatus: 'single', state: 'ZZ' }).limitations[0]).toMatch(/Choose a state/);
  });
});

describe('businessTaxImpact', () => {
  const base = { taxYear: 2026, filingStatus: 'single', state: 'FL', wages: 60000 };

  it('is the tax with the business minus the tax without it', () => {
    const r = businessTaxImpact({ ...base, businessProfit: 30000 });
    expect(r.additionalTaxFromBusiness).toBe(Math.round((r.withBusiness.totalTax - r.withoutBusiness.totalTax) * 100) / 100);
    expect(r.withoutBusiness.federal.selfEmployment.total).toBe(0);
    expect(r.effectiveBusinessTaxRate).toBeCloseTo(r.additionalTaxFromBusiness / 30000, 4);
    // 22% bracket + 15.3% SE on 92.35%, less the QBI and half-SE effects.
    expect(r.marginalRate).toBeGreaterThan(0.28);
    expect(r.marginalRate).toBeLessThan(0.34);
  });

  it('has no business rate at zero profit and a negative extra tax for a loss', () => {
    expect(businessTaxImpact({ ...base, businessProfit: 0 })).toMatchObject({ additionalTaxFromBusiness: 0, effectiveBusinessTaxRate: null });
    const loss = businessTaxImpact({ ...base, businessProfit: -4000 });
    expect(loss.additionalTaxFromBusiness).toBeLessThan(0);
    expect(loss.effectiveBusinessTaxRate).toBeNull();
  });

  it('passes unsupported inputs through as limitations', () => {
    expect(businessTaxImpact({ taxYear: 1999, filingStatus: 'single' })).toMatchObject({ supported: false });
  });
});

describe('federal estimated payments (Pub. 505)', () => {
  it('matches the Pub. 505 (2026) required annual payment example: 110% of $42,581 = $46,839', () => {
    const r = federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 71253, priorYear: { totalTax: 42581, agi: 180000 } });
    expect(Math.round(r.requiredAnnualPayment)).toBe(46839);
    expect(r.basis).toBe('prior-year-110');
  });

  it('uses 100% of last year when prior AGI is $150,000 or less, and 90% of this year when lower', () => {
    expect(federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 20000, priorYear: { totalTax: 15000, agi: 150000 } }))
      .toMatchObject({ requiredAnnualPayment: 15000, basis: 'prior-year-100' });
    expect(federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 10000, priorYear: { totalTax: 15000, agi: 90000 } }))
      .toMatchObject({ requiredAnnualPayment: 9000, basis: 'current-year' });
    expect(federalEstimatedPayments({ taxYear: 2026, filingStatus: 'mfs', currentYearTax: 50000, priorYear: { totalTax: 10000, agi: 80000 } }).basis).toBe('prior-year-110');
  });

  it('splits what is left after withholding into four dated installments that add up', () => {
    const r = federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 10000.01, withholding: 1000 });
    expect(r.requiredFromEstimatedPayments).toBe(8000.01);
    expect(r.installments.map((i) => i.due)).toEqual(['2026-04-15', '2026-06-15', '2026-09-15', '2027-01-15']);
    expect(r.installments.reduce((s, i) => s + c(i.amount), 0)).toBe(c(8000.01));
    expect(r.installments.at(-1).cumulativeRequired).toBe(8000.01);
    expect(r.notes.join(' ')).toMatch(/prior-year safe harbor/);
  });

  it('requires nothing under $1,000 owed after withholding, or after a zero-tax prior year', () => {
    expect(federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 1500, withholding: 600 }).requiredFromEstimatedPayments).toBe(0);
    const zeroPrior = federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 8000, priorYear: { totalTax: 0, agi: 20000 } });
    expect(zeroPrior.requiredAnnualPayment).toBe(0);
  });

  it('tracks payments made and uses the 2025 June 16 due date', () => {
    expect(federalEstimatedPayments({ taxYear: 2026, filingStatus: 'single', currentYearTax: 10000, paymentsMade: 4000 }).remaining).toBe(5000);
    expect(federalEstimatedPayments({ taxYear: 2025, filingStatus: 'single', currentYearTax: 10000 }).installments[1].due).toBe('2025-06-16');
  });
});

describe('reserveRecommendations', () => {
  it('offers personalized, flat and buffered amounts and never reserves on a loss', () => {
    expect(reserveRecommendations({ businessProfit: 10000, personalizedAdditionalTax: 2500, flatRate: 0.25, bufferRate: 0.1 }))
      .toEqual({ personalized: 2500, flat: 2500, conservative: 2750 });
    expect(reserveRecommendations({ businessProfit: -500, flatRate: 0.3 })).toEqual({ personalized: null, flat: 0, conservative: 0 });
    expect(reserveRecommendations({ businessProfit: 1000 })).toEqual({ personalized: null, flat: null, conservative: null });
  });
});
