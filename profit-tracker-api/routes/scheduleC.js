const router = require('express').Router();
const prisma = require('../prisma');
const { expenseWorksheet } = require('../services/scheduleC');
const { withExactList, MAPPINGS } = require('../services/decimalRead');
const { derivedExpenseLines } = require('../services/derivedExpenses');
const { scheduleCBooks, untrackedInventory } = require('../services/scheduleCBooks');
const { validateBody } = require('../middleware/validate');
const { taxYearSettingBody } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const validYear = (value) => typeof value === 'string' && /^\d{4}$/.test(value) && Number(value) >= 1900;
const YEAR_ERROR = 'Choose a four-digit tax year from 1900 to 9999';
const scheduleCEnabled = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { schedule_c_enabled: true } });
  return Boolean(user?.schedule_c_enabled);
};

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    if (!validYear(req.query.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const year = Number(req.query.year);
    const [expenses, inventories, saleRefunds, settings] = await Promise.all([
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
      prisma.taxYearSetting.findMany({ where: { user_id: req.user.id, year: { lte: year } } }),
    ]);
    const exactExpenses = withExactList(expenses, MAPPINGS.expense);
    const worksheet = await expenseWorksheet(exactExpenses, year, derivedExpenseLines(inventories), saleRefunds);
    const expensesInYear = exactExpenses.filter((e) => new Date(e.date).getUTCFullYear() === year);
    const untracked = untrackedInventory(settings, year);
    res.json({ ...worksheet, books: scheduleCBooks({ inventories, year, worksheet, expensesInYear, untracked }) });
  } catch (error) { next(error); }
});

// Save one tax year's settings. Today that is the cost of stock on hand on
// December 31 that isn't entered as purchases; null clears it (the earlier
// year's amount then carries forward).
router.put('/years/:year', isAuthenticated, validateBody(taxYearSettingBody), async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const year = Number(req.params.year);
    const data = { untracked_inventory_end: req.body.untracked_inventory_end ?? null };
    const saved = await prisma.taxYearSetting.upsert({
      where: { user_id_year: { user_id: req.user.id, year } },
      create: { user_id: req.user.id, year, ...data },
      update: data,
    });
    res.json({ year: saved.year, untracked_inventory_end: saved.untracked_inventory_end === null ? null : String(saved.untracked_inventory_end) });
  } catch (error) { next(error); }
});
module.exports = router;
