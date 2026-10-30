const contract = import('../../shared/scheduleC.mjs');
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

async function expenseWorksheet(expenses, year, derivedLines = []) {
  const { taxCategories, taxReviewIssues } = await contract;
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
    rows.push({ ...expense, source: 'manual', amount, tax_details: tax, status, eligible, issues: excluded ? [] : issues,
      documentation_missing: !expense.receipt_url, possible_duplicate_of: duplicate ? duplicate.name : null });
  }

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
    // Shown for transparency only: these belong to cost of goods sold (Part III).
    inventory_costs_excluded: { total: money(inventoryCostLines.reduce((sum, line) => sum + toCents(line.amount), 0)), count: inventoryCostLines.length },
    pending: rows.filter(row => row.status === 'pending').length,
    possible_duplicates: rows.filter(row => row.possible_duplicate_of).length,
    documentation_gaps: rows.filter(row => row.status !== 'excluded' && row.documentation_missing).length };
}
module.exports = { expenseWorksheet, SALE_LINE_CATEGORIES };
