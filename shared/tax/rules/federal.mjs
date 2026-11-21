// Federal individual income and self-employment tax parameters, one entry per
// tax year. Every value here was copied from the official source named in
// `sources` (no figures from memory). When a year's rules change, add a new
// `version` instead of editing a published one in place, so finalized reports
// can say which rules they were built with.
//
// Amounts are in whole dollars as published. Rates are decimals.
// Bracket lists are the upper bound of each rate; the last rate has no bound.

const RP_2024_40 = { label: 'Rev. Proc. 2024-40 (IRB 2024-45), tax year 2025 adjustments', url: 'https://www.irs.gov/irb/2024-45_IRB' };
const RP_2025_32 = { label: 'Rev. Proc. 2025-32 (IRB 2025-45), tax year 2026 adjustments', url: 'https://www.irs.gov/irb/2025-45_IRB' };
const OBBB_DEDUCTIONS = { label: 'IRS: New and enhanced deductions for individuals (OBBB standard deduction for 2025)', url: 'https://www.irs.gov/newsroom/new-and-enhanced-deductions-for-individuals' };
const SENIOR = { label: 'IRC §151(d)(5) and IRS fact sheet on the deduction for seniors', url: 'https://www.law.cornell.edu/uscode/text/26/151' };
const CTC = { label: 'IRS: Child Tax Credit and Credit for Other Dependents', url: 'https://www.irs.gov/credits-deductions/individuals/child-tax-credit-and-credit-for-other-dependents' };
const SSA_BASE = { label: 'SSA contribution and benefit base', url: 'https://www.ssa.gov/oact/COLA/cbb.html' };
const SCHEDULE_SE = { label: 'Schedule SE (Form 1040) and instructions', url: 'https://www.irs.gov/instructions/i1040sse' };
const FORM_8959 = { label: 'Instructions for Form 8959, Additional Medicare Tax', url: 'https://www.irs.gov/instructions/i8959' };
const FORM_8995 = { label: 'Instructions for Form 8995, Qualified Business Income Deduction', url: 'https://www.irs.gov/instructions/i8995' };
const PUB_505 = { label: 'Publication 505, Tax Withholding and Estimated Tax', url: 'https://www.irs.gov/publications/p505' };

// Statutory, not indexed (Form 8959 instructions: "aren't indexed for inflation").
const ADDITIONAL_MEDICARE = { rate: 0.009, threshold: { single: 200000, hoh: 200000, qss: 200000, mfj: 250000, mfs: 125000 } };
// Schedule SE: line 4a factor, $400 floor, 12.4% OASDI + 2.9% HI.
const SE = { netEarningsFactor: 0.9235, minimumNetEarnings: 400, socialSecurityRate: 0.124, medicareRate: 0.029 };
// Senior deduction, tax years 2025-2028: $6,000 per individual 65+, reduced by
// 6% of MAGI over $75,000 ($150,000 joint). Married couples must file jointly.
const SENIOR_DEDUCTION = { amount: 6000, phaseOutRate: 0.06, threshold: { single: 75000, hoh: 75000, qss: 75000, mfj: 150000 }, requiresJointIfMarried: true };

