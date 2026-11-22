import { ASSET_METHODS, shortDate, usd } from '../../utils/taxLogs';

const th = 'py-1.5 pr-3 text-left align-top font-normal text-gray-500';
const td = 'py-1.5 pr-3 align-top';
const num = 'whitespace-nowrap py-1.5 text-right align-top tabular-nums';

function Lines({ caption, rows, total, onDrill }) {
  return <table className="w-full text-sm">
    <caption className="pb-1 text-left font-medium text-white">{caption}</caption>
    <tbody>{rows.map((r) => <tr key={r.line} className={`border-t border-white/5 ${['31', '42'].includes(r.line) ? 'font-semibold text-white' : 'text-gray-300'}`}>
      <th scope="row" className={`${th} w-12`}>{r.line}</th>
      <td className={td}>{onDrill?.(r.line) ? <button type="button" onClick={onDrill(r.line)} className="text-left underline decoration-white/30 underline-offset-2 hover:decoration-purple-300">{r.label}</button> : r.label}</td>
      <td className={num}>{r.value ?? usd(r.amount)}</td>
    </tr>)}
    {total && <tr className="border-t border-white/10 font-semibold text-white"><th scope="row" className={th}>28</th><td className={td}>{total.label}</td><td className={num}>{usd(total.amount)}</td></tr>}
    </tbody>
  </table>;
}

const Section = ({ title, children }) => <section className="space-y-2 break-inside-avoid"><h3 className="font-medium text-white">{title}</h3>{children}</section>;

/**
 * A Schedule C report (live or finalized) laid out for a tax preparer.
 * onDrill(line) returns a click handler for Part II lines that have records
 * to show, or null.
 */
