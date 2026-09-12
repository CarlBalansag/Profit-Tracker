const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { currencyWrite } = require('../services/currencyWrite');
const { validateBody } = require('../middleware/validate');
const { recurringExpense, updateRecurringExpense } = require('../validation/schemas');

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(str + 'T12:00:00.000Z');
  return new Date(str);
};

// ── Generate occurrence dates from start up to today ────────────────────────
function getOccurrences(frequency, start, end) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const cutoff = end && new Date(end) < today ? new Date(end) : today;

  const dates = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const monthlyAnchorDay = cursor.getDate();

  // Don't generate future dates
  if (cursor > cutoff) return dates;

  while (cursor <= cutoff) {
    dates.push(new Date(cursor));
    if (frequency === 'weekly') {
      cursor.setDate(cursor.getDate() + 7);
    } else if (frequency === 'biweekly') {
      cursor.setDate(cursor.getDate() + 14);
    } else {
      // Clamp to the last day of the next month instead of letting Date overflow
      // Jan 31 into March when February has fewer days.
      const nextMonth = cursor.getMonth() + 1;
      const nextYear = cursor.getFullYear() + Math.floor(nextMonth / 12);
      const normalizedMonth = nextMonth % 12;
      const lastDay = new Date(nextYear, normalizedMonth + 1, 0).getDate();
      cursor.setFullYear(nextYear, normalizedMonth, Math.min(monthlyAnchorDay, lastDay));
    }
  }
  return dates;
}

// ── Generate missing Expense entries for one recurring record ────────────────
async function generateEntries(rec, client) {
  const lastGen = rec.last_generated ? new Date(rec.last_generated) : null;
  const occurrences = getOccurrences(rec.frequency, rec.start_date, rec.end_date);

  // Filter to only occurrences after last_generated (or all if never generated)
  const toCreate = lastGen
    ? occurrences.filter(d => d > lastGen)
    : occurrences;

  if (toCreate.length === 0) return;

  await client.expense.createMany({
    data: toCreate.map(date => currencyWrite('Expense', ({
      user_id:             rec.user_id,
      name:                rec.name,
      amount:              rec.amount,
      category:            rec.category,
      date,
      notes:               rec.notes || null,
      recurring_expense_id: rec.id,
    }))),
    skipDuplicates: true,
  });

  // Update last_generated to the most recent occurrence created
  const latest = toCreate[toCreate.length - 1];
  await client.recurringExpense.update({
    where: { id: rec.id },
    data:  { last_generated: latest },
  });
}

// ── GET all — also runs generation for active records ────────────────────────
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const items = await prisma.recurringExpense.findMany({
      where: { user_id: req.user.id },
      orderBy: { start_date: 'desc' },
    });

    // Generate missing entries for active recurring expenses
    if (req.query.export !== 'true') {
      await Promise.all(
        items.filter(r => r.active).map(r => prisma.$transaction(tx => generateEntries(r, tx)))
      );
    }

    res.json(items);
  } catch (err) {
    next(err);
  }
});

// ── POST new recurring expense ────────────────────────────────────────────────
router.post('/', isAuthenticated, validateBody(recurringExpense), async (req, res, next) => {
  try {
    const { name, amount, category, frequency, start_date, end_date, notes } = req.body;
    if (!name || amount === undefined || !frequency || !start_date) {
      return res.status(400).json({ error: 'name, amount, frequency, and start_date are required' });
    }
    if (end_date && parseLocalDate(end_date) < parseLocalDate(start_date)) {
      return res.status(400).json({ error: 'End date cannot be before start date' });
    }

    const rec = await prisma.$transaction(async tx => {
    const created = await tx.recurringExpense.create({
      data: currencyWrite('RecurringExpense', {
        user_id:    req.user.id,
        name,
        amount:     parseFloat(amount),
        category:   category  || null,
        frequency,
        start_date: parseLocalDate(start_date),
        end_date:   end_date  ? parseLocalDate(end_date) : null,
        notes:      notes     || null,
        active:     true,
      })
    });

    // Immediately generate all past occurrences
    await generateEntries(created, tx);
    return tx.recurringExpense.findUnique({ where: { id: created.id } });
    });

    res.json(rec);
  } catch (err) {
    next(err);
  }
});

// ── PUT update (also handles pause/resume via active field) ──────────────────
router.put('/:id', isAuthenticated, validateBody(updateRecurringExpense), async (req, res, next) => {
  try {
    const existing = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const { name, amount, category, frequency, start_date, end_date, notes, active } = req.body;
    const data = {};
    if (name       !== undefined) data.name       = name;
    if (amount     !== undefined) data.amount     = parseFloat(amount);
    if (category   !== undefined) data.category   = category || null;
    if (frequency  !== undefined) data.frequency  = frequency;
    if (start_date !== undefined) data.start_date = parseLocalDate(start_date);
    if (end_date   !== undefined) data.end_date   = end_date ? parseLocalDate(end_date) : null;
    if (notes      !== undefined) data.notes      = notes || null;

    // Resuming from paused: reset last_generated so new entries get picked up
    const wasInactive = !existing.active;
    const nowActive   = active === true;
    if (active !== undefined) data.active = Boolean(active);
    if (wasInactive && nowActive) data.last_generated = existing.last_generated; // keep, generateEntries handles gaps

    const effectiveStart = data.start_date ?? existing.start_date;
    const effectiveEnd = data.end_date !== undefined ? data.end_date : existing.end_date;
    if (effectiveEnd && new Date(effectiveEnd) < new Date(effectiveStart)) {
      return res.status(400).json({ error: 'End date cannot be before start date' });
    }
    const updated = await prisma.$transaction(async tx => {
    const saved = await tx.recurringExpense.update({ where: { id: req.params.id }, data: currencyWrite('RecurringExpense', data) });

    // If still active after update, generate any new entries
    if (saved.active) {
      await generateEntries(saved, tx);
    }
    return tx.recurringExpense.findUnique({ where: { id: saved.id } });
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── DELETE recurring expense and all its generated entries ───────────────────
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await prisma.recurringExpense.findUnique({ where: { id: req.params.id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    // Delete all auto-generated expense entries tied to this recurring record
    await prisma.expense.deleteMany({ where: { recurring_expense_id: req.params.id } });
    await prisma.recurringExpense.delete({ where: { id: req.params.id } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
