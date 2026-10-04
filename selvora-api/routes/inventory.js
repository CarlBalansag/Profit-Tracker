const express = require('express');
const router = express.Router();
const { z } = require('zod');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createInventory, updateInventory, updateSale, createSale, statusActionBody } = require('../validation/schemas');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { requireOwned } = require('../services/ownership');
const { checkTrackingRateLimit, refreshSharedTracking } = require('../services/tracking');
const statusTransitions = require('../services/statusTransitions');
const { editTransaction } = require('../services/transactionEdit');
const { withExactFields, MAPPINGS } = require('../services/decimalRead');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Parse a YYYY-MM-DD string as local noon to avoid UTC midnight timezone shifts
const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// Task 8 read cutover: substitute each Decimal column's exact value into its
// paired Float field, for an inventory row and any nested vendor/payment_method/sales.
// `vendor` and a sale's `platform` are both the same Platform model, so both use MAPPINGS.platform.
function exactInventory(item) {
  if (!item) return item;
  const result = withExactFields(item, MAPPINGS.inventory);
  if (result.vendor) result.vendor = withExactFields(result.vendor, MAPPINGS.platform);
  if (result.payment_method) result.payment_method = withExactFields(result.payment_method, MAPPINGS.paymentMethod);
  if (Array.isArray(result.sales)) result.sales = result.sales.map(sale => {
    const exactSale = withExactFields(sale, MAPPINGS.sales);
    if (exactSale.platform) exactSale.platform = withExactFields(exactSale.platform, MAPPINGS.platform);
    return exactSale;
  });
  return result;
}

// Checkpoint 2: every record a GET returns carries the contextual actions its
// current status allows, so the client never derives them itself and never needs
// a second request after performing one. Computed, never stored.
function withActions(item) {
  if (!item) return item;
  const result = { ...item, allowed_actions: statusTransitions.allowedActions(item, 'inventory') };
  if (Array.isArray(result.sales)) {
    result.sales = result.sales.map((sale) => ({ ...sale, allowed_actions: statusTransitions.allowedActions(sale, 'sale') }));
  }
  return result;
}

// GET all inventory items for current user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { user_id: req.user.id },
      select: {
        id: true, product_name: true, category: true, status: true,
        // Status-workflow columns, needed to compute allowed_actions below.
        receiving_status: true, receiving_status_changed_at: true, is_listed: true,
        vendor_id: true, payment_method_id: true,
        purchase_date: true, received_date: true,
        unit_purchase_cost: true, qty_purchased: true, qty_on_hand: true,
        sales_tax: true, shipping_cost_inbound: true, fees: true,
        cashback_earned: true, cashback_rate: true, gift_card_amount: true,
        unit_purchase_cost_decimal: true, sales_tax_decimal: true, shipping_cost_inbound_decimal: true,
        fees_decimal: true, cashback_earned_decimal: true, cashback_rate_decimal: true, gift_card_amount_decimal: true,
        order_number: true, tracking_number: true, tracking_info: true, receipt_url: true,
        tax_exempt: true,
        vendor: { select: { id: true, name: true, type: true } },
        payment_method: { select: { id: true, name: true, type: true, default_cashback_rate: true, default_cashback_rate_decimal: true, preset_card_id: true, category_rates: true } },
        sales: {
          select: {
            id: true, platform_id: true, quantity: true, unit_price: true, commission_fee: true,
            sale_shipping: true, sale_date: true, payout_date: true, status: true,
            workflow_type: true, workflow_status: true, workflow_status_changed_at: true,
            taxable: true, sale_tax_collected: true, customer_tax_exempt: true, exemption_type: true,
            unit_price_decimal: true, commission_fee_decimal: true, sale_shipping_decimal: true, sale_tax_collected_decimal: true,
            platform: { select: { id: true, name: true, type: true, tax_exempt_place: true } },
            buyer: { select: { id: true, name: true } },
          }
        },
      },
      orderBy: { purchase_date: 'desc' }
    });
    res.json(items.map((item) => withActions(exactInventory(item))));
  } catch (err) {
    next(err);
  }
});

