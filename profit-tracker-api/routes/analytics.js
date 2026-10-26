const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateQuery } = require('../middleware/validate');
const { analyticsDashboardQuery } = require('../validation/schemas');
const { Decimal, decimal, isRealizedSale, batchCost, allocatedCost, effectiveCashbackRate, inventoryCashback, saleEconomics } = require('../services/decimalFinance');
const { pipelineBucketOf } = require('../services/statusTransitions');
const { payoutStatus } = require('../services/payoutStatus');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const zero = () => new Decimal(0);
// Money fields round to 2dp at the response boundary; this route computes
// everything else (ratios, rates) in Decimal too, then rounds those to the
// same 2dp for consistent display precision.
const money = (d) => d.toDecimalPlaces(2).toNumber();

router.get('/dashboard', isAuthenticated, validateQuery(analyticsDashboardQuery), async (req, res, next) => {
  try {
    const userId = req.user.id;
    const mode = req.query.mode || 'All'; // 'All' | 'Cashout' | 'Marketplace'
    const dateParam = req.query.date || 'All Time';

    // Compute date cutoff — use UTC midnight so items stored at 00:00:00Z on the
    // boundary date are always included regardless of the server's local timezone.
    const now = new Date();
    const todayUTC = now.toISOString().slice(0, 10); // "YYYY-MM-DD"
    let dateFrom = null;
    if (dateParam === '7 Days') {
      const d = new Date(todayUTC + 'T00:00:00.000Z');
      d.setUTCDate(d.getUTCDate() - 7);
      dateFrom = d;
    } else if (dateParam === '30 Days') {
      const d = new Date(todayUTC + 'T00:00:00.000Z');
      d.setUTCDate(d.getUTCDate() - 30);
      dateFrom = d;
    } else if (dateParam === 'YTD') {
      dateFrom = new Date(`${now.getUTCFullYear()}-01-01T00:00:00.000Z`);
    }

    // Fetch inventory (purchase-date filtered) and sales (sale-date/platform filtered)
    // in parallel. When date filtering is active we also need *all* inventories for
    // inventory value and pipeline counts — run that third query concurrently too.
    const inventoryWhere = { user_id: userId };
    if (dateFrom) inventoryWhere.purchase_date = { gte: dateFrom };

    const salesWhere = { inventory: { user_id: userId } };
    if (dateFrom) salesWhere.sale_date = { gte: dateFrom };
    if (mode === 'Cashout') salesWhere.platform = { type: 'Cashout' };
    else if (mode === 'Marketplace') salesWhere.platform = { type: 'Marketplace' };

    // Only fetch allInventories separately when we know we'll need it (date filter or non-All mode)
    const needsAllInventories = mode !== 'All' || dateFrom;

    const [inventories, sales, allInventoriesFetched] = await Promise.all([
      prisma.inventory.findMany({
        where: inventoryWhere,
        include: { payment_method: true, vendor: true },
      }),
      prisma.sales.findMany({
        where: salesWhere,
        include: {
          inventory: { include: { payment_method: true, vendor: true } },
          platform: true,
          buyer: true,
        },
        orderBy: { sale_date: 'desc' },
      }),
      needsAllInventories
        ? prisma.inventory.findMany({ where: { user_id: userId } })
        : Promise.resolve(null),
    ]);

    // Precompute per-sale cost allocation once — avoids repeating the same
    // arithmetic 4× (stats, cardMap, trend, recentTransactions).
    // Cancelled, returned, and disputed records remain visible in the pipeline,
    // but are not realized revenue, profit, or units sold.
    const realizedSales = sales.filter(isRealizedSale);
    const saleAlloc = realizedSales.map(sale => {
      const inv = sale.inventory;
      const purchased = Number(inv.qty_purchased) || 0;
      const share = purchased > 0 ? new Decimal(sale.quantity).div(purchased) : zero();
      const allocatedTax      = new Decimal(inv.sales_tax || 0).times(share);
      const allocatedShipping = new Decimal(inv.shipping_cost_inbound || 0).times(share);
      const allocatedFees     = new Decimal(inv.fees || 0).times(share);
      const allocatedGiftCard = new Decimal(inv.gift_card_amount || 0).times(share);
      const rate = effectiveCashbackRate(inv);
      const { cost: saleCost, cashback: saleCashback, revenue: saleRevenue, grossProfit } = saleEconomics(inv, sale, rate);
      return { sale, inv, allocatedTax, allocatedShipping, allocatedFees, allocatedGiftCard, saleCost, saleCashback, saleRevenue, grossProfit, rate };
    });

    // Calculate Primary Stats
    // totalCost is purchase spend. soldCost is COGS for items that have actually sold.
    let totalCost = zero();
    let soldCost = zero();
    let totalRevenue = zero();
    let totalCashback = zero();  // ALL purchases cashback
    let soldCashback = zero();   // sold-only cashback (used for profit calcs)
    let commissionFees = zero();
    let saleShipping = zero();
    let totalTax = zero();
    let soldTax = zero();        // tax allocated to sold items only

    // Purchase spend: all inventory purchases in the selected purchase-date window.
    // Cashback is earned at point of purchase, so totalCashback includes all purchases.
    inventories.forEach(inv => {
      const lineCost = batchCost(inv);
      totalCost = totalCost.plus(lineCost);
      totalTax = totalTax.plus(inv.sales_tax || 0);
      const rate = effectiveCashbackRate(inv);
      totalCashback = totalCashback.plus(inventoryCashback(inv, rate));
    });

    // Sold metrics: only sales in the selected sale-date/platform window.
    saleAlloc.forEach(({ sale, saleCost, saleCashback, allocatedTax, saleRevenue }) => {
      soldCost = soldCost.plus(saleCost);
      soldCashback = soldCashback.plus(saleCashback);
      soldTax = soldTax.plus(allocatedTax);
      totalRevenue = totalRevenue.plus(saleRevenue);
      commissionFees = commissionFees.plus(sale.commission_fee || 0);
      saleShipping = saleShipping.plus(sale.sale_shipping || 0);
    });

    // When scoped to Cashout or Marketplace: all summary numbers reflect only
    // items that actually sold through that channel. Unsold inventory is excluded.
    if (mode !== 'All') {
      totalCost = soldCost;
      totalCashback = soldCashback;
      totalTax = soldTax;
    }

    // Profit metrics use sold-only cashback (cashback attributable to items that moved).
    // totalCashback stat card shows all-purchases cashback (earned at point of purchase).
    const grossProfit = totalRevenue.minus(soldCost);
    const profit = grossProfit.plus(soldCashback);
    const roi = soldCost.greaterThan(0) ? profit.div(soldCost).times(100) : zero();

    // Inventory value: cost of unsold units on hand (always from all inventory regardless of mode/date)
    const allInventories = allInventoriesFetched ?? inventories;
    const inventoryValue = allInventories.reduce((sum, inv) => sum.plus(allocatedCost(inv, inv.qty_on_hand)), zero());

    let inventoryQty = 0;
    let listedQty = 0;
    allInventories.forEach(inv => {
      inventoryQty += inv.qty_on_hand;
      // is_listed is the status-workflow column for this; a row the rollout
      // hasn't reached yet (receiving_status null) has none, so it still falls
      // back to the legacy status string.
      if (inv.is_listed || (!inv.receiving_status && inv.status === 'LISTED')) {
        listedQty += inv.qty_on_hand;
      }
    });

    let unitsSold = 0;
    saleAlloc.forEach(({ sale }) => { unitsSold += sale.quantity; });

    // Sales velocity: sales count ÷ days in filter window
    const windowDays = dateParam === '7 Days' ? 7
      : dateParam === '30 Days' ? 30
      : dateParam === 'YTD' ? Math.ceil((now - new Date(Date.UTC(now.getUTCFullYear(), 0, 1))) / (24 * 60 * 60 * 1000)) || 1
      : null; // All Time: null means no velocity
    const salesVelocity = windowDays ? saleAlloc.length / windowDays : 0;

    // Top Cards (Payment Methods)
    // In All mode: rank all payment cards by total purchase spend.
    // In Cashout/Marketplace mode: only count spend on items that were sold via that channel.
    const cardMap = {};
    if (mode === 'All') {
      inventories.forEach(inv => {
        if (inv.payment_method) {
          const id = inv.payment_method.id;
          if (!cardMap[id]) cardMap[id] = { name: inv.payment_method.name, txns: 0, amount: zero() };
          cardMap[id].txns += 1;
          cardMap[id].amount = cardMap[id].amount.plus(batchCost(inv));
        }
      });
    } else {
      // Filtered mode: accumulate proportional spend per payment card from filtered sales only
      saleAlloc.forEach(({ sale, inv, saleCost }) => {
        if (inv.payment_method) {
          const id = inv.payment_method.id;
          if (!cardMap[id]) cardMap[id] = { name: inv.payment_method.name, txns: 0, amount: zero() };
          cardMap[id].txns += 1;
          cardMap[id].amount = cardMap[id].amount.plus(saleCost);
        }
      });
    }
    const topCards = Object.values(cardMap)
      .map(card => ({ ...card, amount: money(card.amount) }))
      .sort((a, b) => b.amount - a.amount);

    // ── Platform breakdown: how much each sales channel (Cashout or
    // Marketplace platform, or "Direct" when a sale has none) has actually
    // paid out, alongside its commission, profit, payout speed, and exception
    // rate. Built from the same mode/date-filtered `sales`/`saleAlloc` arrays
    // as every other stat above, so it automatically respects both filters.
    const platformMap = new Map();
    const platformKeyOf = (sale) => sale.platform_id || 'direct';
    const ensurePlatform = (sale) => {
      const key = platformKeyOf(sale);
      if (!platformMap.has(key)) {
        platformMap.set(key, {
          id: sale.platform_id || null,
          name: sale.platform?.name || (sale.platform_id ? 'Unknown Platform' : 'Direct'),
          type: sale.platform?.type || 'Direct',
          revenue: zero(), cost: zero(), commission: zero(), cashback: zero(),
          unitsSold: 0, salesCount: 0,
          paidDaysTotal: 0, paidCount: 0,
          returnedCount: 0, disputedCount: 0, cancelledCount: 0, exceptionCount: 0,
        });
      }
      return platformMap.get(key);
    };
    saleAlloc.forEach(({ sale, saleCost, saleRevenue, saleCashback }) => {
      const p = ensurePlatform(sale);
      p.revenue = p.revenue.plus(saleRevenue);
      p.cost = p.cost.plus(saleCost);
      p.commission = p.commission.plus(sale.commission_fee || 0);
      p.cashback = p.cashback.plus(saleCashback);
      p.unitsSold += sale.quantity;
      p.salesCount += 1;
      if (sale.paid_at) {
        const days = (new Date(sale.paid_at) - new Date(sale.sale_date)) / (24 * 60 * 60 * 1000);
        if (Number.isFinite(days) && days >= 0) { p.paidDaysTotal += days; p.paidCount += 1; }
      }
    });
    // Exceptions come from the OTHER side of isRealizedSale -- every sale in
    // the filtered window that function excludes is exactly a returned,
    // disputed, or cancelled one, so this is the complement of saleAlloc
    // rather than a second, separately-filtered query.
    sales.filter(s => !isRealizedSale(s)).forEach(sale => {
      const p = ensurePlatform(sale);
      p.exceptionCount += 1;
      const status = String(sale.workflow_status || sale.status || '').toUpperCase();
      if (status === 'RETURNED' || status === 'RETURN_IN_PROGRESS') p.returnedCount += 1;
      else if (status === 'DISPUTED') p.disputedCount += 1;
      else if (status === 'CANCELLED') p.cancelledCount += 1;
    });
    const platformBreakdown = Array.from(platformMap.values())
      .map(p => ({
        id: p.id,
        name: p.name,
        type: p.type,
        revenue: money(p.revenue),
        cost: money(p.cost),
        commission: money(p.commission),
        profit: money(p.revenue.minus(p.cost).plus(p.cashback)),
        unitsSold: p.unitsSold,
        salesCount: p.salesCount,
        avgPayoutDays: p.paidCount > 0 ? Math.round((p.paidDaysTotal / p.paidCount) * 10) / 10 : null,
        returnedCount: p.returnedCount,
        disputedCount: p.disputedCount,
        cancelledCount: p.cancelledCount,
        exceptionRatePct: (p.salesCount + p.exceptionCount) > 0
          ? money(new Decimal(p.exceptionCount).div(p.salesCount + p.exceptionCount).times(100))
          : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    // ── Vendor breakdown: spend per sourcing vendor. Mirrors the
    // totalCost/soldCost All-vs-channel-mode split above -- in All mode this
    // is every purchase; scoped to a sales channel, it's only the cost of
    // units that actually sold through that channel (same reasoning as the
    // top-of-route "mode !== 'All'" cutover for totalCost).
    const vendorMap = new Map();
    const ensureVendor = (inv) => {
      const key = inv.vendor_id || 'direct';
      if (!vendorMap.has(key)) {
        vendorMap.set(key, {
          id: inv.vendor_id || null,
          name: inv.vendor?.name || 'No Vendor',
          spend: zero(), units: 0, purchases: 0,
        });
      }
      return vendorMap.get(key);
    };
    if (mode === 'All') {
      inventories.forEach(inv => {
        const v = ensureVendor(inv);
        v.spend = v.spend.plus(batchCost(inv));
        v.units += Number(inv.qty_purchased) || 0;
        v.purchases += 1;
      });
    } else {
      saleAlloc.forEach(({ inv, saleCost, sale }) => {
        const v = ensureVendor(inv);
        v.spend = v.spend.plus(saleCost);
        v.units += sale.quantity;
        v.purchases += 1;
      });
    }
    const vendorBreakdown = Array.from(vendorMap.values())
      .map(v => ({
        id: v.id,
        name: v.name,
        spend: money(v.spend),
        units: v.units,
        purchases: v.purchases,
        avgCostPerUnit: v.units > 0 ? money(v.spend.div(v.units)) : 0,
      }))
      .sort((a, b) => b.spend - a.spend);

    // ── Category breakdown: profitability by product category. Sold-side
    // only (same scope as Gross/Net Profit above) -- a category's margin is
    // only meaningful once units in it have actually sold.
    const categoryMap = new Map();
    saleAlloc.forEach(({ inv, saleCost, saleRevenue, grossProfit, saleCashback, sale }) => {
      const key = inv.category || 'Uncategorized';
      if (!categoryMap.has(key)) {
        categoryMap.set(key, { category: key, revenue: zero(), cost: zero(), profit: zero(), unitsSold: 0 });
      }
      const c = categoryMap.get(key);
      c.revenue = c.revenue.plus(saleRevenue);
      c.cost = c.cost.plus(saleCost);
      c.profit = c.profit.plus(grossProfit).plus(saleCashback);
      c.unitsSold += sale.quantity;
    });
    const categoryBreakdown = Array.from(categoryMap.values())
      .map(c => ({
        category: c.category,
        revenue: money(c.revenue),
        cost: money(c.cost),
        profit: money(c.profit),
        margin: c.revenue.greaterThan(0) ? money(c.profit.div(c.revenue).times(100)) : 0,
        unitsSold: c.unitsSold,
      }))
      .sort((a, b) => b.profit - a.profit);

    // Status Pipeline Strategy
    // Unsold inventory goes into PURCHASED. Sales dictate the rest.
    const pipelineCounts = {
      'Pre Order': 0,
      'On Hand': 0,
      PURCHASED: 0,
      SHIPPED: 0,
      DELIVERED: 0,
      SCANNED_IN: 0,
      LISTED: 0,
      SOLD: 0,
      PAID: 0,
      COMPLETED: 0,
      RETURNED: 0,
      DISPUTED: 0,
      CANCELLED: 0,
      PENDING_PAYMENT: 0,
      IN_TRANSIT_OUT: 0,
      AUTHENTICATION: 0
    };

    // Unsold units go into their inventory status bucket (default PURCHASED).
    // Always use allInventories (ignores date filter) so items purchased before the
    // date window still show up in the pipeline — pipeline reflects current stock state.
    //
    // A record the status-workflow rollout has reached (receiving_status /
    // workflow_status set) is bucketed from that column via pipelineBucketOf,
    // since the action endpoints behind the Statuses board generally don't
    // keep the legacy `status` string in sync (see statusTransitions.js) — the
    // legacy string is only read as a fallback for a row the rollout hasn't
    // touched yet, exactly as before.
    if (mode === 'All') {
      allInventories.forEach(inv => {
        if (inv.qty_on_hand > 0) {
          const bucket = pipelineBucketOf(inv, 'inventory');
          if (bucket) {
            pipelineCounts[bucket] += inv.qty_on_hand;
            return;
          }
          const rawSt = inv.status || 'PURCHASED';
          let st = rawSt.toUpperCase();
          if (st === 'PRE ORDER') st = 'Pre Order';
          if (st === 'ON HAND') st = 'On Hand';

          if (pipelineCounts.hasOwnProperty(st)) {
            pipelineCounts[st] += inv.qty_on_hand;
          } else {
            pipelineCounts.PURCHASED += inv.qty_on_hand;
          }
        }
      });
    }

    // For sales, we count by status
    sales.forEach(sale => {
      const bucket = pipelineBucketOf(sale, 'sale');
      if (bucket) {
        pipelineCounts[bucket] += sale.quantity;
        return;
      }
      let st = (sale.status || '').toUpperCase();
      if (st === 'PRE ORDER') st = 'Pre Order';
      if (st === 'ON HAND') st = 'On Hand';

      if (pipelineCounts.hasOwnProperty(st)) {
        pipelineCounts[st] += sale.quantity;
      }
    });

    // Trend data — per-period deltas, not cumulative running totals.
    // Group key: YYYY-MM for YTD / All Time (monthly buckets), YYYY-MM-DD for 7/30 Days (daily).
    const useMonthly = dateParam === 'YTD' || dateParam === 'All Time';
    const bucketKey = (isoDate) => useMonthly ? isoDate.slice(0, 7) : isoDate.slice(0, 10);

    const trendByBucket = new Map();
    const ensureBucket = (key) => {
      if (!trendByBucket.has(key)) {
        trendByBucket.set(key, {
          date: key,
          totalCost: zero(),
          totalTax: zero(),
          cashback: zero(),
          totalRevenue: zero(),
          soldCost: zero(),
          grossProfit: zero(),
          netProfit: zero(),
          unitsSold: 0,
        });
      }
      return trendByBucket.get(key);
    };

    // Purchase cost side (anchored at purchase date).
    if (mode === 'All') {
      inventories.forEach(inv => {
        const key = bucketKey(dateKey(inv.purchase_date));
        const pt = ensureBucket(key);
        const lineCost = batchCost(inv);
        const rate = effectiveCashbackRate(inv);
        pt.totalCost = pt.totalCost.plus(lineCost);
        pt.totalTax = pt.totalTax.plus(inv.sales_tax || 0);
        pt.cashback = pt.cashback.plus(inventoryCashback(inv, rate));
      });
    } else {
      saleAlloc.forEach(({ inv, saleCost, allocatedTax, saleCashback }) => {
        const key = bucketKey(dateKey(inv.purchase_date));
        const pt = ensureBucket(key);
        pt.totalCost = pt.totalCost.plus(saleCost);
        pt.totalTax = pt.totalTax.plus(allocatedTax);
        pt.cashback = pt.cashback.plus(saleCashback);
      });
    }

    // Sale side (anchored at sale date).
    saleAlloc.forEach(({ sale, saleCost, saleRevenue, grossProfit, saleCashback }) => {
      const key = bucketKey(dateKey(sale.sale_date));
      const pt = ensureBucket(key);
      pt.totalRevenue = pt.totalRevenue.plus(saleRevenue);
      pt.soldCost = pt.soldCost.plus(saleCost);
      pt.grossProfit = pt.grossProfit.plus(grossProfit);
      pt.netProfit = pt.netProfit.plus(grossProfit.plus(saleCashback));
      pt.unitsSold += sale.quantity;
    });

    const trend = Array.from(trendByBucket.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(pt => ({
        date: pt.date,
        totalCost: money(pt.totalCost),
        totalTax: money(pt.totalTax),
        cashback: money(pt.cashback),
        totalRevenue: money(pt.totalRevenue),
        soldCost: money(pt.soldCost),
        grossProfit: money(pt.grossProfit),
        netProfit: money(pt.netProfit),
        unitsSold: pt.unitsSold,
      }));

    // For daily views, tell the frontend the window boundaries so it can fill
    // zero-points for inactive days in period mode without needing to know the
    // date range itself.
    const trendMeta = !useMonthly && dateFrom
      ? { windowStart: dateFrom.toISOString().slice(0, 10), windowEnd: todayUTC }
      : null;

    const cashFlowTransactions = saleAlloc.map(({ sale: s, inv, saleCost, saleRevenue, saleCashback }) => ({
      id: s.id,
      product: inv.product_name,
      platform: s.platform?.name || inv.vendor?.name || 'Direct',
      buyer: s.buyer?.name || 'Unknown',
      cost: money(saleCost),
      revenue: money(saleRevenue),
      commission: money(decimal(s.commission_fee_decimal ?? s.commission_fee)),
      cashback: money(saleCashback),
      profit: money(saleRevenue.minus(saleCost).plus(saleCashback)),
      // workflow_status (set by the mark_paid action) takes precedence over
      // the legacy status column, same precedence services/decimalFinance.js
      // and the pipeline bucket already use -- a sale marked paid through the
      // new action never again looks "Pending" here just because its legacy
      // column was never touched.
      status: s.workflow_status || s.status,
      payout_status: payoutStatus(s),
      payout_account: s.payout_account || null,
      payout_short_amount: s.payout_short_amount ? money(decimal(s.payout_short_amount)) : 0,
      date: s.sale_date,
    }));

    res.json({
      stats: {
        totalCost: money(totalCost),
        soldCost: money(soldCost),
        totalRevenue: money(totalRevenue),
        totalCashback: money(totalCashback),
        grossProfit: money(grossProfit),
        profit: money(profit),
        roi: money(roi),
        commissionFees: money(commissionFees),
        saleShipping: money(saleShipping),
        totalTax: money(totalTax),
        inventoryValue: money(inventoryValue),
        inventoryQty,
        listedQty,
        unitsSold,
        salesVelocity,
        transactionCount: mode !== 'All'
          ? new Set(saleAlloc.map(({ sale }) => sale.inventory_id)).size
          : inventories.length,
        salesCount: saleAlloc.length,
        avgCashbackRate: totalCost.greaterThan(0) ? money(totalCashback.div(totalCost).times(100)) : 0
      },
      topCards,
      platformBreakdown,
      vendorBreakdown,
      categoryBreakdown,
      pipelineCounts,
      trend,
      trendMeta,
      recentTransactions: cashFlowTransactions.slice(0, 10),
      cashFlowTransactions,
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
