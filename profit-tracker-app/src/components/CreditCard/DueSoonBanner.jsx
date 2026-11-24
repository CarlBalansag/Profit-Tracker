// Credit Card page: the card bills due in the next few days. Which cards are
// due comes from the To-Do list, so a bill marked paid, snoozed or dismissed
// there leaves the banner too. The amount is the statement Cash Flow estimates
// for that due date, not the month picked on this page.
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { useCashFlow, useTodos } from '../../hooks/useApi';
import { localToday } from '../../utils/returnWindow';
import { formatDollars } from '../../utils/money';

const DAYS_AHEAD = 3;
const KEY = /^card-due:(.+):\d{4}-\d{2}-\d{2}$/;
const utc = (day) => new Date(`${day}T00:00:00Z`);
const when = (days) => (days === 0 ? 'due today' : days === 1 ? 'due tomorrow' : `due in ${days} days`);
const shortDate = (day) => utc(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

function dueSoon(todos, cards) {
  const today = utc(localToday());
  return todos
    .filter((item) => item.type === 'card_due' && item.due_date)
    .map((item) => {
      const cardId = KEY.exec(item.key)?.[1];
      const card = cards.find((c) => c.id === cardId && c.statementDue === item.due_date);
      return card && { card, date: item.due_date, days: Math.round((utc(item.due_date) - today) / 86400000) };
    })
    .filter((bill) => bill && bill.days >= 0 && bill.days <= DAYS_AHEAD && bill.card.statementBalance > 0)
    .sort((a, b) => a.days - b.days || a.card.name.localeCompare(b.card.name));
}

export default function DueSoonBanner() {
  const { data: todos } = useTodos();
  const { data: cashFlow } = useCashFlow();
  const bills = dueSoon(todos?.items ?? [], cashFlow?.cards ?? []);
  if (!bills.length) return null;
  return (
    <section
      aria-label="Payment due soon"
      className="flex items-start gap-3 rounded-xl border border-[color:var(--dp-red-text)] bg-[var(--dp-red-bg)] p-4"
    >
      <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--dp-red-text)]" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[var(--dp-text-primary)]">Payment due soon</h2>
        <ul className="mt-1 space-y-1 text-sm text-[var(--dp-text-secondary)]">
          {bills.map(({ card, date, days }) => (
            <li key={card.id} className="break-words">
              <b className="text-[var(--dp-text-primary)]">{card.name}</b>{card.last4 ? ` ··${card.last4}` : ''} is{' '}
              {when(days)} ({shortDate(date)}), about{' '}
              <b className="tabular-nums text-[var(--dp-text-primary)]">{formatDollars(card.statementBalance)}</b>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 basis-48 text-xs text-[var(--dp-text-secondary)]">
            Estimated from what was charged to the statement. Already paid? Mark it paid in To-Do.
          </p>
          <Link to="/todos" className="page-btn page-btn-secondary page-btn-sm">Open To-Do</Link>
        </div>
      </div>
    </section>
  );
}
