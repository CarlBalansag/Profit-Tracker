const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createSale, updateSale } = require('../validation/schemas');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { requireOwned } = require('../services/ownership');
const { refreshTracking, checkTrackingRateLimit } = require('../services/tracking');
const { autoShippedStatus } = require('../services/statusHierarchy');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
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
      tracking_number,
    } = req.body;

    // Check ownership before opening the transaction. Stock itself is claimed
    // below with a conditional update so concurrent requests cannot oversell.
    const inv = await prisma.inventory.findUnique({ where: { id: inventory_id } });
    if (!inv || inv.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Inventory not found or access denied' });
    }

    const saleQty = parseInt(quantity, 10) || 1;
    await requireOwned('platform', platform_id, req.user.id, 'Sale platform');
    // A tracking number entered at creation time advances status the same
    // way adding one later does — unless the caller explicitly chose a status.
    let resolvedStatus = status || 'SOLD';
    if (!status && tracking_number) {
      const advanced = autoShippedStatus('outbound', resolvedStatus);
      if (advanced) resolvedStatus = advanced;
    }
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
          status: resolvedStatus,
          taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : true,
          sale_tax_collected: parseFloat(sale_tax_collected) || 0,
          customer_tax_exempt: customer_tax_exempt === true || customer_tax_exempt === 'true',
          exemption_type: exemption_type || null,
          tracking_number: tracking_number || null,
        }
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
      sale_date, payout_date, tracking_number,
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
    const qtyDiff = existing.quantity - newQty;

    // Adding a tracking number to a still-unshipped sale automatically
    // advances its status — never overrides an explicit status change in the
    // same request, and never touches a sale that's already further along.
    let resolvedStatus = status !== undefined ? status : existing.status;
    if (status === undefined && tracking_number && !existing.tracking_number) {
      const advanced = autoShippedStatus('outbound', existing.status);
      if (advanced) resolvedStatus = advanced;
    }
    const updated = await prisma.$transaction(async (tx) => {
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

      return tx.sales.update({
        where: { id: req.params.id },
        data: {
        unit_price: unit_price !== undefined ? parseFloat(unit_price) : existing.unit_price,
        quantity: newQty,
        status: resolvedStatus,
        commission_fee: commission_fee !== undefined ? parseFloat(commission_fee) : existing.commission_fee,
        sale_shipping: sale_shipping !== undefined ? parseFloat(sale_shipping) : existing.sale_shipping,
        platform_id: platform_id !== undefined ? (platform_id || null) : existing.platform_id,
        sale_date: sale_date !== undefined ? (parseLocalDate(sale_date) || existing.sale_date) : existing.sale_date,
        payout_date: payout_date !== undefined ? (payout_date ? parseLocalDate(payout_date) : null) : existing.payout_date,
        taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : existing.taxable,
        sale_tax_collected: sale_tax_collected !== undefined ? parseFloat(sale_tax_collected) : existing.sale_tax_collected,
        customer_tax_exempt: customer_tax_exempt !== undefined ? (customer_tax_exempt === true || customer_tax_exempt === 'true') : existing.customer_tax_exempt,
        exemption_type: exemption_type !== undefined ? (exemption_type || null) : existing.exemption_type,
        tracking_number: tracking_number !== undefined ? (tracking_number || null) : existing.tracking_number,
        }
      });
    });

    await publishCalendarFeed(req.user.id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/sales/:id/track - refresh live carrier status for this sale's tracking number
router.post('/:id/track', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.sales.findUnique({
      where: { id: req.params.id },
      include: { inventory: true },
    });
    if (!existing || existing.inventory.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    if (!existing.tracking_number) {
      return res.status(400).json({ error: 'No tracking number set for this sale' });
    }

    const rate = await checkTrackingRateLimit(prisma, req.user.id);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfterSeconds));
      return res.status(429).json({ error: 'Too many tracking checks. Please try again later.', retryAfterSeconds: rate.retryAfterSeconds });
    }

    const tracking_info = await refreshTracking(existing.tracking_number);
    const updated = await prisma.sales.update({
      where: { id: req.params.id },
      data: { tracking_info },
    });
    res.json({ ...updated, rate_limit: { remaining: rate.remaining, resetAt: rate.resetAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
