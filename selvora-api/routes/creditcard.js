const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { computeCardDashboard } = require('../services/cardNetToPay');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /dashboard
// Returns credit-card spending breakdown for the current calendar month.
// Only includes inventory purchased with PaymentMethod.type = 'Credit'.
// The actual math lives in services/cardNetToPay.js, shared with the MCP
// server's get_card_net_to_pay tool so the two never disagree.
router.get('/dashboard', isAuthenticated, async (req, res, next) => {
  try {
    const result = await computeCardDashboard(prisma, req.user.id, req.query.month);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
