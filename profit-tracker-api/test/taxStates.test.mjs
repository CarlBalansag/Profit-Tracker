// Flat-tax state rules. Each expected value is worked by hand from that
// state's own form lines and published amounts (named in rules/states.mjs),
// using wage-only households so federal AGI equals wages unless noted.
import { describe, expect, it } from 'vitest';
import { estimateTaxes, stateEstimatedPayments, STATE_RULES } from '../../shared/tax/index.mjs';

const st = (state, taxYear, extra = {}) => estimateTaxes({ taxYear, filingStatus: 'single', state, ...extra });
const tax = (...args) => st(...args).state.tax;
const two = { qualifyingChildren: 2 };

describe('flat-tax states', () => {
  it('Arizona: AGI - AZ standard deduction x 2.5%, dependent credit phased 5% per $1,000 (Form 140, Table V)', () => {
    expect(tax('AZ', 2025, { wages: 60000 })).toBe(1106.25); // (60,000 - 15,750) x 2.5%
    expect(tax('AZ', 2025, { filingStatus: 'mfj', wages: 100000, dependents: two })).toBe(1512.5); // 68,500 x 2.5% - $200
    // $5,500 over $400,000 -> Table V factor .70 -> $140 credit.
    expect(tax('AZ', 2025, { filingStatus: 'mfj', wages: 405500, dependents: two })).toBe(9350 - 140);
    expect(tax('AZ', 2025, { wages: 60000, age65: { taxpayer: true } })).toBe(1053.75); // less $2,100 age 65 exemption
    expect(st('AZ', 2026, { wages: 60000 }).state.status).toBe('provisional');
  });

  it('Colorado: federal taxable income x 4.4%, with the high-income deduction and QBI addbacks', () => {
    expect(tax('CO', 2025, { wages: 60000 })).toBe(1947); // 44,250 x 4.4%
    // 2026, AGI over $300,000: deduction above $1,000 is added back (16,100 - 1,000).
    const high = st('CO', 2026, { wages: 400000 });
    expect(high.state.tax).toBe(17556); // (383,900 + 15,100) x 4.4%
    const qbi = st('CO', 2026, { businessProfit: 700000 });
    const addback = qbi.state.steps.find((s) => s.label.startsWith('QBI'));
    expect(addback.amount).toBe(qbi.federal.qbiDeduction);
    expect(st('CO', 2026, { businessProfit: 100000 }).state.steps.some((s) => s.label.startsWith('QBI'))).toBe(false);
  });

  it('Georgia: AGI - standard deduction - $4,000 per dependent x 5.19% (2025) and 4.99% (2026)', () => {
    expect(tax('GA', 2025, { wages: 60000 })).toBe(2491.2);
    expect(tax('GA', 2025, { filingStatus: 'hoh', wages: 60000, dependents: two })).toBe(2076);
    expect(tax('GA', 2026, { wages: 60000 })).toBe(2245.5); // (60,000 - 15,000) x 4.99%
  });

  it('Illinois: AGI - $2,850 exemptions x 4.95%, none above the AGI cutoff', () => {
    expect(tax('IL', 2025, { wages: 62850 })).toBe(2970);
    expect(tax('IL', 2025, { filingStatus: 'mfj', wages: 100000, dependents: two })).toBe(4385.7); // 4 x 2,850
    expect(tax('IL', 2025, { wages: 260000 })).toBe(12870);
  });

  it('Indiana: AGI - $1,000 exemptions (+$1,500 per child) x 3% / 2.95%, county tax flagged', () => {
    const r = st('IN', 2025, { wages: 60000 });
    expect(r.state.tax).toBe(1770);
    expect(r.limitations.join(' ')).toMatch(/county income tax/);
    expect(tax('IN', 2025, { filingStatus: 'mfj', wages: 80000, dependents: two })).toBe(2190); // 80,000 - 2,000 - 2,000 - 3,000
    expect(tax('IN', 2026, { wages: 60000 })).toBe(1740.5);
  });

  it('Iowa: federal taxable income x 3.8% less $40 exemption credits, low-income exemption', () => {
    expect(tax('IA', 2025, { wages: 60000 })).toBe(1641.5); // 44,250 x 3.8% - 40
    expect(tax('IA', 2026, { wages: 60000 })).toBe(1628.2); // 43,900 x 3.8% - 40
    expect(tax('IA', 2025, { wages: 9000 })).toBe(0);
    expect(st('IA', 2025, { wages: 60000 }).limitations.join(' ')).toMatch(/school district/);
  });

  it('Kentucky: AGI - standard deduction x 4% (2025) and 3.5% (2026)', () => {
    expect(tax('KY', 2025, { wages: 60000 })).toBe(2269.2);
    expect(tax('KY', 2026, { wages: 60000 })).toBe(1982.4);
  });

  it('Louisiana: AGI - standard deduction x 3%, 2026 deduction indexed per RIB 26-019', () => {
    expect(tax('LA', 2025, { wages: 60000 })).toBe(1425);
    expect(tax('LA', 2026, { wages: 60000 })).toBe(1414.86);
    expect(tax('LA', 2026, { filingStatus: 'hoh', wages: 60000 })).toBe(1029.72);
  });

  it('Massachusetts: 5% after exemptions, No Tax Status, and the 4% surtax', () => {
    expect(tax('MA', 2025, { wages: 60000 })).toBe(2780);
    expect(tax('MA', 2025, { wages: 8000 })).toBe(0);
    expect(tax('MA', 2025, { wages: 1200000 })).toBe(59780 + 4498); // surtax on 1,195,600 - 1,083,150
  });

  it('Michigan: AGI - personal exemptions x 4.25%, city tax flagged', () => {
    expect(tax('MI', 2025, { wages: 60000 })).toBe(2303.5);
    expect(tax('MI', 2026, { wages: 60000 })).toBe(2299.25);
    expect(tax('MI', 2026, { filingStatus: 'mfj', wages: 100000, dependents: two })).toBe(3247);
  });

  it('Mississippi: first $10,000 at 0%, then 4.4% (2025) and 4% (2026)', () => {
    expect(tax('MS', 2025, { wages: 60000 })).toBe(1834.8); // (60,000 - 2,300 - 6,000 - 10,000) x 4.4%
    expect(tax('MS', 2026, { wages: 60000 })).toBe(1668);
  });

  it('North Carolina: AGI - standard deduction - child deduction x 4.25% / 3.99%', () => {
    expect(tax('NC', 2025, { wages: 60750 })).toBe(2040);
    // $90,000 MFJ: $1,500 per child from the D-401 child deduction table.
    expect(tax('NC', 2025, { filingStatus: 'mfj', wages: 90000, dependents: two })).toBe(2613.75);
    expect(tax('NC', 2026, { wages: 60750 })).toBe(1915.2);
  });

  it('Pennsylvania: 3.07% by class, and a business loss does not reduce wages', () => {
    expect(tax('PA', 2025, { wages: 50000, businessProfit: -10000 })).toBe(1535);
    expect(tax('PA', 2026, { wages: 50000, businessProfit: 20000 })).toBe(2149);
  });

  it('Utah 2025: 4.5% of AGI less the phased-out taxpayer tax credit; 2026 not supported yet', () => {
    expect(tax('UT', 2025, { wages: 60000 })).toBe(2298.23); // 2,700 - (945 - 543.23)
    expect(tax('UT', 2025, { filingStatus: 'mfj', wages: 80000, dependents: two })).toBe(2023.14);
    expect(tax('UT', 2025, { wages: 15000 })).toBe(0); // qualified exempt taxpayer
    expect(st('UT', 2026, { wages: 60000 }).state.supported).toBe(false);
  });

  it('labels provisional states and shows the math steps', () => {
    const r = st('IL', 2026, { wages: 60000 });
    expect(r.state.status).toBe('provisional');
    expect(r.limitations.join(' ')).toMatch(/Illinois estimate is provisional/);
    expect(r.state.steps[0]).toEqual({ label: 'Federal adjusted gross income', amount: 60000 });
    expect(st('KY', 2026, { wages: 60000 }).state.status).toBe('verified');
  });

  it('Ohio 2025: nonbusiness schedule after MAGI-tiered exemptions (IT 1040 page 18)', () => {
    // $60,000 MAGI -> $2,150 exemption; $57,850 -> $342 + 2.75% of $31,800.
    expect(tax('OH', 2025, { wages: 60000 })).toBe(1216.5);
    expect(tax('OH', 2025, { wages: 20000 })).toBe(0); // under $26,050 after exemption
    // $28,050 base: $342 + $55 = $397, less the $20 exemption credit (MAGI less exemptions under $30,000).
    expect(tax('OH', 2025, { wages: 30450 })).toBe(377);
    expect(tax('OH', 2025, { wages: 150000 })).toBe(Math.round((2394.32 + 0.03125 * (150000 - 1900 - 100000)) * 100) / 100);
  });

  it('Ohio: the first $250,000 of business income is deducted and the rest is taxed at 3%', () => {
    // $100,000 Schedule C profit is fully deducted; only the half-SE-tax deduction is left (negative), so no tax.
    const r = st('OH', 2025, { businessProfit: 100000 });
    expect(r.state.tax).toBe(0);
    expect(r.state.steps.find((s) => s.label === 'Business income deduction').amount).toBe(-100000);
    // $60,000 wages + $300,000 profit: AGI $348,784.57, $1,900 exemption, $50,000 taxable business income.
    const big = st('OH', 2025, { wages: 60000, businessProfit: 300000 });
    expect(big.federal.agi).toBe(348784.57);
    expect(big.state.steps.find((s) => s.label.startsWith('Taxable business')).amount).toBe(50000);
    expect(big.state.tax).toBe(Math.round((342 + 572.95 + 1500) * 100) / 100);
    // Married filing separately deducts only $125,000.
    expect(st('OH', 2025, { filingStatus: 'mfs', businessProfit: 200000 }).state.steps.find((s) => s.label === 'Business income deduction').amount).toBe(-125000);
    expect(st('OH', 2025, { wages: 60000 }).limitations.join(' ')).toMatch(/municipal income tax/);
  });

  it('Ohio 2026: $332 plus 2.75% over $26,050 (R.C. 5747.02), provisional exemptions', () => {
    const r = st('OH', 2026, { wages: 60000 });
    expect(r.state.tax).toBe(1206.5);
    expect(r.state.status).toBe('provisional');
  });

  it('Idaho 2025: federal taxable income less $4,811 / $9,622 at 5.3%, $205 child credit', () => {
    expect(tax('ID', 2025, { wages: 60000 })).toBe(2090.27); // (44,250 - 4,811) x 5.3%
    expect(tax('ID', 2025, { filingStatus: 'mfj', wages: 100000, dependents: two })).toBe(3120.53 - 410);
    // Uses 2025 federal taxable income after the QBI deduction: AGI $46,467.61 - $15,750
    // - QBI $6,143.52 (capped at 20% of $30,717.61) = $24,574.09.
    const biz = st('ID', 2025, { businessProfit: 50000 });
    expect(biz.federal.taxableIncome).toBe(24574.09);
    expect(biz.state.tax).toBe(1047.44); // (24,574.09 - 4,811) x 5.3%
    expect(tax('ID', 2025, { wages: 18000 })).toBe(0);
  });

  it('keeps Idaho 2026 unsupported while its rate is still before the legislature', () => {
    expect(STATE_RULES[2026].ID.status).toBe('unsupported');
    expect(st('ID', 2026, { wages: 60000 }).limitations.join(' ')).toMatch(/Idaho income tax is not supported yet/);
  });

  it('never returns a negative state tax', () => {
    for (const code of ['AZ', 'CO', 'GA', 'IL', 'IN', 'IA', 'KY', 'LA', 'MA', 'MI', 'MS', 'NC', 'OH', 'PA']) {
      expect(tax(code, 2026, { businessProfit: -20000 })).toBe(0);
    }
  });
});

