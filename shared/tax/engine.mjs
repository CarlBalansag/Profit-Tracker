// Deterministic personal tax estimate for a US sole proprietor (Schedule C).
// Runs the same in the browser and the API: no I/O, no clock, no saved data.
//
// All arithmetic is in integer cents. Inputs are dollars (numbers or numeric
// strings); outputs are dollars rounded to cents.
//
// Anything the engine does not model is reported in `limitations` rather than
// silently estimated, and everything it assumed is listed in `assumptions`.
import { FEDERAL_RULES } from './rules/federal.mjs';
import { stateIncomeTax } from './stateTax.mjs';

export const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh', 'qss'];
const MARRIED = new Set(['mfj', 'mfs']);

const toCents = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};
const toDollars = (cents) => Math.round(cents) / 100;
const times = (cents, rate) => Math.round(cents * rate);
const pos = (cents) => Math.max(0, cents);
const D = (dollars) => Math.round(dollars * 100);

/** Tax on taxable income from a bracket table, exactly (no Tax Table rounding). */
export function bracketTax(taxableCents, bounds, rates) {
  let tax = 0;
  let lower = 0;
  for (let i = 0; i < rates.length; i++) {
    const upper = i < bounds.length ? D(bounds[i]) : Infinity;
    if (taxableCents <= lower) break;
    tax += (Math.min(taxableCents, upper) - lower) * rates[i];
    lower = upper;
  }
  return Math.round(tax);
}

function marginalBracketRate(taxableCents, bounds, rates) {
  for (let i = 0; i < bounds.length; i++) if (taxableCents < D(bounds[i])) return rates[i];
  return rates[rates.length - 1];
}

/** Schedule SE plus Form 8959 Part II, in cents. */
export function selfEmploymentTax(seProfitCents, { ssWagesCents = 0, medicareWagesCents = 0, rules, filingStatus }) {
  const se = rules.selfEmployment;
  const netEarnings = seProfitCents > 0 ? times(seProfitCents, se.netEarningsFactor) : seProfitCents;
  if (netEarnings < D(se.minimumNetEarnings)) {
    return { netEarnings: pos(netEarnings), socialSecurity: 0, medicare: 0, total: 0, deduction: 0, additionalMedicare: 0, belowMinimum: true };
  }
  const ssRoom = pos(D(rules.socialSecurityWageBase) - ssWagesCents);
  const socialSecurity = times(Math.min(netEarnings, ssRoom), se.socialSecurityRate);
  const medicare = times(netEarnings, se.medicareRate);
  const total = socialSecurity + medicare;
  const threshold = pos(D(rules.additionalMedicare.threshold[filingStatus]) - medicareWagesCents);
  const additionalMedicare = times(pos(netEarnings - threshold), rules.additionalMedicare.rate);
  return { netEarnings, socialSecurity, medicare, total, deduction: Math.round(total / 2), additionalMedicare, belowMinimum: false };
}

/** Form 8995 / 8995-A Part III for one non-service business, in cents. */
export function qbiDeduction(qbiCents, taxableBeforeQbiCents, { rules, filingStatus, w2WagesCents = 0, ubiaCents = 0 }) {
  const q = rules.qbi;
  const key = filingStatus === 'mfj' ? 'mfj' : filingStatus === 'mfs' ? 'mfs' : 'other';
  const notes = [];
  if (qbiCents <= 0) {
    if (qbiCents < 0) notes.push('Your business shows a loss, so there is no QBI deduction this year. The loss carries forward and lowers next year\'s QBI deduction.');
    return { deduction: 0, component: 0, limitedBy: qbiCents < 0 ? 'loss' : 'none', notes };
  }
  const full = times(qbiCents, q.rate);
  const threshold = D(q.threshold[key]);
  const end = D(q.phaseInEnd[key]);
  const wageLimit = Math.max(times(w2WagesCents, 0.5), times(w2WagesCents, 0.25) + times(ubiaCents, 0.025));
  let component = full;
  let limitedBy = 'none';
  if (taxableBeforeQbiCents >= end) {
    component = Math.min(full, wageLimit);
    if (component < full) limitedBy = 'wage-and-property';
  } else if (taxableBeforeQbiCents > threshold && wageLimit < full) {
    component = full - Math.round((full - wageLimit) * (taxableBeforeQbiCents - threshold) / (end - threshold));
    limitedBy = 'phase-in';
  }
  if (limitedBy !== 'none') notes.push('Your income is above the QBI threshold, so the deduction is limited by W-2 wages paid and business property. This assumes you paid no employees unless you entered wages, and that reselling is not a specified service business.');
  let deduction = Math.min(component, times(pos(taxableBeforeQbiCents), q.rate));
  if (deduction < component) limitedBy = limitedBy === 'none' ? 'taxable-income' : limitedBy;
  const min = q.minimumDeduction;
  if (min && qbiCents >= D(min.minimumQbi) && deduction < D(min.amount)) {
    deduction = D(min.amount);
    limitedBy = 'minimum';
    notes.push(`The $${min.amount} minimum QBI deduction applies (QBI of at least $${min.minimumQbi.toLocaleString('en-US')}, assuming you materially participate in the business).`);
  }
  return { deduction, component, limitedBy, notes };
}

