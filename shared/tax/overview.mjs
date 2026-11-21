// The Schedule C tax overview: one function that turns a tax profile (saved
// or typed in and never saved), a year and the year's Schedule C profit into
// the answers the overview page shows. Isomorphic, so an unsaved profile can
// be estimated entirely in the browser.
import { businessTaxImpact, federalEstimatedPayments, reserveRecommendations, FILING_STATUSES } from './engine.mjs';
import { stateEstimatedPayments } from './stateTax.mjs';
import { FEDERAL_RULES } from './rules/federal.mjs';
import { STATE_RULES, STATE_NAMES } from './rules/states.mjs';
import { projectProfit, chooseForecast } from './forecast.mjs';

export const RESERVE_MODES = ['personalized', 'flat', 'conservative'];
export const DEFAULT_BUFFER_RATE = 0.10;
export const DEFAULT_FLAT_RATE = 0.25;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const amount = (v) => { const n = num(v); return Number.isFinite(n) ? n : 0; };
const cents = (v) => Math.round(amount(v) * 100);
const dollars = (c) => c / 100;

/** Tax years the estimate supports. */
export const supportedTaxYears = () => Object.keys(FEDERAL_RULES).map(Number);

/**
 * How well a state is covered for a year: 'none' (no income tax), 'verified',
 * 'provisional', or 'unsupported'.
 */
export function stateSupport(year, code) {
  const rule = STATE_RULES[Number(year)]?.[String(code || '').toUpperCase()];
  if (!rule || rule.status === 'unsupported') return 'unsupported';
  if (rule.kind === 'none') return 'none';
  return rule.status === 'provisional' ? 'provisional' : 'verified';
}

