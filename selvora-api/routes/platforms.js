const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/platforms
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const platforms = await prisma.platform.findMany({ 
      orderBy: { name: 'asc' },
      include: { accounts: true }
    });
    res.json(platforms);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/platforms - single create
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, type, fee_pct, address, notes } = req.body;
    const platform = await prisma.platform.create({
      data: {
        name,
        type: type || 'retail',
        fee_pct: parseFloat(fee_pct) || 0,
        address: address || null,
        notes: notes || null
      }
    });
    res.json(platform);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/platforms/batch - bulk create
router.post('/batch', isAuthenticated, async (req, res) => {
  try {
    const { vendors } = req.body; // array of { name, type, category }
    if (!Array.isArray(vendors) || vendors.length === 0) {
      return res.status(400).json({ error: 'vendors array required' });
    }
    const created = await prisma.$transaction(
      vendors.map(v =>
        prisma.platform.upsert({
          where: { id: v.id || '' },
          update: {},
          create: {
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
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/platforms/:id - update vendor
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { name, type, fee_pct, address, notes } = req.body;
    const updated = await prisma.platform.update({
      where: { id: req.params.id },
      data: {
        name,
        type,
        fee_pct: parseFloat(fee_pct) || 0,
        address: address || null,
        notes: notes || null
      }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/platforms/:id
router.delete('/:id', isAuthenticated, async (req, res) => {
  try {
    await prisma.platform.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
