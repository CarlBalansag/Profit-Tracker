const router = require('express').Router();
const prisma = require('../prisma');
const { expenseWorksheet } = require('../services/scheduleC');
router.use((req, res, next) => req.isAuthenticated() ? next() : res.status(401).json({ message: 'Unauthorized' }));
router.get('/', async (req, res, next) => {
  try {
    if (typeof req.query.year !== 'string' || !/^\d{4}$/.test(req.query.year) || Number(req.query.year) < 1900) return res.status(400).json({ error: 'Choose a four-digit tax year from 1900 to 9999' });
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { schedule_c_enabled: true } });
    if (!user?.schedule_c_enabled) return res.status(403).json({ error: 'Enable Schedule C in Settings first' });
    const expenses = await prisma.expense.findMany({ where: { user_id: req.user.id } });
    res.json(await expenseWorksheet(expenses, Number(req.query.year)));
  } catch (error) { next(error); }
});
module.exports = router;
