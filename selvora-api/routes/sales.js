const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { currencyWrite } = require('../services/currencyWrite');
const { validateBody } = require('../middleware/validate');
const { createSale, updateSale } = require('../validation/schemas');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { requireOwned } = require('../services/ownership');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

const requestError = (status, message) => Object.assign(new Error(message), { status });

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

    // Check ownership before opening the transaction. Stock itself is claimed
    // below with a conditional update so concurrent requests cannot oversell.
    const inv = await prisma.inventory.findUnique({ where: { id: inventory_id } });
    if (!inv || inv.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Inventory not found or access denied' });
    }

    const saleQty = parseInt(quantity, 10) || 1;
    await requireOwned('platform', platform_id, req.user.id, 'Sale platform');
    await requireOwned('buyer', buyer_id, req.user.id, 'Buyer');
    const sale = await prisma.$transaction(async (tx) => {
      const stockClaim = await tx.inventory.updateMany({
        where: {
          id: inventory_id,
          user_id: req.user.id,
          qty_on_hand: { gte: saleQty },
        },
        data: { qty_on_hand: { decrement: saleQty } },
      });
      if (stockClaim.count !== 1) {
        throw requestError(400, 'Insufficient quantity on hand');
      }

      return tx.sales.create({
        data: currencyWrite('Sales', {
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
        })
      });
    });

    await publishCalendarFeed(req.user.id);
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
      sale_date, payout_date, buyer_id,
    } = req.body;
    const existing = await prisma.sales.findUnique({
      where: { id: req.params.id },
      include: { inventory: true }
    });
    if (!existing || existing.inventory.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    const newQty = quantity !== undefined ? (parseInt(quantity) || existing.quantity) : existing.quantity;
    await requireOwned('platform', platform_id, req.user.id, 'Sale platform');
    await requireOwned('buyer', buyer_id, req.user.id, 'Buyer');
    const qtyDiff = existing.quantity - newQty;
    const data = {};
    for (const [field, value] of Object.entries({ unit_price, commission_fee, sale_shipping, sale_tax_collected })) {
      if (value !== undefined) data[field] = Number(value);
    }
    if (quantity !== undefined) data.quantity = newQty;
    if (status !== undefined) data.status = status;
    if (platform_id !== undefined) data.platform_id = platform_id || null;
    if (buyer_id !== undefined) data.buyer_id = buyer_id;
    if (sale_date !== undefined) data.sale_date = parseLocalDate(sale_date);
    if (payout_date !== undefined) data.payout_date = parseLocalDate(payout_date);
    if (taxable !== undefined) data.taxable = taxable === true || taxable === 'true';
    if (customer_tax_exempt !== undefined) data.customer_tax_exempt = customer_tax_exempt === true || customer_tax_exempt === 'true';
    if (exemption_type !== undefined) data.exemption_type = exemption_type || null;
    const updated = await prisma.$transaction(async (tx) => {
      // Use the same inventory-first lock order as transaction-wide edits.
      const inventoryClaim = await tx.inventory.updateMany({
        where: { id: existing.inventory_id, user_id: req.user.id },
        data: { qty_on_hand: { increment: 0 } },
      });
      if (inventoryClaim.count !== 1) throw requestError(404, 'Inventory not found or access denied');
      // Claim the version used to calculate the stock delta. A concurrent edit
      // must not apply that delta again or overwrite fields omitted here.
      const claim = await tx.sales.updateMany({
        where: { id: req.params.id, quantity: existing.quantity, inventory: { user_id: req.user.id } },
        data: currencyWrite('Sales', data),
      });
      if (claim.count !== 1) throw requestError(409, 'Sale changed while saving. Reload and retry.');
      if (qtyDiff < 0) {
        const stockClaim = await tx.inventory.updateMany({
          where: { id: existing.inventory_id, qty_on_hand: { gte: -qtyDiff } },
          data: { qty_on_hand: { decrement: -qtyDiff } },
        });
        if (stockClaim.count !== 1) {
          throw requestError(400, 'Insufficient quantity on hand for this update');
        }
      } else if (qtyDiff > 0) {
        await tx.inventory.update({
          where: { id: existing.inventory_id },
          data: { qty_on_hand: { increment: qtyDiff } },
        });
      }

      return tx.sales.findUnique({
        where: { id: req.params.id },
      });
    });

    await publishCalendarFeed(req.user.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.sales.findUnique({ where: { id: req.params.id }, include: { inventory: true } });
    if (!existing || existing.inventory.user_id !== req.user.id) return res.status(404).json({ error: 'Sale not found or access denied' });
    await prisma.$transaction(async tx => {
      const inventory = await tx.inventory.updateMany({ where: { id: existing.inventory_id, user_id: req.user.id }, data: { qty_on_hand: { increment: 0 } } });
      if (inventory.count !== 1) throw requestError(404, 'Inventory not found or access denied');
      const removed = await tx.sales.deleteMany({ where: { id: existing.id, inventory_id: existing.inventory_id, quantity: existing.quantity } });
      if (removed.count !== 1) throw requestError(409, 'Sale changed while deleting. Reload and retry.');
      await tx.inventory.update({ where: { id: existing.inventory_id }, data: { qty_on_hand: { increment: existing.quantity } } });
    });
    await publishCalendarFeed(req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
