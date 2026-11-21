const router = require('express').Router();
const prisma = require('../prisma');
const { expenseWorksheet } = require('../services/scheduleC');
const { withExactList, MAPPINGS } = require('../services/decimalRead');
const { derivedExpenseLines } = require('../services/derivedExpenses');
const { scheduleCBooks } = require('../services/scheduleCBooks');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    if (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || Number(req.query.year) < 1900) return res.status(400).json({ error: 'Choose a four-digit tax year from 1900 to 9999' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { schedule_c_enabled: true } });
    if (!user?.schedule_c_enabled) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const [expenses, inventories, saleRefunds] = await Promise.all([
      prisma.expense.findMany({ where: { user_id: req.user.id } }),
      // Same source the Expenses tab's computed lines use, so the two never disagree.
      prisma.inventory.findMany({
        where: { user_id: req.user.id },
        include: {
          sales: { include: { platform: { select: { name: true } }, sale_shipping_payment_method: { select: { id: true, name: true, type: true } } } },
          payment_method: { select: { id: true, name: true, type: true, default_cashback_rate: true, default_cashback_rate_decimal: true, category_rates: true } },
          vendor: { select: { name: true } },
        },
      }),
      prisma.refund.findMany({ where: { user_id: req.user.id, sale_id: { not: null } }, include: { sale: true } }),
    ]);
    const year = Number(req.query.year);
    const exactExpenses = withExactList(expenses, MAPPINGS.expense);
    const worksheet = await expenseWorksheet(exactExpenses, year, derivedExpenseLines(inventories), saleRefunds);
    const expensesInYear = exactExpenses.filter((e) => new Date(e.date).getUTCFullYear() === year);
    res.json({ ...worksheet, books: scheduleCBooks({ inventories, year, worksheet, expensesInYear }) });
  } catch (error) { next(error); }
});
module.exports = router;
