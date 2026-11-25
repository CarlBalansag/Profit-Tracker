const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { platform, updatePlatform, mergePlatform, platformBatch } = require('../validation/schemas');
const { requireOwned } = require('../services/ownership');
const activityLog = require('../services/activityLog');
const { mergePreview, mergePlatforms } = require('../services/platformMerge');
const { withExactFields, withExactList, MAPPINGS } = require('../services/decimalRead');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
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
    res.json(withExactList(platforms, MAPPINGS.platform));
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms - single create
router.post('/', isAuthenticated, validateBody(platform), async (req, res, next) => {
  try {
    const { name, type, fee_pct, address, notes, tax_exempt_place, default_return_days } = req.body;
    const { result: platform, activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'create', recordType: 'platform',
    }, () => tx.platform.create({
      data: {
        user_id: req.user.id,
        name,
        type: type || 'retail',
        fee_pct: parseFloat(fee_pct) || 0,
        address: address || null,
        notes: notes || null,
        tax_exempt_place: tax_exempt_place === true || tax_exempt_place === 'true',
        default_return_days: default_return_days ?? null,
      }
    })));
    res.json({ ...withExactFields(platform, MAPPINGS.platform), activity_id: activity?.id ?? null });
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
    await Promise.all(vendors.map((vendor) =>
      requireOwned('platform', vendor.id, req.user.id, 'Platform')
    ));
    // One Activity entry for the whole batch; vendors that already existed are
    // left as they were, so only the new ones are in it.
    const givenIds = new Set(vendors.map((v) => v.id).filter(Boolean));
    const { result: created } = await prisma.$transaction((tx) => activityLog.trackChange(tx, req.user.id, {
      action: 'create',
      recordType: 'platform',
      refs: async (t, rows) => ({ platform: rows ? rows.map((p) => p.id) : [...givenIds] }),
      recordId: (rows) => (rows.find((p) => !givenIds.has(p.id)) || rows[0])?.id,
    }, async () => {
      const rows = [];
      for (const v of vendors) {
        rows.push(await tx.platform.upsert({
          where: { id: v.id || '' },
          update: {},
          create: {
            user_id: req.user.id,
            name: v.name,
            type: v.type || 'retail',
            fee_pct: 0,
            notes: v.category || null
          }
        }));
      }
      return rows;
    }));
    res.json(withExactList(created, MAPPINGS.platform));
  } catch (err) {
    next(err);
  }
});

// PUT /api/platforms/:id - update (ownership enforced)
router.put('/:id', isAuthenticated, validateBody(updatePlatform), async (req, res, next) => {
  try {
    const existing = await prisma.platform.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Platform not found' });
    }

    const { name, type, fee_pct, address, notes, tax_exempt_place, default_return_days } = req.body;

    const newTaxExempt = tax_exempt_place !== undefined
      ? (tax_exempt_place === true || tax_exempt_place === 'true')
      : existing.tax_exempt_place;

    const taxChanging = tax_exempt_place !== undefined && newTaxExempt !== existing.tax_exempt_place;
    const { result: [updated, bulkResult], activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'edit', recordType: 'platform', id: req.params.id,
      // Switching tax-exempt rewrites every sale on this platform, so those
      // sales are part of the change (and of its undo).
      extraRefs: async (t) => (taxChanging
        ? { sales: (await t.sales.findMany({ where: { platform_id: req.params.id, inventory: { user_id: req.user.id } }, select: { id: true } })).map((s) => s.id) }
        : {}),
    }, async () => {
      const p = await tx.platform.update({
        where: { id: req.params.id },
        data: {
          name: name ?? existing.name,
          type: type ?? existing.type,
          fee_pct: fee_pct !== undefined ? parseFloat(fee_pct) : existing.fee_pct,
          address: address !== undefined ? address : existing.address,
          notes: notes !== undefined ? notes : existing.notes,
          tax_exempt_place: newTaxExempt,
          default_return_days: default_return_days !== undefined ? default_return_days : existing.default_return_days,
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
    }));

    res.json({ ...withExactFields(updated, MAPPINGS.platform), _salesUpdated: bulkResult.count, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

// GET /api/platforms/:id/merge-preview - what merging this cashout group moves
router.get('/:id/merge-preview', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await mergePreview(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/platforms/:id/merge { into } - moves everything on this cashout
// group to `into`, then removes this one (ownership of both enforced)
router.post('/:id/merge', isAuthenticated, validateBody(mergePlatform), async (req, res, next) => {
  try {
    const { platform: kept, moved, activity } = await mergePlatforms(req.user.id, req.params.id, req.body.into);
    res.json({ platform: withExactFields(kept, MAPPINGS.platform), moved, activity_id: activity?.id ?? null });
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

    // Its store accounts go with it (ON DELETE CASCADE) and purchases, sales
    // and cashout connections lose the link; all of it is logged for undo.
    const { activity } = await prisma.$transaction((tx) => activityLog.trackSetupChange(tx, req.user.id, {
      action: 'delete', recordType: 'platform', id: req.params.id,
    }, () => tx.platform.delete({ where: { id: req.params.id } })));
    res.json({ success: true, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
