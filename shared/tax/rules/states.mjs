// State individual income tax rules. A state is calculated only once its rules
// for that year were read from the state's own forms, instructions, statute or
// legislative office; every other state returns an explicit "not supported
// yet" limitation instead of a guess.
//
// status: 'verified'    - every amount used comes from an official source for that year
//         'provisional' - the rate is official, but an amount is carried over or
//                         from a draft form; `provisional` says which, and the
//                         estimate shows that note
//         'unsupported' - not calculated
//
// kind (how state taxable income is built; see shared/tax/stateTax.mjs):
//   'none'        no broad income tax on wages or business income
//   'agi'         federal AGI - state deduction/exemptions, times a flat rate
//   'federal-ti'  federal taxable income (+ state addbacks), times a flat rate
//   'pa-classes'  Pennsylvania: classes of income, no deductions, no cross-class losses
//   'utah'        4.5% of AGI less the phased-out taxpayer tax credit
//   'ohio'        business income deduction, 3% on remaining business income,
//                 nonbusiness schedule, MAGI-tiered exemptions
//
// Amounts are whole dollars as published; rates are decimals.

const src = (label, url) => ({ label, url });
const ALL = ['single', 'mfj', 'mfs', 'hoh', 'qss'];
const byStatus = (single, mfj, { mfs = single, hoh = single, qss = mfj } = {}) => ({ single, mfj, mfs, hoh, qss });
const quarterly = (year) => [
  { period: 'Q1', due: `${year}-04-15`, share: 0.25 },
  { period: 'Q2', due: `${year}-06-15`, share: 0.25 },
  { period: 'Q3', due: `${year}-09-15`, share: 0.25 },
  { period: 'Q4', due: `${year + 1}-01-15`, share: 0.25 },
];

export const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Secondary source for the list of nine; replace with each agency's page when convenient.
const NO_TAX_SOURCE = src('Nine states without a broad individual income tax in 2026 (secondary source)', 'https://www.kiplinger.com/slideshow/taxes/t054-s001-states-without-income-tax/');
const NO_INCOME_TAX = {
  AK: null, FL: null, NV: null, SD: null, TN: null, TX: null, WY: null,
  NH: 'New Hampshire repealed its interest and dividends tax starting with 2025.',
  WA: 'Washington taxes certain long-term capital gains, which this estimate does not include.',
};

