// Reminders the user writes themselves. Due ones show on the To-Do list
// (services/todos.js); all of them show on the Calendar and in the phone
// calendar feed, which is republished after every change.
const express = require('express');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { requireOwned } = require('../services/ownership');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { createReminder, updateReminder, undoComplete, nextDueDate } = require('../services/reminders');
const { resolveToday } = require('./todos');

const router = express.Router();

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const include = { payment_method: { select: { id: true, name: true, last4: true } } };

const notFound = () => Object.assign(new Error('Reminder not found'), { status: 404 });

async function ownReminder(id, userId) {
  const reminder = await prisma.reminder.findFirst({ where: { id, user_id: userId } });
  if (!reminder) throw notFound();
  return reminder;
}

// A card the reminder is about must be one of this user's.
async function checkCard(paymentMethodId, userId) {
  if (paymentMethodId) await requireOwned('paymentMethod', paymentMethodId, userId, 'Card');
}

// GET /api/reminders?status=open|done -- open (default) soonest first, done
// most recently finished first.
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const done = req.query.status === 'done';
    const reminders = await prisma.reminder.findMany({
      where: { user_id: req.user.id, done_at: done ? { not: null } : null },
      orderBy: done ? { done_at: 'desc' } : [{ due_date: 'asc' }, { due_time: 'asc' }],
      include,
      ...(done ? { take: 50 } : {}),
    });
    res.json(reminders);
  } catch (err) {
    next(err);
  }
});

router.post('/', isAuthenticated, validateBody(createReminder), async (req, res, next) => {
  try {
    const { title, notes = null, due_date, due_time = null, repeat, payment_method_id = null } = req.body;
    await checkCard(payment_method_id, req.user.id);
    const reminder = await prisma.reminder.create({
      data: {
        user_id: req.user.id, title, notes, due_date, due_time, repeat, payment_method_id,
        repeat_from: repeat === 'none' ? null : due_date,
      },
      include,
    });
    await publishCalendarFeed(req.user.id);
    res.status(201).json(reminder);
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', isAuthenticated, validateBody(updateReminder), async (req, res, next) => {
  try {
    const existing = await ownReminder(req.params.id, req.user.id);
    const changes = req.body;
    if (changes.payment_method_id !== undefined) await checkCard(changes.payment_method_id, req.user.id);
    const data = { ...changes };
    // Setting a new date or repeat restarts the count from that date.
    const repeat = changes.repeat ?? existing.repeat;
    if (changes.due_date !== undefined || changes.repeat !== undefined) {
      data.repeat_from = repeat === 'none' ? null : (changes.due_date ?? existing.due_date);
    }
    const reminder = await prisma.reminder.update({ where: { id: existing.id }, data, include });
    await publishCalendarFeed(req.user.id);
    res.json(reminder);
  } catch (err) {
    next(err);
  }
});

// POST /api/reminders/:id/complete -- a one-off is done; a repeating one moves
// to its next date. `previous` is what Undo sends back through PATCH.
router.post('/:id/complete', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await ownReminder(req.params.id, req.user.id);
    if (existing.done_at) return res.status(409).json({ error: 'This reminder is already done.' });
    // The date the user saw when they tapped Done. A second tap (or a stale
    // screen) names a date the reminder has already moved past, so it can't
    // skip a cycle.
    const seen = req.body?.due_date;
    if (seen !== undefined && seen !== existing.due_date) {
      return res.status(409).json({ error: 'This reminder already moved on. Refresh to see it.' });
    }
    const today = resolveToday(req.body?.today);
    const next = nextDueDate(existing, today);
    // Guarded on the row being unchanged, so a double tap can't skip a cycle.
    const { count } = await prisma.reminder.updateMany({
      where: { id: existing.id, user_id: req.user.id, due_date: existing.due_date, done_at: null },
      data: next ? { due_date: next } : { done_at: new Date() },
    });
    if (!count) return res.status(409).json({ error: 'This reminder changed. Refresh and try again.' });
    const reminder = await prisma.reminder.findFirst({ where: { id: existing.id }, include });
    await publishCalendarFeed(req.user.id);
    res.json({ reminder, previous: { due_date: existing.due_date } });
  } catch (err) {
    next(err);
  }
});

// POST /api/reminders/:id/undo-complete { due_date } -- Undo for complete: back
// to the date it had, open again. The repeat keeps counting from where it did.
router.post('/:id/undo-complete', isAuthenticated, validateBody(undoComplete), async (req, res, next) => {
  try {
    const existing = await ownReminder(req.params.id, req.user.id);
    const reminder = await prisma.reminder.update({
      where: { id: existing.id },
      data: { due_date: req.body.due_date, done_at: null },
      include,
    });
    await publishCalendarFeed(req.user.id);
    res.json(reminder);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const existing = await ownReminder(req.params.id, req.user.id);
    await prisma.reminder.delete({ where: { id: existing.id } });
    await publishCalendarFeed(req.user.id);
    res.json({ id: existing.id, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
