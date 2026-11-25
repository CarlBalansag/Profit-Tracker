// To-Do page API. The items are worked out from the user's records on every
// read (services/todos.js); the only thing written is what the user did with
// one item -- snoozed, dismissed, waiting until paid (a late payout), or
// marked done (a card bill paid) -- as a TodoState row keyed by the item's key.
const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { listTodos } = require('../services/todos');

const router = express.Router();

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// "<type>:<record id>" with an optional ":<YYYY-MM-DD>" for one occurrence or
// ":<second record id>" (an email order and the match it may belong to).
const KEY_RE = /^[a-z][a-z_-]{1,30}:[A-Za-z0-9-]{1,64}(:[A-Za-z0-9-]{1,64})?$/;
const serverToday = () => new Date().toISOString().slice(0, 10);

// The user's own date, from their device. Anything not a real date within a
// day or so of the server's clock falls back to the server's date, so a bad
// value can't pull items far into the past or future.
function resolveToday(value) {
  const fallback = serverToday();
  if (typeof value !== 'string' || !DATE_RE.test(value)) return fallback;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) return fallback;
  const drift = Math.abs(parsed - Date.parse(`${fallback}T00:00:00Z`)) / 86400000;
  return drift <= 1 ? value : fallback;
}

const stateBody = z.object({
  key: z.string().regex(KEY_RE, 'Not a to-do key.'),
  action: z.enum(['snooze', 'dismiss', 'done', 'until_paid']),
  until: z.string().regex(DATE_RE, 'until must be YYYY-MM-DD.').optional(),
  today: z.string().optional(),
}).strict();

const STATE_OF = { snooze: 'snoozed', dismiss: 'dismissed', done: 'done', until_paid: 'waiting' };

router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await listTodos(prisma, req.user.id, resolveToday(req.query.today)));
  } catch (err) {
    next(err);
  }
});

router.post('/state', isAuthenticated, validateBody(stateBody), async (req, res, next) => {
  try {
    const { key, action, until } = req.body;
    const today = resolveToday(req.body.today);
    // Only a late payout can wait until it's paid; it clears once it is.
    if (action === 'until_paid' && !key.startsWith('payout:')) {
      return res.status(400).json({ error: 'Only a late payout can wait until it is paid.' });
    }
    if (action === 'snooze') {
      if (!until) return res.status(400).json({ error: 'Pick a date to snooze until.' });
      const days = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
      if (!(days >= 1 && days <= 366)) return res.status(400).json({ error: 'Snooze until a day from tomorrow to a year out.' });
    }
    const data = { state: STATE_OF[action], until: action === 'snooze' ? until : null };
    const saved = await prisma.todoState.upsert({
      where: { user_id_key: { user_id: req.user.id, key } },
      create: { user_id: req.user.id, key, ...data },
      update: data,
    });
    res.json({ key: saved.key, state: saved.state, until: saved.until });
  } catch (err) {
    next(err);
  }
});

// Undo: show the item again.
router.delete('/state', isAuthenticated, async (req, res, next) => {
  try {
    const { key } = req.query;
    if (typeof key !== 'string' || !KEY_RE.test(key)) return res.status(400).json({ error: 'Not a to-do key.' });
    const { count } = await prisma.todoState.deleteMany({ where: { user_id: req.user.id, key } });
    res.json({ key, restored: count > 0 });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
module.exports.resolveToday = resolveToday;