/** Every state and DC, with its coverage for the year, sorted by name. */
export function stateOptions(year) {
  return Object.entries(STATE_NAMES)
    .map(([code, name]) => ({ code, name, support: stateSupport(year, code) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The engine's input from a profile (field names as stored by the API). */
export function profileToEstimateInput(profile, { year, businessProfit }) {
  const nonBusiness = Math.max(0, cents(profile.non_business_income));
  const wages = Math.min(nonBusiness, Math.max(0, cents(profile.wages)));
  return {
    taxYear: Number(year),
    filingStatus: profile.filing_status,
    state: profile.state || null,
    businessProfit: amount(businessProfit),
    otherSelfEmploymentIncome: amount(profile.other_se_income),
    wages: dollars(wages),
    otherIncome: dollars(nonBusiness - wages),
    adjustments: amount(profile.adjustments),
    itemizedDeductions: num(profile.itemized_deductions),
    age65: { taxpayer: Boolean(profile.age65), spouse: Boolean(profile.spouse_age65) },
    dependents: { qualifyingChildren: amount(profile.qualifying_children), otherDependents: amount(profile.other_dependents) },
    federalWithholding: amount(profile.federal_withholding),
    stateWithholding: amount(profile.state_withholding),
    // Estimated payments come from recorded TaxPayment rows (buildTaxOverview).
    federalEstimatedPayments: 0,
    stateEstimatedPayments: 0,
  };
}

// Optional details left blank, and what the estimate assumed instead.
function missingDetails(profile) {
  const blank = (k) => num(profile[k]) === null;
  const list = [];
  if (blank('non_business_income')) list.push({ field: 'non_business_income', text: 'Income outside the business is treated as $0, so your tax bracket may be too low.' });
  else if (blank('wages') && amount(profile.non_business_income) > 0) list.push({ field: 'wages', text: 'None of your other income is treated as W-2 wages. If some is, self-employment tax may be lower than shown.' });
  if (blank('federal_withholding')) list.push({ field: 'federal_withholding', text: 'No federal tax withheld from a paycheck is counted.' });
  if (blank('prior_year_tax')) list.push({ field: 'prior_year_tax', text: 'Last year\'s tax is missing, so the payment plan can\'t use the prior-year safe harbor, which is often lower.' });
  return list;
}

/**
 * profile: a saved or unsaved profile, or null.
 * businessProfit: Schedule C line 31 for the year so far.
 * today: 'YYYY-MM-DD' (for the next due date).
 */
// Splits each installment of a plan into what the recorded payments cover,
// oldest first, and marks it paid, partly paid, overdue or upcoming.
export function trackInstallments(plan, paid, today) {
  if (!plan?.supported || !plan.installments?.length) return [];
  let left = cents(paid);
  return plan.installments.map((inst) => {
    const due = cents(inst.amount);
    const applied = Math.max(0, Math.min(due, left));
    left -= applied;
    const remaining = due - applied;
    const status = remaining <= 0 ? 'paid' : inst.due < today ? 'overdue' : applied > 0 ? 'partly_paid' : 'upcoming';
    return { ...inst, paid: dollars(applied), remaining: dollars(remaining), status };
  });
}

export function buildTaxOverview({ profile, year, businessProfit, today, forecast = null, reserveBalance = 0, payments = [] }) {
  year = Number(year);
  const actualProfit = amount(businessProfit);
  // With the API's projection inputs, the estimate uses the chosen projection
  // of the full year's profit; without them, profit so far.
  const projection = forecast ? projectProfit({ actual: actualProfit, inputs: forecast, target: num(profile?.profit_target) }) : null;
  const chosen = projection ? chooseForecast(projection, profile?.forecast_method) : { key: 'actual', value: actualProfit, label: 'Profit so far', usedFallback: false };
  const profit = chosen.value;
  const reserved = amount(reserveBalance);
  const mode = RESERVE_MODES.includes(profile?.reserve_mode) ? profile.reserve_mode : 'personalized';
  const flatRate = num(profile?.flat_rate) ?? DEFAULT_FLAT_RATE;
  const bufferRate = num(profile?.buffer_rate) ?? DEFAULT_BUFFER_RATE;
  // Recorded payments toward this tax year: the IRS's, and the state of
  // residence's (payments to another state are listed but not counted here).
  const forYear = payments.filter((p) => Number(p.year ?? year) === year);
  const paidTo = (code) => dollars(forYear.filter((p) => p.jurisdiction === code).reduce((t, p) => t + cents(p.amount), 0));
  const federalPaid = paidTo('US');
  const statePaid = profile?.state ? paidTo(profile.state) : 0;
  const estimatedPaid = dollars(cents(federalPaid) + cents(statePaid));
  const filingDue = `${year + 1}-04-15`;
  const base = { year, businessProfit: profit, actualProfit, projection, forecastChoice: chosen, mode, flatRate, bufferRate, filingDue, estimatedPaid, federalPaid, statePaid, reserveBalance: reserved };

  const supportedYear = Boolean(FEDERAL_RULES[year]);
  const readyForPersonalized = supportedYear && profile && FILING_STATUSES.includes(profile.filing_status);
  let impact = null;
  let limitations = [];
  if (!supportedYear) limitations.push(`Tax year ${year} isn't supported yet (supported: ${supportedTaxYears().join(', ')}). You can still use a flat percentage.`);
  if (readyForPersonalized) {
    impact = businessTaxImpact({ ...profileToEstimateInput(profile, { year, businessProfit: profit }), federalEstimatedPayments: federalPaid, stateEstimatedPayments: statePaid });
    if (!impact.supported) { limitations = limitations.concat(impact.limitations || []); impact = null; }
  }
  const effectiveMode = mode !== 'flat' && !impact ? 'flat' : mode;
  const reserves = reserveRecommendations({
    businessProfit: profit,
    personalizedAdditionalTax: impact ? impact.additionalTaxFromBusiness : null,
    flatRate,
    bufferRate,
  });
  // Conservative builds on the personalized number when there is one.
  const recommended = effectiveMode === 'flat' ? reserves.flat : effectiveMode === 'conservative' ? reserves.conservative : reserves.personalized;
  // Money already covering this tax: estimated payments plus the reserve.
  const covered = dollars(cents(estimatedPaid) + cents(reserved));
  const stillToSetAside = Math.max(0, dollars(cents(recommended) - cents(covered)));
  const coverage = recommended > 0 ? Math.round(covered / recommended * 1000) / 1000 : null;

  let federalPlan = null;
  let statePlan = null;
  if (impact) {
    const w = impact.withBusiness;
    const priorYear = num(profile.prior_year_tax) === null ? null : { totalTax: amount(profile.prior_year_tax), agi: num(profile.prior_year_agi) };
    federalPlan = federalEstimatedPayments({ taxYear: year, filingStatus: profile.filing_status, currentYearTax: w.federal.totalTax, withholding: w.federal.withholding, priorYear, paymentsMade: w.federal.estimatedPayments });
    if (profile.state) {
      statePlan = stateEstimatedPayments({ taxYear: year, state: profile.state, filingStatus: profile.filing_status, currentYearTax: w.state.tax, withholding: w.state.withholding, priorYear: null, agi: w.federal.agi, paymentsMade: w.state.estimatedPayments });
    }
  }
  const federalInstallments = trackInstallments(federalPlan, federalPaid, today);
  const stateInstallments = trackInstallments(statePlan, statePaid, today);
  const nextDue = [];
  const overdue = [];
  const upcoming = (plan, installments, who, code) => {
    // Only real payments: a plan that needs none (withholding covers it, or
    // the state doesn't require any) has nothing due.
    if (!plan?.supported || !installments.length || !(plan.requiredFromEstimatedPayments > 0)) return;
    for (const i of installments) if (i.status === 'overdue') overdue.push({ who, code, period: i.period, due: i.due, amount: i.remaining });
    const next = installments.find((i) => i.due >= today && i.remaining > 0);
    if (!next) return;
    // Pay anything overdue along with the next installment to catch up.
    const catchUp = installments.filter((i) => i.due < today).reduce((t, i) => t + cents(i.remaining), 0);
    nextDue.push({ who, code, period: next.period, due: next.due, amount: dollars(cents(next.remaining) + catchUp), installment: next.remaining, catchUp: dollars(catchUp), remainingForYear: plan.remaining });
  };
  upcoming(federalPlan, federalInstallments, 'Federal (IRS)', 'US');
  if (profile?.state) upcoming(statePlan, stateInstallments, STATE_NAMES[profile.state] || profile.state, profile.state);
  nextDue.sort((a, b) => a.due.localeCompare(b.due));

  return {
    ...base,
    supportedYear,
    personalizedAvailable: Boolean(impact),
    effectiveMode,
    impact,
    reserves,
    recommended,
    stillToSetAside,
    covered,
    coverage,
    federalPlan,
    statePlan,
    federalInstallments,
    stateInstallments,
    nextDue,
    overdue,
    missing: profile ? missingDetails(profile) : [],
    limitations: limitations.concat(impact?.limitations || []),
    stateSupport: profile?.state ? stateSupport(year, profile.state) : null,
    sources: { federal: FEDERAL_RULES[year]?.sources || [], state: impact?.withBusiness?.state?.sources || [] },
  };
}
