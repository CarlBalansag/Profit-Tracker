// Activity log + Undo API; the rules live in services/activityLog.js.
const express = require('express');
const router = express.Router();
const { listActivity, undoActivity } = require('../services/activityLog');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/activity?before=<iso>&limit=50 -- newest first.
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await listActivity(req.user.id, req.query));
  } catch (err) {
    next(err);
  }
});

// POST /api/activity/:id/undo
router.post('/:id/undo', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await undoActivity(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
