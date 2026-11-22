import { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { requireSuccessfulResponse } from '../../hooks/apiResponse';
import { buildTaxOverview, STATE_NAMES } from '../../../../shared/tax/index.mjs';
import { localToday } from '../../utils/returnWindow';
import { TaxProfileForm } from './TaxProfileForm';
import { TaxProjection } from './TaxProjection';
import { TaxReserve } from './TaxReserve';
import { TaxPayments } from './TaxPayments';
import { WhatIf } from './WhatIf';
import { DeductionChecks } from './DeductionChecks';
import { FILING_STATUS_LABELS } from '../../utils/taxProfile';
import { ResponsiveTable } from './ResponsiveTable';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const pct = (rate) => (rate === null || rate === undefined ? 'n/a' : `${(Number(rate) * 100).toFixed(1)}%`);
const day = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const card = 'rounded-xl border border-white/10 p-4';
const MODE_LABEL = { personalized: 'personalized', flat: 'flat percentage', conservative: 'conservative' };
const IRS = {
  estimated: { label: 'IRS: Estimated taxes', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes' },
  se: { label: 'IRS: Self-employment tax', url: 'https://www.irs.gov/businesses/small-businesses-self-employed/self-employment-tax-social-security-and-medicare-taxes' },
};

function Row({ label, value, strong = false, hint }) {
  return <tr className={`border-t border-white/5 ${strong ? 'font-semibold text-white' : 'text-gray-300'}`}>
    <td className="py-2 pr-3 align-top">{label}{hint && <span className="block text-xs font-normal text-gray-500">{hint}</span>}</td>
    <td className="whitespace-nowrap py-2 text-right align-top tabular-nums">{value}</td>
  </tr>;
}

function SourceLinks({ sources }) {
  if (!sources?.length) return null;
  return <ul className="mt-2 space-y-1 text-xs">{sources.map((s) => <li key={s.url}><a className="text-gray-400 underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a></li>)}</ul>;
}

// "How we worked it out": a short version, or every line in Detailed.
function TheMath({ o, detailed }) {
  const i = o.impact;
  if (!i) {
    return <p className="mt-3 text-sm text-gray-400">{usd(o.businessProfit)} of profit × {pct(o.flatRate)} = {usd(o.reserves.flat)}. A flat percentage isn&apos;t tailored to you; add your filing status and state for a personalized estimate.</p>;
  }
  const w = i.withBusiness.federal; const wo = i.withoutBusiness.federal;
  const ws = i.withBusiness.state; const wos = i.withoutBusiness.state;
  return <div className="mt-3 space-y-4 text-sm">
    <p className="text-gray-300">We work out your whole {o.year} tax twice, once with your business profit and once without it. The difference is the tax your business adds: {usd(i.withBusiness.totalTax)} − {usd(i.withoutBusiness.totalTax)} = <strong className="text-white">{usd(i.additionalTaxFromBusiness)}</strong>.</p>
    <dl className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-lg border border-white/10 p-3"><dt className="text-xs text-gray-400">Effective business tax rate</dt><dd className="mt-1 text-lg tabular-nums text-white">{pct(i.effectiveBusinessTaxRate)}</dd><dd className="text-xs text-gray-500">Tax the business adds ÷ its profit</dd></div>
      <div className="rounded-lg border border-white/10 p-3"><dt className="text-xs text-gray-400">Marginal rate</dt><dd className="mt-1 text-lg tabular-nums text-white">{pct(i.marginalRate)}</dd><dd className="text-xs text-gray-500">Tax on your next $100 of profit, all taxes combined</dd></div>
      <div className="rounded-lg border border-white/10 p-3"><dt className="text-xs text-gray-400">Effective rate on all income</dt><dd className="mt-1 text-lg tabular-nums text-white">{pct(i.effectiveTaxRate)}</dd><dd className="text-xs text-gray-500">Total tax ÷ total income</dd></div>
    </dl>
    {detailed && <>
      <ResponsiveTable caption="Federal" rowKey={(r) => r.key || r.label} strong={(r) => r.strong} columns={[
        { label: 'Line', cell: (r) => r.label },
        { label: 'Without business', align: 'right', cell: (r) => r.without },
        { label: 'With business', align: 'right', cell: (r) => r.with },
      ]} rows={[
        ...[['Total income', 'totalIncome'], ['Half of self-employment tax (deducted)', 'selfEmploymentTaxDeduction', true], ['Adjusted gross income', 'agi'],
          [`${w.deductionType === 'itemized' ? 'Itemized' : 'Standard'} deduction`, 'deduction', true], ['Senior deduction', 'seniorDeduction', true],
          ['Qualified business income deduction', 'qbiDeduction', true], ['Taxable income', 'taxableIncome'], ['Income tax', 'incomeTax'],
          ['Credits', 'nonrefundableCredits', true]].map(([label, key, minus]) => ({ label, without: `${minus && wo[key] ? '−' : ''}${usd(wo[key])}`, with: `${minus && w[key] ? '−' : ''}${usd(w[key])}` })),
        { label: `Self-employment tax (Social Security ${usd(w.selfEmployment.socialSecurity)} + Medicare ${usd(w.selfEmployment.medicare)})`, without: usd(wo.selfEmployment.total), with: usd(w.selfEmployment.total) },
        { label: 'Additional Medicare tax', without: usd(wo.additionalMedicareTax), with: usd(w.additionalMedicareTax) },
        { label: 'Federal tax', without: usd(wo.totalTax), with: usd(w.totalTax), strong: true },
        { label: <>{ws.name ? `${ws.name} tax` : 'State tax'}{!ws.supported && <span className="block text-xs font-normal text-amber-300">Not included</span>}</>, key: 'state', without: usd(wos.tax), with: usd(ws.tax) },
        { label: 'Total tax', without: usd(i.withoutBusiness.totalTax), with: usd(i.withBusiness.totalTax), strong: true },
      ]} />
      {w.selfEmployment.belowMinimum && <p className="text-xs text-gray-500">Self-employment tax starts once net earnings reach $400, so none is due yet.</p>}
      {ws.steps?.length > 0 && <div><p className="text-xs text-gray-400">{ws.name} steps (with business)</p><table className="w-full"><tbody>{ws.steps.map((s) => <Row key={s.label} label={s.label} value={usd(s.amount)} />)}</tbody></table></div>}
      {i.withBusiness.notes?.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-gray-400">{i.withBusiness.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <div><p className="text-xs font-medium text-gray-400">Assumptions</p><ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-gray-500">{i.withBusiness.assumptions.map((a) => <li key={a}>{a}</li>)}</ul></div>
      <div><p className="text-xs font-medium text-gray-400">Rules used: {i.withBusiness.ruleVersions.federal}{i.withBusiness.ruleVersions.state ? `, ${i.withBusiness.ruleVersions.state}` : ''}. Official sources:</p><SourceLinks sources={[...o.sources.federal, ...o.sources.state]} /></div>
    </>}
  </div>;
}

export function TaxOverview({ year, books, worksheet = null, pendingExpenses = 0, missingReceipts = 0, onShowWorksheet }) {
  const [loaded, setLoaded] = useState(null); // { saved, taxMath } | { error }
  const [session, setSession] = useState(null); // unsaved profile, only in memory
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [p, m, r, pay] = await Promise.all([apiFetch(`/api/tax/profile/${year}`), apiFetch('/api/preferences/tax-math'), apiFetch(`/api/tax/reserves/${year}`), apiFetch(`/api/tax/payments/${year}`)]);
        const { profile } = await (await requireSuccessfulResponse(p)).json();
        const { taxMath } = await (await requireSuccessfulResponse(m)).json();
        const ledger = await (await requireSuccessfulResponse(r)).json();
        const { payments } = await (await requireSuccessfulResponse(pay)).json();
        if (active) setLoaded({ saved: profile, taxMath, ledger, payments });
      } catch (err) { if (active) setLoaded({ error: err.message || 'Could not load your tax details.' }); }
    })();
    return () => { active = false; };
  }, [year, attempt]);

  if (!loaded) return <p role="status" className="text-sm text-gray-400">Loading your tax estimate…</p>;
  if (loaded.error) return <div><p role="alert" className="text-red-400">{loaded.error}</p><button onClick={() => { setLoaded(null); setAttempt((n) => n + 1); }} className="mt-2 underline">Retry</button></div>;

  const saved = loaded.saved;
  const profile = session || saved;
  const detailed = loaded.taxMath === 'detailed';
  const setTaxMath = async (value) => {
    setLoaded((l) => ({ ...l, taxMath: value }));
    try { await requireSuccessfulResponse(await apiFetch('/api/preferences/tax-math', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taxMath: value }) })); } catch { /* the view still switches; it just won't be remembered */ }
  };
  const submit = async ({ profile: next, save }) => {
    setError('');
    // The form doesn't show the projection choice; keep it.
    next = { forecast_method: profile?.forecast_method ?? null, profit_target: profile?.profit_target ?? null, ...next };
    if (!save) { setSession(next); setEditing(false); return; }
    setBusy(true);
    try {
      const res = await requireSuccessfulResponse(await apiFetch(`/api/tax/profile/${year}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }));
      const { profile: stored } = await res.json();
      setLoaded((l) => ({ ...l, saved: stored })); setSession(null); setEditing(false);
    } catch (err) { setError(err.message || 'Could not save. Try again.'); }
    finally { setBusy(false); }
  };
  // A change from the overview itself (the projection choice): saved
  // details are saved again, unsaved ones stay in this tab only.
  const PROFILE_KEYS = ['state', 'filing_status', 'non_business_income', 'wages', 'other_se_income', 'federal_withholding', 'state_withholding',
    'qualifying_children', 'other_dependents', 'age65', 'spouse_age65', 'adjustments',
    'itemized_deductions', 'prior_year_tax', 'prior_year_agi', 'reserve_mode', 'flat_rate', 'buffer_rate', 'forecast_method', 'profit_target'];
  const updateProfile = (patch) => {
    const merged = { ...profile, ...patch };
    const clean = Object.fromEntries(PROFILE_KEYS.filter((k) => merged[k] !== undefined).map((k) => [k, merged[k]]));
    if (saved && !session && clean.filing_status) submit({ profile: clean, save: true });
    else setSession(clean);
  };
  const setLedger = (ledger) => setLoaded((l) => ({ ...l, ledger }));
  const setPayments = (payments) => setLoaded((l) => ({ ...l, payments }));
  const removeSaved = async () => {
    setBusy(true); setError('');
    try {
      await requireSuccessfulResponse(await apiFetch(`/api/tax/profile/${year}`, { method: 'DELETE' }));
      setLoaded((l) => ({ ...l, saved: null })); setSession(null); setConfirmDelete(false); setEditing(false);
    } catch (err) { setError(err.message || 'Could not delete. Try again.'); }
    finally { setBusy(false); }
  };

  const header = <div className="flex flex-wrap items-center justify-between gap-3">
    <div>
      <h2 className="text-lg font-semibold">Your {year} tax estimate</h2>
      <p className="mt-1 text-sm text-gray-400">An estimate to plan with, not a tax bill. Based on your records and a projection of the rest of the year.</p>
    </div>
    <div role="group" aria-label="How much math to show" className="inline-flex rounded-lg border border-white/10 p-0.5 text-sm">
      {['simple', 'detailed'].map((v) => <button key={v} type="button" aria-pressed={loaded.taxMath === v} onClick={() => setTaxMath(v)}
        className={`rounded-md px-3 py-1 ${loaded.taxMath === v ? 'bg-purple-600 text-white' : 'text-gray-300'}`}>{v === 'simple' ? 'Simple' : 'Detailed'}</button>)}
    </div>
  </div>;

  if (!profile && !editing) {
    return <section aria-label="Tax estimate" className="space-y-4">{header}
      <div data-tutorial-id="sc-setup"><TaxProfileForm key="setup" year={year} mode="setup" busy={busy} error={error} onSubmit={submit}
        onFlatOnly={() => setSession({ reserve_mode: 'flat', flat_rate: '0.25' })} /></div>
    </section>;
  }

  const o = buildTaxOverview({ profile, year, businessProfit: books.netProfit, today: localToday(), forecast: books.forecast || null, reserveBalance: loaded.ledger?.balance || 0, payments: loaded.payments || [] });
  const projected = o.forecastChoice.key !== 'actual';
  const describe = profile?.filing_status
    ? `${FILING_STATUS_LABELS[profile.filing_status]}${profile.state ? `, ${STATE_NAMES[profile.state]}` : ''}`
    : 'Flat percentage only';
  const next = o.nextDue[0];
  const unsupportedYear = !o.supportedYear;

  return <section aria-label="Tax estimate" className="space-y-4">
    {header}
    {session && <p className="rounded-xl border border-amber-500/30 p-3 text-sm text-amber-200">Not saved: these details are only in this browser tab and are gone when you leave.{session.filing_status && <> <button type="button" disabled={busy} onClick={() => submit({ profile: session, save: true })} className="underline">Save them</button></>}</p>}
    {o.overdue.length > 0 && <div role="alert" className="rounded-xl border border-red-500/40 p-3 text-sm text-red-200">
      <p className="font-medium">{o.overdue.length === 1 ? 'An estimated tax payment looks unpaid' : `${o.overdue.length} estimated tax payments look unpaid`}</p>
      <ul className="mt-1 space-y-0.5">{o.overdue.map((d) => <li key={`${d.code}-${d.period}`}>{d.who} {d.period}, due {day(d.due)}: <span className="tabular-nums">{usd(d.amount)}</span></li>)}</ul>
      <p className="mt-1 text-xs text-red-200/80">If you've already paid, record it under Tax payments. If not, the IRS charges a penalty that grows the longer a payment is late, so paying soon keeps it small. <a className="underline" href="https://www.irs.gov/payments" target="_blank" rel="noreferrer">Ways to pay the IRS</a></p>
    </div>}
    {o.limitations.length > 0 && <ul role="note" className="space-y-1 rounded-xl border border-amber-500/30 p-3 text-sm text-amber-200">{o.limitations.map((l) => <li key={l}>{l}</li>)}</ul>}

    <div data-tutorial-id="sc-estimate-cards" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className={card}><p className="text-sm text-gray-400">Profit so far</p><p className="mt-2 text-2xl tabular-nums">{usd(o.actualProfit)}</p><p className="mt-1 text-xs text-gray-500">{projected ? <>Projected for {year}: <span className="text-gray-300">{usd(o.businessProfit)}</span> · </> : null}Schedule C line 31 · <button type="button" onClick={onShowWorksheet} className="underline">see how</button></p></div>
      <div className={card}><p className="text-sm text-gray-400">Tax the business adds</p><p className="mt-2 text-2xl tabular-nums">{o.impact ? usd(Math.max(0, o.impact.additionalTaxFromBusiness)) : '—'}</p><p className="mt-1 text-xs text-gray-500">{o.impact ? (o.impact.effectiveBusinessTaxRate !== null ? `About ${pct(o.impact.effectiveBusinessTaxRate)} of ${projected ? 'projected' : 'your'} profit` : 'No profit yet, so no extra tax') : 'Add your filing status to see this'}</p></div>
      <div className={`${card} border-purple-500/30`}><p className="text-sm text-gray-400">Set aside</p><p className="mt-2 text-2xl font-semibold tabular-nums text-white">{usd(o.recommended)}</p><p className="mt-1 text-xs text-gray-500">{MODE_LABEL[o.effectiveMode]} · {usd(o.stillToSetAside)} still to set aside{o.coverage !== null && o.covered > 0 ? ` · ${Math.min(100, Math.round(o.coverage * 100))}% covered` : ''}</p></div>
      <div className={card}><p className="text-sm text-gray-400">Next payment due</p>{next
        ? <><p className="mt-2 text-2xl tabular-nums">{day(next.due)}</p>{o.nextDue.filter((d) => d.due === next.due).map((d) => <p key={d.who} className="mt-1 text-xs text-gray-500">{d.who} {d.period}: {usd(d.amount)}{d.catchUp > 0 ? `, including ${usd(d.catchUp)} overdue` : ''}</p>)}</>
        : <><p className="mt-2 text-lg">{o.impact ? 'Nothing scheduled' : '—'}</p><p className="mt-1 text-xs text-gray-500">{o.impact ? `Any balance is due when you file, by ${day(o.filingDue)}.` : unsupportedYear ? 'Not available for this year' : 'Add your details to see this'}</p></>}</div>
    </div>

    {o.projection && <details data-tutorial-id="sc-projection" className={card} open={detailed || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">Projection for {year}: {o.forecastChoice.label.toLowerCase()} ({usd(o.businessProfit)})</summary>
      <TaxProjection key={`${o.forecastChoice.key}-${profile?.profit_target ?? ''}`} o={o} target={profile?.profit_target ?? null} busy={busy} onChoose={updateProfile} />
    </details>}

    <details data-tutorial-id="sc-math" className={card} open={detailed || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">How we worked it out</summary>
      <TheMath o={o} detailed={detailed} />
      {!detailed && o.impact && <p className="mt-3 text-xs text-gray-500">Switch to Detailed to see every line, the rules used and the official sources.</p>}
    </details>

    {o.impact && <details data-tutorial-id="sc-whatif" className={card}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">What if…</summary>
      <WhatIf year={year} profile={profile} baseProfit={o.businessProfit} marginalRate={o.impact.marginalRate} today={localToday()} />
    </details>}

    <details data-tutorial-id="sc-saved" className={card} open={detailed || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">What you&apos;ve already saved and paid</summary>
      <table className="mt-3 w-full text-sm"><tbody>
        <Row label="Recommended to set aside" value={usd(o.recommended)} />
        <Row label="In your tax savings" value={usd(o.reserveBalance)} />
        <Row label="Tax payments made" hint="Recorded under Tax payments" value={usd(o.estimatedPaid)} />
        <Row strong label={o.stillToSetAside > 0 ? 'Still to set aside' : 'Covered'} hint={o.coverage !== null ? `${Math.min(100, Math.round(o.coverage * 100))}% of the recommendation is covered` : undefined} value={usd(o.stillToSetAside)} />
      </tbody></table>
      {o.impact ? <table className="mt-3 w-full text-sm"><tbody>
        <tr><td colSpan={2} className="pt-2 text-xs font-medium text-gray-400">Your whole return</td></tr>
        <Row label="Federal tax withheld from paychecks" value={usd(o.impact.withBusiness.federal.withholding)} />
        <Row label="Federal estimated payments" value={usd(o.impact.withBusiness.federal.estimatedPayments)} />
        {profile.state && <Row label={`${STATE_NAMES[profile.state]} withheld`} value={usd(o.impact.withBusiness.state.withholding)} />}
        {profile.state && <Row label={`${STATE_NAMES[profile.state]} estimated payments`} value={usd(o.impact.withBusiness.state.estimatedPayments)} />}
        <Row strong label="Left to pay on your whole return" hint="Your total estimated tax minus everything above" value={usd(Math.max(0, o.impact.withBusiness.remainingBalance))} />
      </tbody></table> : <p className="mt-3 text-sm text-gray-400">Add your details to include withholding and payments.</p>}
      <TaxReserve year={year} ledger={loaded.ledger || { entries: [], balance: '0.00' }} onChanged={setLedger} />

    </details>

    <details data-tutorial-id="sc-payments" className={card} open={detailed || o.overdue.length > 0 || undefined}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">Tax payments{o.estimatedPaid > 0 ? ` (${usd(o.estimatedPaid)} paid)` : ''}</summary>
      <TaxPayments year={year} o={o} profile={profile} payments={loaded.payments || []} onChanged={setPayments} />
      <p className="mt-3 text-xs text-gray-500"><a className="underline" href={IRS.estimated.url} target="_blank" rel="noreferrer">{IRS.estimated.label}</a> · <a className="underline" href={IRS.se.url} target="_blank" rel="noreferrer">{IRS.se.label}</a></p>
    </details>

    <details data-tutorial-id="sc-deductions" className={card}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">Deductions you might be missing</summary>
      <DeductionChecks year={year} worksheet={worksheet} saleCount={books.sales?.count || 0} profit={o.businessProfit} records={books.records || null} pendingExpenses={pendingExpenses} missingReceipts={missingReceipts} onShowWorksheet={onShowWorksheet} />
    </details>

    {o.missing.length > 0 && profile.filing_status && <div className={card}>
      <p className="text-sm font-medium text-white">Make this estimate sharper</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-400">{o.missing.map((m) => <li key={m.field}>{m.text}</li>)}</ul>
    </div>}

    <div className={`${card} space-y-3`}>
      {!editing ? <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-400">Using: <span className="text-gray-200">{describe}</span>{saved && !session ? ' · saved' : ' · not saved'}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg border border-white/10 px-3 py-1.5 text-purple-300">Edit my tax details</button>
          {saved && !confirmDelete && <button type="button" onClick={() => setConfirmDelete(true)} className="text-gray-400 underline">Delete saved details</button>}
          {saved && confirmDelete && <span className="flex flex-wrap items-center gap-2"><span className="text-gray-400">Delete your saved {year} details?</span><button type="button" disabled={busy} onClick={removeSaved} className="text-red-300 underline">Yes, delete</button><button type="button" onClick={() => setConfirmDelete(false)} className="text-gray-400 underline">Keep them</button></span>}
          {session && <button type="button" onClick={() => setSession(null)} className="text-gray-400 underline">Clear unsaved details</button>}
        </div>
      </div> : <TaxProfileForm key={`edit-${saved?.updated_at || 'new'}`} year={year} initial={profile} saved={Boolean(saved) && !session} busy={busy} error={error} onSubmit={submit} onCancel={() => { setEditing(false); setError(''); }} />}
      {!editing && error && <p role="alert" className="text-sm text-red-400">{error}</p>}
    </div>
  </section>;
}
