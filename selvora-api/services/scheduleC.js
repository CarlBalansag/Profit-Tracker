const contract = import('../../shared/scheduleC.mjs');
// Round-trips through cents to avoid binary float drift (e.g. 0.1 + 0.2).
const toCents = (value) => Math.round(Number(value) * 100);
const money = (cents) => (cents / 100).toFixed(2);
async function expenseWorksheet(expenses, year) {
  const { taxCategories, taxReviewIssues } = await contract;
  const groups = taxCategories.map(category => ({ ...category, total: '0.00', count: 0 }));
  const groupCents = Object.fromEntries(groups.map(group => [group.id, 0]));
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
    rows.push({ ...expense, amount, tax_details: tax, status, eligible, issues: excluded ? [] : issues, documentation_missing: !expense.receipt_url });
  }
  for (const group of groups) group.total = money(groupCents[group.id]);
  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)) || a.id.localeCompare(b.id));
  const lines = [...new Set(groups.map(group => group.line2025))].map(line => {
    const categories = groups.filter(group => group.line2025 === line);
    return { line, total: money(categories.reduce((sum, group) => sum + groupCents[group.id], 0)), count: categories.reduce((sum, group) => sum + group.count, 0) };
  });
  return { year, mapping_year: 2025, planning: year !== 2025, accounting_basis: 'cash-method paid expenses; user-confirmed tax treatment', groups, lines, rows,
    total: money(Object.values(groupCents).reduce((sum, cents) => sum + cents, 0)),
    pending: rows.filter(row => row.status === 'pending').length,
    documentation_gaps: rows.filter(row => row.status !== 'excluded' && row.documentation_missing).length };
}
module.exports = { expenseWorksheet };
