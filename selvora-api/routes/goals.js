const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const VALID_METRICS = ['netProfit', 'totalRevenue', 'unitsSold'];

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

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
router.post('/', isAuthenticated, async (req, res, next) => {
  try {
    const { metric, target_7d, target_30d, target_ytd, active } = req.body;

    if (!metric || !VALID_METRICS.includes(metric)) {
      return res.status(400).json({ error: `metric must be one of: ${VALID_METRICS.join(', ')}` });
    }

    const goal = await prisma.goal.create({
      data: {
        user_id:    req.user.id,
        metric,
        target_7d:  target_7d  != null ? parseFloat(target_7d)  : null,
        target_30d: target_30d != null ? parseFloat(target_30d) : null,
        target_ytd: target_ytd != null ? parseFloat(target_ytd) : null,
        active:     active !== undefined ? Boolean(active) : true,
      },
    });
    res.json(goal);
  } catch (err) {
    next(err);
  }
});

// PUT update a goal
router.put('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.goal.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { metric, target_7d, target_30d, target_ytd, active } = req.body;

    if (metric !== undefined && !VALID_METRICS.includes(metric)) {
      return res.status(400).json({ error: `metric must be one of: ${VALID_METRICS.join(', ')}` });
    }

    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        ...(metric     !== undefined && { metric }),
        ...(target_7d  !== undefined && { target_7d:  target_7d  != null ? parseFloat(target_7d)  : null }),
        ...(target_30d !== undefined && { target_30d: target_30d != null ? parseFloat(target_30d) : null }),
        ...(target_ytd !== undefined && { target_ytd: target_ytd != null ? parseFloat(target_ytd) : null }),
        ...(active     !== undefined && { active: Boolean(active) }),
      },
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