// POST new inventory explicitly
router.post('/', isAuthenticated, validateBody(createInventory), async (req, res, next) => {
  try {
    const {
      product_name,
      vendor_id,
      payment_method_id,
      purchase_date,
      unit_purchase_cost,
      qty_purchased,
      sales_tax,
      shipping_cost_inbound,
      fees,
      gift_card_amount,
      cashback_rate,
      cashback_earned,
      order_number,
      tracking_number,
      category,
      tax_exempt,
      // optional direct sale posting
      sale_price,
      payout_date,
      sale_tab,
      cashout_platform_id,
      marketplace_platform_id,
      commission_fee,
      sale_shipping,
      sale_date,
      qty_sold,
      status,
      taxable,
      sale_tax_collected,
      customer_tax_exempt,
      exemption_type,
    } = req.body;

    console.log('POST inventory body:', JSON.stringify(req.body));
    const qty = parseInt(qty_purchased, 10) || 1;
    // A tracking number entered at creation time advances status the same
    // way adding one later does — unless the caller explicitly chose a status.
    // The legacy `status` column keeps the exact values it has always had; the
    // status-workflow columns are written alongside it from the same decision.
    let resolvedStatus = status || 'PURCHASED';
    let workflowData = statusTransitions.legacyReceivingPatch(resolvedStatus);
    if (!status && tracking_number) {
      const advanced = statusTransitions.trackingAttached(
        'inventory',
        { status: resolvedStatus, qty_on_hand: qty, ...workflowData },
        tracking_number,
      );
      if (advanced.legacy_status) resolvedStatus = advanced.legacy_status;
      workflowData = { ...workflowData, ...advanced.data };
    }
    // The receiving status starts its life right now, so the "last status
    // updated" stamp starts with it rather than being NULL until the first
    // action. One clock for the purchase and for any sale created with it, so
    // the two cannot be stamped microseconds apart. A legacy status with no
    // new-column equivalent sets no receiving_status at all, and so gets no
    // stamp either.
    const statusChangedAt = new Date();
    if (workflowData.receiving_status) workflowData.receiving_status_changed_at = statusChangedAt;
    await requireOwned('platform', vendor_id, req.user.id, 'Vendor');
    await requireOwned('paymentMethod', payment_method_id, req.user.id, 'Payment method');

    const saleQty = sale_price ? (parseInt(qty_sold, 10) || qty) : 0;
    if (saleQty > qty) {
      return res.status(400).json({ error: 'Quantity sold cannot exceed quantity purchased' });
    }
    const platform_id = sale_price
      ? (sale_tab === 'marketplace' ? (marketplace_platform_id || null) : (cashout_platform_id || null))
      : null;
    const salePlatform = await requireOwned('platform', platform_id, req.user.id, 'Sale platform');
    const saleWorkflow = statusTransitions.resolveSaleWorkflow(salePlatform && salePlatform.workflow_preset);

    const inventory = await prisma.$transaction(async (tx) => {
      const created = await tx.inventory.create({
        data: {
        user_id: req.user.id,
        product_name,
        vendor_id: vendor_id || null,
        payment_method_id: payment_method_id || null,
        purchase_date: parseLocalDate(purchase_date) || new Date(),
        unit_purchase_cost: parseFloat(unit_purchase_cost) || 0,
        qty_purchased: qty,
        qty_on_hand: qty, // Initialize to purchased qty
        sales_tax: parseFloat(sales_tax) || 0,
        shipping_cost_inbound: parseFloat(shipping_cost_inbound) || 0,
        fees: parseFloat(fees) || 0,
        gift_card_amount: parseFloat(gift_card_amount) || 0,
        order_number: order_number || null,
        tracking_number: tracking_number || null,
        // A non-null rate marks this purchase as a snapshotted/overridden
        // cashback value. Callers that omit it retain legacy dynamic rates.
        cashback_rate: cashback_rate !== undefined ? parseFloat(cashback_rate) : null,
        cashback_earned: cashback_earned !== undefined ? parseFloat(cashback_earned) || 0 : 0,
        category: category || null,
        tax_exempt: tax_exempt === true || tax_exempt === 'true',
        status: resolvedStatus,
        ...workflowData,
        }
      });

      if (sale_price) {
        await tx.sales.create({
            data: {
                inventory_id: created.id,
                platform_id,
                quantity: saleQty,
                unit_price: parseFloat(sale_price),
                commission_fee: parseFloat(commission_fee) || 0,
                sale_shipping: parseFloat(sale_shipping) || 0,
                sale_date: parseLocalDate(sale_date || purchase_date) || new Date(),
                payout_date: payout_date ? parseLocalDate(payout_date) : null,
                status: 'SOLD',
                workflow_type: saleWorkflow,
                workflow_status: statusTransitions.legacyWorkflowStatus('SOLD', saleWorkflow),
                workflow_status_changed_at: statusChangedAt,
                taxable: taxable !== undefined ? (taxable === true || taxable === 'true') : true,
                sale_tax_collected: parseFloat(sale_tax_collected) || 0,
                customer_tax_exempt: customer_tax_exempt === true || customer_tax_exempt === 'true',
                exemption_type: exemption_type || null,
            }
        });
        await tx.inventory.update({
            where: { id: created.id },
            data: { qty_on_hand: qty - saleQty }
        });
      }
      return created;
    });

    await publishCalendarFeed(req.user.id);
    res.json(exactInventory(inventory));
  } catch (err) {
    next(err);
  }
});

