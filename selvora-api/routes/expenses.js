const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { currencyWrite } = require('../services/currencyWrite');
const { validateBody } = require('../middleware/validate');
const { createExpense, updateExpense } = require('../validation/schemas');

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
router.post('/', isAuthenticated, validateBody(createExpense), async (req, res, next) => {
  try {
    const { name, amount, category, date, notes, receipt_url, tax_details } = req.body;
    if (!name || amount === undefined || !date) {
      return res.status(400).json({ error: 'name, amount, and date are required' });
    }
    const expense = await prisma.expense.create({
      data: currencyWrite('Expense', {
        user_id: req.user.id,
        name,
        amount: parseFloat(amount),
        category: category || null,
        date: parseLocalDate(date),
        notes: notes || null,
        receipt_url: receipt_url || null,
        ...(tax_details !== undefined ? { tax_details } : {}),
      })
    });
    res.json(expense);
  } catch (err) {
    next(err);
  }
});

// PUT update expense
router.put('/:id', isAuthenticated, validateBody(updateExpense), async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { name, amount, category, date, notes, receipt_url, tax_details } = req.body;
    const data = {};
    if (tax_details?.reviewed && req.body.expected_tax_version === undefined) return res.status(400).json({ error: 'Reload the expense and provide its expected_tax_version before marking reviewed' });
    if (tax_details !== undefined) data.tax_details = tax_details;
    else if (existing.tax_details?.reviewed && ['amount', 'date', 'name', 'category'].some(key => req.body[key] !== undefined)) data.tax_details = { ...existing.tax_details, reviewed: false };
    if (name !== undefined)        data.name = name;
    if (amount !== undefined)      data.amount = parseFloat(amount);
    if (category !== undefined)    data.category = category || null;
    if (date !== undefined)        data.date = parseLocalDate(date);
    if (notes !== undefined)       data.notes = notes || null;
    if (receipt_url !== undefined) data.receipt_url = receipt_url || null;

    const updated = await prisma.$transaction(async tx => {
      const claimed = await tx.expense.updateMany({
        where: { id: req.params.id, user_id: req.user.id, tax_version: req.body.expected_tax_version ?? existing.tax_version ?? 0 },
        data: { ...currencyWrite('Expense', data), tax_version: { increment: 1 } },
      });
      if (!claimed.count) throw Object.assign(new Error('Expense changed since it was opened. Reload the worksheet before reviewing again.'), { status: 409 });
      return tx.expense.findUnique({ where: { id: req.params.id } });
    });
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