function standardDeduction(input, rules) {
  const fs = input.filingStatus;
  let amount = D(rules.standardDeduction[fs]);
  const extra = D(MARRIED.has(fs) || fs === 'qss' ? rules.agedOrBlind.married : rules.agedOrBlind.unmarried);
  const boxes = [input.age65?.taxpayer, input.blind?.taxpayer, ...(fs === 'mfj' ? [input.age65?.spouse, input.blind?.spouse] : [])].filter(Boolean).length;
  amount += boxes * extra;
  return amount;
}

function seniorDeduction(input, rules, magiCents) {
  const s = rules.seniorDeduction;
  if (!s) return 0;
  const fs = input.filingStatus;
  if (fs === 'mfs') return 0;
  const people = [input.age65?.taxpayer, fs === 'mfj' ? input.age65?.spouse : false].filter(Boolean).length;
  if (!people) return 0;
  const each = pos(D(s.amount) - times(pos(magiCents - D(s.threshold[fs] ?? s.threshold.single)), s.phaseOutRate));
  return each * people;
}

function childCredits(input, rules, { magiCents, incomeTaxCents, earnedCents }) {
  const c = rules.childTaxCredit;
  const kids = Math.max(0, Math.floor(Number(input.dependents?.qualifyingChildren) || 0));
  const others = Math.max(0, Math.floor(Number(input.dependents?.otherDependents) || 0));
  const childPart = kids * D(c.perChild);
  const gross = childPart + others * D(c.otherDependent);
  if (!gross) return { nonrefundable: 0, refundable: 0, gross: 0 };
  const start = D(input.filingStatus === 'mfj' ? c.phaseOutStart.mfj : c.phaseOutStart.other);
  const steps = Math.ceil(pos(magiCents - start) / D(1000));
  const afterPhaseOut = pos(gross - steps * D(c.phaseOutPer1000));
  const nonrefundable = Math.min(afterPhaseOut, pos(incomeTaxCents));
  const unused = afterPhaseOut - nonrefundable;
  const childAfterPhaseOut = Math.min(childPart, afterPhaseOut);
  const refundable = Math.min(unused, childAfterPhaseOut, kids * D(c.refundablePerChild), times(pos(earnedCents - D(c.earnedIncomeFloor)), c.refundableRate));
  return { nonrefundable, refundable: pos(refundable), gross: afterPhaseOut };
}

/**
 * Full estimate for one set of inputs. Returns cents internally converted to
 * dollars, plus the steps (for "show the math"), assumptions and limitations.
 */
