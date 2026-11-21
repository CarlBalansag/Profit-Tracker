import { useState } from 'react';
import { stateOptions } from '../../../../shared/tax/index.mjs';
import { FILING_STATUS_LABELS, formToProfile, toForm } from '../../utils/taxProfile';

const SUPPORT_LABEL = { none: ' (no state income tax)', provisional: ' (estimate)', unsupported: ' (not supported yet)', verified: '' };
const inputCls = 'w-full rounded-lg border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-purple-500/60 focus:outline-none disabled:opacity-60';

function Field({ id, label, why, children }) {
  return <div>
    <label htmlFor={id} className="block text-sm text-gray-300">{label}</label>
    <div className="mt-1">{children}</div>
    {why && <p id={`${id}-why`} className="mt-1 text-xs text-gray-500">{why}</p>}
  </div>;
}
function Money({ id, value, onChange, disabled, why }) {
  return <div className="relative">
    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">$</span>
    <input id={id} type="number" inputMode="decimal" min="0" step="0.01" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
      placeholder="0.00" aria-describedby={why ? `${id}-why` : undefined} className={`${inputCls} pl-7`} />
  </div>;
}
function Section({ title, children }) {
  return <fieldset className="space-y-3 rounded-lg border border-white/10 p-3">
    <legend className="px-1 text-sm font-medium text-white">{title}</legend>
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </fieldset>;
}

/**
 * The quick setup (mode 'setup': state, filing status, other income) or the
 * full editor (mode 'edit'). onSubmit({ profile, save }) is called with the
 * API-shaped profile; `save` says whether to store it or only estimate.
 */
