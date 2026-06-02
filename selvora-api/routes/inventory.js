const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createInventory, updateInventory } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Parse a YYYY-MM-DD string as local noon to avoid UTC midnight timezone shifts
const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// GET all inventory items for current user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const items = await prisma.inventory.findMany({
      where: { user_id: req.user.id },
      select: {
        id: true, product_name: true, category: true, status: true,
        purchase_date: true, received_date: true,
        unit_purchase_cost: true, qty_purchased: true, qty_on_hand: true,
        sales_tax: true, shipping_cost_inbound: true, fees: true,
        cashback_earned: true, gift_card_amount: true,
        order_number: true, tracking_number: true, receipt_url: true,
        tax_exempt: true,
        vendor: { select: { id: true, name: true, type: true } },
        payment_method: { select: { id: true, name: true, type: true, default_cashback_rate: true, preset_card_id: true, category_rates: true } },
        sales: {
          select: {
            id: true, quantity: true, unit_price: true, commission_fee: true,
            sale_shipping: true, sale_date: true, payout_date: true, status: true,
            taxable: true, sale_tax_collected: true, customer_tax_exempt: true, exemption_type: true,
            platform: { select: { id: true, name: true, type: true, tax_exempt_place: true } },
            buyer: { select: { id: true, name: true } },
          }
        },
      },
      orderBy: { purchase_date: 'desc' }
    });
    res.json(items);
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
      sale_date,
      qty_sold,
      status
    } = req.body;

    console.log('POST inventory body:', JSON.stringify(req.body));
    const qty = parseInt(qty_purchased, 10) || 1;

    // Optional: if a sale is provided inline, we can create the sale here simultaneously if quantity matches. 
    // Wait, the specification says Phase 2 is Inventory & Sales API. Let's just create the inventory here.
    
    // Create Inventory
    const inventory = await prisma.inventory.create({
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
        cashback_earned: 0, // Calculated at query time from payment method rates
        category: category || null,
        tax_exempt: tax_exempt === true || tax_exempt === 'true'
      }
    });

    // If there was an immediate sale attached from the AddTransaction form
    if (sale_price) {
        const saleQty = parseInt(qty_sold, 10) || qty;
        const platform_id = sale_tab === 'marketplace'
            ? (marketplace_platform_id || null)
            : (cashout_platform_id || null);
        await prisma.sales.create({
            data: {
                inventory_id: inventory.id,
                platform_id,
                quantity: saleQty,
                unit_price: parseFloat(sale_price),
                commission_fee: parseFloat(commission_fee) || 0,
                sale_date: parseLocalDate(sale_date || purchase_date) || new Date(),
                payout_date: payout_date ? parseLocalDate(payout_date) : null,
                status: status || 'SOLD'
            }
        });
        await prisma.inventory.update({
            where: { id: inventory.id },
            data: { qty_on_hand: Math.max(0, qty - saleQty) }
        });
    }

    res.json(inventory);
  } catch (err) {
    next(err);
  }
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
    res.json(item);
  } catch (err) {
    next(err);
  }
});

// PUT - update an inventory record
router.put('/:id', isAuthenticated, validateBody(updateInventory), async (req, res, next) => {
  try {
    const existing = await prisma.inventory.findUnique({ where: { id: req.params.id } });
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
      cashback_earned,
      category,
      vendor_id,
      payment_method_id,
      purchase_date,
      tax_exempt,
    } = req.body;

    const data = {};
    if (product_name !== undefined)          data.product_name = product_name;
    if (unit_purchase_cost !== undefined)    data.unit_purchase_cost = parseFloat(unit_purchase_cost);
    if (qty_purchased !== undefined)         data.qty_purchased = parseInt(qty_purchased) ?? existing.qty_purchased;
    if (qty_on_hand !== undefined)           data.qty_on_hand = parseInt(qty_on_hand) ?? existing.qty_on_hand;
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
    if (cashback_earned !== undefined)       data.cashback_earned = parseFloat(cashback_earned) || 0;
    if (category !== undefined)              data.category = category || null;
    if (vendor_id !== undefined)             data.vendor_id = vendor_id || null;
    if (payment_method_id !== undefined)     data.payment_method_id = payment_method_id || null;
    if (purchase_date !== undefined)         data.purchase_date = parseLocalDate(purchase_date);
    if (tax_exempt !== undefined)            data.tax_exempt = tax_exempt === true || tax_exempt === 'true';

    const updated = await prisma.inventory.update({
      where: { id: req.params.id },
      data,
      include: { vendor: true, payment_method: true }
    });
    res.json(updated);
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

    // Manually delete linked sales first (belt-and-suspenders alongside DB cascade)
    await prisma.sales.deleteMany({ where: { inventory_id: req.params.id } });

    // Now delete the inventory record itself
    await prisma.inventory.delete({ where: { id: req.params.id } });

    res.json({ success: true });
  } catch (err) {
    console.error('DELETE inventory error:', err);
    next(err);
  }
});

module.exports = router;
