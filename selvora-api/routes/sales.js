const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createSale, updateSale } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// GET /api/sales
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const sales = await prisma.sales.findMany({
      where: { inventory: { user_id: req.user.id } },
      include: { inventory: true, platform: true, buyer: true },
      orderBy: { sale_date: 'desc' }
    });
    res.json(sales);
  } catch (err) {
    next(err);
  }
});

// POST /api/sales
router.post('/', isAuthenticated, validateBody(createSale), async (req, res, next) => {
  try {
    const {
      inventory_id,
      platform_id,
      buyer_id,
      quantity,
      unit_price,
      commission_fee,
      sale_shipping,
      sale_date,
      payout_date,
      status,
      taxable,
      sale_tax_collected,
      customer_tax_exempt,
      exemption_type,
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
        sale_shipping: parseFloat(sale_shipping) || 0,
        sale_date: parseLocalDate(sale_date) || new Date(),
        payout_date: payout_date ? parseLocalDate(payout_date) : null,
        status: status || 'SOLD',
        taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : true,
        sale_tax_collected: parseFloat(sale_tax_collected) || 0,
        customer_tax_exempt: customer_tax_exempt === true || customer_tax_exempt === 'true',
        exemption_type: exemption_type || null,
      }
    });

    // Deplete Inventory qty_on_hand
    await prisma.inventory.update({
      where: { id: inventory_id },
      data: { qty_on_hand: inv.qty_on_hand - saleQty }
    });

    res.json(sale);
  } catch (err) {
    next(err);
  }
});

// PUT /api/sales/:id - update a sale record inline
router.put('/:id', isAuthenticated, validateBody(updateSale), async (req, res, next) => {
  try {
    const {
      unit_price, quantity, status, commission_fee, platform_id,
      sale_shipping, taxable, sale_tax_collected, customer_tax_exempt, exemption_type,
      sale_date, payout_date,
    } = req.body;
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
        sale_shipping: sale_shipping !== undefined ? parseFloat(sale_shipping) : existing.sale_shipping,
        platform_id: platform_id !== undefined ? (platform_id || null) : existing.platform_id,
        sale_date: sale_date !== undefined ? (parseLocalDate(sale_date) || existing.sale_date) : existing.sale_date,
        payout_date: payout_date !== undefined ? (payout_date ? parseLocalDate(payout_date) : null) : existing.payout_date,
        taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : existing.taxable,
        sale_tax_collected: sale_tax_collected !== undefined ? parseFloat(sale_tax_collected) : existing.sale_tax_collected,
        customer_tax_exempt: customer_tax_exempt !== undefined ? (customer_tax_exempt === true || customer_tax_exempt === 'true') : existing.customer_tax_exempt,
        exemption_type: exemption_type !== undefined ? (exemption_type || null) : existing.exemption_type,
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
    next(err);
  }
});

module.exports = router;
