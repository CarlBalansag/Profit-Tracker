const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { platform, platformBatch } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/platforms — only returns platforms belonging to the authenticated user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const platforms = await prisma.platform.findMany({
      where: { user_id: req.user.id },
      orderBy: { name: 'asc' },
      include: { accounts: true }
    });
    res.json(platforms);
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms - single create
router.post('/', isAuthenticated, validateBody(platform), async (req, res, next) => {
  try {
    const { name, type, fee_pct, address, notes } = req.body;
    const platform = await prisma.platform.create({
      data: {
        user_id: req.user.id,
        name,
        type: type || 'retail',
        fee_pct: parseFloat(fee_pct) || 0,
        address: address || null,
        notes: notes || null
      }
    });
    res.json(platform);
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms/batch - bulk create
router.post('/batch', isAuthenticated, validateBody(platformBatch), async (req, res, next) => {
  try {
    const { vendors } = req.body;
    if (!Array.isArray(vendors) || vendors.length === 0) {
      return res.status(400).json({ error: 'vendors array required' });
    }
    const created = await prisma.$transaction(
      vendors.map(v =>
        prisma.platform.upsert({
          where: { id: v.id || '' },
          update: {},
          create: {
            user_id: req.user.id,
            name: v.name,
            type: v.type || 'retail',
            fee_pct: 0,
            notes: v.category || null
          }
        })
      )
    );
    res.json(created);
  } catch (err) {
    next(err);
  }
});

// PUT /api/platforms/:id - update (ownership enforced)
router.put('/:id', isAuthenticated, validateBody(platform.partial()), async (req, res, next) => {
  try {
    const existing = await prisma.platform.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    const { name, type, fee_pct, address, notes, tax_exempt_place } = req.body;

    const newTaxExempt = tax_exempt_place !== undefined
      ? (tax_exempt_place === true || tax_exempt_place === 'true')
      : existing.tax_exempt_place;

    const [updated, bulkResult] = await prisma.$transaction(async (tx) => {
      const p = await tx.platform.update({
        where: { id: req.params.id },
        data: {
          name,
          type,
          fee_pct: parseFloat(fee_pct) || 0,
          address: address || null,
          notes: notes || null,
          tax_exempt_place: newTaxExempt,
        }
      });

      // Bulk-update all sales for this platform when tax_exempt_place changes
      let bulk = { count: 0 };
      if (tax_exempt_place !== undefined && newTaxExempt !== existing.tax_exempt_place) {
        bulk = await tx.sales.updateMany({
          where: { platform_id: req.params.id },
          data: newTaxExempt
            ? { taxable: false, customer_tax_exempt: true, exemption_type: 'Resale' }
            : { taxable: true, customer_tax_exempt: false, exemption_type: null },
        });
      }

      return [p, bulk];
    });

    res.json({ ...updated, _salesUpdated: bulkResult.count });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/platforms/:id (ownership enforced)
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.platform.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    await prisma.platform.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
