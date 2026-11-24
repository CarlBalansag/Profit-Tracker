// Everything the Cash Flow page shows, worked out in one place:
//   - owed:      unpaid and short-paid sales, grouped by who owes the money,
//                with how long each has waited and whether it is late
//   - cards:     an estimated bill and balance per credit card, from the
//                purchases, expenses and shipping labels charged to it
//   - coverage:  for each upcoming card due date, the payouts expected to
//                land before it, and whether they cover the bills so far
//   - monthly:   money in vs money out per month (payouts and store refunds
//                in; purchases, business expenses and buyer refunds out)
//   - tiedUp:    weekly cost of unsold stock plus sold-but-unpaid sales
//   - map:       where the money put in sits right now
//
// Card bills are estimates: the app records what was charged to a card, not
// the payments made to it, so a bill is "what was charged in that statement
// cycle". Cashback is left out of cash in, because the card pays it out on
// its own schedule.
const { Decimal, decimal, isRealizedSale, grossBatchCost, batchCost, keptQuantity, keptSaleQuantity, allocatedCost, saleEconomics } = require('./decimalFinance');
const { payoutStatus } = require('./payoutStatus');
const { withExactFields, MAPPINGS } = require('./decimalRead');
const { ACCOUNT_SELECT, ownAccount } = require('./storeAccounts');

const DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PAYOUT_DAYS = 14;
const DUE_SOON_DAYS = 3;
const MONTHS = 12;
const WEEKS = 16;

const zero = () => new Decimal(0);
const money = (d) => decimal(d || 0).toDecimalPlaces(2).toNumber();
const utcDay = (date) => {
  const d = new Date(date);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};
const isoDay = (date) => utcDay(date).toISOString().slice(0, 10);
const monthKey = (date) => new Date(date).toISOString().slice(0, 7);
const daysBetween = (a, b) => Math.floor((utcDay(b) - utcDay(a)) / DAY);
const addDays = (date, n) => new Date(utcDay(date).getTime() + n * DAY);

// A day-of-month clamped to the month's length, so a 31 on a 30-day month
// lands on the 30th instead of rolling into the next month.
function dayInMonth(year, month, day) {
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, last)));
}

// The most recent date on or before `today` that falls on `day` of a month.
function lastOccurrence(day, today) {
  const t = utcDay(today);
  const thisMonth = dayInMonth(t.getUTCFullYear(), t.getUTCMonth(), day);
  return thisMonth <= t ? thisMonth : dayInMonth(t.getUTCFullYear(), t.getUTCMonth() - 1, day);
}
// The first date strictly after `after` that falls on `day` of a month.
function nextOccurrenceAfter(day, after) {
  const a = utcDay(after);
  const thisMonth = dayInMonth(a.getUTCFullYear(), a.getUTCMonth(), day);
  return thisMonth > a ? thisMonth : dayInMonth(a.getUTCFullYear(), a.getUTCMonth() + 1, day);
}
const monthBefore = (date, day) => dayInMonth(date.getUTCFullYear(), date.getUTCMonth() - 1, day);

const exactInventory = (inv) => {
  const result = withExactFields(inv, MAPPINGS.inventory);
  if (result.payment_method) result.payment_method = withExactFields(result.payment_method, MAPPINGS.paymentMethod);
  return result;
};
const exactSale = (sale) => {
  const result = withExactFields(sale, MAPPINGS.sales);
  if (result.inventory) result.inventory = exactInventory(result.inventory);
  return result;
};

// When the money from a paid sale actually arrived. Older sales marked paid by
// hand have no paid_at, so fall back to the payout date, then the sale date.
const paidDateOf = (sale) => sale.paid_at || sale.payout_date || sale.completed_at || sale.sale_date;

// What the buyer/platform paid you for a sale, before any later buyer refund
// (refunds go out as their own line on the day they happened).
function payoutAmountOf(sale, revenue) {
  if (sale.paid_amount !== null && sale.paid_amount !== undefined) return decimal(sale.paid_amount);
  const beforeRefunds = revenue.plus(decimal(sale.refunded_amount || 0));
  const short = decimal(sale.payout_short_amount || 0);
  return beforeRefunds.minus(short);
}

const ownerKeyOf = (sale) => sale.buyer_id ? `buyer:${sale.buyer_id}` : sale.platform_id ? `platform:${sale.platform_id}` : 'direct';
const ownerNameOf = (sale) => sale.buyer?.name || sale.platform?.name || 'Direct';

