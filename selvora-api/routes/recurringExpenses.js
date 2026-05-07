const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// ── Generate occurrence dates from start up to today ────────────────────────
function getOccurrences(frequency, start, end) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const cutoff = end && new Date(end) < today ? new Date(end) : today;

  const dates = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);

  // Don't generate future dates
  if (cursor > cutoff) return dates;

  while (cursor <= cutoff) {
    dates.push(new Date(cursor));
    if (frequency === 'weekly') {
      cursor.setDate(cursor.getDate() + 7);
    } else if (frequency === 'biweekly') {
      cursor.setDate(cursor.getDate() + 14);
    } else {
      // monthly: advance by one month
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return dates;
}

// ── Generate missing Expense entries for one recurring record ────────────────
async function generateEntries(rec) {
  const lastGen = rec.last_generated ? new Date(rec.last_generated) : null;
  const occurrences = getOccurrences(rec.frequency, rec.start_date, rec.end_date);

  // Filter to only occurrences after last_generated (or all if never generated)
  const toCreate = lastGen
    ? occurrences.filter(d => d > lastGen)
    : occurrences;

  if (toCreate.length === 0) return;

  await prisma.expense.createMany({
    data: toCreate.map(date => ({
      user_id:             rec.user_id,
      name:                rec.name,
      amount:              rec.amount,
      category:            rec.category,
      date,
      notes:               rec.notes || null,
      recurring_expense_id: rec.id,
    })),
  });

  // Update last_generated to the most recent occurrence created
  const latest = toCreate[toCreate.length - 1];
  await prisma.recurringExpense.update({
    where: { id: rec.id },
    data:  { last_generated: latest },
  });
}

// ── GET all — also runs generation for active records ────────────────────────
router.get('/', isAuthenticated, async (req, res) => {
  try {
    const items = await prisma.recurringExpense.findMany({
      where: { user_id: req.user.id },
      orderBy: { start_date: 'desc' },
    });

    // Generate missing entries for active recurring expenses
    await Promise.all(
      items.filter(r => r.active).map(r => generateEntries(r))
    );

    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST new recurring expense ────────────────────────────────────────────────
router.post('/', isAuthenticated, async (req, res) => {
  try {
    const { name, amount, category, frequency, start_date, end_date, notes } = req.body;
    if (!name || !amount || !frequency || !start_date) {
      return res.status(400).json({ error: 'name, amount, frequency, and start_date are required' });
    }

    const rec = await prisma.recurringExpense.create({
      data: {
        user_id:    req.user.id,
        name,
        amount:     parseFloat(amount),
        category:   category  || null,
        frequency,
        start_date: new Date(start_date),
        end_date:   end_date  ? new Date(end_date) : null,
        notes:      notes     || null,
        active:     true,
      },
    });

    // Immediately generate all past occurrences
    await generateEntries(rec);

    res.json(rec);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PUT update (also handles pause/resume via active field) ──────────────────
router.put('/:id', isAuthenticated, async (req, res) => {
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
    if (start_date !== undefined) data.start_date = new Date(start_date);
    if (end_date   !== undefined) data.end_date   = end_date ? new Date(end_date) : null;
    if (notes      !== undefined) data.notes      = notes || null;

    // Resuming from paused: reset last_generated so new entries get picked up
    const wasInactive = !existing.active;
    const nowActive   = active === true;
    if (active !== undefined) data.active = Boolean(active);
    if (wasInactive && nowActive) data.last_generated = existing.last_generated; // keep, generateEntries handles gaps

    const updated = await prisma.recurringExpense.update({ where: { id: req.params.id }, data });

    // If still active after update, generate any new entries
    if (updated.active) {
      await generateEntries(updated);
    }

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE recurring expense and all its generated entries ───────────────────
router.delete('/:id', isAuthenticated, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