export function estimateTaxes(rawInput = {}) {
  const year = Number(rawInput.taxYear);
  const rules = FEDERAL_RULES[year];
  if (!rules) {
    return { supported: false, limitations: [`Tax year ${rawInput.taxYear} is not supported. Supported years: ${Object.keys(FEDERAL_RULES).join(', ')}.`] };
  }
  const filingStatus = FILING_STATUSES.includes(rawInput.filingStatus) ? rawInput.filingStatus : null;
  if (!filingStatus) return { supported: false, limitations: ['Choose a filing status to calculate an estimate.'] };
  const input = { ...rawInput, filingStatus };
  const assumptions = [
    'Uses the exact tax rate schedule; the IRS Tax Table used for incomes under $100,000 can differ by a few dollars.',
    'All non-business income is treated as ordinary income (no capital gains or qualified dividend rates).',
    'Alternative minimum tax and the net investment income tax are not included.',
  ];
  const limitations = [];

  const business = toCents(input.businessProfit);
  const otherSE = toCents(input.otherSelfEmploymentIncome);
  const wages = toCents(input.wages);
  const ssWages = input.socialSecurityWages == null || input.socialSecurityWages === '' ? wages : toCents(input.socialSecurityWages);
  const medicareWages = input.medicareWages == null || input.medicareWages === '' ? wages : toCents(input.medicareWages);
  const otherIncome = toCents(input.otherIncome);
  const adjustments = pos(toCents(input.adjustments));

  // Schedule SE
  const seProfit = business + otherSE;
  const se = selfEmploymentTax(seProfit, { ssWagesCents: ssWages, medicareWagesCents: medicareWages, rules, filingStatus });
  const wageAdditionalMedicare = times(pos(medicareWages - D(rules.additionalMedicare.threshold[filingStatus])), rules.additionalMedicare.rate);

  // AGI
  const totalIncome = wages + otherIncome + business + otherSE;
  const agi = totalIncome - se.deduction - adjustments;
  if (seProfit < 0) {
    const limit = rules.excessBusinessLoss && D(filingStatus === 'mfj' ? rules.excessBusinessLoss.mfj : rules.excessBusinessLoss.other);
    if (!limit || -seProfit > limit) limitations.push('A large business loss may be limited by the excess business loss rules, which this estimate does not apply.');
    assumptions.push('A business loss is assumed to be fully deductible against your other income (you materially participate and have enough basis).');
  }

  // Deductions
  const standard = standardDeduction(input, rules);
  const itemized = input.itemizedDeductions == null || input.itemizedDeductions === '' ? null : pos(toCents(input.itemizedDeductions));
  const usesItemized = itemized != null && itemized > standard;
  const deduction = usesItemized ? itemized : standard;
  if (usesItemized) assumptions.push('Itemized deductions are used as entered; any SALT cap or other limits must already be applied.');
  const senior = seniorDeduction(input, rules, agi);
  const taxableBeforeQbi = pos(agi - deduction - senior);

  // QBI (one non-service business: this business plus other SE income)
  const qbiCents = seProfit - se.deduction - pos(toCents(input.qbiReductions));
  const qbi = qbiDeduction(qbiCents, taxableBeforeQbi, { rules, filingStatus, w2WagesCents: toCents(input.businessW2Wages), ubiaCents: toCents(input.businessPropertyBasis) });
  const taxable = pos(taxableBeforeQbi - qbi.deduction);

  // Tax
  const bounds = rules.brackets[filingStatus];
  const incomeTax = bracketTax(taxable, bounds, rules.brackets.rates);
  const earned = pos(wages + (se.belowMinimum ? 0 : se.netEarnings) - se.deduction);
  const credits = childCredits(input, rules, { magiCents: agi, incomeTaxCents: incomeTax, earnedCents: earned });
  if (credits.gross) assumptions.push('Each child and dependent is assumed to meet the IRS tests and have a valid SSN or TIN.');
  const otherCredits = pos(toCents(input.otherNonrefundableCredits));
  const nonrefundable = Math.min(pos(incomeTax), credits.nonrefundable + otherCredits);
  const additionalMedicare = wageAdditionalMedicare + se.additionalMedicare;
  const federalTax = incomeTax - nonrefundable + se.total + additionalMedicare - credits.refundable;

  const state = stateIncomeTax(input.state, year, {
    filingStatus, agi, federalTaxable: taxable, federalDeduction: deduction, federalBasicStandardDeduction: D(rules.standardDeduction[filingStatus]),
    seniorDeduction: senior, qbi: qbi.deduction, wages, business, otherSE, otherIncome,
    qualifyingChildren: Math.max(0, Math.floor(Number(input.dependents?.qualifyingChildren) || 0)),
    otherDependents: Math.max(0, Math.floor(Number(input.dependents?.otherDependents) || 0)),
    age65: input.age65, blind: input.blind,
  });
  if (!state.supported && state.limitation) limitations.push(state.limitation);
  if (state.local) limitations.push(state.local);
  if (state.status === 'provisional') limitations.push(`${state.name} estimate is provisional: ${state.notes[0]}`);

  const federalWithholding = pos(toCents(input.federalWithholding));
  const federalPayments = pos(toCents(input.federalEstimatedPayments));
  const stateWithholding = pos(toCents(input.stateWithholding));
  const statePayments = pos(toCents(input.stateEstimatedPayments));
  const total = federalTax + state.tax;

  for (const flag of ['hasCapitalGains', 'hasRentalIncome', 'hasForeignIncome', 'claimsEitc', 'isDependent', 'partYearResident']) {
    if (input.flags?.[flag]) limitations.push(UNSUPPORTED_FLAGS[flag]);
  }

  return {
    supported: true,
    taxYear: year,
    filingStatus,
    ruleVersions: { federal: rules.version, state: state.version || null },
    federal: {
      totalIncome: toDollars(totalIncome),
      selfEmploymentTaxDeduction: toDollars(se.deduction),
      adjustments: toDollars(adjustments),
      agi: toDollars(agi),
      deduction: toDollars(deduction),
      deductionType: usesItemized ? 'itemized' : 'standard',
      seniorDeduction: toDollars(senior),
      taxableBeforeQbi: toDollars(taxableBeforeQbi),
      qbiDeduction: toDollars(qbi.deduction),
      qbiLimitedBy: qbi.limitedBy,
      taxableIncome: toDollars(taxable),
      incomeTax: toDollars(incomeTax),
      nonrefundableCredits: toDollars(nonrefundable),
      refundableCredits: toDollars(credits.refundable),
      selfEmployment: { netEarnings: toDollars(se.netEarnings), socialSecurity: toDollars(se.socialSecurity), medicare: toDollars(se.medicare), total: toDollars(se.total), belowMinimum: se.belowMinimum },
      additionalMedicareTax: toDollars(additionalMedicare),
      totalTax: toDollars(federalTax),
      marginalBracketRate: marginalBracketRate(taxable, bounds, rules.brackets.rates),
      withholding: toDollars(federalWithholding),
      estimatedPayments: toDollars(federalPayments),
      balance: toDollars(federalTax - federalWithholding - federalPayments),
    },
    state: { ...state, tax: toDollars(state.tax), taxableIncome: state.taxableIncome == null ? null : toDollars(state.taxableIncome),
      steps: (state.steps || []).map((s) => ({ ...s, amount: toDollars(s.amount) })), withholding: toDollars(stateWithholding), estimatedPayments: toDollars(statePayments), balance: toDollars(state.tax - stateWithholding - statePayments) },
    totalTax: toDollars(total),
    remainingBalance: toDollars(total - federalWithholding - federalPayments - stateWithholding - statePayments),
    notes: qbi.notes,
    assumptions,
    limitations,
  };
}

