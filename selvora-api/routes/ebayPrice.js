const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody, validateQuery } = require('../middleware/validate');
const { ebayPriceQuery, ebayPrice } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// GET /api/ebay-price?q=product+name
// Returns cached price if fresh, otherwise { cached: false } so the frontend knows to scrape
router.get('/', isAuthenticated, validateQuery(ebayPriceQuery), async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.status(400).json({ message: 'Missing query parameter q' });

  const cached = await prisma.ebayPriceCache.findUnique({
    where: { product_name: query },
  });

  if (cached && cached.fetched_at) {
    const age = Date.now() - new Date(cached.fetched_at).getTime();
    if (age < CACHE_TTL_MS) {
      return res.json({
        product_name: query,
        last_sold_price: cached.last_sold_price,
        currency: cached.currency,
        fetched_at: cached.fetched_at,
        from_cache: true,
      });
    }
  }

  // Cache miss or stale — tell the frontend to scrape and report back
  return res.json({ product_name: query, from_cache: false });
});

// POST /api/ebay-price
// Frontend sends the price it scraped from the browser; backend caches it
router.post('/', isAuthenticated, validateBody(ebayPrice), async (req, res) => {
  const { product_name, last_sold_price } = req.body;
  if (!product_name) return res.status(400).json({ message: 'Missing product_name' });

  const record = await prisma.ebayPriceCache.upsert({
    where: { product_name },
    update: { last_sold_price: last_sold_price ?? null, currency: 'USD' },
    create: { product_name, last_sold_price: last_sold_price ?? null, currency: 'USD' },
  });

  return res.json({
    product_name: record.product_name,
    last_sold_price: record.last_sold_price,
    currency: record.currency,
    fetched_at: record.fetched_at,
  });
});

module.exports = router;