describe('state estimated payments', () => {
  it('Colorado: lesser of 70% of this year or 100% of last year, four equal payments', () => {
    const r = stateEstimatedPayments({ taxYear: 2026, state: 'CO', filingStatus: 'single', currentYearTax: 5000, priorYear: { totalTax: 3000, agi: 100000 } });
    expect(r).toMatchObject({ supported: true, requiredAnnualPayment: 3000, basis: 'prior-year' });
    expect(r.installments.map((i) => [i.due, i.amount])).toEqual([['2026-04-15', 750], ['2026-06-15', 750], ['2026-09-15', 750], ['2027-01-15', 750]]);
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'CO', filingStatus: 'single', currentYearTax: 5000, priorYear: { totalTax: 4000, agi: 200000 } }).requiredAnnualPayment).toBe(3500);
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'CO', filingStatus: 'single', currentYearTax: 1500, withholding: 600 }).required).toBe(false);
  });

  it('Arizona: only required when income is over $75,000 this year and last year', () => {
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'AZ', filingStatus: 'single', currentYearTax: 2000, agi: 60000 }).required).toBe(false);
    const r = stateEstimatedPayments({ taxYear: 2026, state: 'AZ', filingStatus: 'single', currentYearTax: 2000, agi: 90000, priorYear: { totalTax: 1500, agi: 80000 } });
    expect(r).toMatchObject({ required: true, requiredAnnualPayment: 1500 });
  });

  it('Iowa uses its own end-of-month due dates; Illinois uses 90% / 100%', () => {
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'IA', filingStatus: 'single', currentYearTax: 3000 }).installments.map((i) => i.due))
      .toEqual(['2026-04-30', '2026-06-30', '2026-09-30', '2027-02-01']);
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'IL', filingStatus: 'single', currentYearTax: 4000 }).requiredAnnualPayment).toBe(3600);
  });

  it('says when a state has no income tax or its schedule is not supported yet', () => {
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'TX', filingStatus: 'single', currentYearTax: 0 })).toMatchObject({ supported: true, required: false });
    expect(stateEstimatedPayments({ taxYear: 2026, state: 'KY', filingStatus: 'single', currentYearTax: 3000 })).toMatchObject({ supported: false });
    const idaho = stateEstimatedPayments({ taxYear: 2025, state: 'ID', filingStatus: 'single', currentYearTax: 3000 });
    expect(idaho).toMatchObject({ supported: true, required: false });
    expect(idaho.notes[0]).toMatch(/doesn't require estimated tax payments/);
  });
});
