// Schedule C Parts I and III (income and cost of goods sold) built from the
// purchases and sales already in ProfitTracker, plus the line 31 net profit and
// a reconciliation to the profit the rest of the app shows.
//
// Accounting rules used (cash method, specific identification at cost):
// - Gross receipts (line 1): sale price x quantity of realized sales, in the
//   year of the sale date. Sales tax recorded as collected is not included.
// - Returns and allowances (line 2): refunds to buyers, in the year the money
//   went back (from the Part II worksheet, which already reports them).
// - Inventory cost per unit: the purchase's batch cost (price, tax, inbound
//   shipping and fees, less gift cards and store refunds) plus what the gift
//   card amount cost the user when they entered it, less the card rewards
//   earned on it -- rewards are treated as a discount on the purchase, not
//   income -- spread over the units kept. A gift card with no cost entered is
//   counted as free (as the rest of the app does), and a note says so.
// - Units leave inventory on the sale date; a sale's units are the ones it
//   still keeps out of stock (quantity less units refunded or put back).
// - Cancelled purchases are not inventory.
// - COGS (line 42) = beginning inventory + purchases - ending inventory.
//
// Everything is Decimal internally and rounded to cents once, on output.
const { Decimal, decimal, isRealizedSale, batchCost, keptQuantity, keptSaleQuantity, effectiveCashbackRate, inventoryCashback, saleEconomics } = require('./decimalFinance');
const { withExactFields, MAPPINGS } = require('./decimalRead');

const ZERO = new Decimal(0);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const yearOf = (value) => new Date(value).getUTCFullYear();
const money = (d) => decimal(d).toDecimalPlaces(2).toFixed(2);
const isCancelledPurchase = (inv) => Boolean(inv.cancelled_at)
  || inv.receiving_status === 'CANCELLED'
  || String(inv.status || '').toUpperCase() === 'CANCELLED';
// Units a sale keeps out of stock (mirrors shared/finance.mjs heldSaleQuantity).
const unitsOut = (sale) => Math.max(0, num(sale.quantity) - num(sale.refunded_qty) - num(sale.restored_qty));
const DEC_CUTOFF_DAY = 25; // sales on Dec 25-31 are listed for the payout cutoff check

function batchFacts(raw) {
  const inv = withExactFields(raw, MAPPINGS.inventory);
  const kept = keptQuantity(inv);
  // Card rewards at the rate in effect on the purchase date, not today's.
  const rate = effectiveCashbackRate(inv, new Date(inv.purchase_date));
  const cashback = kept > 0 ? inventoryCashback(inv, rate) : ZERO;
  const giftCardAmount = decimal(inv.gift_card_amount || 0);
  const hasGiftCard = giftCardAmount.greaterThan(0);
  const giftCardCost = hasGiftCard && inv.gift_card_cost !== null && inv.gift_card_cost !== undefined
    ? decimal(inv.gift_card_cost) : null;
  const cost = batchCost(inv);
  const taxCost = cost.plus(giftCardCost ?? ZERO).minus(cashback);
  const unit = kept > 0 ? taxCost.div(kept) : ZERO;
  const sales = (inv.sales || []).map((s) => withExactFields(s, MAPPINGS.sales)).filter(isRealizedSale);
  return { inv, kept, cost, cashback, taxCost, unit, sales, rate, giftCardAmount, hasGiftCard, giftCardCost, purchaseYear: yearOf(inv.purchase_date) };
}

// Units of a batch still on hand at the end of `year` (0 if bought later).
function heldAtYearEnd(b, year) {
  if (b.purchaseYear > year || b.kept <= 0) return 0;
  const out = b.sales.filter((s) => yearOf(s.sale_date) <= year).reduce((n, s) => n + unitsOut(s), 0);
  return Math.max(0, b.kept - out);
}

/**
 * inventories: rows with sales (platform), payment_method and vendor.
 * worksheet: the Part II result from services/scheduleC.js for the same year.
 * expensesInYear: manual Expense rows dated in the year (for the reconciliation).
 */
