// State income tax from the rules in rules/states.mjs. All amounts in cents.
import { STATE_RULES, STATE_NAMES, NC_CHILD_DEDUCTION } from './rules/states.mjs';

const D = (dollars) => Math.round(dollars * 100);
const pos = (cents) => Math.max(0, cents);
const times = (cents, rate) => Math.round(cents * rate);

function counts(ctx) {
  const joint = ctx.filingStatus === 'mfj';
  return {
    people: joint ? 2 : 1,
    kids: ctx.qualifyingChildren,
    others: ctx.otherDependents,
    dependents: ctx.qualifyingChildren + ctx.otherDependents,
    age65: [ctx.age65?.taxpayer, joint && ctx.age65?.spouse].filter(Boolean).length,
    blind: [ctx.blind?.taxpayer, joint && ctx.blind?.spouse].filter(Boolean).length,
  };
}

function exemptionTotal(rule, ctx, n) {
  const e = rule.exemptions;
  if (!e) return 0;
  if (e.personalCutoffAgi && ctx.agi > D(e.personalCutoffAgi[ctx.filingStatus])) return 0;
  const personal = e.personal ? D(e.personal[ctx.filingStatus]) : D(e.perPerson || 0) * n.people;
  return personal
    + D(e.dependent || 0) * n.dependents
    + D(e.childExtra || 0) * n.kids
    + D(e.age65 || 0) * n.age65
    + D(e.blind || 0) * n.blind;
}

function ncChildDeduction(ctx, n) {
  if (!n.kids) return 0;
  const row = NC_CHILD_DEDUCTION[ctx.filingStatus].find(([upTo]) => ctx.agi <= D(upTo));
  return row ? D(row[1]) * n.kids : 0;
}

function credits(rule, ctx, n) {
  let total = 0;
  const dc = rule.dependentCredit;
  if (dc) {
    const gross = D(dc.child) * n.kids + D(dc.other) * n.others;
    const over = dc.phaseOutStart ? ctx.agi - D(dc.phaseOutStart[ctx.filingStatus]) : 0;
    const factor = over > 0 ? Math.max(0, 1 - dc.reductionPerStep * Math.ceil(over / D(dc.step))) : 1;
    total += Math.round(gross * factor);
  }
  const pc = rule.personalCredits;
  if (pc) {
    total += D(pc.perPerson || 0) * (pc.personCount?.[ctx.filingStatus] || 0)
      + D(pc.dependent || 0) * n.dependents
      + D(pc.age65 || 0) * n.age65
      + D(pc.blind || 0) * n.blind;
  }
  return total;
}

function lowIncomeExempt(rule, ctx, n) {
  const li = rule.lowIncomeExemption;
  if (!li) return false;
  const limit = n.age65 && li.age65 ? li.age65[ctx.filingStatus] : li[ctx.filingStatus];
  return ctx.agi <= D(limit);
}

/**
 * Ohio IT 1040: Ohio AGI is federal AGI less the business income deduction;
 * exemptions depend on MAGI (Ohio AGI plus that deduction); taxable business
 * income is the business income left after the deduction, capped at the
 * income tax base, taxed at 3%; the rest is nonbusiness income on the schedule.
 */
function ohio(rule, ctx, n) {
  const business = pos(ctx.business + ctx.otherSE);
  const bid = Math.min(business, D(ctx.filingStatus === 'mfs' ? rule.businessIncomeDeduction.mfs : rule.businessIncomeDeduction.other));
  const ohioAgi = ctx.agi - bid;
  const magi = ohioAgi + bid;
  const tier = rule.exemptionTiers.find(([upTo]) => magi <= D(upTo));
  const exemptionCount = n.people + n.dependents;
  const exemptions = tier ? D(tier[1]) * exemptionCount : 0;
  const base = pos(ohioAgi - exemptions);
  const taxableBusiness = Math.min(pos(business - bid), base);
  const nonbusiness = base - taxableBusiness;
  let nonbusinessTax = 0;
  for (const [over, baseTax, rate] of rule.nonbusinessSchedule) {
    if (nonbusiness > D(over)) nonbusinessTax = D(baseTax) + times(nonbusiness - D(over), rate);
  }
  const businessTax = times(taxableBusiness, rule.businessRate);
  const before = nonbusinessTax + businessTax;
  const ec = rule.exemptionCredit;
  const credit = magi - exemptions < D(ec.belowIncome) ? Math.min(before, D(ec.perExemption) * exemptionCount) : 0;
  const steps = [
    { label: 'Federal adjusted gross income', amount: ctx.agi },
    { label: 'Business income deduction', amount: -bid },
    { label: 'Personal and dependent exemptions', amount: -exemptions },
    { label: 'Taxable business income (taxed at 3%)', amount: taxableBusiness },
    { label: 'Taxable nonbusiness income', amount: nonbusiness },
  ];
  if (credit) steps.push({ label: 'Exemption credit', amount: -credit });
  return { tax: before - credit, taxableIncome: base, steps };
}

