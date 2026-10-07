const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createSale, updateSale, statusActionBody } = require('../validation/schemas');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { requireOwned } = require('../services/ownership');
const { checkTrackingRateLimit, refreshSharedTracking } = require('../services/tracking');
const statusTransitions = require('../services/statusTransitions');
const { withExactFields, MAPPINGS } = require('../services/decimalRead');
const { markPaidBatch } = require('../validation/schemas');
const { markSalesPaid } = require('../services/markSalesPaid');

// Task 8 read cutover: substitute each Decimal column's exact value into its
// paired Float field, for a sale and its nested inventory/platform (if included).
function exactSale(sale) {
  if (!sale) return sale;
  const result = withExactFields(sale, MAPPINGS.sales);
  if (result.inventory) result.inventory = withExactFields(result.inventory, MAPPINGS.inventory);
  if (result.platform) result.platform = withExactFields(result.platform, MAPPINGS.platform);
  return result;
}

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

// Checkpoint 2: every record a GET returns carries the contextual actions its
// current workflow status allows, so the client never derives them itself and
// never needs a second request after performing one. Computed, never stored.
const withActions = (sale) =>
  (sale ? { ...sale, allowed_actions: statusTransitions.allowedActions(sale, 'sale') } : sale);

// GET /api/sales
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const sales = await prisma.sales.findMany({
      where: { inventory: { user_id: req.user.id } },
      include: { inventory: true, platform: true, buyer: true },
      orderBy: { sale_date: 'desc' }
    });
    res.json(sales.map((sale) => withActions(exactSale(sale))));
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
    const platform = await requireOwned('platform', platform_id, req.user.id, 'Sale platform');
    await requireOwned('buyer', buyer_id, req.user.id, 'Buyer');
    // The platform's preset is copied onto the sale now, so changing that
    // platform's default workflow later never rewrites this sale.
    const workflow_type = statusTransitions.resolveSaleWorkflow(platform && platform.workflow_preset);
    // A tracking number entered at creation time advances status the same
    // way adding one later does — unless the caller explicitly chose a status.
    // The legacy `status` column keeps the exact values it has always had; the
    // status-workflow columns are written alongside it from the same decision.
    let resolvedStatus = status || 'SOLD';
    let workflowData = { workflow_type, workflow_status: statusTransitions.legacyWorkflowStatus(resolvedStatus, workflow_type) };
    if (!status && tracking_number) {
      const advanced = statusTransitions.trackingAttached(
        'sale',
        { status: resolvedStatus, quantity: saleQty, ...workflowData },
        tracking_number,
      );
      if (advanced.legacy_status) resolvedStatus = advanced.legacy_status;
      workflowData = { ...workflowData, ...advanced.data };
    }
    // The workflow status starts its life right now, so the "last status
    // updated" stamp starts with it rather than being NULL until the first
    // action. A legacy status with no new-column equivalent resolves
    // workflow_status to null, and such a sale gets no stamp either.
    if (workflowData.workflow_status) workflowData.workflow_status_changed_at = new Date();
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
          ...workflowData,
          taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : true,
          sale_tax_collected: parseFloat(sale_tax_collected) || 0,
          customer_tax_exempt: customer_tax_exempt === true || customer_tax_exempt === 'true',
          exemption_type: exemption_type || null,
          tracking_number: tracking_number || null,
        }
      });
    });

    await publishCalendarFeed(req.user.id);
    res.json(exactSale(sale));
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

    // Adding a tracking number for the FIRST time *is* the add_outbound_tracking
    // business action, so it is only valid where that action is: a sale still
    // awaiting shipment. Editing, replacing or clearing a number the sale already
    // has is deliberately NOT gated -- correcting tracking after delivery has to
    // stay possible. A sale with no workflow_status at all (one the backfill could
    // not resolve) is not gated either: there is no stored state to judge it
    // against, and its legacy column must keep advancing exactly as it does today.
    if (tracking_number && !existing.tracking_number && existing.workflow_status
      && !statusTransitions.isActionAllowed(existing, 'sale', 'add_outbound_tracking')) {
      return res.status(400).json({ error: 'A tracking number cannot be added to a sale that is not awaiting shipment' });
    }

    // Adding a tracking number to a still-unshipped sale automatically
    // advances its status — never overrides an explicit status change in the
    // same request, and never touches a sale that's already further along.
    // The legacy column advances to exactly the value it always did; the
    // status-workflow column advances alongside it when the row has one.
    let resolvedStatus = status !== undefined ? status : existing.status;
    const workflowData = {};
    if (status === undefined && tracking_number && !existing.tracking_number) {
      const advanced = statusTransitions.trackingAttached('sale', existing, tracking_number);
      if (advanced.legacy_status) resolvedStatus = advanced.legacy_status;
      Object.assign(workflowData, advanced.data);
      // An auto-advance here is a real workflow-status change, so it carries the
      // same "last status updated" stamp an action endpoint would write.
      if (advanced.data.workflow_status) workflowData.workflow_status_changed_at = new Date();
    }
    const updated = await prisma.$transaction(async (tx) => {
      // Claim the inventory row first, using the same lock order as the
      // combined transaction-edit route, so the two can't deadlock when they
      // run concurrently against the same purchase.
      const inventoryClaim = await tx.inventory.updateMany({
        where: { id: existing.inventory_id, user_id: req.user.id },
        data: { qty_on_hand: { increment: 0 } },
      });
      if (inventoryClaim.count !== 1) throw requestError(404, 'Inventory not found or access denied');
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

      // Claim the sale version the stock delta above was calculated from. A
      // concurrent edit must not have this write silently re-apply that delta
      // or clobber fields this request never touched.
      const claim = await tx.sales.updateMany({
        where: { id: req.params.id, quantity: existing.quantity, inventory: { user_id: req.user.id } },
        data: {
        unit_price: unit_price !== undefined ? parseFloat(unit_price) : existing.unit_price,
        quantity: newQty,
        status: resolvedStatus,
        ...workflowData,
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
      if (claim.count !== 1) throw requestError(409, 'Sale changed while saving. Reload and retry.');
      return tx.sales.findUnique({ where: { id: req.params.id } });
    });

    await publishCalendarFeed(req.user.id);
    res.json(exactSale(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sales/:id - remove only this sale and restore its stock, preserving the purchase batch
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.sales.findUnique({ where: { id: req.params.id }, include: { inventory: true } });
    if (!existing || existing.inventory.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    await prisma.$transaction(async (tx) => {
      const inventory = await tx.inventory.updateMany({
        where: { id: existing.inventory_id, user_id: req.user.id },
        data: { qty_on_hand: { increment: 0 } },
      });
      if (inventory.count !== 1) throw requestError(404, 'Inventory not found or access denied');
      const removed = await tx.sales.deleteMany({
        where: { id: existing.id, inventory_id: existing.inventory_id, quantity: existing.quantity },
      });
      if (removed.count !== 1) throw requestError(409, 'Sale changed while deleting. Reload and retry.');
      await tx.inventory.update({
        where: { id: existing.inventory_id },
        data: { qty_on_hand: { increment: existing.quantity } },
      });
    });
    await publishCalendarFeed(req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/sales/mark-paid-batch - mark several sales paid from one deposit.
// Shared with the MCP mark_sale_paid tool via services/markSalesPaid.js.
router.post('/mark-paid-batch', isAuthenticated, validateBody(markPaidBatch), async (req, res, next) => {
  try {
    const { sale_ids, payout_date, payout_amount, payout_account, payout_reference } = req.body;
    const updated = await markSalesPaid({
      userId: req.user.id,
      saleIds: sale_ids,
      payoutDate: parseLocalDate(payout_date),
      payoutAmount: payout_amount,
      payoutAccount: payout_account || null,
      payoutReference: payout_reference || null,
    });
    await publishCalendarFeed(req.user.id);
    res.json(updated.map((sale) => withActions(exactSale(sale))));
  } catch (err) {
    next(err);
  }
});

// POST /api/sales/:id/actions/:action - perform one status-workflow action
router.post('/:id/actions/:action', isAuthenticated, validateBody(statusActionBody), async (req, res, next) => {
  try {
    const { id, action } = req.params;
    const existing = await prisma.sales.findUnique({
      where: { id },
      include: { inventory: true },
    });
    if (!existing || existing.inventory.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Sale not found or access denied' });
    }
    // The sale's own current status decides what it can do, so a client cannot
    // force an action the state does not support. applyTransition re-checks
    // this inside the transaction, against the row it actually claims, which is
    // what makes a concurrent action safe rather than this.
    if (!statusTransitions.isActionAllowed(existing, 'sale', action)) {
      return res.status(409).json({ error: `Action "${action}" is not available for this sale's current status` });
    }

    const payload = { ...statusTransitions.actionPayload(action, req.body), user_id: req.user.id };
    const result = await prisma.$transaction((tx) =>
      statusTransitions.applyTransition(tx, 'sale', existing, action, payload));

    await publishCalendarFeed(req.user.id);
    // The recomputed actions travel with the record so the client can redraw
    // its buttons without a second request.
    res.json(withActions(exactSale(result.record)));
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

    // One carrier request for the package, applied to every purchase and sale
    // of this user sharing the number -- not one request per row.
    const shared = await refreshSharedTracking({
      prisma, userId: req.user.id, trackingNumber: existing.tracking_number,
    });
    const updated = shared.sales.find((row) => row.id === req.params.id)
      || { ...existing, tracking_info: shared.tracking_info };
    res.json({ ...withActions(exactSale(updated)), rate_limit: { remaining: rate.remaining, resetAt: rate.resetAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
