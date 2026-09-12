const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { currencyWrite } = require('../services/currencyWrite');
const { validateBody } = require('../middleware/validate');
const { goal, updateGoal } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

function validateTargets(metric, targets) {
  if (metric === 'unitsSold' && Object.entries(targets).some(([key, value]) => key.startsWith('target_') && value != null && !Number.isSafeInteger(value))) {
    const error = new Error('Unit goals require whole numbers.');
    error.status = 400;
    throw error;
  }
}

// GET all goals for current user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const goals = await prisma.goal.findMany({
      where: { user_id: req.user.id },
      orderBy: { created_at: 'asc' },
    });
    res.json(goals);
  } catch (err) {
    next(err);
  }
});

// POST create a goal
router.post('/', isAuthenticated, validateBody(goal), async (req, res, next) => {
  try {
    const { metric, target_7d, target_30d, target_ytd, active } = req.body;
    validateTargets(metric, { target_7d, target_30d, target_ytd });

    const goal = await prisma.goal.create({
      data: currencyWrite('Goal', {
        user_id:    req.user.id,
        metric,
        target_7d,
        target_30d,
        target_ytd,
        active:     active ?? true,
      })
    });
    res.json(goal);
  } catch (err) {
    next(err);
  }
});

// PUT update a goal
router.put('/:id', isAuthenticated, validateBody(updateGoal), async (req, res, next) => {
  try {
    const existing = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { metric, target_7d, target_30d, target_ytd, active } = req.body;
    validateTargets(metric ?? existing.metric, { ...existing, ...req.body });

    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: currencyWrite('Goal', {
        metric: metric ?? existing.metric,
        ...(target_7d  !== undefined && { target_7d }),
        ...(target_30d !== undefined && { target_30d }),
        ...(target_ytd !== undefined && { target_ytd }),
        ...(active     !== undefined && { active }),
      })
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE a goal
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    await prisma.goal.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
