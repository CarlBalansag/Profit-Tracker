const { decimal } = require('./money');
const contract = import('../../shared/scheduleC.mjs');
async function expenseWorksheet(expenses, year) {
  const { taxCategories, taxReviewIssues } = await contract;
  const groups = taxCategories.map(category => ({ ...category, total: '0.00', count: 0 }));
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
    const amount = decimal(expense.amount_decimal ?? expense.amount).toFixed(2);
    const eligible = status === 'reviewed' ? decimal(amount).times(tax.business_use === 'mixed' ? tax.business_percent : 100).div(100).toDecimalPlaces(2).toFixed(2) : '0.00';
    if (status === 'reviewed') {
      const group = groups.find(category => category.id === tax.tax_category);
      group.total = decimal(group.total).plus(eligible).toFixed(2); group.count++;
    }
    rows.push({ ...expense, amount, tax_details: tax, status, eligible, issues: excluded ? [] : issues, documentation_missing: !expense.receipt_url });
  }
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
  const lines = [...new Set(groups.map(group => group.line2025))].map(line => {
    const categories = groups.filter(group => group.line2025 === line);
    return { line, total: categories.reduce((sum, group) => sum.plus(group.total), decimal(0)).toFixed(2), count: categories.reduce((sum, group) => sum + group.count, 0) };
  });
  return { year, mapping_year: 2025, planning: year !== 2025, accounting_basis: 'cash-method paid expenses; user-confirmed tax treatment', groups, lines, rows,
    total: groups.reduce((sum, group) => sum.plus(group.total), decimal(0)).toFixed(2),
    pending: rows.filter(row => row.status === 'pending').length,
    documentation_gaps: rows.filter(row => row.status !== 'excluded' && row.documentation_missing).length };
}
module.exports = { expenseWorksheet };
