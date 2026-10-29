// Per-card credit-card dashboard math, shared by routes/creditcard.js (the
// Credit Card page) and routes/mcp.js's get_card_net_to_pay tool. Factored out
// so the two can never drift onto different numbers for the same month --
// moved here verbatim from routes/creditcard.js, no behavior change.
const { Decimal, isRealizedSale, batchCost, effectiveCashbackRate, inventoryCashback, allocatedCashback, saleEconomics } = require('./decimalFinance');

const zero = () => new Decimal(0);
const money = (d) => d.toDecimalPlaces(2).toNumber();

// Resolves ?month=YYYY-MM to a [monthStart, monthEnd) UTC range, defaulting to
// the current UTC month. Shared so both callers parse the param identically.
function resolveMonthRange(monthParam) {
  const now = new Date();
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth(); // 0-based
  if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
    const [y, m] = monthParam.split('-').map(Number);
    year = y;
    month = m - 1;
  }
  const monthStart = new Date(Date.UTC(year, month, 1));
  const monthEnd = new Date(Date.UTC(year, month + 1, 1));
  const monthLabel = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { monthStart, monthEnd, monthLabel };
}

// The next calendar date a card's payment is due, counting forward from `now`.
// Mirrors profit-tracker-app/src/pages/CreditCard.jsx's client-side daysUntilDue --
// due_day/statement_close_day are static card settings, not scoped to the
// selected month, so this always looks forward from the real current date.
function nextDueDate(dueDay, now = new Date()) {
  if (!dueDay) return null;
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), dueDay);
  const target = thisMonth > now ? thisMonth : new Date(now.getFullYear(), now.getMonth() + 1, dueDay);
  return target;
}