export function ReportPacket({ report: r, heading, onDrill }) {
  const ho = r.home_office;
  const mi = r.mileage;
  const eq = r.equipment;
  return <article aria-label={heading} className="tax-packet space-y-6 rounded-xl border border-white/10 p-4 text-sm sm:p-5">
    <header className="space-y-1">
      <h2 className="text-lg font-semibold text-white">{heading}</h2>
      <p className="text-gray-400">Schedule C (Form 1040) preparation aid, not a filed return. {r.basis}</p>
      {r.planning && <p className="text-amber-300">Line numbers follow the {r.form_lines_year} form; the {r.year} form hasn&apos;t been checked yet.</p>}
      {(r.expenses.pending > 0 || r.expenses.missing_receipts > 0) && <p className="text-amber-300">{[r.expenses.pending > 0 && `${r.expenses.pending} ${r.expenses.pending === 1 ? 'expense was' : 'expenses were'} still waiting for review and ${r.expenses.pending === 1 ? 'is' : 'are'} not included`, r.expenses.missing_receipts > 0 && `${r.expenses.missing_receipts} deducted ${r.expenses.missing_receipts === 1 ? 'expense has' : 'expenses have'} no receipt attached`].filter(Boolean).join('; ')}.</p>}
    </header>

    <div className="grid gap-6 lg:grid-cols-2">
      <Lines caption="Part I: Income, and the result" rows={r.part1} />
      <Lines caption="Part II: Expenses" rows={r.part2} total={{ label: 'Total expenses', amount: r.part2_total }} onDrill={onDrill} />
      <Lines caption="Part III: Cost of goods sold" rows={r.part3} />
      {r.part5.length > 0 && <table className="w-full text-sm"><caption className="pb-1 text-left font-medium text-white">Part V: Other expenses (line 48)</caption><tbody>
        {r.part5.map((x) => <tr key={x.label} className="border-t border-white/5 text-gray-300"><td className={td}>{x.label}</td><td className={num}>{usd(x.amount)}</td></tr>)}
      </tbody></table>}
    </div>

    {r.part4 && <Section title="Part IV: Vehicle">
      <dl className="grid gap-x-6 gap-y-1 text-gray-300 sm:grid-cols-2">
        <div><dt className="inline text-gray-500">43. First used for the business: </dt><dd className="inline">{r.part4.inService ? shortDate(r.part4.inService) : 'not entered'}</dd></div>
        <div><dt className="inline text-gray-500">44a. Business miles: </dt><dd className="inline tabular-nums">{Number(r.part4.businessMiles).toLocaleString('en-US')}</dd></div>
        <div><dt className="inline text-gray-500">44b. Commuting miles: </dt><dd className="inline tabular-nums">{r.part4.commutingMiles == null ? 'not entered' : Number(r.part4.commutingMiles).toLocaleString('en-US')}</dd></div>
        <div><dt className="inline text-gray-500">44c. Other miles: </dt><dd className="inline tabular-nums">{r.part4.otherMiles == null ? 'not entered' : Number(r.part4.otherMiles).toLocaleString('en-US')}</dd></div>
      </dl>
      <p className="text-xs text-gray-500">Lines 45 to 47b (personal use, another vehicle, evidence) are yes/no questions for you to answer; the mileage log below is the written evidence.</p>
    </Section>}

    {ho && <Section title="Line 30: Business use of home (simplified method)">
      <p className="text-gray-300">{ho.square_feet.toLocaleString('en-US')} sq ft{ho.square_feet > ho.square_feet_used ? ` (${ho.square_feet_used} counted)` : ''} for {ho.months} {ho.months === 1 ? 'month' : 'months'}{ho.home_square_feet ? ` of a ${ho.home_square_feet.toLocaleString('en-US')} sq ft home` : ''}: {usd(ho.before_limit)} at $5 a square foot{ho.amount !== ho.before_limit ? `, limited to ${usd(ho.amount)} by the business profit` : ''}.</p>
    </Section>}

    {mi && mi.trips > 0 && <Section title={`Mileage log (line 9): ${usd(mi.total)}`}>
      <p className="text-gray-400">{mi.by_rate.map((x) => `${Number(x.miles).toLocaleString('en-US')} mi at ${x.cents}¢ = ${usd(x.amount)}`).join(' · ')}{Number(mi.parking_tolls) ? ` · parking and tolls ${usd(mi.parking_tolls)}` : ''}</p>
      <div className="overflow-x-auto"><table className="w-full text-xs sm:text-sm"><thead><tr className="text-gray-500"><th className={th}>Date</th><th className={th}>Where</th><th className={th}>Why</th><th className={`${th} text-right`}>Miles</th></tr></thead><tbody>
        {mi.log.map((t, i) => <tr key={`${t.date}-${i}`} className="border-t border-white/5 text-gray-300"><td className={`${td} whitespace-nowrap`}>{t.date}</td><td className={td}>{t.destination}</td><td className={td}>{t.purpose}{t.parking_tolls ? ` (+${usd(t.parking_tolls)})` : ''}</td><td className={num}>{t.miles}</td></tr>)}
      </tbody></table></div>
    </Section>}

    {eq.items.length > 0 && <Section title="Equipment (Form 4562 and line 22)">
      <div className="overflow-x-auto"><table className="w-full text-xs sm:text-sm"><thead><tr className="text-gray-500"><th className={th}>Item</th><th className={th}>In use</th><th className={`${th} text-right`}>Cost</th><th className={th}>Method</th><th className={`${th} text-right`}>{r.year}</th></tr></thead><tbody>
        {eq.items.map((a, i) => <tr key={`${a.name}-${i}`} className="border-t border-white/5 text-gray-300"><td className={td}>{a.name}{a.business_percent < 100 ? ` (${a.business_percent}% business)` : ''}</td><td className={`${td} whitespace-nowrap`}>{a.placed_in_service}{a.disposed_date ? ` to ${a.disposed_date}` : ''}</td><td className={num}>{usd(a.cost)}</td><td className={td}>{ASSET_METHODS[a.method]?.short}{a.method === 'macrs' ? `, ${a.recovery_years}-year` : ''}</td><td className={num}>{usd(a.this_year)}</td></tr>)}
      </tbody></table></div>
      <p className="text-gray-400">Depreciation {usd(eq.depreciation)} · Section 179 {usd(eq.section_179)}{Number(eq.section_179_carryover) ? ` (${usd(eq.section_179_carryover)} carried to next year)` : ''} · de minimis {usd(eq.de_minimis)}. Half-year convention; no bonus depreciation.</p>
    </Section>}

    <Section title={`Sales: ${r.sales.count} ${r.sales.count === 1 ? 'sale' : 'sales'}`}>
      {r.sales.by_platform.length > 0 && <p className="text-gray-300">{r.sales.by_platform.map((p) => `${p.platform} ${usd(p.gross)} (${p.count})`).join(' · ')}</p>}
      {r.form_1099k.forms.length > 0 && <p className="text-gray-300">1099-K forms: {r.form_1099k.forms.map((f) => `${f.payer_name} ${usd(f.gross_amount)}`).join(' · ')} (total {usd(r.form_1099k.total)}).</p>}
      {r.year_end_cutoff.count > 0 && <p className="text-gray-400">{r.year_end_cutoff.count} late-December {r.year_end_cutoff.count === 1 ? 'sale' : 'sales'} ({usd(r.year_end_cutoff.total)}) paid after the year ended are included, counted on the sale date.</p>}
    </Section>

    {r.payments.length > 0 && <Section title="Estimated and other tax payments recorded">
      <ul className="space-y-0.5 text-gray-300">{r.payments.map((p, i) => <li key={i}>{p.paid_date} · {p.jurisdiction === 'US' ? 'IRS' : p.jurisdiction} {p.period} · {usd(p.amount)}{p.reference ? ` · ${p.reference}` : ''}</li>)}</ul>
    </Section>}

    {r.notes.length > 0 && <Section title="Notes"><ul className="list-disc space-y-1 pl-5 text-gray-400">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul></Section>}
  </article>;
}