/** Returns { tax, taxableIncome, steps } in cents, or null for an unknown kind. */
function compute(rule, ctx) {
  const n = counts(ctx);
  const steps = [];
  if (rule.kind === 'pa-classes') {
    // Each class stands alone: a loss in one class cannot reduce another.
    const compensation = pos(ctx.wages);
    const netProfits = pos(ctx.business + ctx.otherSE);
    const other = pos(ctx.otherIncome);
    const taxable = compensation + netProfits + other;
    steps.push({ label: 'Compensation', amount: compensation }, { label: 'Net profits (a business loss is not subtracted from other classes)', amount: netProfits }, { label: 'Other income', amount: other });
    return { tax: times(taxable, rule.rate), taxableIncome: taxable, steps };
  }
  if (rule.kind === 'utah') {
    const fs = ctx.filingStatus;
    if (ctx.agi <= ctx.federalBasicStandardDeduction + ctx.seniorDeduction) {
      return { tax: 0, taxableIncome: pos(ctx.agi), steps: [{ label: 'Qualified exempt taxpayer (AGI at or below the federal standard deduction)', amount: 0 }] };
    }
    const gross = times(pos(ctx.agi), rule.rate);
    const initial = times(D(rule.personalExemption) * n.dependents + ctx.federalDeduction, rule.creditRate);
    const phaseOut = times(pos(ctx.agi - D(rule.phaseOutBase[fs])), rule.phaseOutRate);
    const credit = pos(initial - phaseOut);
    steps.push({ label: 'Tax before credit', amount: gross }, { label: 'Taxpayer tax credit', amount: -credit });
    return { tax: pos(gross - credit), taxableIncome: pos(ctx.agi), steps };
  }
  if (rule.kind === 'ohio') return ohio(rule, ctx, n);
  let base;
  if (rule.kind === 'agi') {
    base = ctx.agi;
    steps.push({ label: 'Federal adjusted gross income', amount: base });
    const std = rule.standardDeduction ? D(rule.standardDeduction[ctx.filingStatus]) : 0;
    if (std) { base -= std; steps.push({ label: 'State standard deduction', amount: -std }); }
    const ex = exemptionTotal(rule, ctx, n);
    if (ex) { base -= ex; steps.push({ label: 'State exemptions', amount: -ex }); }
    if (rule.childDeduction === 'NC') {
      const cd = ncChildDeduction(ctx, n);
      if (cd) { base -= cd; steps.push({ label: 'NC child deduction', amount: -cd }); }
    }
  } else if (rule.kind === 'federal-ti') {
    base = ctx.federalTaxable;
    steps.push({ label: 'Federal taxable income', amount: base });
    if (rule.qbiAddback && ctx.agi > D(rule.qbiAddback.agiOver[ctx.filingStatus]) && ctx.qbi) {
      base += ctx.qbi; steps.push({ label: 'QBI deduction added back', amount: ctx.qbi });
    }
    const cap = rule.deductionCap;
    if (cap && ctx.agi > D(cap.agiOver)) {
      const addback = pos(ctx.federalDeduction - D(cap.cap[ctx.filingStatus]));
      if (addback) { base += addback; steps.push({ label: 'Standard/itemized deduction addback', amount: addback }); }
    }
  } else {
    return null;
  }
  const taxable = pos(base);
  if (rule.noTaxStatus) {
    const limit = D(rule.noTaxStatus[ctx.filingStatus]) + D(rule.noTaxStatus.perDependent?.[ctx.filingStatus] || 0) * n.dependents;
    if (ctx.agi <= limit) return { tax: 0, taxableIncome: taxable, steps: [...steps, { label: 'No Tax Status', amount: 0 }] };
  }
  if (lowIncomeExempt(rule, ctx, n)) return { tax: 0, taxableIncome: taxable, steps: [...steps, { label: 'Low-income exemption', amount: 0 }] };
  const zero = typeof rule.zeroRateAmount === 'object' ? rule.zeroRateAmount[ctx.filingStatus] : rule.zeroRateAmount || 0;
  let tax = times(pos(taxable - D(zero)), rule.rate);
  if (zero) steps.push({ label: `First $${zero.toLocaleString('en-US')} taxed at 0%`, amount: 0 });
  if (rule.surtax) {
    const surtax = times(pos(taxable - D(rule.surtax.threshold)), rule.surtax.rate);
    if (surtax) { tax += surtax; steps.push({ label: 'Surtax', amount: surtax }); }
  }
  const credit = Math.min(tax, credits(rule, ctx, n));
  if (credit) steps.push({ label: 'State credits', amount: -credit });
  return { tax: tax - credit, taxableIncome: taxable, steps };
}

/**
 * ctx (cents): filingStatus, agi, federalTaxable, federalDeduction (standard or
 * itemized, without the senior deduction), federalBasicStandardDeduction,
 * seniorDeduction, qbi, wages, business, otherSE, otherIncome,
 * qualifyingChildren, otherDependents, age65, blind.
 */