const UNSUPPORTED_FLAGS = {
  hasCapitalGains: 'Capital gains and qualified dividends get lower rates that this estimate does not apply (it treats them as ordinary income).',
  hasRentalIncome: 'Rental income and passive activity rules are not included.',
  hasForeignIncome: 'Foreign income, the foreign earned income exclusion and foreign tax credits are not included.',
  claimsEitc: 'The earned income tax credit is not included.',
  isDependent: 'Someone else can claim you as a dependent; the reduced standard deduction for dependents is not applied.',
  partYearResident: 'Part-year or multi-state residency is not supported; state tax is estimated as a full-year resident.',
};

/**
 * Tax with and without the business, so the difference is the extra tax the
 * business causes. Rates are null when they would divide by zero or a loss.
 */
export function businessTaxImpact(input = {}) {
  const withBusiness = estimateTaxes(input);
  if (!withBusiness.supported) return { supported: false, limitations: withBusiness.limitations };
  const withoutBusiness = estimateTaxes({ ...input, businessProfit: 0 });
  const bump = estimateTaxes({ ...input, businessProfit: (Number(input.businessProfit) || 0) + 100 });
  const profit = toCents(input.businessProfit);
  const additional = toCents(withBusiness.totalTax) - toCents(withoutBusiness.totalTax);
  const grossIncome = toCents(withBusiness.federal.totalIncome);
  return {
    supported: true,
    withBusiness,
    withoutBusiness,
    businessProfit: toDollars(profit),
    additionalTaxFromBusiness: toDollars(additional),
    effectiveBusinessTaxRate: profit > 0 ? Math.round(additional / profit * 10000) / 10000 : null,
    // Tax on the next $100 of business profit, all taxes combined.
    marginalRate: Math.round((toCents(bump.totalTax) - toCents(withBusiness.totalTax)) / D(100) * 10000) / 10000,
    effectiveTaxRate: grossIncome > 0 ? Math.round(toCents(withBusiness.totalTax) / grossIncome * 10000) / 10000 : null,
    limitations: withBusiness.limitations,
  };
}

