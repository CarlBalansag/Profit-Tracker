const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// GET all expenses for current user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { user_id: req.user.id },
      orderBy: { date: 'desc' },
    });
    res.json(expenses);
  } catch (err) {
    next(err);
  }
});

// POST new expense
router.post('/', isAuthenticated, async (req, res, next) => {
  try {
    const { name, amount, category, date, notes, receipt_url } = req.body;
    if (!name || !amount || !date) {
      return res.status(400).json({ error: 'name, amount, and date are required' });
    }
    const expense = await prisma.expense.create({
      data: {
        user_id: req.user.id,
        name,
        amount: parseFloat(amount),
        category: category || null,
        date: parseLocalDate(date),
        notes: notes || null,
        receipt_url: receipt_url || null,
      },
    });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

// PUT update expense
router.put('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { name, amount, category, date, notes, receipt_url } = req.body;
    const data = {};
    if (name !== undefined)        data.name = name;
    if (amount !== undefined)      data.amount = parseFloat(amount);
    if (category !== undefined)    data.category = category || null;
    if (date !== undefined)        data.date = parseLocalDate(date);
    if (notes !== undefined)       data.notes = notes || null;
    if (receipt_url !== undefined) data.receipt_url = receipt_url || null;

    const updated = await prisma.expense.update({ where: { id: req.params.id }, data });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE expense
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
