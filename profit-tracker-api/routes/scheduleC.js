const router = require('express').Router();
const prisma = require('../prisma');
const { expenseWorksheet } = require('../services/scheduleC');
const { withExactList, MAPPINGS } = require('../services/decimalRead');
const { derivedExpenseLines } = require('../services/derivedExpenses');
const { scheduleCBooks, untrackedInventory } = require('../services/scheduleCBooks');
const { profitEvents, forecastInputs } = require('../services/taxForecast');
const { validateBody } = require('../middleware/validate');
const { taxYearSettingBody, createForm1099K, updateForm1099K } = require('../validation/schemas');
const { requireOwned } = require('../services/ownership');

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
    const [expenses, inventories, saleRefunds, settings, forms1099K, platforms] = await Promise.all([
      prisma.expense.findMany({ where: { user_id: req.user.id } }),
      // Same source the Expenses tab's computed lines use, so the two never disagree.
      prisma.inventory.findMany({
        where: { user_id: req.user.id },
        include: {
          sales: { include: { platform: { select: { id: true, name: true } }, sale_shipping_payment_method: { select: { id: true, name: true, type: true } } } },
          payment_method: { select: { id: true, name: true, type: true, default_cashback_rate: true, default_cashback_rate_decimal: true, category_rates: true } },
          vendor: { select: { name: true } },
        },
      }),
      prisma.refund.findMany({ where: { user_id: req.user.id, sale_id: { not: null } }, include: { sale: true } }),
      prisma.taxYearSetting.findMany({ where: { user_id: req.user.id, year: { lte: year } } }),
      prisma.taxForm1099K.findMany({ where: { user_id: req.user.id, year }, orderBy: { created_at: 'asc' } }),
      // Where 1099-K forms come from: the places the user sells or cashes out.
      prisma.platform.findMany({ where: { user_id: req.user.id, type: { in: ['Marketplace', 'Cashout'] } }, select: { id: true, name: true, type: true }, orderBy: { name: 'asc' } }),
    ]);
    const exactExpenses = withExactList(expenses, MAPPINGS.expense);
    const worksheet = await expenseWorksheet(exactExpenses, year, derivedExpenseLines(inventories), saleRefunds);
    const expensesInYear = exactExpenses.filter((e) => new Date(e.date).getUTCFullYear() === year);
    const untracked = untrackedInventory(settings, year);
    const books = scheduleCBooks({ inventories, year, worksheet, expensesInYear, untracked, forms1099K, platforms });
    // Projection inputs: this year's dated profit and last year's pattern.
    const derived = derivedExpenseLines(inventories);
    const priorWorksheet = await expenseWorksheet(exactExpenses, year - 1, derived, saleRefunds);
    const priorEvents = profitEvents({ inventories, year: year - 1, worksheet: priorWorksheet });
    const priorBooks = priorEvents.length ? scheduleCBooks({ inventories, year: year - 1, worksheet: priorWorksheet, untracked: untrackedInventory(settings, year - 1) }) : null;
    books.forecast = forecastInputs({
      year, today: new Date(), events: profitEvents({ inventories, year, worksheet }),
      priorEvents, priorNetProfit: priorBooks ? priorBooks.netProfit : null,
    });
    res.json({ ...worksheet, books });
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
// Form 1099-K amounts for a tax year, to compare with sales by platform.
const form1099KResponse = (form) => ({
  id: form.id, year: form.year, payer_name: form.payer_name, platform_id: form.platform_id,
  gross_amount: String(form.gross_amount), transaction_count: form.transaction_count,
});
const ownedForm = async (id, userId) => {
  const form = await prisma.taxForm1099K.findFirst({ where: { id, user_id: userId } });
  if (!form) throw Object.assign(new Error('1099-K not found'), { status: 404 });
  return form;
};

router.post('/years/:year/1099-k', isAuthenticated, validateBody(createForm1099K), async (req, res, next) => {
  try {
    if (!validYear(req.params.year)) return res.status(400).json({ error: YEAR_ERROR });
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    await requireOwned('platform', req.body.platform_id, req.user.id, 'Platform');
    const form = await prisma.taxForm1099K.create({ data: {
      user_id: req.user.id, year: Number(req.params.year), payer_name: req.body.payer_name,
      platform_id: req.body.platform_id || null, gross_amount: req.body.gross_amount, transaction_count: req.body.transaction_count ?? null,
    } });
    res.status(201).json(form1099KResponse(form));
  } catch (error) { next(error); }
});

router.put('/1099-k/:id', isAuthenticated, validateBody(updateForm1099K), async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    await ownedForm(req.params.id, req.user.id);
    await requireOwned('platform', req.body.platform_id, req.user.id, 'Platform');
    const data = {};
    for (const key of ['payer_name', 'platform_id', 'gross_amount', 'transaction_count']) if (req.body[key] !== undefined) data[key] = req.body[key];
    const result = await prisma.taxForm1099K.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data });
    if (result.count !== 1) return res.status(404).json({ error: '1099-K not found' });
    res.json(form1099KResponse(await ownedForm(req.params.id, req.user.id)));
  } catch (error) { next(error); }
});

router.delete('/1099-k/:id', isAuthenticated, async (req, res, next) => {
  try {
    if (!await scheduleCEnabled(req.user.id)) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const result = await prisma.taxForm1099K.deleteMany({ where: { id: req.params.id, user_id: req.user.id } });
    if (result.count !== 1) return res.status(404).json({ error: '1099-K not found' });
    res.json({ deleted: true });
  } catch (error) { next(error); }
});

module.exports = router;
