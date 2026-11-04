// Refunds API for the app; the rules live in services/refunds.js.
const express = require('express');
const router = express.Router();
const { validateBody } = require('../middleware/validate');
const { createRefund } = require('../validation/schemas');
const { listRefunds, recordRefund, removeRefund } = require('../services/refunds');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/refunds?inventory_id=... or ?sale_id=... -- newest first.
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await listRefunds(req.user.id, req.query));
  } catch (err) {
    next(err);
  }
});

// POST /api/refunds
router.post('/', isAuthenticated, validateBody(createRefund), async (req, res, next) => {
  try {
    res.json(await recordRefund(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/refunds/:id
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    await removeRefund(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
