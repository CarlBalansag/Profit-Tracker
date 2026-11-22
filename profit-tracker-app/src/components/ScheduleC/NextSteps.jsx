import { Link } from 'react-router-dom';
import { CalendarX, CircleCheck, Copy, ListChecks, PackageX, ReceiptText, TriangleAlert } from 'lucide-react';
import { Panel } from '../Analytics/Motion';

const TONES = {
  warn: { bg: 'var(--dp-warning-bg)', color: 'var(--dp-warning-text)' },
  info: { bg: 'var(--dp-hover-bg)', color: 'var(--dp-text-secondary)' },
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const names = (list) => {
  const shown = list.slice(0, 3).map((x) => x.product_name);
  return list.length > 3 ? `${shown.join(', ')} and ${list.length - 3} more` : shown.join(', ');
};
const btn = 'page-btn page-btn-secondary !h-9 !px-3 !text-xs shrink-0';

function Step({ icon, tone = 'warn', title, detail, alert = false, children }) {
  const Icon = icon;
  const t = TONES[tone];
  return (
    <li role={alert ? 'alert' : undefined} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: t.bg }}>
          <Icon size={16} aria-hidden="true" style={{ color: t.color }} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--dp-text-primary)]">{title}</p>
          {detail && <p className="mt-0.5 break-words text-xs text-[var(--dp-text-muted)]">{detail}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap gap-2 pl-12 sm:pl-0">{children}</div>}
    </li>
  );
}

/**
 * What to do on the worksheet, in order, one row each: expenses to review,
 * records that look wrong, possible duplicates and missing receipts.
 * onReview opens the first expense to review; onShow(filter) shows those
 * records in the expense list.
 */
export function NextSteps({ report, books, onReview, onShow }) {
  const checks = books?.checks || {};
  const items = [];
  if (report.pending > 0) {
    items.push(<Step key="review" icon={ListChecks} title={`${plural(report.pending, 'expense', 'expenses')} to review`}
      detail="They don't count until you check them. Suggestions fill in most of it.">
      <button type="button" onClick={onReview} className="page-btn page-btn-primary !h-9 !px-3 !text-xs shrink-0">Start review</button>
    </Step>);
  }
  if (checks.negativeCogs) {
    items.push(<Step key="cogs" alert icon={TriangleAlert} title="Cost of goods sold is below zero"
      detail='Usually the year-end stock amount under "Stock not in ProfitTracker" is too high.' />);
  }
  if (checks.oversold?.length) {
    items.push(<Step key="oversold" alert icon={PackageX} title={`${plural(checks.oversold.length, 'purchase has', 'purchases have')} more units sold than bought (${names(checks.oversold)})`}
      detail="Fix the quantities so the cost of what you sold is right.">
      <Link to="/transactions" className={btn}>Open transactions</Link>
    </Step>);
  }
  if (checks.soldBeforePurchase?.length) {
    items.push(<Step key="dates" alert icon={CalendarX} title={`${plural(checks.soldBeforePurchase.length, 'sale is', 'sales are')} dated before the purchase`}
      detail={`${names(checks.soldBeforePurchase)}. Check the dates.`}>
      <Link to="/transactions" className={btn}>Open transactions</Link>
    </Step>);
  }
  if (report.possible_duplicates > 0) {
    items.push(<Step key="dupes" icon={Copy} title={`${plural(report.possible_duplicates, 'possible duplicate', 'possible duplicates')}`}
      detail="Looks entered twice, or already counted from a sale. Delete the extra one.">
      <button type="button" onClick={() => onShow('duplicates')} className={btn}>Show</button>
    </Step>);
  }
  if (report.documentation_gaps > 0) {
    items.push(<Step key="receipts" tone="info" icon={ReceiptText} title={`${plural(report.documentation_gaps, 'expense has', 'expenses have')} no receipt`}
      detail="Not required to count, but keep one in case the IRS asks.">
      <button type="button" onClick={() => onShow('receipts')} className={btn}>Show</button>
    </Step>);
  }
  return (
    <div data-tutorial-id="sc-todo">
      <Panel title="To do">
        {items.length
          ? <ul className="-my-3 divide-y divide-[color:var(--dp-border)]">{items}</ul>
          : <p className="flex items-center gap-2 text-sm text-[var(--dp-text-secondary)]"><CircleCheck size={16} className="text-[var(--dp-green-text)]" aria-hidden="true" /> All caught up. Every expense is reviewed and nothing looks off.</p>}
      </Panel>
    </div>
  );
}
