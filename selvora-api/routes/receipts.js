const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const cloudinary = require('cloudinary').v2;
const { validateBody } = require('../middleware/validate');
const { attachReceipt, detachReceipt } = require('../validation/schemas');

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
router.get('/', isAuthenticated, async (req, res, next) => {
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
    next(err);
  }
});

// Allowed MIME types for receipt uploads
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// POST /api/receipts/attach — upload receipt to Cloudinary, store URL in DB
router.post('/attach', isAuthenticated, validateBody(attachReceipt), async (req, res, next) => {
  try {
    const { itemType, itemId, fileData, fileName } = req.body;
    if (!itemType || !itemId || !fileData) {
      return res.status(400).json({ error: 'itemType, itemId, and fileData are required' });
    }

    // Validate that fileData is a data URL with an allowed MIME type
    const dataUrlMatch = fileData.match(/^data:([^;]+);base64,/);
    if (!dataUrlMatch) {
      return res.status(400).json({ error: 'fileData must be a base64 data URL' });
    }
    const mimeType = dataUrlMatch[1];
    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return res.status(400).json({ error: 'File type not allowed. Use JPEG, PNG, WebP, GIF, or PDF.' });
    }

    // Validate decoded file size server-side
    const base64Data = fileData.slice(dataUrlMatch[0].length);
    const byteLength = Math.ceil(base64Data.length * 0.75);
    if (byteLength > MAX_BYTES) {
      return res.status(400).json({ error: 'File exceeds the 5 MB size limit.' });
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
    next(err);
  }
});

// DELETE /api/receipts/detach — remove receipt from DB (Cloudinary file stays for now)
router.delete('/detach', isAuthenticated, validateBody(detachReceipt), async (req, res, next) => {
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
    next(err);
  }
});

module.exports = router;
