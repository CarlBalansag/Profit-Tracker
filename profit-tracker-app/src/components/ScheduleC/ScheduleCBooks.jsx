import { Link } from 'react-router-dom';
import { Banknote, Package, Receipt, Scale } from 'lucide-react';
import { Panel, Rise } from '../Analytics/Motion';
import { UntrackedStock } from './UntrackedStock';
import { Forms1099K } from './Forms1099K';
import { MileageLog } from './MileageLog';
import { EquipmentList } from './EquipmentList';
import { HomeOffice } from './HomeOffice';
import { Tile } from './Tile';

const usd = (value) => {
  const n = Number(value) || 0;
  const text = `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${text}` : text;
};
const signed = (value) => (Number(value) > 0 ? `+${usd(value)}` : usd(value));
const rowSummary = 'cursor-pointer text-sm font-medium text-[var(--dp-text-primary)]';

function LineTable({ caption, rows }) {
  return <table className="w-full text-sm">
    <caption className="pb-2 text-left text-xs font-semibold text-[var(--dp-text-secondary)]">{caption}</caption>
    <tbody>{rows.map((row) => <tr key={row.line} className={`border-t border-[color:var(--dp-border)] ${['31', '42'].includes(row.line) ? 'font-semibold text-[var(--dp-text-primary)]' : 'text-[var(--dp-text-secondary)]'}`}>
      <th scope="row" className="w-12 py-2 pr-2 text-left align-top font-normal text-[var(--dp-text-muted)]">{row.line}</th>
      <td className="py-2 pr-3 align-top">{row.label}</td>
      <td className="whitespace-nowrap py-2 text-right align-top tabular-nums">{row.value ?? usd(row.amount)}</td>
    </tr>)}</tbody>
  </table>;
}

/** The four numbers: sales, what the items cost, expenses, profit. */
export function ProfitTiles({ books }) {
  if (!books) return null;
  const line = (n) => books.lines.find((l) => l.line === n)?.amount;
  const net = Number(books.netProfit);
  const refunded = Number(line('2'));
  return <Rise data-tutorial-id="sc-profit" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
    <Tile label="Sales" icon={Banknote} value={usd(line('1'))}
      sub={`${books.sales.count} ${books.sales.count === 1 ? 'sale' : 'sales'}${refunded ? ` · ${usd(refunded)} refunded` : ''}`}
      tip="Schedule C line 1: what your sales brought in this year, counted on the sale date." />
    <Tile label="Cost of items" icon={Package} value={usd(line('4'))} sub="What they cost you"
      tip="Line 4: what the items you sold cost, with purchase tax and shipping, less card rewards. Stock you still have isn't counted until it sells." />
    <Tile label="Expenses" icon={Receipt} value={usd(line('28'))} sub="Reviewed costs only" tipAlign="right"
      tip="Line 28: reviewed expenses, shipping labels and selling fees from your sales, plus driving and equipment you add." />
    <Tile label={net < 0 ? 'Loss' : 'Profit'} icon={Scale} value={usd(books.netProfit)} sub="What you pay tax on" highlight tipAlign="right"
      tone={net < 0 ? 'text-[var(--dp-red-text)]' : 'text-[var(--dp-text-primary)]'}
      tip="Line 31: sales minus cost of items sold minus expenses. Income tax and self-employment tax are figured on this number." />
  </Rise>;
}

/** Driving, equipment and home office: deductions you add yourself. */
export function LowerYourTax({ books, year, onSettingsSaved }) {
  if (!books?.records) return null;
  const saved = onSettingsSaved || (() => {});
  return <div id="schedule-c-logs" data-tutorial-id="sc-logs" className="scroll-mt-4">
    <Panel title="Lower your tax" sub="Add these only if they apply. Each one lowers your profit.">
      <div className="sc-rows">
        <MileageLog year={Number(year)} mileage={books.records.mileage} vehicle={books.records.vehicle} onSaved={saved} />
        <EquipmentList year={Number(year)} assets={books.records.assets} onSaved={saved} />
        <HomeOffice key={year} year={Number(year)} homeOffice={books.records.homeOffice} onSaved={saved} />
      </div>
    </Panel>
  </div>;
}