// ---- Sources ---------------------------------------------------------------
const S = {
  AZ_2025: src('Arizona Form 140 resident booklet (2025)', 'https://azdor.gov/sites/default/files/document/FORMS_INDIVIDUAL_2025_140Booklet.pdf'),
  AZ_HIGHLIGHTS: src('ADOR individual income tax highlights', 'https://azdor.gov/forms/individual-income-tax-highlights'),
  AZ_FORMS: src('ADOR individual forms ("tax year 2023 and beyond ... flat tax rate of 2.5%")', 'https://azdor.gov/forms/individual'),
  AZ_ARS: src('A.R.S. §43-1041 optional standard deduction', 'https://www.azleg.gov/ars/43/01041.htm'),
  AZ_EST: src('ADOR individual estimated tax payments', 'https://azdor.gov/individuals/individual-estimated-tax-payments'),
  CO_GUIDE: src('Colorado DOR individual income tax guide', 'https://tax.colorado.gov/individual-income-tax-guide'),
  CO_LCS: src('Colorado Legislative Council Staff: individual income tax (4.40%)', 'https://content.leg.colorado.gov/agencies/legislative-council-staff/individual-income-tax%C2%A0'),
  CO_EST: src('Colorado DOR estimated payments', 'https://tax.colorado.gov/individual-income-tax-estimated-payments'),
  GA_2025: src('Georgia IT-511 instructions booklet (2025)', 'https://dor.georgia.gov/document/document/2025-it-511-individual-income-tax-booklet/download'),
  GA_2026: src('Georgia DOR important tax updates (4.99%, $15,000/$30,000)', 'https://dor.georgia.gov/taxes/important-tax-updates'),
  IL_RATE: src('Illinois income tax rates', 'https://tax.illinois.gov/research/taxrates/income.html'),
  IL_EXEMPT: src('IL-1040 Step 4 exemptions (2025)', 'https://tax.illinois.gov/forms/incometax/currentyear/individual/il-1040-instr/step-4---exemptions.html'),
  IL_EST: src('Illinois Pub-105 estimated payments', 'https://tax.illinois.gov/research/publications/pubs/illinois-estimated-payments-requirements-for-individuals-and-businesses.html'),
  IN_2025: src('Indiana IT-40 booklet (2025)', 'https://forms.in.gov/Download.aspx?id=16915'),
  IN_RATES: src('Indiana DOR rates ("2.95% for 2026")', 'https://www.in.gov/dor/resources/tax-rates-and-reports/rates-fees-and-penalties'),
  IA_TAX: src('IA 1040 instructions (2025): Iowa tax and federal taxable income', 'https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-tax'),
  IA_CREDITS: src('IA 1040 instructions (2025): exemption credits', 'https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/exemption-credits'),
  IA_LOW: src('IA 1040 instructions (2025): Iowa taxable income, low-income exemption', 'https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/1040-expanded-instructions/iowa-taxable-income'),
  IA_2026: src('Iowa DOR: 2026 individual income tax rate (3.8%)', 'https://revenue.iowa.gov/press-release/2025-10-21/idr-announces-2026-individual-income-tax-and-interest-rates'),
  IA_EST: src('Iowa DOR estimated income tax payments', 'https://revenue.iowa.gov/taxes/tax-guidance/individual-income-tax/estimated-income-tax-payments'),
  KY_2025: src('Kentucky 740 instructions (2025)', 'https://revenue.ky.gov/Forms/740%20Packet%20Instructions.pdf'),
  KY_2026: src('Kentucky DOR: 2026 standard deduction', 'https://revenue.ky.gov/News/Pages/Kentucky-DOR-Announces-2026-Standard-Deduction.aspx'),
  KY_2026_RATE: src('Kentucky TY2026 e-file handbook (3.5%)', 'https://revenue.ky.gov/Software-Developer/Documents/TY2026%20E-File%20HandBook%20Publication%201345%20v1.0.pdf'),
  KY_CREDITS: src('Kentucky DOR tax credits (personal credits)', 'https://revenue.ky.gov/Business/Pages/Tax-Credits.aspx'),
  LA_RATE: src('LDR: individual income tax rates (flat 3% from 2025)', 'https://revenue.louisiana.gov/tax-education-and-faqs/faqs/income-tax-reform/what-are-the-individual-income-tax-rates-and-brackets/'),
  LA_2025: src('Louisiana IT-540 instructions (2025)', 'https://dam.ldr.la.gov/taxforms/IT540i-WEB-2025.pdf'),
  LA_2026: src('LDR Revenue Information Bulletin 26-019 (2026 standard deduction)', 'https://dam.ldr.la.gov/lawspolicies/RIB%2026-019.pdf'),
  MA_RATE: src('Massachusetts tax rates', 'https://www.mass.gov/info-details/massachusetts-tax-rates'),
  MA_SURTAX: src('Massachusetts 4% surtax thresholds', 'https://www.mass.gov/info-details/massachusetts-4-surtax-on-taxable-income'),
  MA_EXEMPT: src('Massachusetts personal income tax exemptions', 'https://www.mass.gov/info-details/massachusetts-personal-income-tax-exemptions'),
  MA_2025: src('Massachusetts Form 1 instructions (2025)', 'https://www.mass.gov/doc/2025-form-1-instructions/download'),
  MI_2026: src('Michigan Treasury: 2026 rate stays 4.25%', 'https://www.michigan.gov/treasury/news/2026/04/15/state-individual-income-tax-rate-for-2026-tax-year-determined'),
  MI_EXEMPT: src('Michigan Treasury: rate and personal exemption by calendar year', 'https://www.michigan.gov/taxes/business-taxes/withholding/calendar-year-tax-information'),
  MI_2025: src('Michigan MI-1040 instructions (2025)', 'https://www.michigan.gov/taxes/-/media/Project/Websites/taxes/Forms/IIT/TY2025/MI-1040-Book.pdf'),
  MS_INFO: src('Mississippi DOR general information (rates, exemptions, standard deduction)', 'https://www.dor.ms.gov/general-information'),
  NC_2025: src('North Carolina D-401 instructions (2025)', 'https://www.ncdor.gov/2025-d-401-individual-income-tax-instructions-0'),
  NC_RATES: src('NCDOR tax rate schedules (4.25% for 2025, 3.99% after 2025)', 'https://www.ncdor.gov/taxes-forms/tax-rate-schedules'),
  NC_STATUTE: src('N.C.G.S. §105-153.5 (standard deduction, child deduction)', 'https://www.ncleg.gov/enactedlegislation/statutes/html/bysection/chapter_105/gs_105-153.5.html'),
  PA_RATE: src('Pennsylvania personal income tax rates (3.07%, 2004 - present)', 'https://www.pa.gov/agencies/revenue/resources/tax-rates/personal-income-tax-rates'),
  PA_2025: src('Pennsylvania PA-40 instructions (2025): classes of income', 'https://www.pa.gov/content/dam/copapwp-pagov/en/revenue/documents/formsandpublications/formsforindividuals/pit/documents/2025/2025_pa-40in.pdf'),
  UT_2025: src('Utah TC-40 instructions (2025)', 'https://files.tax.utah.gov/tax/forms/current/tc-40inst.pdf'),
  ID_2025: src('Idaho Form 40/43 instructions (2025, rev. 03-02-2026)', 'https://tax.idaho.gov/wp-content/uploads/forms/EIN00046/EIN00046_03-02-2026.pdf'),
  OH_2025: src('Ohio IT 1040 instructions (2025)', 'https://dam.assets.ohio.gov/image/upload/tax.ohio.gov/forms/ohio_individual/individual/2025/it1040-booklet.pdf'),
  OH_ORC: src('Ohio Revised Code §5747.02 (2026 rates)', 'https://codes.ohio.gov/ohio-revised-code/section-5747.02'),
  OH_LSC: src('Ohio LSC analysis of H.B. 96 (indexing suspended for 2025 and 2026)', 'https://www.lsc.ohio.gov/assets/legislation/136/hb96/ps/files/hb96-tax-bill-analysis-as-passed-by-the-senate-136th-general-assembly.pdf'),
};

