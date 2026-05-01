const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const methods = await prisma.paymentMethod.findMany({
      where: { user_id: req.user.id }
    });
    res.json(methods.map(parseRates));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new payment method
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, type, default_cashback_rate, preset_card_id, category_rates } = req.body;
    const method = await prisma.paymentMethod.create({
      data: {
        user_id: req.user.id,
        name,
        type,
        default_cashback_rate: parseFloat(default_cashback_rate) || 0,
        preset_card_id: preset_card_id || null,
        category_rates: category_rates ? JSON.stringify(category_rates) : null
      }
    });
    res.json(parseRates(method));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// UPDATE payment method
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, type, default_cashback_rate, preset_card_id, category_rates } = req.body;

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
          : existing.category_rates
      }
    });
    res.json(parseRates(updated));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE payment method
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.paymentMethod.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