// GET distinct product names for autocomplete
router.get('/product-names', isAuthenticated, async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { user_id: req.user.id },
      select: { product_name: true },
      distinct: ['product_name'],
      orderBy: { product_name: 'asc' },
    });
    res.json(items.map(i => i.product_name));
  } catch (err) { next(err); }
});

// GET most recent inventory item matching a product name added within the last hour
router.get('/recent-by-name', isAuthenticated, async (req, res, next) => {
  try {
    const { product_name } = req.query;
    if (!product_name) return res.json(null);
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const item = await prisma.inventory.findFirst({
      where: {
        user_id: req.user.id,
        product_name: { equals: product_name, mode: 'insensitive' },
        created_at: { gte: since },
      },
      select: {
        unit_purchase_cost: true, qty_purchased: true,
        sales_tax: true, shipping_cost_inbound: true, fees: true,
        gift_card_amount: true, cashback_rate: true, cashback_earned: true, tax_exempt: true, category: true,
        vendor_id: true, payment_method_id: true,
        unit_purchase_cost_decimal: true, sales_tax_decimal: true, shipping_cost_inbound_decimal: true,
        fees_decimal: true, gift_card_amount_decimal: true, cashback_rate_decimal: true, cashback_earned_decimal: true,
        vendor: { select: { id: true, name: true } },
        payment_method: { select: { id: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    res.json(item ? exactInventory(item) : null);
  } catch (err) { next(err); }
});

// GET single inventory item by id
router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const item = await prisma.inventory.findUnique({
      where: { id: req.params.id },
      include: {
        vendor: true,
        payment_method: true,
        sales: {
          include: { platform: true, buyer: true }
        }
      }
    });
    if (!item || item.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });
    res.json(withActions(exactInventory(item)));
  } catch (err) {
    next(err);
  }
});

// PUT - save a purchase and its sales (plus optionally one new sale) atomically
const transactionEditBody = z.object({
  inventory: updateInventory,
  sales: updateSale.extend({ id: z.string().uuid() }).array().max(500),
  newSale: createSale.omit({ inventory_id: true }).optional(),
});
router.put('/:id/transaction', isAuthenticated, validateBody(transactionEditBody), async (req, res, next) => {
  try {
    const result = await editTransaction(prisma, req.params.id, req.user.id, req.body);
    await publishCalendarFeed(req.user.id);
    res.json(exactInventory(result));
  } catch (err) {
    next(err);
  }
});

// PUT - update an inventory record
router.put('/:id', isAuthenticated, validateBody(updateInventory), async (req, res, next) => {
  try {
    const existing = await prisma.inventory.findUnique({
      where: { id: req.params.id },
      include: { sales: { select: { quantity: true } } },
    });
    if (!existing || existing.user_id !== req.user.id) return res.status(404).json({ error: 'Not found' });

    const {
      product_name,
      unit_purchase_cost,
      qty_purchased,
      qty_on_hand,
      status,
      sales_tax,
      shipping_cost_inbound,
      fees,
      gift_card_amount,
      order_number,
      tracking_number,
      cashback_rate,
      cashback_earned,
      category,
      vendor_id,
      payment_method_id,
      purchase_date,
      tax_exempt,
    } = req.body;

    const data = {};
    await requireOwned('platform', vendor_id, req.user.id, 'Vendor');
    await requireOwned('paymentMethod', payment_method_id, req.user.id, 'Payment method');
    const soldQty = existing.sales.reduce((sum, sale) => sum + sale.quantity, 0);
    if (qty_purchased !== undefined) {
      const requestedQty = parseInt(qty_purchased, 10);
      if (requestedQty < soldQty) {
        return res.status(400).json({ error: 'Quantity purchased cannot be lower than units already sold' });
      }
      data.qty_purchased = requestedQty;
      data.qty_on_hand = requestedQty - soldQty;
    } else if (qty_on_hand !== undefined && parseInt(qty_on_hand, 10) + soldQty !== existing.qty_purchased) {
      return res.status(400).json({ error: 'On-hand quantity must equal purchased quantity minus sold quantity' });
    }
    if (product_name !== undefined)          data.product_name = product_name;
    if (unit_purchase_cost !== undefined)    data.unit_purchase_cost = parseFloat(unit_purchase_cost);
    if (qty_on_hand !== undefined && qty_purchased === undefined) data.qty_on_hand = parseInt(qty_on_hand);
    if (status !== undefined) {
      data.status = status;
      if (existing.status?.toUpperCase().includes('PRE') && status === 'On Hand') {
        data.received_date = new Date();
      }
    }
    if (sales_tax !== undefined)             data.sales_tax = parseFloat(sales_tax) || 0;
    if (shipping_cost_inbound !== undefined) data.shipping_cost_inbound = parseFloat(shipping_cost_inbound) || 0;
    if (fees !== undefined)                  data.fees = parseFloat(fees) || 0;
    if (gift_card_amount !== undefined)      data.gift_card_amount = parseFloat(gift_card_amount) || 0;
    if (order_number !== undefined)          data.order_number = order_number || null;
    if (tracking_number !== undefined)       data.tracking_number = tracking_number || null;
    // Adding a tracking number to a still-pre-shipment item automatically
    // advances its status — never overrides an explicit status change in the
    // same request, and never touches an item that's already further along.
    // The legacy column advances to exactly the value it always did; the
    // status-workflow column advances alongside it when the row has one.
    if (status === undefined && tracking_number && !existing.tracking_number) {
      const advanced = statusTransitions.trackingAttached('inventory', existing, tracking_number);
      if (advanced.legacy_status) data.status = advanced.legacy_status;
      Object.assign(data, advanced.data);
      // An auto-advance here is a real receiving-status change, so it carries the
      // same "last status updated" stamp an action endpoint would write.
      if (advanced.data.receiving_status) data.receiving_status_changed_at = new Date();
    }
    if (cashback_rate !== undefined)         data.cashback_rate = parseFloat(cashback_rate);
    if (cashback_earned !== undefined)       data.cashback_earned = parseFloat(cashback_earned) || 0;
    if (category !== undefined)              data.category = category || null;
    if (vendor_id !== undefined)             data.vendor_id = vendor_id || null;
    if (payment_method_id !== undefined)     data.payment_method_id = payment_method_id || null;
    if (purchase_date !== undefined)         data.purchase_date = parseLocalDate(purchase_date);
    if (tax_exempt !== undefined)            data.tax_exempt = tax_exempt === true || tax_exempt === 'true';

    // Quantity fields double as the basis for every sale's stock math, so a
    // concurrent sale changing qty_on_hand between the read above and this
    // write must not be silently overwritten.
    const updated = (qty_purchased !== undefined || qty_on_hand !== undefined)
      ? await prisma.$transaction(async (tx) => {
        const claim = await tx.inventory.updateMany({
          where: {
            id: req.params.id, user_id: req.user.id,
            qty_purchased: existing.qty_purchased, qty_on_hand: existing.qty_on_hand,
          },
          data,
        });
        if (claim.count !== 1) throw Object.assign(new Error('Inventory changed while saving. Reload and retry.'), { status: 409 });
        return tx.inventory.findUnique({ where: { id: req.params.id }, include: { vendor: true, payment_method: true } });
      })
      : await prisma.inventory.update({
        where: { id: req.params.id },
        data,
        include: { vendor: true, payment_method: true }
      });
    await publishCalendarFeed(req.user.id);
    res.json(exactInventory(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE an inventory item (and cascade-delete any linked sales)
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.inventory.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found or access denied' });
    }

    // The foreign-key cascade deletes linked sales atomically with inventory
    // in one statement. A failed purchase delete must preserve its entire
    // sale history — a separate manual deleteMany here could otherwise
    // succeed while the inventory delete that follows it fails.
    await prisma.inventory.delete({ where: { id: req.params.id } });

    await publishCalendarFeed(req.user.id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE inventory error:', err);
    next(err);
  }
});

// POST /api/inventory/:id/actions/:action - perform one status-workflow action
router.post('/:id/actions/:action', isAuthenticated, validateBody(statusActionBody), async (req, res, next) => {
  try {
    const { id, action } = req.params;
    const existing = await prisma.inventory.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found or access denied' });
    }
    // The record's own current status decides what it can do, so a client
    // cannot force an action the state does not support. applyTransition
    // re-checks this inside the transaction, against the row it actually
    // claims, which is what makes a concurrent action safe rather than this.
    if (!statusTransitions.isActionAllowed(existing, 'inventory', action)) {
      return res.status(409).json({ error: `Action "${action}" is not available for this purchase's current status` });
    }

    const payload = { ...statusTransitions.actionPayload(action, req.body), user_id: req.user.id };
    const result = await prisma.$transaction((tx) =>
      statusTransitions.applyTransition(tx, 'inventory', existing, action, payload));

    await publishCalendarFeed(req.user.id);
    // The recomputed actions travel with the record so the client can redraw
    // its buttons without a second request.
    res.json(withActions(exactInventory(result.record)));
  } catch (err) {
    next(err);
  }
});

// POST /api/inventory/:id/track - refresh live carrier status for this item's tracking number
router.post('/:id/track', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.inventory.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found or access denied' });
    }
    if (!existing.tracking_number) {
      return res.status(400).json({ error: 'No tracking number set for this item' });
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
    const updated = shared.inventory.find((row) => row.id === req.params.id)
      || { ...existing, tracking_info: shared.tracking_info };
    res.json({ ...withActions(exactInventory(updated)), rate_limit: { remaining: rate.remaining, resetAt: rate.resetAt } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
