const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { goal, updateGoal } = require('../validation/schemas');
const { parseAmount } = require('../services/money');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// A target's precision rule depends on the goal's metric, which an update
// may not include (it can inherit the existing record's metric) -- so this
// can't be expressed as a Zod schema alone; it runs after the effective
// metric is known. Money-metric targets are direct user input (strict,
// reject over-precision); unitsSold targets are counts (reject non-integers).
function validateGoalTargets(metric, targets) {
  const isCount = metric === 'unitsSold';
  const validated = {};
  for (const [key, value] of Object.entries(targets)) {
    if (value === undefined) continue;
    if (value === null) { validated[key] = null; continue; }
    if (isCount) {
      if (!Number.isInteger(value)) {
        throw Object.assign(new Error(`${key} must be a whole number of units.`), { status: 400 });
      }
      validated[key] = value;
    } else {
      try {
        validated[key] = parseAmount(value, 2).toNumber();
      } catch (err) {
        throw Object.assign(new Error(`${key}: ${err.message}`), { status: 400 });
      }
    }
  }
  return validated;
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
    const targets = validateGoalTargets(metric, { target_7d, target_30d, target_ytd });

    const goal = await prisma.goal.create({
      data: {
        user_id:    req.user.id,
        metric,
        target_7d:  targets.target_7d,
        target_30d: targets.target_30d,
        target_ytd: targets.target_ytd,
        active:     active ?? true,
      },
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
    const effectiveMetric = metric !== undefined ? metric : existing.metric;
    const targets = validateGoalTargets(effectiveMetric, { target_7d, target_30d, target_ytd });

    const updated = await prisma.goal.update({
      where: { id: req.params.id },
      data: {
        ...(metric                    !== undefined && { metric }),
        ...(targets.target_7d         !== undefined && { target_7d: targets.target_7d }),
        ...(targets.target_30d        !== undefined && { target_30d: targets.target_30d }),
        ...(targets.target_ytd        !== undefined && { target_ytd: targets.target_ytd }),
        ...(active                    !== undefined && { active }),
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
