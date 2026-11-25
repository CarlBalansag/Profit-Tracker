const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { getCatalog, getCatalogIndex } = require('../services/cardCatalog');
const { artSources, getArtwork } = require('../services/cardArt');

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
    // Revalidate every time (Express's ETag turns an unchanged list into a
    // 304), so a monthly refresh shows up right away instead of after a
    // browser cache expires.
    res.set('Cache-Control', 'private, no-cache');
    res.json({
      // Picture addresses stay on the server; GET /:id/art/:source serves them.
      cards: catalog.cards.map(({ art: _art, ...card }) => card),
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

const ID_RE = /^[a-z0-9-]{1,120}$/;
const MAX_IDS = 100;

// GET /api/card-catalog/cards?ids=a,b -- just the named cards, with what the
// Credit Card page shows on a card's face. Unknown ids are left out.
router.get('/cards', isAuthenticated, async (req, res, next) => {
  try {
    const ids = [...new Set(String(req.query.ids || '').split(',').filter((id) => ID_RE.test(id)))].slice(0, MAX_IDS);
    const byId = ids.length ? await getCatalogIndex(prisma) : new Map();
    res.set('Cache-Control', 'private, no-cache');
    res.json({
      cards: ids.map((id) => byId.get(id)).filter(Boolean).map((card) => ({
        id: card.id, name: card.name, issuer: card.issuer, network: card.network,
        network_tier: card.network_tier ?? null, annual_fee: card.annual_fee ?? null, art: artSources(card.art),
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/card-catalog/:id/art/:source -- one card's picture. The caller names
// a catalog card, never an address.
router.get('/:id/art/:source', isAuthenticated, async (req, res, next) => {
  try {
    const { id, source } = req.params;
    if (!ID_RE.test(id) || !['primary', 'mirror'].includes(source)) return res.status(404).json({ error: 'No artwork for that card.' });
    const card = (await getCatalogIndex(prisma)).get(id);
    const image = card ? await getArtwork(card.art, source) : null;
    if (!image) {
      res.set('Cache-Control', 'private, max-age=3600');
      return res.status(404).json({ error: 'No artwork for that card.' });
    }
    res.set('Content-Type', image.type);
    res.set('Cache-Control', 'private, max-age=2592000');
    return res.send(image.buf);
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