/**
 * Federal required annual payment (Pub. 505) and the installment schedule.
 * priorYear: { totalTax, agi, fullYear } or null when unknown.
 */
export function federalEstimatedPayments({ taxYear, filingStatus, currentYearTax, withholding = 0, priorYear = null, paymentsMade = 0 }) {
  const rules = FEDERAL_RULES[Number(taxYear)];
  if (!rules) return { supported: false, limitations: [`Tax year ${taxYear} is not supported.`] };
  const e = rules.estimatedTax;
  const current = toCents(currentYearTax);
  const withheld = pos(toCents(withholding));
  const notes = [];
  const ninety = times(pos(current), e.safeHarborCurrentYear);
  let required = ninety;
  let basis = 'current-year';
  if (priorYear && priorYear.fullYear !== false && priorYear.totalTax != null) {
    const priorTax = pos(toCents(priorYear.totalTax));
    const high = toCents(priorYear.agi) > D(filingStatus === 'mfs' ? e.highIncomeAgi.mfs : e.highIncomeAgi.other);
    const priorTarget = times(priorTax, high ? e.safeHarborPriorYearHighIncome : e.safeHarborPriorYear);
    if (priorTax === 0) notes.push('You owed no tax last year, so you generally do not owe an underpayment penalty this year.');
    if (priorTarget < required) { required = priorTarget; basis = high ? 'prior-year-110' : 'prior-year-100'; }
  } else {
    notes.push('Add last year\'s total tax and AGI to use the prior-year safe harbor, which is often lower.');
  }
  const owedAfterWithholding = current - withheld;
  const noPenalty = owedAfterWithholding < D(e.noPenaltyBelow);
  if (noPenalty) notes.push(`You expect to owe less than $${e.noPenaltyBelow.toLocaleString('en-US')} after withholding, so estimated payments are generally not required.`);
  const fromEstimates = noPenalty ? 0 : pos(required - withheld);
  const paid = pos(toCents(paymentsMade));
  let cumulative = 0;
  const installments = e.installments.map((inst) => {
    const share = Math.round(fromEstimates * inst.share);
    cumulative += share;
    return { ...inst, amount: toDollars(share), cumulativeRequired: toDollars(cumulative) };
  });
  // Rounding leftovers go on the last installment so the total matches.
  if (installments.length) {
    const diff = fromEstimates - cumulative;
    const last = installments[installments.length - 1];
    last.amount = toDollars(toCents(last.amount) + diff);
    last.cumulativeRequired = toDollars(fromEstimates);
  }
  return {
    supported: true,
    version: rules.version,
    requiredAnnualPayment: toDollars(required),
    basis,
    requiredFromEstimatedPayments: toDollars(fromEstimates),
    paid: toDollars(paid),
    remaining: toDollars(pos(fromEstimates - paid)),
    installments,
    notes,
  };
}

/** Flat-percentage and conservative reserve recommendations. */
export function reserveRecommendations({ businessProfit, personalizedAdditionalTax = null, flatRate = null, bufferRate = 0.10 }) {
  const profit = pos(toCents(businessProfit));
  const flat = flatRate == null ? null : times(profit, Math.min(1, Math.max(0, Number(flatRate) || 0)));
  const personalized = personalizedAdditionalTax == null ? null : pos(toCents(personalizedAdditionalTax));
  const base = personalized ?? flat;
  const conservative = base == null ? null : times(base, 1 + Math.max(0, Number(bufferRate) || 0));
  return {
    personalized: personalized == null ? null : toDollars(personalized),
    flat: flat == null ? null : toDollars(flat),
    conservative: conservative == null ? null : toDollars(conservative),
  };
}