export const FEDERAL_RULES = {
  2025: {
    version: 'federal-2025.1',
    status: 'verified',
    lastVerified: '2026-11-21',
    sources: [RP_2024_40, OBBB_DEDUCTIONS, SENIOR, CTC, SSA_BASE, SCHEDULE_SE, FORM_8959, FORM_8995, PUB_505],
    brackets: {
      rates: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      single: [11925, 48475, 103350, 197300, 250525, 626350],
      mfj:    [23850, 96950, 206700, 394600, 501050, 751600],
      qss:    [23850, 96950, 206700, 394600, 501050, 751600],
      mfs:    [11925, 48475, 103350, 197300, 250525, 375800],
      hoh:    [17000, 64850, 103350, 197300, 250500, 626350],
    },
    // As amended by P.L. 119-21 (OBBB); Rev. Proc. 2024-40's $15,000 figures are superseded.
    standardDeduction: { single: 15750, mfs: 15750, mfj: 31500, qss: 31500, hoh: 23625 },
    agedOrBlind: { married: 1600, unmarried: 2000 },
    seniorDeduction: SENIOR_DEDUCTION,
    childTaxCredit: { perChild: 2200, refundablePerChild: 1700, otherDependent: 500, phaseOutStart: { mfj: 400000, other: 200000 }, phaseOutPer1000: 50, earnedIncomeFloor: 2500, refundableRate: 0.15 },
    socialSecurityWageBase: 176100,
    selfEmployment: SE,
    additionalMedicare: ADDITIONAL_MEDICARE,
    qbi: { rate: 0.20, threshold: { mfj: 394600, mfs: 197300, other: 197300 }, phaseInEnd: { mfj: 494600, mfs: 247300, other: 247300 }, minimumDeduction: null },
    excessBusinessLoss: { mfj: 626000, other: 313000 },
    estimatedTax: {
      safeHarborCurrentYear: 0.90,
      safeHarborPriorYear: 1.00,
      safeHarborPriorYearHighIncome: 1.10,
      highIncomeAgi: { mfs: 75000, other: 150000 },
      noPenaltyBelow: 1000,
      installments: [
        { period: 'Q1', covers: 'Jan 1 – Mar 31', due: '2025-04-15', share: 0.25 },
        { period: 'Q2', covers: 'Apr 1 – May 31', due: '2025-06-16', share: 0.25 },
        { period: 'Q3', covers: 'Jun 1 – Aug 31', due: '2025-09-15', share: 0.25 },
        { period: 'Q4', covers: 'Sep 1 – Dec 31', due: '2026-01-15', share: 0.25 },
      ],
    },
  },
  2026: {
    version: 'federal-2026.1',
    status: 'verified',
    lastVerified: '2026-11-21',
    sources: [RP_2025_32, SENIOR, CTC, SSA_BASE, SCHEDULE_SE, FORM_8959, FORM_8995, PUB_505],
    brackets: {
      rates: [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37],
      single: [12400, 50400, 105700, 201775, 256225, 640600],
      mfj:    [24800, 100800, 211400, 403550, 512450, 768700],
      qss:    [24800, 100800, 211400, 403550, 512450, 768700],
      mfs:    [12400, 50400, 105700, 201775, 256225, 384350],
      hoh:    [17700, 67450, 105700, 201750, 256200, 640600],
    },
    standardDeduction: { single: 16100, mfs: 16100, mfj: 32200, qss: 32200, hoh: 24150 },
    agedOrBlind: { married: 1650, unmarried: 2050 },
    seniorDeduction: SENIOR_DEDUCTION,
    childTaxCredit: { perChild: 2200, refundablePerChild: 1700, otherDependent: 500, phaseOutStart: { mfj: 400000, other: 200000 }, phaseOutPer1000: 50, earnedIncomeFloor: 2500, refundableRate: 0.15 },
    socialSecurityWageBase: 184500,
    selfEmployment: SE,
    additionalMedicare: ADDITIONAL_MEDICARE,
    // Rev. Proc. 2025-32 §4.26 lists the end of the phase-in range; the $400
    // minimum (QBI of at least $1,000) is new for years after 2025 (§2.12).
    qbi: { rate: 0.20, threshold: { mfj: 403500, mfs: 201775, other: 201750 }, phaseInEnd: { mfj: 553500, mfs: 276775, other: 276750 }, minimumDeduction: { amount: 400, minimumQbi: 1000 } },
    // 2026 excess business loss amount not yet captured from Rev. Proc. 2025-32;
    // the engine flags large losses instead of applying a limit.
    excessBusinessLoss: null,
    estimatedTax: {
      safeHarborCurrentYear: 0.90,
      safeHarborPriorYear: 1.00,
      safeHarborPriorYearHighIncome: 1.10,
      highIncomeAgi: { mfs: 75000, other: 150000 },
      noPenaltyBelow: 1000,
      installments: [
        { period: 'Q1', covers: 'Jan 1 – Mar 31', due: '2026-04-15', share: 0.25 },
        { period: 'Q2', covers: 'Apr 1 – May 31', due: '2026-06-15', share: 0.25 },
        { period: 'Q3', covers: 'Jun 1 – Aug 31', due: '2026-09-15', share: 0.25 },
        { period: 'Q4', covers: 'Sep 1 – Dec 31', due: '2027-01-15', share: 0.25 },
      ],
    },
  },
};

export const SUPPORTED_FEDERAL_YEARS = Object.keys(FEDERAL_RULES).map(Number);
