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

// GET /paid-bills
// The card bills marked paid, here or on the To-Do list, as [{ card_id,
// due_date }]. A bill is the to-do key "card-due:<card id>:<due date>".
router.get('/paid-bills', isAuthenticated, async (req, res, next) => {
  try {
    const states = await prisma.todoState.findMany({
      where: { user_id: req.user.id, state: 'done' },
      select: { key: true },
    });
    const bills = states
      .map(({ key }) => /^card-due:(.+):(\d{4}-\d{2}-\d{2})$/.exec(key))
      .filter(Boolean)
      .map(([, card_id, due_date]) => ({ card_id, due_date }));
    res.json({ bills });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
