// The one live figure each sidebar row carries, worked out from the to-do
// list the sidebar already loads for its count (no extra requests). A row
// with nothing to say gets no figure, so the numbers that show mean
// something. `problem` marks a figure that is late or overdue.

const compactMoney = (value) => {
  const n = Math.abs(Number(value) || 0);
  if (n >= 10000) return `$${Math.round(n / 1000)}k`;
  if (n >= 1000) return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
};

export function navFigures(data, cashFlow) {
  const items = data?.items ?? [];
  const count = (pred) => items.filter(pred).length;
  const has = (...types) => (entry) => types.includes(entry.type);
  const figures = {};

  const total = data?.counts?.total ?? items.length;
  // Late payouts as the Cash Flow page counts them (per payer's usual timing).
  const cashLate = Number(cashFlow?.summary?.lateCount) || 0;
  if (total > 0 || cashLate > 0) {
    // Late work is named in words, so red is never the only sign. To-Do's
    // late count includes Cash Flow's late payouts (its own payout items are
    // left out so nothing counts twice), so the two rows always agree.
    const overdue = count((entry) => entry.urgency === 'overdue' && !(cashLate && entry.type === 'payout_late'));
    const late = overdue + cashLate;
    figures['/todos'] = late > 0
      ? { text: `${late} late`, count: late, problem: true, hint: 'Overdue to-dos, plus payouts past the payer\'s usual timing' }
      : { text: `${total} open`, count: total, hint: 'Everything on your to-do list' };
  }

  const toShip = count(has('ship', 'deal_closed_unshipped', 'send_tracking'));
  const lateShip = count((e) => has('ship', 'deal_closed_unshipped')(e) && e.urgency === 'overdue');
  if (lateShip) figures['/shipping'] = { text: `${lateShip} late`, count: lateShip, problem: true, hint: 'Sold 7+ days ago and not shipped yet' };
  else if (toShip) figures['/shipping'] = { text: `${toShip} to ship`, count: toShip, hint: 'Sold 3+ days ago and not shipped, or tracking to send' };

  // Owed money comes from the Cash Flow page's own summary, so the sidebar and
  // the page always say the same thing; nothing shows until it has loaded.
  const summary = cashFlow?.summary;
  const owed = Number(summary?.owedTotal) || 0;
  if (owed > 0) {
    const late = Number(summary.lateCount) || 0;
    figures['/cashflow'] = late > 0
      ? { text: `${late} late`, count: late, problem: true, hint: `Payouts past the payer's usual timing (${compactMoney(owed)} owed in all)` }
      : { text: `${compactMoney(owed)} owed`, hint: 'Sold and not paid yet' };
  }

  const overdueBills = count(has('card_overdue'));
  const dueBills = count(has('card_due'));
  if (overdueBills) figures['/creditcard'] = { text: `${overdueBills} late`, count: overdueBills, problem: true, hint: 'Card bills past their due date and not marked paid' };
  else if (dueBills) figures['/creditcard'] = { text: `${dueBills} due`, count: dueBills, hint: 'Card bills due in the next 3 days' };

  const aging = count(has('aging_stock'));
  if (aging) figures['/inventory'] = { text: `${aging} aging`, count: aging, hint: 'On hand 30+ days and not listed' };

  const cashout = count((entry) => entry.group === 'cashout');
  const lateCashout = count((e) => e.group === 'cashout' && e.urgency === 'overdue');
  if (lateCashout) figures['/cashout'] = { text: `${lateCashout} late`, count: lateCashout, problem: true, hint: 'Cashout items past their deadline' };
  else if (cashout) figures['/cashout'] = { text: `${cashout} open`, count: cashout, hint: 'Cashout items that need a step from you' };

  const review = count(has('email_review', 'email_add_purchase'));
  if (review) figures['/automation'] = { text: `${review} new`, count: review, hint: 'Store emails waiting for you to review' };

  const coming = count(has('recurring_expense'));
  if (coming) figures['/expenses'] = { text: `${coming} due soon`, count: coming, hint: 'Recurring expenses due in the next 3 days' };

  return figures;
}
