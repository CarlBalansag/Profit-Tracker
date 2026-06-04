const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { paymentMethod } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Parse category_rates JSON stored in DB and attach as array
const parseRates = (method) => ({
  ...method,
  category_rates: method.category_rates ? JSON.parse(method.category_rates) : []
});

// GET all payment methods for the authenticated user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { user_id: req.user.id }
    });
    res.json(methods.map(parseRates));
  } catch (err) {
    next(err);
  }
});

// POST new payment method
router.post('/', isAuthenticated, validateBody(paymentMethod), async (req, res, next) => {
  try {
    const { name, type, default_cashback_rate, preset_card_id, category_rates,
            statement_close_day, due_day, credit_limit, min_payment_pct } = req.body;
    const method = await prisma.paymentMethod.create({
      data: {
        user_id: req.user.id,
        name,
        type,
        default_cashback_rate: parseFloat(default_cashback_rate) || 0,
        preset_card_id: preset_card_id || null,
        category_rates: category_rates ? JSON.stringify(category_rates) : null,
        statement_close_day: statement_close_day ? parseInt(statement_close_day) : null,
        due_day: due_day ? parseInt(due_day) : null,
        credit_limit: credit_limit ? parseFloat(credit_limit) : null,
        min_payment_pct: min_payment_pct ? parseFloat(min_payment_pct) : null,
      }
    });
    res.json(parseRates(method));
  } catch (err) {
    next(err);
  }
});

// UPDATE payment method
router.put('/:id', isAuthenticated, validateBody(paymentMethod), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, default_cashback_rate, preset_card_id, category_rates,
            statement_close_day, due_day, credit_limit, min_payment_pct } = req.body;

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const updated = await prisma.paymentMethod.update({
      where: { id },
      data: {
        name,
        type,
        default_cashback_rate: parseFloat(default_cashback_rate) || 0,
        preset_card_id: preset_card_id ?? existing.preset_card_id,
        category_rates: category_rates !== undefined
          ? JSON.stringify(category_rates)
          : existing.category_rates,
        statement_close_day: statement_close_day !== undefined ? (statement_close_day ? parseInt(statement_close_day) : null) : existing.statement_close_day,
        due_day: due_day !== undefined ? (due_day ? parseInt(due_day) : null) : existing.due_day,
        credit_limit: credit_limit !== undefined ? (credit_limit ? parseFloat(credit_limit) : null) : existing.credit_limit,
        min_payment_pct: min_payment_pct !== undefined ? (min_payment_pct ? parseFloat(min_payment_pct) : null) : existing.min_payment_pct,
      }
    });
    res.json(parseRates(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE payment method
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.paymentMethod.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
