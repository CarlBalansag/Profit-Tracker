const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Same cashback rate logic as analytics.js — applies category rate overrides
// (e.g. Amazon 5% on Chase Freedom Flex) with expiry support.
const getEffectiveCashbackRate = (inv) => {
  const pm = inv.payment_method;
  if (!pm) return 0;

  const vendorName = (inv.vendor?.name || '').toLowerCase();

  let rates = [];
  if (pm.category_rates) {
    try { rates = JSON.parse(pm.category_rates); } catch { rates = []; }
  }

  if (vendorName && rates.length > 0) {
    const today = new Date();
    const match = rates.find(cr => {
      if (cr.expires && new Date(cr.expires) < today) return false;
      return vendorName.includes(cr.store.toLowerCase()) || cr.store.toLowerCase().includes(vendorName);
    });
    if (match) return match.rate;
  }

  return pm.default_cashback_rate || 0;
};

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
        totalSpend: 0,
        cashbackEarned: 0,
        totalLosses: 0,
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
      const rate = getEffectiveCashbackRate(inv);
      const qty = inv.qty_purchased || 1;
      const itemCost = (inv.unit_purchase_cost * qty) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0) - (inv.gift_card_amount || 0);
      const itemCashback = itemCost * (rate / 100);

      card.totalSpend += itemCost;
      card.cashbackEarned += itemCashback;
      card.txnCount += 1;

      // Per-item P&L for sold units
      const hasSales = inv.sales && inv.sales.length > 0;

      if (hasSales) {
        // Allocate cost proportionally across sold quantities
        const perUnit = qty > 0 ? 1 / qty : 0;

        for (const sale of inv.sales) {
          const allocatedCost = (inv.unit_purchase_cost * sale.quantity)
            + (inv.sales_tax * perUnit * sale.quantity)
            + (inv.shipping_cost_inbound * perUnit * sale.quantity)
            + ((inv.fees || 0) * perUnit * sale.quantity)
            - ((inv.gift_card_amount || 0) * perUnit * sale.quantity);
          const allocatedCashback = allocatedCost * (rate / 100);
          const saleRevenue = (sale.unit_price * sale.quantity) - sale.commission_fee;
          const netPnl = saleRevenue - allocatedCost;
          const isLoss = netPnl < 0;
          const lossAmount = isLoss ? Math.abs(netPnl) : 0;
          const lossToRedeem = Math.min(allocatedCashback, lossAmount);

          card.soldCount += sale.quantity;
          if (isLoss) card.totalLosses += lossAmount;

          card.items.push({
            id: inv.id,
            saleId: sale.id,
            product: inv.product_name,
            cost: allocatedCost,
            cashback: allocatedCashback,
            status: sale.status || 'SOLD',
            revenue: saleRevenue,
            netPnl,
            lossAmount,
            lossToRedeem,
            cashbackRate: rate,
          });
        }

        // Check if any unsold units remain on this inventory item
        const soldQty = inv.sales.reduce((s, sa) => s + sa.quantity, 0);
        const unsoldQty = qty - soldQty;
        if (unsoldQty > 0) {
          const unsoldCost = (inv.unit_purchase_cost * unsoldQty)
            + (inv.sales_tax * (unsoldQty / qty))
            + (inv.shipping_cost_inbound * (unsoldQty / qty))
            + ((inv.fees || 0) * (unsoldQty / qty))
            - ((inv.gift_card_amount || 0) * (unsoldQty / qty));
          const unsoldCashback = unsoldCost * (rate / 100);
          card.pendingCount += unsoldQty;
          card.items.push({
            id: inv.id,
            saleId: null,
            product: inv.product_name,
            cost: unsoldCost,
            cashback: unsoldCashback,
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
          cost: itemCost,
          cashback: itemCashback,
          status: inv.status || 'PURCHASED',
          revenue: null,
          netPnl: null,
          lossAmount: 0,
          lossToRedeem: 0,
          cashbackRate: rate,
        });
      }
    }

    // Compute card-level cashback netting
    const cards = Object.values(cardMap).map(card => {
      const cashbackToRedeem = Math.min(card.cashbackEarned, card.totalLosses);
      const cashbackToKeep = card.cashbackEarned - cashbackToRedeem;
      const uncoveredLoss = Math.max(0, card.totalLosses - card.cashbackEarned);
      const amountToPay = card.totalSpend - cashbackToRedeem;

      return {
        ...card,
        cashbackToRedeem,
        cashbackToKeep,
        uncoveredLoss,
        amountToPay,
      };
    }).sort((a, b) => b.totalSpend - a.totalSpend);

    // Summary totals
    const summary = cards.reduce((acc, card) => {
      acc.totalSpend += card.totalSpend;
      acc.totalCashbackEarned += card.cashbackEarned;
      acc.totalCashbackToRedeem += card.cashbackToRedeem;
      acc.totalCashbackToKeep += card.cashbackToKeep;
      acc.totalAmountToPay += card.amountToPay;
      acc.totalUncoveredLoss += card.uncoveredLoss;
      return acc;
    }, {
      totalSpend: 0,
      totalCashbackEarned: 0,
      totalCashbackToRedeem: 0,
      totalCashbackToKeep: 0,
      totalAmountToPay: 0,
      totalUncoveredLoss: 0,
    });

    res.json({ month: monthLabel, cards, summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
