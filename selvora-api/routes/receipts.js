const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const cloudinary = require('cloudinary').v2;
const prisma = new PrismaClient();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// GET /api/receipts — returns all inventory + expense items split by receipt status
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const [inventories, expenses] = await Promise.all([
      prisma.inventory.findMany({
        where: { user_id: req.user.id },
        orderBy: { purchase_date: 'desc' },
        select: {
          id: true,
          product_name: true,
          purchase_date: true,
          unit_purchase_cost: true,
          qty_purchased: true,
          receipt_url: true,
        },
      }),
      prisma.expense.findMany({
        where: { user_id: req.user.id },
        orderBy: { date: 'desc' },
        select: {
          id: true,
          name: true,
          date: true,
          amount: true,
          receipt_url: true,
        },
      }),
    ]);

    const all = [
      ...inventories.map(inv => ({
        id: inv.id,
        itemType: 'inventory',
        name: inv.product_name,
        date: inv.purchase_date,
        amount: inv.unit_purchase_cost * inv.qty_purchased,
        receipt_url: inv.receipt_url || null,
      })),
      ...expenses.map(exp => ({
        id: exp.id,
        itemType: 'expense',
        name: exp.name,
        date: exp.date,
        amount: exp.amount,
        receipt_url: exp.receipt_url || null,
      })),
    ];

    const withReceipts    = all.filter(i => i.receipt_url);
    const withoutReceipts = all.filter(i => !i.receipt_url);

    res.json({ withReceipts, withoutReceipts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/receipts/attach — upload receipt to Cloudinary, store URL in DB
router.post('/attach', isAuthenticated, async (req, res) => {
  try {
    const { itemType, itemId, fileData, fileName } = req.body;
    if (!itemType || !itemId || !fileData) {
      return res.status(400).json({ error: 'itemType, itemId, and fileData are required' });
    }

    // Upload base64 dataURL to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(fileData, {
      folder: 'selvora/receipts',
      resource_type: 'auto',  // handles images and PDFs
      public_id: `${itemType}_${itemId}`,
      overwrite: true,
    });
    const receiptUrl = uploadResult.secure_url;

    if (itemType === 'inventory') {
      const existing = await prisma.inventory.findUnique({ where: { id: itemId } });
      if (!existing || existing.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.inventory.update({
        where: { id: itemId },
        data: { receipt_url: receiptUrl },
      });
    } else if (itemType === 'expense') {
      const existing = await prisma.expense.findUnique({ where: { id: itemId } });
      if (!existing || existing.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.expense.update({
        where: { id: itemId },
        data: { receipt_url: receiptUrl },
      });
    } else {
      return res.status(400).json({ error: 'itemType must be inventory or expense' });
    }

    res.json({ success: true, receipt_url: receiptUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/receipts/detach — remove receipt from DB (Cloudinary file stays for now)
router.delete('/detach', isAuthenticated, async (req, res) => {
  try {
    const { itemType, itemId } = req.body;
    if (!itemType || !itemId) {
      return res.status(400).json({ error: 'itemType and itemId are required' });
    }

    if (itemType === 'inventory') {
      const existing = await prisma.inventory.findUnique({ where: { id: itemId } });
      if (!existing || existing.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.inventory.update({ where: { id: itemId }, data: { receipt_url: null } });
    } else if (itemType === 'expense') {
      const existing = await prisma.expense.findUnique({ where: { id: itemId } });
      if (!existing || existing.user_id !== req.user.id) {
        return res.status(404).json({ error: 'Not found' });
      }
      await prisma.expense.update({ where: { id: itemId }, data: { receipt_url: null } });
    } else {
      return res.status(400).json({ error: 'itemType must be inventory or expense' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
