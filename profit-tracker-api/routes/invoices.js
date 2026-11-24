const express = require('express');
const router = express.Router();
const { validateBody } = require('../middleware/validate');
const { createInvoice: createInvoiceBody, updateInvoice: updateInvoiceBody } = require('../validation/schemas');
const invoices = require('../services/invoices');

// Invoices to buyers, built from recorded sales (services/invoices.js).

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireId = (value, label) => {
  if (!UUID.test(String(value || ''))) throw Object.assign(new Error(`${label} not found`), { status: 404 });
  return value;
};

// GET /api/invoices — every invoice, newest first, with its lines and totals.
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await invoices.listInvoices(req.user.id));
  } catch (err) {
    next(err);
  }
});

// GET /api/invoices/billable?buyer_id=…&invoice_id=… — the buyer's sales that
// can go on an invoice (invoice_id: also offer the ones already on that draft).
router.get('/billable', isAuthenticated, async (req, res, next) => {
  try {
    const buyerId = requireId(req.query.buyer_id, 'Buyer');
    const exceptInvoiceId = req.query.invoice_id ? requireId(req.query.invoice_id, 'Invoice') : null;
    res.json(await invoices.billableSales(req.user.id, buyerId, { exceptInvoiceId }));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await invoices.getInvoice(req.user.id, requireId(req.params.id, 'Invoice')));
  } catch (err) {
    next(err);
  }
});

router.post('/', isAuthenticated, validateBody(createInvoiceBody), async (req, res, next) => {
  try {
    res.status(201).json(await invoices.createInvoice(req.user.id, req.body));
  } catch (err) {
    next(err);
  }
});

router.put('/:id', isAuthenticated, validateBody(updateInvoiceBody), async (req, res, next) => {
  try {
    res.json(await invoices.updateInvoice(req.user.id, requireId(req.params.id, 'Invoice'), req.body));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await invoices.deleteInvoice(req.user.id, requireId(req.params.id, 'Invoice')));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