async function computeCashFlow(prisma, userId, now = new Date()) {
  const today = utcDay(now);

  const [rawInventories, rawSales, rawExpenses, refunds, cards] = await Promise.all([
    prisma.inventory.findMany({ where: { user_id: userId }, include: { payment_method: true } }),
    prisma.sales.findMany({
      where: { inventory: { user_id: userId } },
      include: { inventory: { include: { payment_method: true, account: ACCOUNT_SELECT } }, platform: true, buyer: true },
    }),
    prisma.expense.findMany({ where: { user_id: userId } }),
    prisma.refund.findMany({ where: { user_id: userId } }),
    prisma.paymentMethod.findMany({ where: { user_id: userId, type: 'Credit' } }),
  ]);
  const inventories = rawInventories.map(exactInventory);
  const sales = rawSales.map(exactSale);
  const expenses = rawExpenses.map((e) => withExactFields(e, MAPPINGS.expense));

  const realized = sales.filter(isRealizedSale).map((sale) => {
    const { revenue } = saleEconomics(sale.inventory, sale);
    return { sale, revenue, status: payoutStatus(sale) };
  });

  // ── Payout speed per buyer/platform, from sales that have been paid ──────
  const paidDays = new Map();
  realized.forEach(({ sale, status }) => {
    if (status === 'unpaid' || !sale.paid_at) return;
    const days = daysBetween(sale.sale_date, sale.paid_at);
    if (days < 0) return;
    const key = ownerKeyOf(sale);
    const p = paidDays.get(key) || { total: 0, count: 0, short: 0 };
    p.total += days; p.count += 1;
    if (status === 'partial') p.short += 1;
    paidDays.set(key, p);
  });
  const expectedDaysFor = (sale) => {
    if (sale.buyer?.avg_days_to_payout) return { days: sale.buyer.avg_days_to_payout, basis: 'buyer setting' };
    const p = paidDays.get(ownerKeyOf(sale));
    if (p && p.count > 0) return { days: Math.round(p.total / p.count), basis: `average of ${p.count} paid` };
    return { days: DEFAULT_PAYOUT_DAYS, basis: 'default' };
  };

  // ── Owed to you ──────────────────────────────────────────────────────────
  const owedGroups = new Map();
  const expectedPayouts = [];
  realized.forEach(({ sale, revenue, status }) => {
    if (status === 'paid') return;
    const amount = status === 'partial' ? decimal(sale.payout_short_amount || 0) : revenue;
    if (amount.lte(0)) return;
    const { days: expectedDays, basis } = expectedDaysFor(sale);
    const expected = sale.payout_date && status === 'unpaid'
      ? utcDay(sale.payout_date)
      : addDays(sale.sale_date, expectedDays);
    const waitingDays = Math.max(0, daysBetween(sale.sale_date, today));
    const lateDays = Math.max(0, daysBetween(expected, today));
    const dueIn = daysBetween(today, expected);
    const state = lateDays > 0 ? 'late' : dueIn <= DUE_SOON_DAYS ? 'due_soon' : 'on_time';

    const key = ownerKeyOf(sale);
    if (!owedGroups.has(key)) {
      owedGroups.set(key, { key, name: ownerNameOf(sale), amount: zero(), count: 0, oldestDays: 0, maxLateDays: 0, expectedDays, basis, items: [] });
    }
    const g = owedGroups.get(key);
    g.amount = g.amount.plus(amount);
    g.count += 1;
    g.oldestDays = Math.max(g.oldestDays, waitingDays);
    g.maxLateDays = Math.max(g.maxLateDays, lateDays);
    g.items.push({
      id: sale.id,
      product: sale.inventory?.product_name || 'Untitled item',
      // The store account it was bought on (name only), or null.
      account: ownAccount(sale.inventory?.account, userId)?.name ?? null,
      saleDate: isoDay(sale.sale_date),
      amount: money(amount),
      payoutStatus: status,
      waitingDays,
      expectedDate: isoDay(expected),
      lateDays,
      state,
    });
    // A late payout could land any day, so count it as expected today.
    expectedPayouts.push({ date: expected < today ? today : expected, amount });
  });
  const stateRank = { late: 2, due_soon: 1, on_time: 0 };
  const owed = Array.from(owedGroups.values())
    .map((g) => {
      const state = g.items.reduce((s, i) => (stateRank[i.state] > stateRank[s] ? i.state : s), 'on_time');
      const p = paidDays.get(g.key);
      return {
        name: g.name,
        amount: money(g.amount),
        count: g.count,
        oldestDays: g.oldestDays,
        maxLateDays: g.maxLateDays,
        expectedDays: g.expectedDays,
        expectedBasis: g.basis,
        shortPaidPct: p && p.count ? Math.round((p.short / p.count) * 100) : null,
        state,
        items: g.items.sort((a, b) => b.waitingDays - a.waitingDays),
      };
    })
    .sort((a, b) => stateRank[b.state] - stateRank[a.state] || b.oldestDays - a.oldestDays);
  const owedTotal = owed.reduce((s, g) => s.plus(g.amount), zero());

  // ── Card bills and balances ──────────────────────────────────────────────
  const chargesFor = (cardId, from, to) => {
    // (from, to] in whole UTC days
    const inWindow = (date) => { const d = utcDay(date); return d > from && d <= to; };
    let total = zero();
    inventories.forEach((inv) => { if (inv.payment_method_id === cardId && inWindow(inv.purchase_date)) total = total.plus(grossBatchCost(inv)); });
    expenses.forEach((e) => { if (e.payment_method_id === cardId && inWindow(e.date)) total = total.plus(decimal(e.amount || 0)); });
    sales.forEach((s) => { if (s.sale_shipping_payment_method_id === cardId && inWindow(s.sale_date)) total = total.plus(decimal(s.sale_shipping || 0)); });
    return total;
  };
  const bills = [];
  const cardRows = cards.map((rawCard) => {
    const card = withExactFields(rawCard, MAPPINGS.paymentMethod);
    const closeDay = card.statement_close_day || null;
    const dueDay = card.due_day || null;
    // Without a close day, treat each calendar month as the statement cycle.
    const lastClose = closeDay ? lastOccurrence(closeDay, today) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
    const prevClose = closeDay ? monthBefore(lastClose, closeDay) : new Date(Date.UTC(lastClose.getUTCFullYear(), lastClose.getUTCMonth(), 0));
    const nextClose = closeDay ? nextOccurrenceAfter(closeDay, today) : new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
    const statement = chargesFor(card.id, prevClose, lastClose);
    const sinceClose = chargesFor(card.id, lastClose, today);
    const statementDue = dueDay ? nextOccurrenceAfter(dueDay, lastClose) : null;
    const statementOpen = statementDue && statementDue >= today;
    const balance = (statementOpen ? statement : zero()).plus(sinceClose);
    const limit = card.credit_limit ? decimal(card.credit_limit) : null;

    if (statementOpen && statement.gt(0)) {
      bills.push({ card: card.name, cardId: card.id, dueDate: statementDue, amount: statement, final: true });
    }
    if (dueDay && sinceClose.gt(0)) {
      bills.push({ card: card.name, cardId: card.id, dueDate: nextOccurrenceAfter(dueDay, nextClose), amount: sinceClose, final: false });
    }
    return {
      id: card.id,
      name: card.name,
      last4: card.last4 || null,
      balance: money(balance),
      statementBalance: money(statement),
      currentCycle: money(sinceClose),
      statementDue: statementDue ? isoDay(statementDue) : null,
      statementOpen: Boolean(statementOpen),
      nextClose: isoDay(nextClose),
      limit: limit ? money(limit) : null,
      utilizationPct: limit && limit.gt(0) ? money(balance.div(limit).times(100)) : null,
      hasDates: Boolean(closeDay && dueDay),
    };
  }).sort((a, b) => b.balance - a.balance);

  // ── Do expected payouts cover each bill in time? ─────────────────────────
  bills.sort((a, b) => a.dueDate - b.dueDate);
  let billsSoFar = zero();
  const coverage = bills.map((bill) => {
    billsSoFar = billsSoFar.plus(bill.amount);
    const payoutsBefore = expectedPayouts
      .filter((p) => p.date <= bill.dueDate)
      .reduce((s, p) => s.plus(p.amount), zero());
    const gap = payoutsBefore.minus(billsSoFar);
    return {
      card: bill.card,
      cardId: bill.cardId,
      dueDate: isoDay(bill.dueDate),
      dueInDays: daysBetween(today, bill.dueDate),
      amount: money(bill.amount),
      final: bill.final,
      payoutsBefore: money(payoutsBefore),
      billsSoFar: money(billsSoFar),
      covered: gap.gte(0),
      gap: money(gap),
    };
  });
  const horizon = addDays(today, 30);
  const billsDue30 = bills.filter((b) => b.dueDate <= horizon).reduce((s, b) => s.plus(b.amount), zero());

  // ── Money in vs out by month ─────────────────────────────────────────────
  const monthKeys = [];
  for (let i = MONTHS - 1; i >= 0; i -= 1) {
    monthKeys.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  const monthly = new Map(monthKeys.map((m) => [m, { month: m, payouts: zero(), storeRefunds: zero(), purchases: zero(), expenses: zero(), buyerRefunds: zero() }]));
  const addTo = (date, field, amount) => { const row = monthly.get(monthKey(date)); if (row) row[field] = row[field].plus(amount); };
  realized.forEach(({ sale, revenue, status }) => {
    if (status === 'unpaid') return;
    addTo(paidDateOf(sale), 'payouts', payoutAmountOf(sale, revenue));
  });
  inventories.forEach((inv) => addTo(inv.purchase_date, 'purchases', grossBatchCost(inv)));
  expenses.forEach((e) => addTo(e.date, 'expenses', decimal(e.amount || 0)));
  refunds.forEach((r) => {
    if (r.inventory_id) addTo(r.date, 'storeRefunds', decimal(r.amount || 0));
    else if (r.sale_id) addTo(r.date, 'buyerRefunds', decimal(r.amount || 0));
  });
  const monthlyRows = Array.from(monthly.values()).map((m) => {
    const moneyIn = m.payouts.plus(m.storeRefunds);
    const moneyOut = m.purchases.plus(m.expenses).plus(m.buyerRefunds);
    return {
      month: m.month,
      payouts: money(m.payouts),
      storeRefunds: money(m.storeRefunds),
      purchases: money(m.purchases),
      expenses: money(m.expenses),
      buyerRefunds: money(m.buyerRefunds),
      in: money(moneyIn),
      out: money(moneyOut),
      net: money(moneyIn.minus(moneyOut)),
    };
  });

  // ── Cash tied up, week by week ───────────────────────────────────────────
  const soldUnitsBy = (invId, t) => sales.reduce((n, s) => (
    s.inventory_id === invId && utcDay(s.sale_date) <= t && isRealizedSale(s) ? n + keptSaleQuantity(s) : n
  ), 0);
  const tiedUp = [];
  for (let i = WEEKS - 1; i >= 0; i -= 1) {
    const t = addDays(today, -7 * i);
    let stock = zero();
    inventories.forEach((inv) => {
      if (utcDay(inv.purchase_date) > t) return;
      const held = Math.max(0, keptQuantity(inv) - soldUnitsBy(inv.id, t));
      stock = stock.plus(allocatedCost(inv, held));
    });
    let unpaid = zero();
    realized.forEach(({ sale, revenue, status }) => {
      if (utcDay(sale.sale_date) > t) return;
      const paidBy = status !== 'unpaid' && utcDay(paidDateOf(sale)) <= t;
      if (!paidBy) unpaid = unpaid.plus(revenue);
    });
    tiedUp.push({ date: isoDay(t), inventory: money(stock), unpaid: money(unpaid), total: money(stock.plus(unpaid)) });
  }

  // ── Where the money is right now ─────────────────────────────────────────
  const putIn = inventories.reduce((s, inv) => s.plus(batchCost(inv)), zero());
  const inStock = inventories.reduce((s, inv) => s.plus(allocatedCost(inv, inv.qty_on_hand)), zero());
  const stockUnits = inventories.reduce((n, inv) => n + (inv.qty_on_hand || 0), 0);
  const paidBack = realized.reduce((s, { sale, revenue, status }) => (status === 'unpaid' ? s : s.plus(payoutAmountOf(sale, revenue))), zero())
    .minus(refunds.filter((r) => r.sale_id).reduce((s, r) => s.plus(decimal(r.amount || 0)), zero()));
  const unpaidCount = owed.reduce((n, g) => n + g.count, 0);

  const thisMonth = monthlyRows[monthlyRows.length - 1];
  const lastMonth = monthlyRows[monthlyRows.length - 2];

  return {
    asOf: isoDay(today),
    summary: {
      owedTotal: money(owedTotal),
      owedCount: unpaidCount,
      lateCount: owed.reduce((n, g) => n + g.items.filter((i) => i.state === 'late').length, 0),
      billsDue30: money(billsDue30),
      coverageGap: money(owedTotal.minus(billsDue30)),
      inStock: money(inStock),
      stockUnits,
      netThisMonth: thisMonth.net,
      netLastMonth: lastMonth.net,
    },
    owed,
    cards: cardRows,
    coverage,
    monthly: monthlyRows,
    tiedUp,
    map: {
      putIn: money(putIn),
      inStock: money(inStock),
      stockUnits,
      unpaid: money(owedTotal),
      unpaidCount,
      paidBack: money(paidBack),
    },
  };
}

module.exports = { computeCashFlow, _internal: { lastOccurrence, nextOccurrenceAfter, dayInMonth } };