// Ohio: business income deduction, 3% on business income above it, and the
// nonbusiness schedule ("over" amount, base tax, rate on the excess).
const OHIO_EXEMPTION_TIERS = [[40000, 2400], [80000, 2150], [749999, 1900]];
const OHIO = {
  businessIncomeDeduction: { mfs: 125000, other: 250000 }, businessRate: 0.03,
  exemptionTiers: OHIO_EXEMPTION_TIERS,
  exemptionCredit: { perExemption: 20, belowIncome: 30000 },
};

const LOCAL = {
  OH: 'Ohio municipal income tax and school district income tax are not included.',
  IN: 'Indiana county income tax (mandatory, set by your county) is not included.',
  IA: 'Iowa school district and EMS surtaxes are not included.',
  KY: 'Kentucky city and county occupational license taxes are not included.',
  MI: 'Michigan city income taxes (Detroit, Grand Rapids and others) are not included.',
  PA: 'Pennsylvania local earned income tax and school district taxes are not included.',
};
const STATE_ADJUSTMENTS = 'State additions and subtractions to federal income (for example retirement exclusions or state depreciation addbacks) are not applied.';

// ---- Per-state definitions ------------------------------------------------
const DEFINED = {
  AZ: {
    2025: { kind: 'agi', status: 'verified', rate: 0.025, sources: [S.AZ_2025, S.AZ_HIGHLIGHTS],
      standardDeduction: byStatus(15750, 31500, { hoh: 23625 }),
      exemptions: { age65: 2100, blind: 1500 },
      dependentCredit: { child: 100, other: 25, phaseOutStart: byStatus(200000, 400000), step: 1000, reductionPerStep: 0.05 } },
    2026: { kind: 'agi', status: 'provisional', rate: 0.025, sources: [S.AZ_FORMS, S.AZ_ARS, S.AZ_2025, S.AZ_EST],
      provisional: 'Arizona has not posted 2026 forms; this uses the A.R.S. §43-1041 standard deduction and the 2025 exemption and dependent-credit amounts.',
      standardDeduction: byStatus(15750, 31500, { hoh: 23625 }),
      exemptions: { age65: 2100, blind: 1500 },
      dependentCredit: { child: 100, other: 25, phaseOutStart: byStatus(200000, 400000), step: 1000, reductionPerStep: 0.05 },
      estimatedTax: { requiredWhenAgiOver: byStatus(75000, 150000), currentYear: 0.90, priorYear: 1.00, installments: quarterly(2026), sources: [S.AZ_EST] } },
  },
  CO: {
    2025: { kind: 'federal-ti', status: 'verified', rate: 0.044, sources: [S.CO_GUIDE],
      qbiAddback: { agiOver: byStatus(500000, 1000000, { hoh: 500000, mfs: 500000 }) },
      deductionCap: { agiOver: 300000, cap: byStatus(12000, 16000) } },
    2026: { kind: 'federal-ti', status: 'verified', rate: 0.044, sources: [S.CO_LCS, S.CO_GUIDE, S.CO_EST],
      qbiAddback: { agiOver: byStatus(500000, 1000000, { hoh: 500000, mfs: 500000 }) },
      deductionCap: { agiOver: 300000, cap: byStatus(1000, 2000) },
      estimatedTax: { requiredWhenOwedOver: 1000, currentYear: 0.70, priorYear: 1.00, priorYearHighIncome: 1.10, highIncomeAgi: { mfs: 75000, other: 150000 }, installments: quarterly(2026), sources: [S.CO_GUIDE, S.CO_EST] } },
  },
  GA: {
    2025: { kind: 'agi', status: 'verified', rate: 0.0519, sources: [S.GA_2025],
      standardDeduction: byStatus(12000, 24000), exemptions: { dependent: 4000 }, notes: ['Georgia does not allow the federal QBI deduction; it starts from federal AGI, so the QBI deduction never reduces Georgia income.'] },
    2026: { kind: 'agi', status: 'provisional', rate: 0.0499, sources: [S.GA_2026, S.GA_2025],
      provisional: 'Uses the 2025 Georgia dependent exemption ($4,000); 2026 Georgia instructions are not posted yet.',
      standardDeduction: byStatus(15000, 30000), exemptions: { dependent: 4000 } },
  },
  IL: {
    2025: { kind: 'agi', status: 'verified', rate: 0.0495, sources: [S.IL_RATE, S.IL_EXEMPT],
      exemptions: { perPerson: 2850, dependent: 2850, age65: 1000, blind: 1000, personalCutoffAgi: byStatus(250000, 500000) } },
    2026: { kind: 'agi', status: 'provisional', rate: 0.0495, sources: [S.IL_RATE, S.IL_EXEMPT, S.IL_EST],
      provisional: 'Uses the 2025 Illinois exemption allowance ($2,850); the 2026 amount is not published yet.',
      exemptions: { perPerson: 2850, dependent: 2850, age65: 1000, blind: 1000, personalCutoffAgi: byStatus(250000, 500000) },
      estimatedTax: { requiredWhenOwedOver: 1000, currentYear: 0.90, priorYear: 1.00, installments: quarterly(2026), sources: [S.IL_EST] } },
  },
  IN: {
    2025: { kind: 'agi', status: 'verified', rate: 0.03, sources: [S.IN_2025], local: LOCAL.IN,
      exemptions: { perPerson: 1000, dependent: 1000, childExtra: 1500, age65: 1000, blind: 1000 } },
    2026: { kind: 'agi', status: 'provisional', rate: 0.0295, sources: [S.IN_RATES, S.IN_2025], local: LOCAL.IN,
      provisional: 'Uses the 2025 Indiana exemption amounts; 2026 Indiana forms are not posted yet.',
      exemptions: { perPerson: 1000, dependent: 1000, childExtra: 1500, age65: 1000, blind: 1000 } },
  },
  IA: {
    2025: { kind: 'federal-ti', status: 'verified', rate: 0.038, sources: [S.IA_TAX, S.IA_CREDITS, S.IA_LOW], local: LOCAL.IA,
      lowIncomeExemption: { single: 9000, mfs: 9000, mfj: 13500, hoh: 13500, qss: 13500, age65: { single: 24000, mfj: 32000, hoh: 32000, qss: 32000, mfs: 32000 } },
      personalCredits: { perPerson: 40, personCount: { single: 1, mfs: 1, qss: 1, mfj: 2, hoh: 2 }, dependent: 40, age65: 20, blind: 20 } },
    2026: { kind: 'federal-ti', status: 'provisional', rate: 0.038, sources: [S.IA_2026, S.IA_TAX, S.IA_CREDITS, S.IA_EST], local: LOCAL.IA,
      provisional: 'Uses the 2025 Iowa low-income exemption thresholds and exemption credits; 2026 instructions are not posted yet.',
      lowIncomeExemption: { single: 9000, mfs: 9000, mfj: 13500, hoh: 13500, qss: 13500, age65: { single: 24000, mfj: 32000, hoh: 32000, qss: 32000, mfs: 32000 } },
      personalCredits: { perPerson: 40, personCount: { single: 1, mfs: 1, qss: 1, mfj: 2, hoh: 2 }, dependent: 40, age65: 20, blind: 20 },
      // Iowa's own dates (last day of months 4, 6, 9 and the next January);
      // Jan 31, 2027 is a Sunday, so the payment is on time the next business day.
      estimatedTax: { requiredWhenOwedOver: 1000, currentYear: 0.90, priorYear: 1.00, priorYearHighIncomeNote: 'Iowa may require more than 100% of last year\'s tax when last year\'s federal AGI was over $150,000 ($75,000 MFS); see the IA 1040ES instructions.', highIncomeAgi: { mfs: 75000, other: 150000 },
        installments: [{ period: 'Q1', due: '2026-04-30', share: 0.25 }, { period: 'Q2', due: '2026-06-30', share: 0.25 }, { period: 'Q3', due: '2026-09-30', share: 0.25 }, { period: 'Q4', due: '2027-02-01', share: 0.25 }], sources: [S.IA_EST] } },
  },
  KY: {
    2025: { kind: 'agi', status: 'verified', rate: 0.04, sources: [S.KY_2025, S.KY_CREDITS], local: LOCAL.KY,
      standardDeduction: byStatus(3270, 3270), personalCredits: { age65: 40, blind: 40 },
      notes: ['The Kentucky family size tax credit for lower incomes is not included.'] },
    2026: { kind: 'agi', status: 'verified', rate: 0.035, sources: [S.KY_2026_RATE, S.KY_2026, S.KY_CREDITS], local: LOCAL.KY,
      standardDeduction: byStatus(3360, 3360), personalCredits: { age65: 40, blind: 40 },
      notes: ['The Kentucky family size tax credit for lower incomes is not included.'] },
  },
  LA: {
    2025: { kind: 'agi', status: 'verified', rate: 0.03, sources: [S.LA_RATE, S.LA_2025], standardDeduction: byStatus(12500, 25000, { hoh: 25000 }) },
    2026: { kind: 'agi', status: 'verified', rate: 0.03, sources: [S.LA_RATE, S.LA_2026], standardDeduction: byStatus(12838, 25676, { hoh: 25676 }) },
  },
  MA: {
    2025: { kind: 'agi', status: 'provisional', rate: 0.05, sources: [S.MA_RATE, S.MA_EXEMPT, S.MA_SURTAX, S.MA_2025],
      provisional: 'Massachusetts income is approximated by federal AGI; the age 65 and blind exemptions are not included.',
      exemptions: { personal: byStatus(4400, 8800, { hoh: 6800 }), dependent: 1000 },
      noTaxStatus: { single: 8000, mfs: 8000, hoh: 14400, mfj: 16400, qss: 16400, perDependent: { hoh: 1000, mfj: 1000, qss: 1000 } },
      surtax: { rate: 0.04, threshold: 1083150 } },
    2026: { kind: 'agi', status: 'provisional', rate: 0.05, sources: [S.MA_RATE, S.MA_EXEMPT, S.MA_SURTAX, S.MA_2025],
      provisional: 'Massachusetts income is approximated by federal AGI; the age 65 and blind exemptions are not included, and the No Tax Status limits are the 2025 amounts.',
      exemptions: { personal: byStatus(4400, 8800, { hoh: 6800 }), dependent: 1000 },
      noTaxStatus: { single: 8000, mfs: 8000, hoh: 14400, mfj: 16400, qss: 16400, perDependent: { hoh: 1000, mfj: 1000, qss: 1000 } },
      surtax: { rate: 0.04, threshold: 1107750 } },
  },
  MI: {
    2025: { kind: 'agi', status: 'verified', rate: 0.0425, sources: [S.MI_2025, S.MI_EXEMPT], local: LOCAL.MI, exemptions: { perPerson: 5800, dependent: 5800 } },
    2026: { kind: 'agi', status: 'verified', rate: 0.0425, sources: [S.MI_2026, S.MI_EXEMPT], local: LOCAL.MI, exemptions: { perPerson: 5900, dependent: 5900 } },
  },
  MS: {
    2025: { kind: 'agi', status: 'provisional', rate: 0.044, sources: [S.MS_INFO],
      provisional: 'Mississippi\'s exemption and standard deduction tables are not dated by year. For a joint return only one $10,000 zero-rate amount is applied (each spouse gets $10,000 of their own income), so this may overstate tax when both spouses earn income.',
      zeroRateAmount: 10000,
      standardDeduction: byStatus(2300, 4600, { hoh: 3400 }),
      exemptions: { personal: byStatus(6000, 12000, { hoh: 8000 }), dependent: 1500, age65: 1500, blind: 1500 } },
    2026: { kind: 'agi', status: 'provisional', rate: 0.04, sources: [S.MS_INFO],
      provisional: 'Mississippi\'s exemption and standard deduction tables are not dated by year. For a joint return only one $10,000 zero-rate amount is applied (each spouse gets $10,000 of their own income), so this may overstate tax when both spouses earn income.',
      zeroRateAmount: 10000,
      standardDeduction: byStatus(2300, 4600, { hoh: 3400 }),
      exemptions: { personal: byStatus(6000, 12000, { hoh: 8000 }), dependent: 1500, age65: 1500, blind: 1500 } },
  },
  NC: {
    2025: { kind: 'agi', status: 'verified', rate: 0.0425, sources: [S.NC_2025, S.NC_RATES], standardDeduction: byStatus(12750, 25500, { hoh: 19125 }), childDeduction: 'NC' },
    2026: { kind: 'agi', status: 'verified', rate: 0.0399, sources: [S.NC_RATES, S.NC_STATUTE], standardDeduction: byStatus(12750, 25500, { hoh: 19125 }), childDeduction: 'NC' },
  },
  PA: {
    2025: { kind: 'pa-classes', status: 'verified', rate: 0.0307, sources: [S.PA_RATE, S.PA_2025], local: LOCAL.PA,
      notes: ['Pennsylvania Tax Forgiveness for low incomes is not included.'] },
    2026: { kind: 'pa-classes', status: 'verified', rate: 0.0307, sources: [S.PA_RATE, S.PA_2025], local: LOCAL.PA,
      notes: ['Pennsylvania Tax Forgiveness for low incomes is not included.'] },
  },
  UT: {
    2025: { kind: 'utah', status: 'verified', rate: 0.045, sources: [S.UT_2025],
      personalExemption: 2111, creditRate: 0.06, phaseOutRate: 0.013,
      phaseOutBase: { single: 18213, mfs: 18213, mfj: 36426, qss: 36426, hoh: 27320 },
      notes: ['The Utah child tax credit is not included.'] },
  },
  // Idaho starts from the same taxable income as the federal return (federal
  // standard deduction, QBI and Schedule 1-A deductions). Its 2026 rate was
  // still before the legislature (H.B. 589 / H.B. 782), so 2026 is unsupported.
  ID: {
    2025: { kind: 'federal-ti', status: 'verified', rate: 0.053, sources: [S.ID_2025],
      zeroRateAmount: byStatus(4811, 9622, { hoh: 9622 }),
      dependentCredit: { child: 205, other: 0 },
      notes: ['The Idaho grocery credit is not included.'],
      estimatedTax: { notRequired: 'Idaho doesn\'t require estimated tax payments (Form 40 instructions).' } },
  },
  OH: {
    2025: { kind: 'ohio', status: 'verified', sources: [S.OH_2025], local: LOCAL.OH, ...OHIO,
      nonbusinessSchedule: [[26050, 342, 0.0275], [100000, 2394.32, 0.03125]],
      notes: ['The Ohio joint filing credit is not included (business income does not count toward it).'] },
    2026: { kind: 'ohio', status: 'provisional', sources: [S.OH_ORC, S.OH_LSC, S.OH_2025], local: LOCAL.OH, ...OHIO,
      provisional: 'Uses the 2025 Ohio exemption amounts and business income deduction (indexing is suspended for 2026); 2026 Ohio instructions are not posted yet.',
      nonbusinessSchedule: [[26050, 332, 0.0275]],
      notes: ['The Ohio joint filing credit is not included (business income does not count toward it).'] },
  },
};

