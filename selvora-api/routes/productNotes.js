const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Normalize product name for case-insensitive matching
const normalize = (name) => name?.trim().toLowerCase() ?? '';

// GET /api/product-notes?product_name=...
// Returns { note: string } or { note: null } if no note exists
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const { product_name } = req.query;
    if (!product_name) {
      return res.status(400).json({ error: 'product_name is required' });
    }

    const record = await prisma.productNote.findUnique({
      where: {
        user_id_product_name: {
          user_id: req.user.id,
          product_name: normalize(product_name),
        },
      },
    });

    res.json({ note: record?.note ?? null });
  } catch (err) {
    next(err);
  }
});

// PUT /api/product-notes
// Body: { product_name, note }
// Creates or updates a note for a product
router.put('/', isAuthenticated, async (req, res, next) => {
  try {
    const { product_name, note } = req.body;

    if (!product_name || typeof product_name !== 'string' || !product_name.trim()) {
      return res.status(400).json({ error: 'product_name is required' });
    }
    if (typeof note !== 'string') {
      return res.status(400).json({ error: 'note must be a string' });
    }
    if (note.length > 2000) {
      return res.status(400).json({ error: 'note must be 2000 characters or fewer' });
    }

    const record = await prisma.productNote.upsert({
      where: {
        user_id_product_name: {
          user_id: req.user.id,
          product_name: normalize(product_name),
        },
      },
      update: { note: note.trim() },
      create: {
        user_id: req.user.id,
        product_name: normalize(product_name),
        note: note.trim(),
      },
    });

    res.json(record);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/product-notes?product_name=...
// Removes the note for a product (no-op if it doesn't exist)
router.delete('/', isAuthenticated, async (req, res, next) => {
  try {
    const { product_name } = req.query;
    if (!product_name) {
      return res.status(400).json({ error: 'product_name is required' });
    }

    await prisma.productNote.deleteMany({
      where: {
        user_id: req.user.id,
        product_name: normalize(product_name),
      },
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
