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

export function navFigures(data) {
  const items = data?.items ?? [];
  const count = (pred) => items.filter(pred).length;
  const has = (...types) => (entry) => types.includes(entry.type);
  const figures = {};

  const total = data?.counts?.total ?? items.length;
  if (total > 0) {
    // Late work is named in words, so red is never the only sign.
    const overdue = count((entry) => entry.urgency === 'overdue');
    figures['/todos'] = overdue > 0
      ? { text: `${overdue} late`, count: total, problem: true }
      : { text: `${total} open`, count: total };
  }

  const toShip = count(has('ship', 'deal_closed_unshipped', 'send_tracking'));
  const lateShip = count((e) => has('ship', 'deal_closed_unshipped')(e) && e.urgency === 'overdue');
  if (lateShip) figures['/shipping'] = { text: `${lateShip} late`, problem: true };
  else if (toShip) figures['/shipping'] = { text: `${toShip} to ship` };

  const owed = (data?.waiting_payments ?? []).reduce((sum, payer) => sum + (Number(payer.total) || 0), 0);
  if (owed > 0) {
    const late = (data?.waiting_payments ?? []).reduce((sum, payer) => sum + (Number(payer.overdue_total) || 0), 0);
    figures['/cashflow'] = late > 0
      ? { text: `${compactMoney(late)} late`, problem: true }
      : { text: `${compactMoney(owed)} owed` };
  }

  const overdueBills = count(has('card_overdue'));
  const dueBills = count(has('card_due'));
  if (overdueBills) figures['/creditcard'] = { text: `${overdueBills} overdue`, problem: true };
  else if (dueBills) figures['/creditcard'] = { text: `${dueBills} due` };

  const aging = count(has('aging_stock'));
  if (aging) figures['/inventory'] = { text: `${aging} aging` };

  const cashout = count((entry) => entry.group === 'cashout');
  const lateCashout = count((e) => e.group === 'cashout' && e.urgency === 'overdue');
  if (lateCashout) figures['/cashout'] = { text: `${lateCashout} late`, problem: true };
  else if (cashout) figures['/cashout'] = { text: `${cashout} open` };

  const review = count(has('email_review', 'email_add_purchase'));
  if (review) figures['/automation'] = { text: `${review} new` };

  const coming = count(has('recurring_expense'));
  if (coming) figures['/expenses'] = { text: `${coming} coming` };

  return figures;
}