// Every 2026 NC child deduction row, from the 2025 D-401 table (set in G.S. 105-153.5).
export const NC_CHILD_DEDUCTION = {
  mfj: [[40000, 3000], [60000, 2500], [80000, 2000], [100000, 1500], [120000, 1000], [140000, 500]],
  qss: [[40000, 3000], [60000, 2500], [80000, 2000], [100000, 1500], [120000, 1000], [140000, 500]],
  hoh: [[30000, 3000], [45000, 2500], [60000, 2000], [75000, 1500], [90000, 1000], [105000, 500]],
  single: [[20000, 3000], [30000, 2500], [40000, 2000], [50000, 1500], [60000, 1000], [70000, 500]],
  mfs: [[20000, 3000], [30000, 2500], [40000, 2000], [50000, 1500], [60000, 1000], [70000, 500]],
};

function rulesForYear(year) {
  const rules = {};
  for (const code of Object.keys(STATE_NAMES)) {
    if (code in NO_INCOME_TAX) {
      rules[code] = { kind: 'none', status: 'verified', version: `${code}-${year}.1`, lastVerified: '2026-11-21', sources: [NO_TAX_SOURCE], notes: NO_INCOME_TAX[code] ? [NO_INCOME_TAX[code]] : [] };
      continue;
    }
    const def = DEFINED[code]?.[year];
    rules[code] = def
      ? { ...def, version: `${code}-${year}.1`, lastVerified: '2026-11-21', notes: [...(def.notes || []), STATE_ADJUSTMENTS] }
      : { kind: 'unsupported', status: 'unsupported', version: null };
  }
  return rules;
}

export const STATE_RULES = { 2025: rulesForYear(2025), 2026: rulesForYear(2026) };
export const FILING_STATUS_KEYS = ALL;
