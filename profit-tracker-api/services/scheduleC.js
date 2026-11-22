const contract = import('../../shared/scheduleC.mjs');
const { isRealizedSale } = require('./decimalFinance');
// Round-trips through cents to avoid binary float drift (e.g. 0.1 + 0.2).
const toCents = (value) => Math.round(Number(value) * 100);
const money = (cents) => (cents / 100).toFixed(2);
const dateOnly = (value) => new Date(value).toISOString().slice(0, 10);
const yearOf = (value) => new Date(value).getUTCFullYear();
const DAY_MS = 24 * 60 * 60 * 1000;
// Sale costs computed by services/derivedExpenses.js go straight onto their
// Part II line: they come from the sale record itself, so there is nothing for
// the user to review. Purchase tax, inbound shipping, purchase fees and gift
// cards are part of what the inventory cost (Part III), so they never appear in
// Part II -- deducting them here too would count the same dollar twice.
const SALE_LINE_CATEGORIES = { SHIPPING_LABEL: 'POSTAGE', SALE_PLATFORM_FEE: 'FEES' };
// A manual expense this close in amount and date to a sale cost is probably the
// same label or fee entered twice. Flagged, never removed automatically.
const DUPLICATE_WINDOW_DAYS = 7;

// Two manual expenses that are probably the same charge entered twice: the
// same amount within a day of each other, with matching names (one contains
// the other). Two imported statement lines with different transaction ids are
// different charges, so they never match. The later one is flagged, pointing
// at the earlier; nothing is removed automatically.
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function flagDuplicateExpenses(rows) {
  const manual = rows.filter(r => r.source === 'manual' && r.status !== 'excluded')
    .map(r => ({ r, cents: toCents(r.amount), time: new Date(r.tax_details?.paid_date || r.date).getTime(), name: normName(r.name) }))
    .sort((a, b) => a.time - b.time || String(a.r.id).localeCompare(String(b.r.id)));
  for (let j = 0; j < manual.length; j++) {
    const later = manual[j];
    if (later.r.possible_duplicate_of || later.name.length < 3) continue;
    for (let i = j - 1; i >= 0; i--) {
      const earlier = manual[i];
      if (later.time - earlier.time > DAY_MS) break;
      if (earlier.cents !== later.cents || earlier.name.length < 3) continue;
      if (!(earlier.name.includes(later.name) || later.name.includes(earlier.name))) continue;
      if (earlier.r.external_id && later.r.external_id && earlier.r.external_id !== later.r.external_id) continue;
      later.r.possible_duplicate_of = earlier.r.name;
      later.r.possible_duplicate_source = 'expense';
      later.r.possible_duplicate_id = earlier.r.id;
      break;
    }
  }
}

