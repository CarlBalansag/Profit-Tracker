import { Link } from 'react-router-dom';
import { UntrackedStock } from './UntrackedStock';
import { Forms1099K } from './Forms1099K';
import { MileageLog } from './MileageLog';
import { EquipmentList } from './EquipmentList';
import { HomeOffice } from './HomeOffice';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const signed = (value) => (Number(value) > 0 ? `+${usd(value)}` : usd(value));
const card = 'rounded-xl border border-white/10 p-4';

function LineTable({ caption, rows }) {
  return <table className="w-full text-sm">
    <caption className="pb-2 text-left font-medium text-white">{caption}</caption>
    <tbody>{rows.map((row) => <tr key={row.line} className={`border-t border-white/5 ${['31', '42'].includes(row.line) ? 'font-semibold text-white' : 'text-gray-300'}`}>
      <th scope="row" className="w-12 py-2 pr-2 text-left align-top font-normal text-gray-500">{row.line}</th>
      <td className="py-2 pr-3 align-top">{row.label}</td>
      <td className="whitespace-nowrap py-2 text-right align-top tabular-nums">{row.value ?? usd(row.amount)}</td>
    </tr>)}</tbody>
  </table>;
}

export function ScheduleCBooks({ books, year, onSettingsSaved }) {
  if (!books) return null;
  const line = (n) => books.lines.find((l) => l.line === n)?.amount;
  const net = Number(books.netProfit);
  const { reconciliation: rec, checks, yearEndCutoff: cutoff } = books;
  const problems = [
    checks.negativeCogs && 'Cost of goods sold is below zero, which usually means more stock is on hand at the end of the year than you started with plus what you bought. Check the amounts under "Stock not in ProfitTracker".',
    checks.oversold.length > 0 && `${checks.oversold.length} ${checks.oversold.length === 1 ? 'purchase has' : 'purchases have'} more units sold than bought (${checks.oversold.map((o) => o.product_name).join(', ')}). Fix the quantities so cost of goods sold is right.`,
    checks.soldBeforePurchase.length > 0 && `${checks.soldBeforePurchase.length} ${checks.soldBeforePurchase.length === 1 ? 'sale is' : 'sales are'} dated before the purchase ${checks.soldBeforePurchase.length === 1 ? 'it came' : 'they came'} from (${checks.soldBeforePurchase.map((s) => s.product_name).join(', ')}). Check the dates.`,
  ].filter(Boolean);

  return <section aria-labelledby="schedule-c-profit" className="space-y-4">
    <div>
      <h2 id="schedule-c-profit" className="text-lg font-semibold">Profit for {year} (Parts I and III)</h2>
      <p className="mt-1 text-sm text-gray-400">Built from your purchases and sales. {books.basis}</p>
    </div>

    <div data-tutorial-id="sc-profit" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className={card}><p className="text-sm text-gray-400">Gross receipts (line 1)</p><p className="mt-2 text-2xl tabular-nums">{usd(line('1'))}</p><p className="mt-1 text-xs text-gray-500">{books.sales.count} {books.sales.count === 1 ? 'sale' : 'sales'}{Number(line('2')) ? ` · ${usd(line('2'))} refunded` : ''}</p></div>
      <div className={card}><p className="text-sm text-gray-400">Cost of goods sold (line 4)</p><p className="mt-2 text-2xl tabular-nums">{usd(line('4'))}</p><p className="mt-1 text-xs text-gray-500">What the items you sold cost you</p></div>
      <div className={card}><p className="text-sm text-gray-400">Expenses (line 28)</p><p className="mt-2 text-2xl tabular-nums">{usd(line('28'))}</p><p className="mt-1 text-xs text-gray-500">{books.records && Number(books.records.total) ? `Reviewed expenses, sale fees and labels, plus ${usd(books.records.total)} from driving and equipment` : 'Reviewed expenses plus sale fees and labels'}</p></div>
      <div className={`${card} border-purple-500/30`}><p className="text-sm text-gray-400">Net {net < 0 ? 'loss' : 'profit'} (line 31)</p><p className={`mt-2 text-2xl font-semibold tabular-nums ${net < 0 ? 'text-red-300' : 'text-white'}`}>{usd(books.netProfit)}</p><p className="mt-1 text-xs text-gray-500">Before income and self-employment tax</p></div>
    </div>

    {problems.length > 0 && <div data-tutorial-id="sc-warnings" className="space-y-4">{problems.map((text) => <p key={text} role="alert" className="rounded-xl border border-amber-500/40 p-4 text-sm text-amber-300">{text}</p>)}</div>}

    <details data-tutorial-id="sc-lines" className={card}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">Show the Schedule C lines</summary>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <LineTable caption="Part I: Income, and the result" rows={books.lines} />
        <LineTable caption="Part III: Cost of goods sold" rows={books.partIII} />
        {books.records && <LineTable caption="Part II lines from your logs (included in line 28)" rows={books.records.lines} />}
      </div>
      <p className="mt-3 text-xs text-gray-500">Line 4 comes from Part III: what your inventory was worth on January 1, plus what you bought, minus what was still on hand on December 31. Money spent on stock you still hold isn&apos;t deducted until you sell it.</p>
    </details>

    {books.records && <div id="schedule-c-logs" data-tutorial-id="sc-logs" className="scroll-mt-4 space-y-3">
      <h3 className="pt-2 font-medium">Driving, equipment and home office</h3>
      <p className="text-sm text-gray-400">Deductions that come from your own records rather than from expenses. Each one is added only when you enter it.</p>
      <MileageLog year={Number(year)} mileage={books.records.mileage} vehicle={books.records.vehicle} onSaved={onSettingsSaved || (() => {})} />
      <EquipmentList year={Number(year)} assets={books.records.assets} onSaved={onSettingsSaved || (() => {})} />
      <HomeOffice key={year} year={Number(year)} homeOffice={books.records.homeOffice} onSaved={onSettingsSaved || (() => {})} />
    </div>}

    <div data-tutorial-id="sc-extras" className="space-y-4">
    {books.untracked && <UntrackedStock key={`${year}-${books.untracked.startEntered}-${books.untracked.endEntered}`} year={Number(year)} untracked={books.untracked} onSaved={onSettingsSaved || (() => {})} />}

    <details className={card}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">Why this differs from your profit elsewhere in the app</summary>
      <table className="mt-4 w-full text-sm"><tbody>
        <tr className="text-gray-300"><td className="py-2 pr-3">Profit on {year} sales, how the rest of the app counts it</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(rec.appProfitOnSales)}</td></tr>
        <tr className="border-t border-white/5 text-gray-300"><td className="py-2 pr-3">Expenses dated {year} on the Expenses tab</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(-Number(rec.appExpenses))}</td></tr>
        {rec.differences.map((d) => <tr key={d.key} className="border-t border-white/5 text-gray-400"><td className="py-2 pr-3">{d.label}</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{signed(d.amount)}</td></tr>)}
        <tr className="border-t border-white/10 font-semibold text-white"><td className="py-2 pr-3">Schedule C net profit (line 31)</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(rec.scheduleCNetProfit)}</td></tr>
      </tbody></table>
    </details>

    {books.form1099K && <Forms1099K year={Number(year)} data={books.form1099K} onSaved={onSettingsSaved || (() => {})} />}

    {cutoff.sales.length > 0 && <details className={card}>
      <summary className="cursor-pointer text-sm font-medium text-purple-300">{cutoff.sales.length} late-December {cutoff.sales.length === 1 ? 'sale' : 'sales'} paid after the year ended ({usd(cutoff.total)})</summary>
      <p className="mt-3 text-sm text-gray-400">These count in {year} because they were sold in {year}, even though the money arrived later.</p>
      <ul className="mt-2 space-y-1 text-sm text-gray-300">{cutoff.sales.map((s) => <li key={s.sale_id} className="flex flex-wrap justify-between gap-2"><Link className="underline" to="/transactions" state={{ openTransaction: { inventoryId: s.inventory_id, saleId: s.sale_id } }}>{s.product_name}</Link><span className="text-gray-500">sold {s.sale_date} · {s.paid_at ? `paid ${s.paid_at}` : 'not paid yet'} · {usd(s.amount)}</span></li>)}</ul>
    </details>}

    </div>

    {books.notes.length > 0 && <ul data-tutorial-id="sc-notes" className="space-y-2 text-sm text-gray-400">{books.notes.map((note) => <li key={note} className="rounded-xl border border-white/10 p-3">{note}</li>)}</ul>}
  </section>;
}
