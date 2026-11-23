const express = require('express');
const { withReceiptLink } = require('../services/privateReceipts');
const activityLog = require('../services/activityLog');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { createExpense, updateExpense } = require('../validation/schemas');
const { withExactFields, MAPPINGS } = require('../services/decimalRead');
const { requireOwned } = require('../services/ownership');
const { derivedExpenseLines } = require('../services/derivedExpenses');
const { normalizeExternalId, findExpenseByExternalId, isExternalIdConflict } = require('../services/expenseExternalId');

// Shown in the expense form, where the field is called "Transaction ID".
const DUPLICATE_MESSAGE = 'This transaction ID is already recorded on another expense.';

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// Substitutes exact Decimal values on the expense itself and its nested
// payment_method (same pattern as inventory.js/sales.js -- see QA-28).
function exactExpense(expense) {
  if (!expense) return expense;
  const result = withReceiptLink(withExactFields(expense, MAPPINGS.expense), 'expense');
  if (result.payment_method) result.payment_method = withExactFields(result.payment_method, MAPPINGS.paymentMethod);
  return result;
}

// GET all expenses for current user
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const expenses = await prisma.expense.findMany({
      where: { user_id: req.user.id },
      orderBy: { date: 'desc' },
      include: { payment_method: { select: { id: true, name: true, type: true } } },
    });
    res.json(expenses.map(exactExpense));
  } catch (err) {
    next(err);
  }
});

// GET read-only lines computed from purchases and sales (tax, shipping, fees,
// commission). Kept separate from GET / so Schedule C and MCP keep seeing only
// manual expenses -- see services/derivedExpenses.js.
router.get('/derived', isAuthenticated, async (req, res, next) => {
  try {
    const inventories = await prisma.inventory.findMany({
      where: { user_id: req.user.id },
      include: {
        sales: { include: { sale_shipping_payment_method: { select: { id: true, name: true, type: true } } } },
        payment_method: { select: { id: true, name: true, type: true } },
      },
    });
    res.json(derivedExpenseLines(inventories));
  } catch (err) {
    next(err);
  }
});

// POST new expense
router.post('/', isAuthenticated, validateBody(createExpense), async (req, res, next) => {
  try {
    const { name, amount, category, date, notes, receipt_url, payment_method_id, tax_details } = req.body;
    if (!name || !amount || !date) {
      return res.status(400).json({ error: 'name, amount, and date are required' });
    }
    await requireOwned('paymentMethod', payment_method_id, req.user.id, 'Payment method');
    const externalId = normalizeExternalId(req.body.external_id) ?? null;
    const duplicate = await findExpenseByExternalId(prisma, req.user.id, externalId);
    if (duplicate) return res.status(409).json({ error: DUPLICATE_MESSAGE, existing_id: duplicate.id });
    const { result: expense, activity } = await prisma.$transaction((tx) => activityLog.trackChange(tx, req.user.id, {
      action: 'create',
      recordType: 'expense',
      refs: async (t, created) => ({ expense: created ? [created.id] : [] }),
      recordId: (created) => created.id,
    }, () => tx.expense.create({
      data: {
        user_id: req.user.id,
        name,
        amount: parseFloat(amount),
        category: category || null,
        date: parseLocalDate(date),
        notes: notes || null,
        external_id: externalId,
        receipt_url: receipt_url || null,
        payment_method_id: payment_method_id || null,
        ...(tax_details !== undefined ? { tax_details } : {}),
      },
      include: { payment_method: { select: { id: true, name: true, type: true } } },
    })));
    res.json({ ...exactExpense(expense), activity_id: activity?.id ?? null });
  } catch (err) {
    if (isExternalIdConflict(err)) return res.status(409).json({ error: DUPLICATE_MESSAGE });
    next(err);
  }
});

