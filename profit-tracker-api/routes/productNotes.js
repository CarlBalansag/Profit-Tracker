const express = require('express');
const router = express.Router();
const prisma = require('../prisma');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Normalize product name for case-insensitive matching
const normalize = (name) => name?.trim().toLowerCase() ?? '';
const activityLog = require('../services/activityLog');
// The note for this product, if any, as trackChange refs.
const noteRefs = async (tx, userId, productName) => {
  const row = await tx.productNote.findUnique({ where: { user_id_product_name: { user_id: userId, product_name: productName } }, select: { id: true } });
  return { productNote: row ? [row.id] : [] };
};

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

    const key = normalize(product_name);
    const { result: record, activity } = await prisma.$transaction(async (tx) => {
      const existed = (await noteRefs(tx, req.user.id, key)).productNote.length > 0;
      return activityLog.trackChange(tx, req.user.id, {
        action: existed ? 'edit' : 'create',
        recordType: 'product_note',
        productName: product_name.trim(),
        refs: (t) => noteRefs(t, req.user.id, key),
        recordId: (row) => row.id,
      }, () => tx.productNote.upsert({
        where: { user_id_product_name: { user_id: req.user.id, product_name: key } },
        update: { note: note.trim() },
        create: { user_id: req.user.id, product_name: key, note: note.trim() },
      }));
    });

    res.json({ ...record, activity_id: activity?.id ?? null });
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

    const key = normalize(product_name);
    const existing = await prisma.productNote.findUnique({ where: { user_id_product_name: { user_id: req.user.id, product_name: key } } });
    let activity = null;
    if (existing) {
      ({ activity } = await prisma.$transaction((tx) => activityLog.trackChange(tx, req.user.id, {
        action: 'delete',
        recordType: 'product_note',
        productName: String(product_name).trim(),
        refs: async () => ({ productNote: [existing.id] }),
        recordId: existing.id,
      }, () => tx.productNote.deleteMany({ where: { id: existing.id, user_id: req.user.id } }))));
    }

    res.json({ success: true, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
