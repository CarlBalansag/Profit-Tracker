const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/sales
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const sales = await prisma.sales.findMany({
      where: { inventory: { user_id: req.user.id } },
      include: { inventory: true, platform: true, buyer: true },
      orderBy: { sale_date: 'desc' }
    });
    res.json(sales);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const {
      inventory_id,
      platform_id,
      buyer_id,
      quantity,
      unit_price,
      commission_fee,
      sale_date,
      payout_date,
      status
    } = req.body;

    // Validate inventory exists and belongs to user
    const inv = await prisma.inventory.findUnique({ where: { id: inventory_id } });
    if (!inv || inv.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Inventory not found or access denied' });
    }

    const saleQty = parseInt(quantity, 10) || 1;
    if (inv.qty_on_hand < saleQty) {
      return res.status(400).json({ error: 'Insufficient quantity on hand' });
    }

    // Create the Sale
    const sale = await prisma.sales.create({
      data: {
        inventory_id,
        platform_id: platform_id || null,
        buyer_id: buyer_id || null,
        quantity: saleQty,
        unit_price: parseFloat(unit_price),
        commission_fee: parseFloat(commission_fee) || 0,
        sale_date: new Date(sale_date || Date.now()),
        payout_date: payout_date ? new Date(payout_date) : null,
        status: status || 'SOLD'
      }
    });

    // Deplete Inventory qty_on_hand
    await prisma.inventory.update({
      where: { id: inventory_id },
      data: { qty_on_hand: inv.qty_on_hand - saleQty }
    });

    res.json(sale);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/sales/:id - update a sale record inline
router.put('/:id', isAuthenticated, async (req, res) => {
  try {
    const { unit_price, quantity, status, commission_fee, platform_id } = req.body;
    const existing = await prisma.sales.findUnique({
      where: { id: req.params.id },
      include: { inventory: true }
    });
    if (!existing || existing.inventory.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    const newQty = quantity !== undefined ? (parseInt(quantity) || existing.quantity) : existing.quantity;
    const updated = await prisma.sales.update({
      where: { id: req.params.id },
      data: {
        unit_price: unit_price !== undefined ? parseFloat(unit_price) : existing.unit_price,
        quantity: newQty,
        status: status !== undefined ? status : existing.status,
        commission_fee: commission_fee !== undefined ? parseFloat(commission_fee) : existing.commission_fee,
        platform_id: platform_id !== undefined ? (platform_id || null) : existing.platform_id,
      }
    });

    // Adjust inventory qty_on_hand if quantity changed
    const qtyDiff = existing.quantity - newQty;
    if (qtyDiff !== 0) {
      const inv = existing.inventory;
      const newOnHand = inv.qty_on_hand + qtyDiff;
      if (newOnHand < 0) {
        return res.status(400).json({ error: 'Insufficient quantity on hand for this update' });
      }
      await prisma.inventory.update({
        where: { id: existing.inventory_id },
        data: { qty_on_hand: newOnHand }
      });
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

