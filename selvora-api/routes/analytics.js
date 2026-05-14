const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

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

router.get('/dashboard', isAuthenticated, async (req, res, next) => {
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

    // Fetch all inventory items (purchases), filtered by date
    const inventoryWhere = { user_id: userId };
    if (dateFrom) inventoryWhere.purchase_date = { gte: dateFrom };

    const inventories = await prisma.inventory.findMany({
      where: inventoryWhere,
      include: { payment_method: true, vendor: true }
    });

    // Fetch all sales, filtered by platform type and date
    const salesWhere = { inventory: { user_id: userId } };
    if (dateFrom) salesWhere.sale_date = { gte: dateFrom };
    if (mode === 'Cashout') salesWhere.platform = { type: 'Cashout' };
    else if (mode === 'Marketplace') salesWhere.platform = { type: 'Marketplace' };

    const sales = await prisma.sales.findMany({
      where: salesWhere,
      include: {
        inventory: {
          include: { payment_method: true, vendor: true }
        },
        platform: true,
        buyer: true
      },
      orderBy: { sale_date: 'desc' }
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
      const lineCost = (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0);
      totalCost += lineCost;
      totalTax += inv.sales_tax;
      const rate = getEffectiveCashbackRate(inv);
      totalCashback += lineCost * (rate / 100);
    });

    // Sold metrics: only sales in the selected sale-date/platform window.
    sales.forEach(sale => {
      const inv = sale.inventory;
      const allocatedTax = inv.qty_purchased > 0 ? (inv.sales_tax / inv.qty_purchased) * sale.quantity : 0;
      const allocatedShipping = inv.qty_purchased > 0 ? (inv.shipping_cost_inbound / inv.qty_purchased) * sale.quantity : 0;
      const allocatedFees = inv.qty_purchased > 0 ? ((inv.fees || 0) / inv.qty_purchased) * sale.quantity : 0;
      const saleCost = (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees;
      const rate = getEffectiveCashbackRate(inv);
      const saleCashback = saleCost * (rate / 100);

      soldCost += saleCost;
      soldCashback += saleCashback;
      soldTax += allocatedTax;
      totalRevenue += (sale.unit_price * sale.quantity) - sale.commission_fee;
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
    const allInventories = mode !== 'All' || dateFrom
      ? await prisma.inventory.findMany({ where: { user_id: userId } })
      : inventories;
    const inventoryValue = allInventories.reduce((sum, inv) => {
      if (!inv.qty_purchased || inv.qty_purchased <= 0) return sum + (inv.qty_on_hand * inv.unit_purchase_cost);
      const unitTax = inv.sales_tax / inv.qty_purchased;
      const unitShipping = inv.shipping_cost_inbound / inv.qty_purchased;
      const unitFees = (inv.fees || 0) / inv.qty_purchased;
      const unitCost = inv.unit_purchase_cost + unitTax + unitShipping + unitFees;
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
    sales.forEach(sale => {
      unitsSold += sale.quantity;
    });

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
          cardMap[id].amount += (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0);
        }
      });
    } else {
      // Filtered mode: accumulate proportional spend per payment card from filtered sales only
      sales.forEach(sale => {
        const inv = sale.inventory;
        if (inv.payment_method) {
          const id = inv.payment_method.id;
          if (!cardMap[id]) cardMap[id] = { name: inv.payment_method.name, txns: 0, amount: 0 };
          cardMap[id].txns += 1;
          const allocatedTax = inv.qty_purchased > 0 ? (inv.sales_tax / inv.qty_purchased) * sale.quantity : 0;
          const allocatedShipping = inv.qty_purchased > 0 ? (inv.shipping_cost_inbound / inv.qty_purchased) * sale.quantity : 0;
          const allocatedFees = inv.qty_purchased > 0 ? ((inv.fees || 0) / inv.qty_purchased) * sale.quantity : 0;
          cardMap[id].amount += (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees;
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

    // Trend data: one cumulative point per actual purchase/sale date.
    const trendByDate = new Map();
    const ensureTrendPoint = (key) => {
      if (!trendByDate.has(key)) {
        trendByDate.set(key, {
          date: key,
          purchaseCostDelta: 0,
          taxDelta: 0,
          purchaseCashbackDelta: 0, // cashback on ALL purchases (earned at buy time)
          revenueDelta: 0,
          soldCostDelta: 0,
          grossProfitDelta: 0,
          netProfitDelta: 0,
        });
      }
      return trendByDate.get(key);
    };

    // Trend chart — purchase cost side.
    // All mode: plot full purchase cost at purchase date for every inventory item.
    // Cashout/Marketplace mode: plot only the proportional cost for items in filtered sales,
    // still anchored at purchase date so the chart reflects when money left your pocket.
    if (mode === 'All') {
      inventories.forEach(inv => {
        const key = dateKey(inv.purchase_date);
        const point = ensureTrendPoint(key);
        const lineCost = (inv.unit_purchase_cost * inv.qty_purchased) + inv.sales_tax + inv.shipping_cost_inbound + (inv.fees || 0);
        const rate = getEffectiveCashbackRate(inv);
        point.purchaseCostDelta += lineCost;
        point.taxDelta += inv.sales_tax;
        point.purchaseCashbackDelta += lineCost * (rate / 100);
      });
    } else {
      // Use proportional allocation from filtered sales — consistent with totalCost override
      sales.forEach(sale => {
        const inv = sale.inventory;
        const key = dateKey(inv.purchase_date);
        const point = ensureTrendPoint(key);
        const allocatedTax = inv.qty_purchased > 0 ? (inv.sales_tax / inv.qty_purchased) * sale.quantity : 0;
        const allocatedShipping = inv.qty_purchased > 0 ? (inv.shipping_cost_inbound / inv.qty_purchased) * sale.quantity : 0;
        const allocatedFees = inv.qty_purchased > 0 ? ((inv.fees || 0) / inv.qty_purchased) * sale.quantity : 0;
        const proportionalCost = (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees;
        const rate = getEffectiveCashbackRate(inv);
        point.purchaseCostDelta += proportionalCost;
        point.taxDelta += allocatedTax;
        point.purchaseCashbackDelta += proportionalCost * (rate / 100);
      });
    }

    sales.forEach(sale => {
      const inv = sale.inventory;
      const key = dateKey(sale.sale_date);
      const point = ensureTrendPoint(key);
      const allocatedTax = inv.qty_purchased > 0 ? (inv.sales_tax / inv.qty_purchased) * sale.quantity : 0;
      const allocatedShipping = inv.qty_purchased > 0 ? (inv.shipping_cost_inbound / inv.qty_purchased) * sale.quantity : 0;
      const allocatedFees = inv.qty_purchased > 0 ? ((inv.fees || 0) / inv.qty_purchased) * sale.quantity : 0;
      const saleCost = (inv.unit_purchase_cost * sale.quantity) + allocatedTax + allocatedShipping + allocatedFees;
      const saleRevenue = (sale.unit_price * sale.quantity) - sale.commission_fee;
      const saleCashback = saleCost * (getEffectiveCashbackRate(inv) / 100);
      const saleGrossProfit = saleRevenue - saleCost;

      point.revenueDelta += saleRevenue;
      point.soldCostDelta += saleCost;
      point.grossProfitDelta += saleGrossProfit;
      // netProfit on graph = gross profit + sold cashback (consistent with profit stat card)
      point.netProfitDelta += saleGrossProfit + saleCashback;
    });

    let runningTotalCost = 0;
    let runningTotalTax = 0;
    let runningCashback = 0;   // all-purchases cashback
    let runningTotalRevenue = 0;
    let runningSoldCost = 0;
    let runningGrossProfit = 0;
    let runningNetProfit = 0;
    const trend = Array.from(trendByDate.values())
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(point => {
        runningTotalCost += point.purchaseCostDelta;
        runningTotalTax += point.taxDelta;
        runningCashback += point.purchaseCashbackDelta;  // all purchases
        runningTotalRevenue += point.revenueDelta;
        runningSoldCost += point.soldCostDelta;
        runningGrossProfit += point.grossProfitDelta;
        runningNetProfit += point.netProfitDelta;

        return {
          date: point.date,
          totalCost: runningTotalCost,
          totalTax: runningTotalTax,
          cashback: runningCashback,       // all purchases
          totalRevenue: runningTotalRevenue,
          soldCost: runningSoldCost,
          grossProfit: runningGrossProfit,
          netProfit: runningNetProfit,
        };
      });

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
          ? new Set(sales.map(s => s.inventory_id)).size
          : inventories.length,
        salesCount: sales.length,
        avgCashbackRate: totalCost > 0 ? (totalCashback / totalCost) * 100 : 0
      },
      topCards,
      pipelineCounts,
      trend,
      recentTransactions: sales.slice(0, 10).map(s => {
        const inv = s.inventory;
        const allocatedTax = inv.qty_purchased > 0 ? (inv.sales_tax / inv.qty_purchased) * s.quantity : 0;
        const allocatedShipping = inv.qty_purchased > 0 ? (inv.shipping_cost_inbound / inv.qty_purchased) * s.quantity : 0;
        const allocatedFees = inv.qty_purchased > 0 ? ((inv.fees || 0) / inv.qty_purchased) * s.quantity : 0;
        const saleCost = (inv.unit_purchase_cost * s.quantity) + allocatedTax + allocatedShipping + allocatedFees;
        const saleRevenue = (s.unit_price * s.quantity) - s.commission_fee;
        const cashbackRate = getEffectiveCashbackRate(inv);
        const saleCashback = saleCost * (cashbackRate / 100);
        return {
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
        };
      })
    });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
