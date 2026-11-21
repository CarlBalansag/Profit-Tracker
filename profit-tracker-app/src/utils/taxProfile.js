// Tax profile form helpers: labels, and converting between the form's values
// and the API's profile shape.
import { DEFAULT_BUFFER_RATE, DEFAULT_FLAT_RATE } from '../../../shared/tax/index.mjs';

export const FILING_STATUS_LABELS = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
  qss: 'Qualifying surviving spouse',
};
const MONEY_FIELDS = ['non_business_income', 'wages', 'other_se_income', 'federal_withholding', 'state_withholding', 'federal_estimated_paid',
  'state_estimated_paid', 'adjustments', 'itemized_deductions', 'prior_year_tax', 'prior_year_agi'];

const pct = (rate) => (rate === null || rate === undefined || rate === '' ? '' : String(Math.round(Number(rate) * 10000) / 100));
export const toForm = (p = {}) => {
  const out = {
    state: p.state || '', filing_status: p.filing_status || '', age65: Boolean(p.age65), spouse_age65: Boolean(p.spouse_age65),
    qualifying_children: p.qualifying_children ?? '', other_dependents: p.other_dependents ?? '',
    reserve_mode: p.reserve_mode || 'personalized', flat_pct: pct(p.flat_rate ?? DEFAULT_FLAT_RATE), buffer_pct: pct(p.buffer_rate ?? DEFAULT_BUFFER_RATE),
  };
  for (const key of MONEY_FIELDS) out[key] = p[key] ?? '';
  return out;
};

// Back to the API's shape; returns { profile } or { error }.
export function formToProfile(values, { requireFilingStatus = true } = {}) {
  const money = (v) => String(v ?? '').trim();
  for (const key of MONEY_FIELDS) {
    const v = money(values[key]);
    if (v !== '' && !/^\d+(\.\d{1,2})?$/.test(v)) return { error: 'Enter amounts in dollars and cents, like 1250.00, or leave them blank.' };
  }
  if (requireFilingStatus && !values.filing_status) return { error: 'Choose your filing status.' };
  if (money(values.wages) !== '' && Number(values.wages) > Number(values.non_business_income || 0)) {
    return { error: 'W-2 wages are part of your income outside the business, so they can\'t be more than it.' };
  }
  for (const key of ['qualifying_children', 'other_dependents']) {
    const v = money(values[key]);
    if (v !== '' && !/^\d{1,2}$/.test(v)) return { error: 'Enter the number of children and dependents as whole numbers.' };
  }
  for (const key of ['flat_pct', 'buffer_pct']) {
    const v = money(values[key]);
    if (v !== '' && !(/^\d+(\.\d{1,2})?$/.test(v) && Number(v) <= 100)) return { error: 'Enter percentages from 0 to 100.' };
  }
  const profile = {
    state: values.state || null, filing_status: values.filing_status || null,
    age65: Boolean(values.age65), spouse_age65: values.filing_status === 'mfj' && Boolean(values.spouse_age65),
    qualifying_children: money(values.qualifying_children) === '' ? null : Number(values.qualifying_children),
    other_dependents: money(values.other_dependents) === '' ? null : Number(values.other_dependents),
    reserve_mode: values.reserve_mode,
    flat_rate: money(values.flat_pct) === '' ? null : String(Number(values.flat_pct) / 100),
    buffer_rate: money(values.buffer_pct) === '' ? null : String(Number(values.buffer_pct) / 100),
  };
  for (const key of MONEY_FIELDS) profile[key] = money(values[key]) === '' ? null : money(values[key]);
  return { profile };
}
