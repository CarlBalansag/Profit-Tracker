const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { Decimal, isRealizedSale, batchCost, effectiveCashbackRate, inventoryCashback, allocatedCashback, saleEconomics } = require('../services/decimalFinance');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const zero = () => new Decimal(0);
const money = (d) => d.toDecimalPlaces(2).toNumber();

// GET /dashboard
// Returns credit-card spending breakdown for the current calendar month.
// Only includes inventory purchased with PaymentMethod.type = 'Credit'.
router.get('/dashboard', isAuthenticated, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = new Date();

    // Accept ?month=YYYY-MM to navigate to a specific month; default to current month
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth(); // 0-based
    if (req.query.month && /^\d{4}-\d{2}$/.test(req.query.month)) {
      const [y, m] = req.query.month.split('-').map(Number);
      year = y;
      month = m - 1; // convert to 0-based
    }

    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd   = new Date(Date.UTC(year, month + 1, 1)); // exclusive upper bound
    const monthLabel = `${year}-${String(month + 1).padStart(2, '0')}`;

    // Fetch all credit-card payment methods so they always appear even with no activity
    const creditPaymentMethods = await prisma.paymentMethod.findMany({
      where: { user_id: userId, type: 'Credit' },
    });

    // Fetch all credit-card inventory purchases in the selected month
    const inventories = await prisma.inventory.findMany({
      where: {
        user_id: userId,
        purchase_date: { gte: monthStart, lt: monthEnd },
        payment_method: { type: 'Credit' },
      },
      include: {
        payment_method: true,
        vendor: true,
        sales: {
          include: { platform: true },
        },
      },
    });

    // Seed cardMap with all credit cards so they show even with $0 spend this month
    const cardMap = {};
    for (const pm of creditPaymentMethods) {
      cardMap[pm.id] = {
        id: pm.id,
        name: pm.name,
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

      // Card is already seeded from creditPaymentMethods; skip if somehow missing
      if (!cardMap[pm.id]) continue;

      const card = cardMap[pm.id];
      const rate = effectiveCashbackRate(inv);
      const qty = inv.qty_purchased || 1;
      const itemCost = batchCost(inv);
      const itemCashback = inventoryCashback(inv, rate);

      card.totalSpend = card.totalSpend.plus(itemCost);
      card.cashbackEarned = card.cashbackEarned.plus(itemCashback);
      card.txnCount += 1;

      // Per-item P&L for sold units
      const hasSales = inv.sales && inv.sales.length > 0;

      if (hasSales) {
        // Allocate cost proportionally across sold quantities
        for (const sale of inv.sales) {
          if (!isRealizedSale(sale)) continue;
          const { cost: allocatedCost, cashback: allocatedCashback, revenue: saleRevenue, grossProfit: netPnl } = saleEconomics(inv, sale, rate);
          const isLoss = netPnl.isNegative();
          const lossAmount = isLoss ? netPnl.abs() : zero();
          const lossToRedeem = Decimal.min(allocatedCashback, lossAmount);

          card.soldCount += sale.quantity;
          if (isLoss) card.totalLosses = card.totalLosses.plus(lossAmount);

          card.items.push({
            id: inv.id,
            saleId: sale.id,
            product: inv.product_name,
            cost: money(allocatedCost),
            cashback: money(allocatedCashback),
            status: sale.status || 'SOLD',
            revenue: money(saleRevenue),
            netPnl: money(netPnl),
            lossAmount: money(lossAmount),
            lossToRedeem: money(lossToRedeem),
            cashbackRate: rate,
          });
        }

        // Check if any unsold units remain on this inventory item
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
        // Fully unsold — pending spend
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

    // Compute card-level cashback netting (still in Decimal -- these feed the
    // summary reduce below before anything is rounded to a display Number).
    const cardsDecimal = Object.values(cardMap).map(card => {
      const cashbackToRedeem = Decimal.min(card.cashbackEarned, card.totalLosses);
      const cashbackToKeep = card.cashbackEarned.minus(cashbackToRedeem);
      const uncoveredLoss = Decimal.max(0, card.totalLosses.minus(card.cashbackEarned));
      const amountToPay = card.totalSpend.minus(cashbackToRedeem);

      return { ...card, cashbackToRedeem, cashbackToKeep, uncoveredLoss, amountToPay };
    });

    // Summary totals — summed in Decimal across cards, rounded once.
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

    res.json({ month: monthLabel, cards, summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
