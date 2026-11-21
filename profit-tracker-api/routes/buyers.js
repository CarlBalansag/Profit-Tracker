const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { buyer, updateBuyer } = require('../validation/schemas');
const activityLog = require('../services/activityLog');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/buyers — only returns buyers belonging to the authenticated user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const buyers = await prisma.buyer.findMany({
      where: { user_id: req.user.id },
      orderBy: { name: 'asc' },
    });
    res.json(buyers);
  } catch (err) {
    next(err);
  }
});

// POST /api/buyers
router.post('/', isAuthenticated, validateBody(buyer), async (req, res, next) => {
  try {
    const { name, avg_days_to_payout } = req.body;
    const { result: created, activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'create', recordType: 'buyer',
    }, () => tx.buyer.create({
      data: {
        user_id: req.user.id,
        name,
        avg_days_to_payout: avg_days_to_payout ?? null,
      },
    })));
    res.json({ ...created, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/buyers/:id (ownership enforced)
router.put('/:id', isAuthenticated, validateBody(updateBuyer), async (req, res, next) => {
  try {
    const existing = await prisma.buyer.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Buyer not found' });
    }
    const { name, avg_days_to_payout } = req.body;
    const { result: updated, activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'edit', recordType: 'buyer', id: req.params.id,
    }, () => tx.buyer.update({
      where: { id: req.params.id },
      data: {
        name: name ?? existing.name,
        avg_days_to_payout: avg_days_to_payout !== undefined ? avg_days_to_payout : existing.avg_days_to_payout,
      },
    })));
    res.json({ ...updated, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/buyers/:id (ownership enforced)
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.buyer.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Buyer not found' });
    }
    // Sales to this buyer lose the link; logged for undo.
    const { activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'delete', recordType: 'buyer', id: req.params.id,
    }, () => tx.buyer.delete({ where: { id: req.params.id } })));
    res.json({ success: true, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
