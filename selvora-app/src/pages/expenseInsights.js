const toMonthlyAmount = (expense) => {
  if (expense.frequency === 'weekly') return expense.amount * 52 / 12;
  if (expense.frequency === 'biweekly') return expense.amount * 26 / 12;
  return expense.amount;
};

export function getExpenseInsights(expenses, recurring, referenceDate = new Date()) {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const priorMonth = month === 0 ? 11 : month - 1;
  const priorYear = month === 0 ? year - 1 : year;
  const inMonth = (date, targetYear, targetMonth) => {
    const value = new Date(date);
    return value.getFullYear() === targetYear && value.getMonth() === targetMonth;
  };
  const currentExpenses = expenses.filter((expense) => inMonth(expense.date, year, month));
  const currentTotal = currentExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const previousTotal = expenses.filter((expense) => inMonth(expense.date, priorYear, priorMonth))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const categoryTotals = currentExpenses.reduce((totals, expense) => {
    const category = expense.category || 'OTHER';
    totals[category] = (totals[category] || 0) + expense.amount;
    return totals;
  }, {});
  const categories = Object.entries(categoryTotals)
    .map(([category, amount]) => ({ category, amount, share: currentTotal > 0 ? amount / currentTotal : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const recurringMonthly = recurring.filter((expense) => expense.active)
    .reduce((sum, expense) => sum + toMonthlyAmount(expense), 0);
  return { currentTotal, previousTotal, monthChange: previousTotal === 0 ? null : (currentTotal - previousTotal) / previousTotal, categories, largestCategory: categories[0] || null, recurringMonthly };
}