// Returns the same per-card breakdown the Credit Card page's GET /dashboard
// renders, for the given month (YYYY-MM, optional). Only inventory purchased
// with PaymentMethod.type = 'Credit' counts.
async function computeCardDashboard(prisma, userId, monthParam) {
  const { monthStart, monthEnd, monthLabel } = resolveMonthRange(monthParam);

  const creditPaymentMethods = await prisma.paymentMethod.findMany({
    where: { user_id: userId, type: 'Credit' },
  });

  const inventories = await prisma.inventory.findMany({
    where: {
      user_id: userId,
      purchase_date: { gte: monthStart, lt: monthEnd },
      payment_method: { type: 'Credit' },
    },
    include: {
      payment_method: true,
      vendor: true,
      sales: { include: { platform: true } },
    },
  });

  const cardMap = {};
  for (const pm of creditPaymentMethods) {
    cardMap[pm.id] = {
      id: pm.id,
      name: pm.name,
      last4: pm.last4 ?? null,
      cashbackRate: 0,
      totalSpend: zero(),
      cashbackEarned: zero(),
      totalLosses: zero(),
      txnCount: 0,
      soldCount: 0,
      pendingCount: 0,
      items: [],
      statement_close_day: pm.statement_close_day ?? null,
      due_day: pm.due_day ?? null,
      credit_limit: pm.credit_limit ?? null,
      min_payment_pct: pm.min_payment_pct ?? null,
    };
  }

  for (const inv of inventories) {
    const pm = inv.payment_method;
    if (!pm) continue;
    if (!cardMap[pm.id]) continue;

    const card = cardMap[pm.id];
    const rate = effectiveCashbackRate(inv);
    const qty = inv.qty_purchased || 1;
    const itemCost = batchCost(inv);
    const itemCashback = inventoryCashback(inv, rate);

    card.totalSpend = card.totalSpend.plus(itemCost);
    card.cashbackEarned = card.cashbackEarned.plus(itemCashback);
    card.txnCount += 1;

    const hasSales = inv.sales && inv.sales.length > 0;

    if (hasSales) {
      for (const sale of inv.sales) {
        if (!isRealizedSale(sale)) continue;
        const { cost: allocatedCost, cashback: itemAllocatedCashback, revenue: saleRevenue, grossProfit: netPnl } = saleEconomics(inv, sale, rate);
        const isLoss = netPnl.isNegative();
        const lossAmount = isLoss ? netPnl.abs() : zero();
        const lossToRedeem = Decimal.min(itemAllocatedCashback, lossAmount);

        card.soldCount += sale.quantity;
        if (isLoss) card.totalLosses = card.totalLosses.plus(lossAmount);

        card.items.push({
          id: inv.id,
          saleId: sale.id,
          product: inv.product_name,
          cost: money(allocatedCost),
          cashback: money(itemAllocatedCashback),
          status: sale.status || 'SOLD',
          revenue: money(saleRevenue),
          netPnl: money(netPnl),
          lossAmount: money(lossAmount),
          lossToRedeem: money(lossToRedeem),
          cashbackRate: rate,
        });
      }

      const soldQty = inv.sales.reduce((s, sa) => s + sa.quantity, 0);
      const unsoldQty = qty - soldQty;
      if (unsoldQty > 0) {
        const unsoldShare = new Decimal(unsoldQty).div(qty);
        const unsoldCost = new Decimal(inv.unit_purchase_cost || 0).times(unsoldQty)
          .plus(new Decimal(inv.sales_tax || 0).times(unsoldShare))
          .plus(new Decimal(inv.shipping_cost_inbound || 0).times(unsoldShare))
          .plus(new Decimal(inv.fees || 0).times(unsoldShare))
          .minus(new Decimal(inv.gift_card_amount || 0).times(unsoldShare));
        const unsoldCashback = allocatedCashback(inv, unsoldQty, rate);
        card.pendingCount += unsoldQty;
        card.items.push({
          id: inv.id,
          saleId: null,
          product: inv.product_name,
          cost: money(unsoldCost),
          cashback: money(unsoldCashback),
          status: inv.status || 'PURCHASED',
          revenue: null,
          netPnl: null,
          lossAmount: 0,
          lossToRedeem: 0,
          cashbackRate: rate,
        });
      }
    } else {
      card.pendingCount += qty;
      card.items.push({
        id: inv.id,
        saleId: null,
        product: inv.product_name,
        cost: money(itemCost),
        cashback: money(itemCashback),
        status: inv.status || 'PURCHASED',
        revenue: null,
        netPnl: null,
        lossAmount: 0,
        lossToRedeem: 0,
        cashbackRate: rate,
      });
    }
  }

  // Shipping labels bought on a credit card (Sales.sale_shipping_payment_method_id)
  // are card spend in the month of the sale, and earn the card's default rate --
  // there is no store to match a category rate against. Only realized sales
  // count, the same rule as every sale-side total.
  const labelSales = await prisma.sales.findMany({
    where: {
      inventory: { user_id: userId },
      sale_date: { gte: monthStart, lt: monthEnd },
      sale_shipping_payment_method: { type: 'Credit' },
    },
    include: { inventory: true, sale_shipping_payment_method: true },
  });
  for (const sale of labelSales) {
    if (!isRealizedSale(sale)) continue;
    const card = cardMap[sale.sale_shipping_payment_method_id];
    const labelCost = new Decimal(sale.sale_shipping_decimal ?? sale.sale_shipping ?? 0);
    if (!card || !labelCost.greaterThan(0)) continue;
    const rate = Math.max(0, Number(sale.sale_shipping_payment_method.default_cashback_rate) || 0);
    const labelCashback = labelCost.times(rate).div(100);
    card.totalSpend = card.totalSpend.plus(labelCost);
    card.cashbackEarned = card.cashbackEarned.plus(labelCashback);
    card.txnCount += 1;
    card.items.push({
      id: sale.inventory_id,
      saleId: sale.id,
      kind: 'shipping_label',
      product: `${sale.inventory.product_name} · Shipping label`,
      cost: money(labelCost),
      cashback: money(labelCashback),
      status: 'Shipping label',
      revenue: null,
      netPnl: null,
      lossAmount: 0,
      lossToRedeem: 0,
      cashbackRate: rate,
    });
  }

  const cardsDecimal = Object.values(cardMap).map(card => {
    const cashbackToRedeem = Decimal.min(card.cashbackEarned, card.totalLosses);
    const cashbackToKeep = card.cashbackEarned.minus(cashbackToRedeem);
    const uncoveredLoss = Decimal.max(0, card.totalLosses.minus(card.cashbackEarned));
    const amountToPay = card.totalSpend.minus(cashbackToRedeem);

    return { ...card, cashbackToRedeem, cashbackToKeep, uncoveredLoss, amountToPay };
  });

  const summaryDecimal = cardsDecimal.reduce((acc, card) => ({
    totalSpend: acc.totalSpend.plus(card.totalSpend),
    totalCashbackEarned: acc.totalCashbackEarned.plus(card.cashbackEarned),
    totalCashbackToRedeem: acc.totalCashbackToRedeem.plus(card.cashbackToRedeem),
    totalCashbackToKeep: acc.totalCashbackToKeep.plus(card.cashbackToKeep),
    totalAmountToPay: acc.totalAmountToPay.plus(card.amountToPay),
    totalUncoveredLoss: acc.totalUncoveredLoss.plus(card.uncoveredLoss),
  }), {
    totalSpend: zero(),
    totalCashbackEarned: zero(),
    totalCashbackToRedeem: zero(),
    totalCashbackToKeep: zero(),
    totalAmountToPay: zero(),
    totalUncoveredLoss: zero(),
  });

  const cards = cardsDecimal
    .map(card => ({
      ...card,
      totalSpend: money(card.totalSpend),
      cashbackEarned: money(card.cashbackEarned),
      totalLosses: money(card.totalLosses),
      cashbackToRedeem: money(card.cashbackToRedeem),
      cashbackToKeep: money(card.cashbackToKeep),
      uncoveredLoss: money(card.uncoveredLoss),
      amountToPay: money(card.amountToPay),
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  const summary = Object.fromEntries(
    Object.entries(summaryDecimal).map(([key, value]) => [key, money(value)])
  );

  return { month: monthLabel, cards, summary };
}

module.exports = { computeCardDashboard, resolveMonthRange, nextDueDate };