export function stateIncomeTax(stateCode, year, ctx) {
  const code = String(stateCode || '').toUpperCase();
  const name = STATE_NAMES[code];
  if (!name) return { code, supported: false, tax: 0, limitation: 'Choose a state of residence to include state income tax.' };
  const rule = STATE_RULES[year]?.[code];
  const unsupported = { code, name, supported: false, tax: 0, limitation: `${name} income tax is not supported yet, so it is not included in this estimate.` };
  if (!rule || rule.status === 'unsupported') return unsupported;
  const base = { code, name, supported: true, version: rule.version, status: rule.status, sources: rule.sources, notes: [...(rule.notes || [])] };
  if (rule.provisional) base.notes.unshift(rule.provisional);
  if (rule.local) base.local = rule.local;
  if (rule.kind === 'none') return { ...base, tax: 0, taxableIncome: 0, rate: 0, steps: [] };
  const result = compute(rule, ctx);
  if (!result) return unsupported;
  return { ...base, ...result, rate: rule.rate };
}

/** State estimated payments where the state's own schedule has been verified. */
export function stateEstimatedPayments({ taxYear, state, filingStatus, currentYearTax, withholding = 0, priorYear = null, agi = null, paymentsMade = 0 }) {
  const code = String(state || '').toUpperCase();
  const rule = STATE_RULES[Number(taxYear)]?.[code];
  const name = STATE_NAMES[code] || code;
  if (rule?.kind === 'none') return { supported: true, required: false, requiredAnnualPayment: 0, requiredFromEstimatedPayments: 0, remaining: 0, installments: [], notes: [`${name} has no income tax, so no state estimated payments are due.`] };
  const e = rule?.estimatedTax;
  if (e?.notRequired) return { supported: true, required: false, requiredAnnualPayment: 0, requiredFromEstimatedPayments: 0, remaining: 0, installments: [], notes: [e.notRequired], sources: rule.sources };
  if (!e) return { supported: false, limitations: [`${name} estimated payment rules for ${taxYear} are not supported yet.`] };
  const c = (v) => Math.round((Number(v) || 0) * 100);
  const notes = [];
  const current = pos(c(currentYearTax));
  const withheld = pos(c(withholding));
  let required = times(current, e.currentYear);
  let basis = 'current-year';
  if (priorYear && priorYear.totalTax != null) {
    const high = e.priorYearHighIncome && priorYear.agi != null && c(priorYear.agi) > D(filingStatus === 'mfs' ? e.highIncomeAgi.mfs : e.highIncomeAgi.other);
    const target = times(pos(c(priorYear.totalTax)), high ? e.priorYearHighIncome : e.priorYear);
    if (target < required) { required = target; basis = high ? 'prior-year-high-income' : 'prior-year'; }
  }
  if (e.priorYearHighIncomeNote && priorYear?.agi != null && c(priorYear.agi) > D(filingStatus === 'mfs' ? e.highIncomeAgi.mfs : e.highIncomeAgi.other)) notes.push(e.priorYearHighIncomeNote);
  let mustPay = true;
  if (e.requiredWhenOwedOver != null && current - withheld <= D(e.requiredWhenOwedOver)) {
    mustPay = false;
    notes.push(`You expect to owe $${e.requiredWhenOwedOver.toLocaleString('en-US')} or less after withholding, so ${name} estimated payments are generally not required.`);
  }
  if (e.requiredWhenAgiOver) {
    const limit = D(e.requiredWhenAgiOver[filingStatus]);
    const thisYear = agi != null && c(agi) > limit;
    const lastYear = priorYear?.agi != null ? c(priorYear.agi) > limit : null;
    if (!thisYear || lastYear === false) {
      mustPay = false;
      notes.push(`${name} requires estimated payments only when income is over $${e.requiredWhenAgiOver[filingStatus].toLocaleString('en-US')} this year and last year.`);
    } else if (lastYear === null) {
      notes.push(`${name} requires estimated payments only when last year's income was also over $${e.requiredWhenAgiOver[filingStatus].toLocaleString('en-US')}; add last year's AGI to confirm.`);
    }
  }
  const fromEstimates = mustPay ? pos(required - withheld) : 0;
  let cumulative = 0;
  const installments = e.installments.map((inst, i) => {
    const amount = i === e.installments.length - 1 ? fromEstimates - cumulative : Math.round(fromEstimates * inst.share);
    cumulative += amount;
    return { ...inst, amount: amount / 100, cumulativeRequired: cumulative / 100 };
  });
  return {
    supported: true, required: mustPay, version: rule.version, basis,
    requiredAnnualPayment: required / 100,
    requiredFromEstimatedPayments: fromEstimates / 100,
    paid: pos(c(paymentsMade)) / 100,
    remaining: pos(fromEstimates - pos(c(paymentsMade))) / 100,
    installments, notes, sources: e.sources,
  };
}
