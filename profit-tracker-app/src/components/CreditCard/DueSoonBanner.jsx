// Credit Card page: the card bills due in the next few days, and any just
// missed. The bills are the To-Do list's own, so one marked paid, snoozed or
// dismissed there leaves the banner, and marking one paid here clears it there.
// The amount is the statement Cash Flow estimates for that exact due date, not
// the month picked on this page. A bill still shows without an amount when
// there is no estimate for its date or it is $0: only tracked charges are in
// the estimate, so $0 here doesn't mean the card's real bill is $0.
import React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CircleCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useCashFlow, useTodos, useTodoState } from '../../hooks/useApi';
import { localToday } from '../../utils/returnWindow';
import { formatDollars } from '../../utils/money';

const KEY = /^card-due:(.+):\d{4}-\d{2}-\d{2}$/;

function cardBills(todos, cards) {
  const today = localToday();
  return todos
    // A saved list from an earlier day can hold a bill whose date has passed;
    // the fresh one brings it back as missed.
    .filter((item) => item.type === 'card_overdue' || (item.type === 'card_due' && item.due_date >= today))
    .map((item) => {
      const cardId = KEY.exec(item.key)?.[1];
      const card = cards.find((c) => c.id === cardId && c.statementDue === item.due_date);
      return { ...item, estimate: card?.statementBalance > 0 ? card.statementBalance : null };
    })
    .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.title.localeCompare(b.title));
}

export default function DueSoonBanner() {
  const { data: todos } = useTodos();
  const { data: cashFlow } = useCashFlow();
  const mutation = useTodoState();
  const bills = cardBills(todos?.items ?? [], cashFlow?.cards ?? []);

  // Awaited rather than passed as mutate callbacks, which are dropped when the
  // page is left (or another bill is marked) before the save comes back.
  const undo = async (key) => {
    try {
      await mutation.mutateAsync({ key, action: 'restore' });
    } catch (err) {
      toast.error(`Could not undo: ${err.message}`);
    }
  };
  const markPaid = async (key) => {
    try {
      await mutation.mutateAsync({ key, action: 'done' });
      toast.success('Marked paid.', { action: { label: 'Undo', onClick: () => undo(key) } });
    } catch (err) {
      toast.error(`Could not save: ${err.message}`);
    }
  };

  if (!bills.length) return null;
  return (
    <section
      aria-label="Card payments due"
      className="flex items-start gap-3 rounded-xl border border-[color:var(--dp-red-text)] bg-[var(--dp-red-bg)] p-4"
    >
      <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--dp-red-text)]" />
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-semibold text-[var(--dp-text-primary)]">Card payments due</h2>
        <ul className="mt-2 space-y-3">
          {bills.map((bill) => (
            <li key={bill.key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <div className="min-w-0 flex-1 basis-36">
                <p className="break-words text-sm font-semibold text-[var(--dp-text-primary)]">{bill.title}</p>
                <p className="text-xs text-[var(--dp-text-secondary)]">
                  {bill.estimate != null && <>About <b className="tabular-nums text-[var(--dp-text-primary)]">{formatDollars(bill.estimate)}</b> · </>}
                  {bill.detail}
                </p>
              </div>
              <button type="button" disabled={mutation.isPending} onClick={() => markPaid(bill.key)} className="page-btn page-btn-secondary shrink-0">
                <CircleCheck size={14} aria-hidden="true" /> Mark paid<span className="sr-only">: {bill.title}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="min-w-0 flex-1 basis-44 text-xs text-[var(--dp-text-secondary)]">
            Amounts are estimated from the charges tracked here.
          </p>
          <Link to="/todos" className="page-btn page-btn-secondary shrink-0">Open To-Do</Link>
        </div>
      </div>
    </section>
  );
}
