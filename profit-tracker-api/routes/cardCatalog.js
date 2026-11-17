const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getCatalog } = require('../services/cardCatalog');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/card-catalog -- every US card in the OpenCard DB catalog, for the
// "Add cards" picker. Same list for every user; refreshes itself about once a
// month (services/cardCatalog.js).
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const catalog = await getCatalog(prisma);
    res.set('Cache-Control', 'private, max-age=3600');
    res.json({
      cards: catalog.cards,
      synced_at: catalog.synced_at,
      last_verified: catalog.last_verified,
      source: catalog.source,
      attribution: {
        name: 'OpenCard DB',
        url: 'https://github.com/thedavidweng/opencard-db',
        license: 'CC BY 4.0',
      },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