/** Everything a preparer may want, folded away: form lines, stock, 1099-Ks, notes. */
export function BooksDetails({ books, year, onSettingsSaved }) {
  if (!books) return null;
  const saved = onSettingsSaved || (() => {});
  const { reconciliation: rec, yearEndCutoff: cutoff } = books;
  return <div data-tutorial-id="sc-details">
    <Panel title="Details" sub="For you or a tax preparer. Open only what you need.">
      <div className="sc-rows">
        <details>
          <summary className={rowSummary}>Show the Schedule C lines</summary>
          <div className="mt-4 grid gap-6 lg:grid-cols-2">
            <LineTable caption="Part I: Income, and the result" rows={books.lines} />
            <LineTable caption="Part III: Cost of goods sold" rows={books.partIII} />
            {books.records && <LineTable caption="Part II lines from your logs (included in line 28)" rows={books.records.lines} />}
          </div>
          <p className="mt-3 text-xs text-[var(--dp-text-muted)]">Line 4 is what your stock was worth on January 1, plus what you bought, minus what was left on December 31. {books.basis}</p>
        </details>

        {books.untracked && <UntrackedStock key={`${year}-${books.untracked.startEntered}-${books.untracked.endEntered}`} year={Number(year)} untracked={books.untracked} onSaved={saved} />}

        {books.form1099K && <Forms1099K year={Number(year)} data={books.form1099K} onSaved={saved} />}

        <details>
          <summary className={rowSummary}>Why this differs from your profit elsewhere in the app</summary>
          <table className="mt-4 w-full text-sm"><tbody>
            <tr className="text-[var(--dp-text-secondary)]"><td className="py-2 pr-3">Profit on {year} sales, how the rest of the app counts it</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(rec.appProfitOnSales)}</td></tr>
            <tr className="border-t border-[color:var(--dp-border)] text-[var(--dp-text-secondary)]"><td className="py-2 pr-3">Expenses dated {year} on the Expenses tab</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(-Number(rec.appExpenses))}</td></tr>
            {rec.differences.map((d) => <tr key={d.key} className="border-t border-[color:var(--dp-border)] text-[var(--dp-text-muted)]"><td className="py-2 pr-3">{d.label}</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{signed(d.amount)}</td></tr>)}
            <tr className="border-t border-[color:var(--dp-border)] font-semibold text-[var(--dp-text-primary)]"><td className="py-2 pr-3">Schedule C net profit (line 31)</td><td className="whitespace-nowrap py-2 text-right tabular-nums">{usd(rec.scheduleCNetProfit)}</td></tr>
          </tbody></table>
        </details>

        {cutoff.sales.length > 0 && <details>
          <summary className={rowSummary}>{cutoff.sales.length} late-December {cutoff.sales.length === 1 ? 'sale' : 'sales'} paid after the year ended ({usd(cutoff.total)})</summary>
          <p className="mt-3 text-sm text-[var(--dp-text-secondary)]">These count in {year} because they were sold in {year}, even though the money arrived later.</p>
          <ul className="mt-2 space-y-1 text-sm text-[var(--dp-text-secondary)]">{cutoff.sales.map((s) => <li key={s.sale_id} className="flex flex-wrap justify-between gap-2"><Link className="underline" to="/transactions" state={{ openTransaction: { inventoryId: s.inventory_id, saleId: s.sale_id } }}>{s.product_name}</Link><span className="text-[var(--dp-text-muted)]">sold {s.sale_date} · {s.paid_at ? `paid ${s.paid_at}` : 'not paid yet'} · {usd(s.amount)}</span></li>)}</ul>
        </details>}

        {books.notes.length > 0 && <details data-tutorial-id="sc-notes">
          <summary className={rowSummary}>Notes ({books.notes.length})</summary>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--dp-text-secondary)]">{books.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </details>}
      </div>
    </Panel>
  </div>;
}
