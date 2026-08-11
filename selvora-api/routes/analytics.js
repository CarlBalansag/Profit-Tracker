const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateQuery } = require('../middleware/validate');
const { analyticsDashboardQuery } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const dateKey = (date) => new Date(date).toISOString().slice(0, 10);

// Returns the effective cashback rate for an inventory item, applying category
// rate overrides (e.g. Amazon 5% on Chase Freedom Flex) the same way the
// frontend does.  category_rates is stored as a JSON string in the DB.
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
    const saleAlloc = sales.map(sale => {
      const inv = sale.inventory;
      const perUnit = inv.qty_purchased > 0 ? 1 / inv.qty_purchased : 0;
      const allocatedTax      = inv.sales_tax              * perUnit * sale.quantity;
      const allocatedShipping = inv.shipping_cost_inbound  * perUnit * sale.quantity;
      const allocatedFees     = (inv.fees || 0)            * perUnit * sale.quantity;
      const allocatedGiftCard = (inv.gift_card_amount || 0) * perUnit * sale.quantity;
      const saleCost          = (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees - allocatedGiftCard;
      const rate              = getEffectiveCashbackRate(inv);
      const saleCashback      = saleCost * (rate / 100);
      const saleRevenue       = (sale.unit_price * sale.quantity) - sale.commission_fee;
      const grossProfit       = saleRevenue - saleCost;
      return { sale, inv, allocatedTax, allocatedShipping, allocatedFees, allocatedGiftCard, saleCost, saleCashback, saleRevenue, grossProfit, rate };
    });

    // Calculate Primary Stats
    // totalCost is purchase spend. soldCost is COGS for items that have actually sold.
    let totalCost = 0;
    let soldCost = 0;
    let totalRevenue = 0;
    let totalCashback = 0;  // ALL purchases cashback
    let soldCashback = 0;   // sold-only cashback (used for profit calcs)
    let commissionFees = 0;
    let totalTax = 0;
    let soldTax = 0;        // tax allocated to sold items only

    // Purchase spend: all inventory purchases in the selected purchase-date window.
    // Cashback is earned at point of purchase, so totalCashback includes all purchases.
    inventories.forEach(inv => {
      const lineCost = (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0) - (inv.gift_card_amount || 0);
      totalCost += lineCost;
      totalTax += inv.sales_tax;
      const rate = getEffectiveCashbackRate(inv);
      totalCashback += lineCost * (rate / 100);
    });

    // Sold metrics: only sales in the selected sale-date/platform window.
    saleAlloc.forEach(({ sale, saleCost, saleCashback, allocatedTax, saleRevenue }) => {
      soldCost += saleCost;
      soldCashback += saleCashback;
      soldTax += allocatedTax;
      totalRevenue += saleRevenue;
      commissionFees += sale.commission_fee;
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
    const grossProfit = totalRevenue - soldCost;
    const profit = grossProfit + soldCashback;
    const roi = soldCost > 0 ? (profit / soldCost) * 100 : 0;

    // Inventory value: cost of unsold units on hand (always from all inventory regardless of mode/date)
    const allInventories = allInventoriesFetched ?? inventories;
    const inventoryValue = allInventories.reduce((sum, inv) => {
      if (!inv.qty_purchased || inv.qty_purchased <= 0) return sum + (inv.qty_on_hand * inv.unit_purchase_cost);
      const unitTax = inv.sales_tax / inv.qty_purchased;
      const unitShipping = inv.shipping_cost_inbound / inv.qty_purchased;
      const unitFees = (inv.fees || 0) / inv.qty_purchased;
      const unitGiftCard = (inv.gift_card_amount || 0) / inv.qty_purchased;
      const unitCost = inv.unit_purchase_cost + unitTax + unitShipping + unitFees - unitGiftCard;
      return sum + (inv.qty_on_hand * unitCost);
    }, 0);

    let inventoryQty = 0;
    let listedQty = 0;
    allInventories.forEach(inv => {
      inventoryQty += inv.qty_on_hand;
      if (inv.status === 'LISTED') {
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
    const salesVelocity = windowDays ? sales.length / windowDays : 0;

    // Top Cards (Payment Methods)
    // In All mode: rank all payment cards by total purchase spend.
    // In Cashout/Marketplace mode: only count spend on items that were sold via that channel.
    const cardMap = {};
    if (mode === 'All') {
      inventories.forEach(inv => {
        if (inv.payment_method) {
          const id = inv.payment_method.id;
          if (!cardMap[id]) cardMap[id] = { name: inv.payment_method.name, txns: 0, amount: 0 };
          cardMap[id].txns += 1;
          cardMap[id].amount += (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0) - (inv.gift_card_amount || 0);
        }
      });
    } else {
      // Filtered mode: accumulate proportional spend per payment card from filtered sales only
      saleAlloc.forEach(({ sale, inv, saleCost }) => {
        if (inv.payment_method) {
          const id = inv.payment_method.id;
          if (!cardMap[id]) cardMap[id] = { name: inv.payment_method.name, txns: 0, amount: 0 };
          cardMap[id].txns += 1;
          cardMap[id].amount += saleCost;
        }
      });
    }
    const topCards = Object.values(cardMap).sort((a, b) => b.amount - a.amount);

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
    if (mode === 'All') {
      allInventories.forEach(inv => {
        if (inv.qty_on_hand > 0) {
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
          totalCost: 0,
          totalTax: 0,
          cashback: 0,
          totalRevenue: 0,
          soldCost: 0,
          grossProfit: 0,
          netProfit: 0,
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
        const lineCost = (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0) - (inv.gift_card_amount || 0);
        const rate = getEffectiveCashbackRate(inv);
        pt.totalCost += lineCost;
        pt.totalTax += inv.sales_tax;
        pt.cashback += lineCost * (rate / 100);
      });
    } else {
      saleAlloc.forEach(({ inv, saleCost, allocatedTax, rate }) => {
        const key = bucketKey(dateKey(inv.purchase_date));
        const pt = ensureBucket(key);
        pt.totalCost += saleCost;
        pt.totalTax += allocatedTax;
        pt.cashback += saleCost * (rate / 100);
      });
    }

    // Sale side (anchored at sale date).
    saleAlloc.forEach(({ sale, saleCost, saleRevenue, grossProfit, saleCashback }) => {
      const key = bucketKey(dateKey(sale.sale_date));
      const pt = ensureBucket(key);
      pt.totalRevenue += saleRevenue;
      pt.soldCost += saleCost;
      pt.grossProfit += grossProfit;
      pt.netProfit += grossProfit + saleCashback;
      pt.unitsSold += sale.quantity;
    });

    const trend = Array.from(trendByBucket.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    // For daily views, tell the frontend the window boundaries so it can fill
    // zero-points for inactive days in period mode without needing to know the
    // date range itself.
    const trendMeta = !useMonthly && dateFrom
      ? { windowStart: dateFrom.toISOString().slice(0, 10), windowEnd: todayUTC }
      : null;

    res.json({
      stats: {
        totalCost,
        soldCost,
        totalRevenue,
        totalCashback,
        grossProfit,
        profit,
        roi,
        commissionFees,
        totalTax,
        inventoryValue,
        inventoryQty,
        listedQty,
        unitsSold,
        salesVelocity,
        transactionCount: mode !== 'All'
          ? new Set(saleAlloc.map(({ sale }) => sale.inventory_id)).size
          : inventories.length,
        salesCount: saleAlloc.length,
        avgCashbackRate: totalCost > 0 ? (totalCashback / totalCost) * 100 : 0
      },
      topCards,
      pipelineCounts,
      trend,
      trendMeta,
      recentTransactions: saleAlloc.slice(0, 10).map(({ sale: s, inv, saleCost, saleRevenue, saleCashback }) => ({
        id: s.id,
        product: inv.product_name,
        platform: s.platform?.name || inv.vendor?.name || 'Direct',
        buyer: s.buyer?.name || 'Unknown',
        cost: saleCost,
        revenue: saleRevenue,
        commission: s.commission_fee,
        cashback: saleCashback,
        profit: saleRevenue - saleCost + saleCashback,
        status: s.status,
        date: s.sale_date,
      }))
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