function scheduleCBooks({ inventories = [], year, worksheet, expensesInYear = [] }) {
  const batches = inventories.filter((inv) => !isCancelledPurchase(inv)).map(batchFacts);
  let gross = ZERO; let purchases = ZERO; let beginning = ZERO; let ending = ZERO;
  let cashbackOnPurchases = ZERO; let salesTaxCollected = ZERO;
  // Gift cards on this year's purchases: with a cost entered, and without one.
  const giftCards = { costed: ZERO, cost: ZERO, uncosted: ZERO, uncostedCount: 0 };
  let appRevenue = ZERO; let appCost = ZERO; let appCashback = ZERO; let directCogs = ZERO;
  const byPlatform = new Map();
  const issues = { oversold: [], soldBeforePurchase: [], restoredOnRealized: 0 };
  const cutoff = [];
  let saleCount = 0;
  let earliestPurchaseYear = null;

  for (const b of batches) {
    if (earliestPurchaseYear === null || b.purchaseYear < earliestPurchaseYear) earliestPurchaseYear = b.purchaseYear;
    if (b.purchaseYear === year) {
      purchases = purchases.plus(b.taxCost);
      cashbackOnPurchases = cashbackOnPurchases.plus(b.cashback);
      if (b.giftCardCost) { giftCards.costed = giftCards.costed.plus(b.giftCardAmount); giftCards.cost = giftCards.cost.plus(b.giftCardCost); }
      else if (b.hasGiftCard) { giftCards.uncosted = giftCards.uncosted.plus(b.giftCardAmount); giftCards.uncostedCount++; }
    }
    beginning = beginning.plus(b.unit.times(heldAtYearEnd(b, year - 1)));
    ending = ending.plus(b.unit.times(heldAtYearEnd(b, year)));
    const outEver = b.sales.reduce((n, s) => n + unitsOut(s), 0);
    if (b.kept > 0 && outEver > b.kept) issues.oversold.push({ inventory_id: b.inv.id, product_name: b.inv.product_name });

    for (const sale of b.sales) {
      if (yearOf(sale.sale_date) !== year) continue;
      saleCount++;
      const price = decimal(sale.unit_price || 0).times(num(sale.quantity));
      gross = gross.plus(price);
      salesTaxCollected = salesTaxCollected.plus(decimal(sale.sale_tax_collected || 0));
      const platform = sale.platform?.name || 'No platform';
      byPlatform.set(platform, (byPlatform.get(platform) || { total: ZERO, count: 0 }));
      const row = byPlatform.get(platform);
      row.total = row.total.plus(price); row.count++;
      directCogs = directCogs.plus(b.unit.times(unitsOut(sale)));
      // What the rest of the app counts for this sale (Dashboard / Analytics),
      // which uses today's card rate rather than the purchase-date rate.
      const econ = saleEconomics(b.inv, sale);
      appRevenue = appRevenue.plus(econ.revenue).plus(decimal(sale.commission_fee || 0)).plus(decimal(sale.sale_shipping || 0));
      appCost = appCost.plus(econ.cost);
      appCashback = appCashback.plus(econ.cashback);
      if (num(sale.restored_qty) > 0) issues.restoredOnRealized++;
      if (new Date(sale.sale_date) < new Date(b.inv.purchase_date)) issues.soldBeforePurchase.push({ sale_id: sale.id, product_name: b.inv.product_name });
      const d = new Date(sale.sale_date);
      if (d.getUTCMonth() === 11 && d.getUTCDate() >= DEC_CUTOFF_DAY && (!sale.paid_at || yearOf(sale.paid_at) > year)) {
        cutoff.push({ sale_id: sale.id, inventory_id: b.inv.id, product_name: b.inv.product_name, sale_date: new Date(sale.sale_date).toISOString().slice(0, 10), paid_at: sale.paid_at ? new Date(sale.paid_at).toISOString().slice(0, 10) : null, amount: money(price) });
      }
    }
  }

  const returns = decimal(worksheet?.returns_and_allowances?.total || 0);
  const netReceipts = gross.minus(returns);
  const cogs = beginning.plus(purchases).minus(ending);
  const grossProfit = netReceipts.minus(cogs);
  const otherIncome = ZERO;
  const grossIncome = grossProfit.plus(otherIncome);
  const expenses = decimal(worksheet?.total || 0);
  const netProfit = grossIncome.minus(expenses);

  // Reconciliation: the app's profit on this year's sales, after all expenses
  // dated this year, versus line 31. Each line is one reason they differ.
  const salesFees = decimal(worksheet?.automatic?.total || 0);
  const appSalesProfit = appRevenue.minus(salesFees).minus(appCost).plus(appCashback);
  const appExpenses = expensesInYear.reduce((s, e) => s.plus(decimal(e.amount_decimal ?? e.amount ?? 0)), ZERO);
  const appProfitAfterExpenses = appSalesProfit.minus(appExpenses);
  const refundTiming = appRevenue.minus(netReceipts); // app nets each sale's refunds; tax counts refunds when paid
  const inventoryTiming = cogs.minus(appCost.minus(appCashback));
  const expenseDifference = expenses.minus(salesFees).minus(appExpenses);

  const lines = [
    { line: '1', label: 'Gross receipts or sales', amount: money(gross) },
    { line: '2', label: 'Returns and allowances', amount: money(returns) },
    { line: '3', label: 'Subtract line 2 from line 1', amount: money(netReceipts) },
    { line: '4', label: 'Cost of goods sold (line 42)', amount: money(cogs) },
    { line: '5', label: 'Gross profit', amount: money(grossProfit) },
    { line: '6', label: 'Other income', amount: money(otherIncome) },
    { line: '7', label: 'Gross income', amount: money(grossIncome) },
    { line: '28', label: 'Total expenses (Part II)', amount: money(expenses) },
    { line: '29', label: 'Tentative profit or (loss)', amount: money(netProfit) },
    { line: '30', label: 'Business use of home', amount: '0.00' },
    { line: '31', label: 'Net profit or (loss)', amount: money(netProfit) },
  ];
  const partIII = [
    { line: '33', label: 'Method used to value closing inventory', value: 'Cost' },
    { line: '35', label: 'Inventory at beginning of year', amount: money(beginning) },
    { line: '36', label: 'Purchases less cost of items withdrawn for personal use', amount: money(purchases) },
    { line: '37', label: 'Cost of labor', amount: '0.00' },
    { line: '38', label: 'Materials and supplies', amount: '0.00' },
    { line: '39', label: 'Other costs', amount: '0.00' },
    { line: '40', label: 'Add lines 35 through 39', amount: money(beginning.plus(purchases)) },
    { line: '41', label: 'Inventory at end of year', amount: money(ending) },
    { line: '42', label: 'Cost of goods sold', amount: money(cogs) },
  ];

  const notes = [];
  if (earliestPurchaseYear === null || earliestPurchaseYear >= year) {
    notes.push(`Beginning inventory is $${money(beginning)} because ProfitTracker has no purchases from before ${year}. If you had stock before you started tracking, your beginning inventory is higher.`);
  }
  if (giftCards.costed.greaterThan(0)) notes.push(`Gift cards paid $${money(giftCards.costed)} of this year's purchases. They cost you $${money(giftCards.cost)}, and that is what counts in your inventory cost.`);
  if (giftCards.uncostedCount > 0) notes.push(`${giftCards.uncostedCount} ${giftCards.uncostedCount === 1 ? 'purchase was' : 'purchases were'} paid partly with gift cards ($${money(giftCards.uncosted)}) with no gift card cost entered, so those gift cards count as free. If you bought them, add what they cost you on the purchase so your inventory cost is right.`);
  if (salesTaxCollected.greaterThan(0)) notes.push(`Sales tax you recorded collecting ($${money(salesTaxCollected)}) is not in gross receipts. If you collected and paid it to the state yourself, you may instead include it in gross receipts and deduct it as a tax on line 23; the result is the same.`);
  if (cashbackOnPurchases.greaterThan(0)) notes.push(`Card rewards on this year's purchases ($${money(cashbackOnPurchases)}) lower your inventory cost instead of counting as income, so they are not taxed twice.`);
  const pending = (worksheet?.rows || []).filter((r) => r.status === 'pending');
  if (pending.length) notes.push(`${pending.length} ${pending.length === 1 ? 'expense is' : 'expenses are'} waiting for review and not included in Part II yet.`);

  return {
    year,
    basis: 'Cash method; inventory at cost (specific identification); sales counted on the sale date.',
    lines,
    partIII,
    netProfit: money(netProfit),
    sales: { count: saleCount, byPlatform: [...byPlatform].map(([platform, v]) => ({ platform, gross: money(v.total), count: v.count })).sort((a, b) => Number(b.gross) - Number(a.gross)) },
    reconciliation: {
      appProfitOnSales: money(appSalesProfit),
      appExpenses: money(appExpenses),
      appProfitAfterExpenses: money(appProfitAfterExpenses),
      differences: [
        { key: 'refund_timing', label: 'Refunds counted in the year they were paid, not against the sale', amount: money(refundTiming.negated()) },
        { key: 'inventory_cost', label: 'Cost of goods sold from beginning and ending inventory', amount: money(inventoryTiming.negated()) },
        { key: 'expenses', label: 'Expenses only count once reviewed and paid this year', amount: money(expenseDifference.negated()) },
      ],
      scheduleCNetProfit: money(netProfit),
    },
    checks: {
      directCostOfUnitsSold: money(directCogs),
      oversold: issues.oversold,
      soldBeforePurchase: issues.soldBeforePurchase,
      salesWithRestoredUnits: issues.restoredOnRealized,
    },
    yearEndCutoff: { from: `${year}-12-${DEC_CUTOFF_DAY}`, sales: cutoff, total: money(cutoff.reduce((s, c) => s.plus(c.amount), ZERO)) },
    notes,
  };
}

module.exports = { scheduleCBooks, heldAtYearEnd, unitsOut };