// PUT update expense
router.put('/:id', isAuthenticated, validateBody(updateExpense), async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { name, amount, category, date, notes, receipt_url, payment_method_id, tax_details } = req.body;
    if (payment_method_id !== undefined) await requireOwned('paymentMethod', payment_method_id, req.user.id, 'Payment method');
    const data = {};
    if (tax_details?.reviewed && req.body.expected_tax_version === undefined) return res.status(400).json({ error: 'Reload the expense and provide its expected_tax_version before marking reviewed' });
    if (tax_details !== undefined) data.tax_details = tax_details;
    else if (existing.tax_details?.reviewed && ['amount', 'date', 'name', 'category'].some(key => req.body[key] !== undefined)) data.tax_details = { ...existing.tax_details, reviewed: false };
    if (name !== undefined)        data.name = name;
    if (amount !== undefined)      data.amount = parseFloat(amount);
    if (category !== undefined)    data.category = category || null;
    if (date !== undefined)        data.date = parseLocalDate(date);
    if (notes !== undefined)       data.notes = notes || null;
    const externalId = normalizeExternalId(req.body.external_id);
    if (externalId !== undefined) {
      const duplicate = await findExpenseByExternalId(prisma, req.user.id, externalId, req.params.id);
      if (duplicate) return res.status(409).json({ error: DUPLICATE_MESSAGE, existing_id: duplicate.id });
      data.external_id = externalId;
    }
    if (receipt_url !== undefined) data.receipt_url = receipt_url || null;
    if (payment_method_id !== undefined) data.payment_method_id = payment_method_id || null;

    const { result: updated, activity } = await prisma.$transaction(async tx => activityLog.trackChange(tx, req.user.id, {
      action: 'edit',
      recordType: 'expense',
      refs: async () => ({ expense: [req.params.id] }),
      recordId: req.params.id,
    }, async () => {
      const claimed = await tx.expense.updateMany({
        where: { id: req.params.id, user_id: req.user.id, tax_version: req.body.expected_tax_version ?? existing.tax_version ?? 0 },
        data: { ...data, tax_version: { increment: 1 } },
      });
      if (!claimed.count) throw Object.assign(new Error('Expense changed since it was opened. Reload the worksheet before reviewing again.'), { status: 409 });
      return tx.expense.findUnique({ where: { id: req.params.id }, include: { payment_method: { select: { id: true, name: true, type: true } } } });
    }));
    res.json({ ...exactExpense(updated), activity_id: activity?.id ?? null });
  } catch (err) {
    if (isExternalIdConflict(err)) return res.status(409).json({ error: DUPLICATE_MESSAGE });
    next(err);
  }
});

// Mark many expenses' documentation at once: "external" (kept elsewhere),
// "insufficient", or null to clear. Owner-only; one Activity entry with Undo.
const { z } = require('zod');
const documentationBody = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  documentation: z.enum(['external', 'insufficient']).nullable(),
  note: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).nullable().optional()),
}).strict();
router.patch('/documentation', isAuthenticated, validateBody(documentationBody), async (req, res, next) => {
  try {
    const ids = [...new Set(req.body.ids)];
    const owned = await prisma.expense.findMany({ where: { id: { in: ids }, user_id: req.user.id }, select: { id: true } });
    if (owned.length !== ids.length) return res.status(404).json({ error: 'Some of these expenses were not found.' });
    const { activity } = await prisma.$transaction((tx) => activityLog.trackChange(tx, req.user.id, {
      action: 'edit', recordType: 'expense', recordId: ids[0],
      productName: ids.length > 1 ? `${ids.length} expenses` : undefined,
      refs: async () => ({ expense: ids }),
    }, () => tx.expense.updateMany({
      where: { id: { in: ids }, user_id: req.user.id },
      data: { documentation: req.body.documentation, documentation_note: req.body.documentation ? req.body.note ?? null : null },
    })));
    res.json({ updated: ids.length, activity_id: activity?.id ?? null });
  } catch (err) { next(err); }
});

// DELETE expense
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const { activity } = await prisma.$transaction((tx) => activityLog.trackChange(tx, req.user.id, {
      action: 'delete',
      recordType: 'expense',
      recordId: req.params.id,
      productName: existing.name,
      refs: async () => ({ expense: [req.params.id] }),
    }, () => tx.expense.delete({ where: { id: req.params.id } })));
    res.json({ success: true, activity_id: activity?.id ?? null });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