export function TaxProfileForm({ year, initial, mode = 'edit', saved = false, busy = false, error = '', onSubmit, onCancel, onFlatOnly }) {
  const [values, setValues] = useState(() => toForm(initial || {}));
  const [localError, setLocalError] = useState('');
  const set = (key) => (value) => setValues((v) => ({ ...v, [key]: value }));
  const states = stateOptions(year);
  const id = (key) => `tax-${key}`;
  const submit = (save) => (e) => {
    e?.preventDefault();
    // A flat percentage works without a filing status, as long as it isn't saved.
    const result = formToProfile(values, { requireFilingStatus: save || values.reserve_mode !== 'flat' });
    if (result.error) { setLocalError(result.error); return; }
    setLocalError('');
    onSubmit({ profile: result.profile, save });
  };
  const basics = <>
    <Field id={id('state')} label="State you live in" why="Most states tax your profit too. We only show state tax for states we've checked.">
      <select id={id('state')} value={values.state} disabled={busy} onChange={(e) => set('state')(e.target.value)} aria-describedby={`${id('state')}-why`} className={inputCls}>
        <option value="">Choose a state</option>
        {states.map((s) => <option key={s.code} value={s.code}>{s.name}{SUPPORT_LABEL[s.support]}</option>)}
      </select>
    </Field>
    <Field id={id('filing_status')} label="Filing status" why="It sets your tax brackets and standard deduction.">
      <select id={id('filing_status')} value={values.filing_status} disabled={busy} onChange={(e) => set('filing_status')(e.target.value)} aria-describedby={`${id('filing_status')}-why`} className={inputCls}>
        <option value="">Choose one</option>
        {Object.entries(FILING_STATUS_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
    </Field>
    <Field id={id('non_business_income')} label={`Income outside this business in ${year}`} why="A job, interest, unemployment: anything not from reselling, for the whole year. Your profit is taxed on top of it, so it decides your bracket. Enter 0 if none.">
      <Money id={id('non_business_income')} value={values.non_business_income} onChange={set('non_business_income')} disabled={busy} why />
    </Field>
  </>;
  const shownError = localError || error;

  if (mode === 'setup') {
    return <form onSubmit={submit(true)} noValidate aria-label="Set up your tax estimate" className="space-y-4 rounded-xl border border-white/10 p-4">
      <div>
        <h3 className="text-base font-semibold text-white">Set up your tax estimate</h3>
        <p className="mt-1 text-sm text-gray-400">Three questions. We never ask for your Social Security number or name. You can add more detail later to make the estimate sharper.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">{basics}</div>
      {shownError && <p role="alert" className="text-sm text-red-400">{shownError}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save and see my estimate'}</button>
        <button type="button" disabled={busy} onClick={submit(false)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-200">Estimate without saving</button>
        {onFlatOnly && <button type="button" disabled={busy} onClick={onFlatOnly} className="text-sm text-gray-400 underline">Skip: use a flat 25%</button>}
      </div>
      <p className="text-xs text-gray-500">&quot;Estimate without saving&quot; keeps your answers only in this browser tab. They are not sent to ProfitTracker and are gone when you leave the page.</p>
    </form>;
  }

  return <form onSubmit={submit(saved)} noValidate aria-label="Your tax details" className="space-y-4">
    <Section title="Basics">{basics}
      <Field id={id('wages')} label="How much of that is W-2 wages" why="Social Security tax already taken from a paycheck counts toward this year's limit, which can lower the self-employment tax on your profit.">
        <Money id={id('wages')} value={values.wages} onChange={set('wages')} disabled={busy} why />
      </Field>
    </Section>
    <Section title="Other self-employment">
      <Field id={id('other_se_income')} label="Profit from other self-employment" why="Gig or freelance profit outside ProfitTracker adds to self-employment tax. Leave blank if none.">
        <Money id={id('other_se_income')} value={values.other_se_income} onChange={set('other_se_income')} disabled={busy} why />
      </Field>
    </Section>
    <Section title={`Already paid for ${year}`}>
      <Field id={id('federal_withholding')} label="Federal tax withheld from paychecks" why="Withholding already counts toward your tax bill. Your pay stub shows it year to date; estimate the full year.">
        <Money id={id('federal_withholding')} value={values.federal_withholding} onChange={set('federal_withholding')} disabled={busy} why />
      </Field>
      <Field id={id('state_withholding')} label="State tax withheld from paychecks">
        <Money id={id('state_withholding')} value={values.state_withholding} onChange={set('state_withholding')} disabled={busy} />
      </Field>
      <Field id={id('federal_estimated_paid')} label="Federal estimated payments made" why="Quarterly payments you've sent the IRS for this year (Form 1040-ES).">
        <Money id={id('federal_estimated_paid')} value={values.federal_estimated_paid} onChange={set('federal_estimated_paid')} disabled={busy} why />
      </Field>
      <Field id={id('state_estimated_paid')} label="State estimated payments made">
        <Money id={id('state_estimated_paid')} value={values.state_estimated_paid} onChange={set('state_estimated_paid')} disabled={busy} />
      </Field>
    </Section>
    <Section title="Family">
      <Field id={id('qualifying_children')} label="Children under 17" why="Each can lower your tax through the child tax credit. Just the number; no names.">
        <input id={id('qualifying_children')} type="number" inputMode="numeric" min="0" step="1" value={values.qualifying_children} disabled={busy} onChange={(e) => set('qualifying_children')(e.target.value)} aria-describedby={`${id('qualifying_children')}-why`} className={inputCls} />
      </Field>
      <Field id={id('other_dependents')} label="Other dependents" why="Older children or relatives you support can get a smaller credit.">
        <input id={id('other_dependents')} type="number" inputMode="numeric" min="0" step="1" value={values.other_dependents} disabled={busy} onChange={(e) => set('other_dependents')(e.target.value)} aria-describedby={`${id('other_dependents')}-why`} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={values.age65} disabled={busy} onChange={(e) => set('age65')(e.target.checked)} /> I am 65 or older</label>
      {values.filing_status === 'mfj' && <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={values.spouse_age65} disabled={busy} onChange={(e) => set('spouse_age65')(e.target.checked)} /> My spouse is 65 or older</label>}
    </Section>
    <Section title="Deductions">
      <Field id={id('adjustments')} label="Adjustments to income" why="IRA or HSA contributions, student loan interest and similar amounts that lower your income before deductions.">
        <Money id={id('adjustments')} value={values.adjustments} onChange={set('adjustments')} disabled={busy} why />
      </Field>
      <Field id={id('itemized_deductions')} label="Itemized deductions, if you itemize" why="Leave blank to use the standard deduction. We use whichever is larger.">
        <Money id={id('itemized_deductions')} value={values.itemized_deductions} onChange={set('itemized_deductions')} disabled={busy} why />
      </Field>
    </Section>
    <Section title={`Last year (${year - 1})`}>
      <Field id={id('prior_year_tax')} label="Total tax on last year's return" why="Paying 100% of last year's tax (110% at higher incomes) in estimated payments usually avoids a penalty. It's line 24 of Form 1040.">
        <Money id={id('prior_year_tax')} value={values.prior_year_tax} onChange={set('prior_year_tax')} disabled={busy} why />
      </Field>
      <Field id={id('prior_year_agi')} label="Last year's adjusted gross income" why="Decides whether the 100% or 110% rule applies. It's line 11 of Form 1040.">
        <Money id={id('prior_year_agi')} value={values.prior_year_agi} onChange={set('prior_year_agi')} disabled={busy} why />
      </Field>
    </Section>
    <fieldset className="space-y-3 rounded-lg border border-white/10 p-3">
      <legend className="px-1 text-sm font-medium text-white">How much to set aside</legend>
      {[['personalized', 'Personalized', 'The extra tax this business adds, worked out from your details.'],
        ['flat', 'A flat percentage of profit', 'Simple and predictable; not tailored to you.'],
        ['conservative', 'Conservative', 'The personalized amount plus a safety buffer.']].map(([key, label, help]) => (
        <label key={key} className="flex items-start gap-2 text-sm text-gray-300">
          <input type="radio" name="reserve_mode" value={key} checked={values.reserve_mode === key} disabled={busy} onChange={() => set('reserve_mode')(key)} className="mt-1" />
          <span><span className="text-white">{label}</span><span className="block text-xs text-gray-500">{help}</span></span>
        </label>))}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={id('flat_pct')} label="Flat percentage">
          <div className="relative"><input id={id('flat_pct')} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={values.flat_pct} disabled={busy} onChange={(e) => set('flat_pct')(e.target.value)} className={`${inputCls} pr-8`} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span></div>
        </Field>
        <Field id={id('buffer_pct')} label="Safety buffer">
          <div className="relative"><input id={id('buffer_pct')} type="number" inputMode="decimal" min="0" max="100" step="0.01" value={values.buffer_pct} disabled={busy} onChange={(e) => set('buffer_pct')(e.target.value)} className={`${inputCls} pr-8`} /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">%</span></div>
        </Field>
      </div>
    </fieldset>
    {shownError && <p role="alert" className="text-sm text-red-400">{shownError}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {saved
        ? <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save changes'}</button>
        : <>
          <button type="submit" disabled={busy} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white disabled:opacity-50">Update estimate (not saved)</button>
          <button type="button" disabled={busy} onClick={submit(true)} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-gray-200">{busy ? 'Saving…' : 'Save these details'}</button>
        </>}
      <button type="button" disabled={busy} onClick={onCancel} className="text-sm text-gray-400 underline">Cancel</button>
    </div>
  </form>;
}
