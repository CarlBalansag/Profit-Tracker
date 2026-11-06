const express = require('express');
const router = express.Router();
const { validateBody } = require('../middleware/validate');
const { dataReset } = require('../validation/schemas');
const { resetUserData, removeReceiptFiles, finishReset } = require('../services/dataReset');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// POST /api/data-reset -- permanently deletes the signed-in user's data.
// The user always comes from the session; the schema rejects any other field.
router.post('/', isAuthenticated, validateBody(dataReset), async (req, res, next) => {
  try {
    const { scope } = req.body;
    const result = await resetUserData(req.user.id, scope);
    console.log(`[data-reset] user ${req.user.id} reset ${scope}:`, result.deleted);

    await finishReset(req.user.id, result);
    res.json({ scope, deleted: result.deleted });

    // Hundreds of receipts would outlast the Netlify proxy, and the reset has
    // already succeeded, so the files are removed after the response.
    removeReceiptFiles(result.receiptFiles).then(({ failed }) => {
      if (failed) console.error(`[data-reset] ${failed} receipt file(s) not removed for user ${req.user.id}`);
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