async function expenseWorksheet(expenses, year, derivedLines = [], saleRefunds = []) {
  const { taxCategories, taxReviewIssues, suggestTaxDetails } = await contract;
  const groups = taxCategories.map(category => ({ ...category, total: '0.00', count: 0 }));
  const groupCents = Object.fromEntries(groups.map(group => [group.id, 0]));
  const saleLines = derivedLines.filter(line => line.source === 'sale' && SALE_LINE_CATEGORIES[line.category]);
  const rows = [];
  for (const expense of expenses) {
    const tax = expense.tax_details || {};
    // Unknown payment dates stay visible in every year until assigned explicitly.
    if (tax.paid_date && Number(tax.paid_date.slice(0, 4)) !== year) continue;
    if (tax.payment_status === 'unpaid' && new Date(expense.date).getUTCFullYear() !== year) continue;
    const issues = taxReviewIssues(tax);
    const excluded = tax.business_use === 'personal' || tax.payment_status === 'unpaid';
    if (!excluded && !tax.reviewed) issues.push('Confirm tax treatment and mark reviewed');
    const status = excluded ? 'excluded' : issues.length ? 'pending' : 'reviewed';
    const amountCents = toCents(expense.amount);
    const amount = money(amountCents);
    const eligibleCents = status === 'reviewed' ? Math.round(amountCents * (tax.business_use === 'mixed' ? Number(tax.business_percent) : 100) / 100) : 0;
    const eligible = money(eligibleCents);
    if (status === 'reviewed') {
      const group = groups.find(category => category.id === tax.tax_category);
      groupCents[group.id] += eligibleCents; group.count++;
    }
    const expenseTime = new Date(tax.paid_date || expense.date).getTime();
    const duplicate = excluded ? null : saleLines.find(line => toCents(line.amount) === amountCents
      && Math.abs(new Date(line.date).getTime() - expenseTime) <= DUPLICATE_WINDOW_DAYS * DAY_MS);
    // Waiting for review: what the review form can prefill (blank fields only).
    const suggestion = status === 'pending' ? suggestTaxDetails(expense, { paymentMethodName: expense.payment_method?.name || null }) : null;
    const { payment_method: paymentMethod, ...plain } = expense;
    rows.push({ ...plain, payment_method_name: paymentMethod?.name || null, source: 'manual', amount, tax_details: tax, status, eligible, issues: excluded ? [] : issues,
      documentation_missing: !expense.receipt_url, suggestion,
      possible_duplicate_of: duplicate ? duplicate.name : null, possible_duplicate_source: duplicate ? 'sale' : null, possible_duplicate_id: null });
  }

  flagDuplicateExpenses(rows);

  let automaticCents = 0;
  let automaticCount = 0;
  for (const line of saleLines) {
    if (yearOf(line.date) !== year) continue;
    const categoryId = SALE_LINE_CATEGORIES[line.category];
    const cents = toCents(line.amount);
    groupCents[categoryId] += cents;
    groups.find(group => group.id === categoryId).count++;
    automaticCents += cents;
    automaticCount++;
    const isLabel = line.category === 'SHIPPING_LABEL';
    rows.push({
      id: line.id, source: 'sale', name: line.name, inventory_id: line.inventory_id, sale_id: line.sale_id,
      amount: money(cents), eligible: money(cents), status: 'automatic', issues: [],
      // The sale record is the supporting document; there is no separate receipt to attach.
      documentation_missing: false, receipt_url: null, possible_duplicate_of: null,
      tax_details: {
        business_use: 'business', business_percent: '100', tax_category: categoryId, payment_status: 'paid', reviewed: true,
        payee: isLabel ? (line.payment_method?.name ? `Shipping label (${line.payment_method.name})` : 'Shipping label (from payout)') : (line.platform_name || 'Selling platform'),
        purpose: `${isLabel ? 'Shipping label' : 'Selling fee'} for the sale of ${line.product_name}`,
        paid_date: dateOnly(line.date),
        payment_reference: `Sale record ${line.sale_id}`,
      },
    });
  }

  // Refunds to buyers are returns and allowances (line 2): they lower gross
  // receipts, so they're reported on their own and never join the expense
  // total. Counted in the year the money went back, for sales still realized.
  const returns = saleRefunds.filter(refund => refund.sale && isRealizedSale(refund.sale) && yearOf(refund.date) === year);

  const inventoryCostLines = derivedLines.filter(line => line.source === 'purchase' && yearOf(line.date) === year);
  for (const group of groups) group.total = money(groupCents[group.id]);
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
  const lines = [...new Set(groups.map(group => group.line2025))].map(line => {
    const categories = groups.filter(group => group.line2025 === line);
    return { line, total: money(categories.reduce((sum, group) => sum + groupCents[group.id], 0)), count: categories.reduce((sum, group) => sum + group.count, 0) };
  });
  return { year, mapping_year: 2025, planning: year !== 2025, accounting_basis: 'cash-method paid expenses; user-confirmed tax treatment', groups, lines, rows,
    total: money(Object.values(groupCents).reduce((sum, cents) => sum + cents, 0)),
    automatic: { total: money(automaticCents), count: automaticCount },
    returns_and_allowances: { line: '2', total: money(returns.reduce((sum, refund) => sum + toCents(refund.amount), 0)), count: returns.length },
    // Shown for transparency only: these belong to cost of goods sold (Part III).
    inventory_costs_excluded: { total: money(inventoryCostLines.reduce((sum, line) => sum + toCents(line.amount), 0)), count: inventoryCostLines.length },
    pending: rows.filter(row => row.status === 'pending').length,
    possible_duplicates: rows.filter(row => row.possible_duplicate_of).length,
    possible_duplicates_of_sales: rows.filter(row => row.possible_duplicate_source === 'sale').length,
    possible_duplicates_of_expenses: rows.filter(row => row.possible_duplicate_source === 'expense').length,
    documentation_gaps: rows.filter(row => row.status !== 'excluded' && row.documentation_missing).length };
}
module.exports = { expenseWorksheet, SALE_LINE_CATEGORIES };
