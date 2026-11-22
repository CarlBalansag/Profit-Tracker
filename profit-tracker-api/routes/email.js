// Email connections (phase E1). Owner-only: every query is scoped to
// req.user.id. Passwords are tested, encrypted and never returned or logged.
const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { PRESETS, SENDERS, normalizeHost } = require('../services/email/config');
const { encryptSecret, configured } = require('../services/email/crypto');
const { friendlyError } = require('../services/email/imap');
const { syncAccount, testConnection } = require('../services/email/sync');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Tests are the expensive, outward-facing call (we log in to someone's mail
// server), so each user gets a few per quarter hour.
const TEST_LIMIT = 10;
const TEST_WINDOW_MS = 15 * 60 * 1000;
const testAttempts = new Map();
function allowTest(userId, now = Date.now()) {
  const recent = (testAttempts.get(userId) || []).filter((t) => now - t < TEST_WINDOW_MS);
  if (recent.length >= TEST_LIMIT) { testAttempts.set(userId, recent); return false; }
  recent.push(now);
  testAttempts.set(userId, recent);
  return true;
}
const SYNC_COOLDOWN_MS = 60 * 1000;

const deps = { open: undefined, resolve: undefined }; // replaced in tests

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a start date');
const createBody = z.object({
  preset: z.enum(Object.keys(PRESETS)),
  email_address: z.string().trim().toLowerCase().email('Enter an email address').max(320),
  username: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(320).optional()),
  host: z.preprocess((v) => (v === '' ? undefined : v), z.string().trim().max(253).optional()),
  password: z.string().min(1, 'Enter the app password').max(512),
  sync_since: isoDay,
  include_spam: z.boolean().optional().default(false),
}).strict();
const updateBody = z.object({
  password: z.string().min(1).max(512).optional(),
  sync_since: isoDay.optional(),
  include_spam: z.boolean().optional(),
}).strict();

const PUBLIC_FIELDS = {
  id: true, provider: true, preset: true, email_address: true, imap_host: true, imap_username: true,
  status: true, last_error: true, sync_since: true, include_spam: true, last_synced_at: true,
  sync_started_at: true, created_at: true,
};

function sinceDate(day) {
  const d = new Date(`${day}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const notConfigured = (res) => res.status(503).json({ error: 'Email connections are not set up on this server yet.' });

router.get('/setup', isAuthenticated, (req, res) => {
  res.json({
    configured: configured(),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, host: p.host, help: p.help, helpUrl: p.helpUrl })),
    senders: SENDERS.map((s) => s.label),
  });
});

router.get('/accounts', isAuthenticated, async (req, res, next) => {
  try {
    const [accounts, counts] = await Promise.all([
      prisma.emailAccount.findMany({ where: { user_id: req.user.id }, select: PUBLIC_FIELDS, orderBy: { created_at: 'asc' } }),
      prisma.emailMessage.groupBy({ by: ['account_id'], where: { user_id: req.user.id }, _count: { _all: true } }),
    ]);
    const byAccount = new Map(counts.map((c) => [c.account_id, c._count._all]));
    res.json(accounts.map((a) => ({ ...a, message_count: byAccount.get(a.id) || 0, syncing: Boolean(a.sync_started_at) })));
  } catch (err) { next(err); }
});

router.get('/messages', isAuthenticated, async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const rows = await prisma.emailMessage.findMany({
      where: { user_id: req.user.id },
      orderBy: [{ sent_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
      take,
      select: { id: true, account_id: true, from_address: true, from_name: true, subject: true, sent_at: true, merchant: true, status: true },
    });
    res.json(rows);
  } catch (err) { next(err); }
});

router.post('/accounts', isAuthenticated, validateBody(createBody), async (req, res, next) => {
  try {
    if (!configured()) return notConfigured(res);
    const b = req.body;
    const preset = PRESETS[b.preset];
    const host = normalizeHost(preset.host || b.host);
    if (!host) return res.status(400).json({ error: 'Enter your mail server name (for example imap.example.com).' });
    const since = sinceDate(b.sync_since);
    if (!since || since > new Date()) return res.status(400).json({ error: 'Choose a start date that is not in the future.' });

    const existing = await prisma.emailAccount.findUnique({ where: { user_id_email_address: { user_id: req.user.id, email_address: b.email_address } } });
    if (existing) {
      return res.status(409).json({ error: existing.status === 'disconnected' ? 'This email is already in your list. Use Reconnect on it instead.' : 'This email is already connected.' });
    }
    if (!allowTest(req.user.id)) return res.status(429).json({ error: 'Too many connection attempts. Wait a few minutes and try again.' });

    const details = { preset: b.preset, imap_host: host, imap_port: preset.port, imap_username: b.username || null, email_address: b.email_address, password: b.password };
    try {
      await testConnection(details, deps);
    } catch (err) {
      return res.status(400).json({ error: friendlyError(err) });
    }
    let account;
    try {
      account = await prisma.emailAccount.create({
        data: {
          user_id: req.user.id, provider: 'imap', preset: b.preset, email_address: b.email_address,
          imap_host: host, imap_port: preset.port, imap_username: b.username || null,
          encrypted_secret: encryptSecret(b.password), sync_since: since, include_spam: b.include_spam,
        },
        select: PUBLIC_FIELDS,
      });
    } catch (err) {
      if (err?.code === 'P2002') return res.status(409).json({ error: 'This email is already connected.' });
      throw err;
    }
    // First sync runs in the background; the list shows it as syncing.
    Promise.resolve().then(() => syncAccount(account.id, deps)).catch(() => {});
    res.status(201).json({ ...account, message_count: 0, syncing: true });
  } catch (err) { next(err); }
});

const ownAccount = (req) => prisma.emailAccount.findFirst({ where: { id: req.params.id, user_id: req.user.id } });

router.patch('/accounts/:id', isAuthenticated, validateBody(updateBody), async (req, res, next) => {
  try {
    const account = await ownAccount(req);
    if (!account) return res.status(404).json({ error: 'Email account not found.' });
    const b = req.body;
    const data = {};
    let rescan = false;
    if (b.sync_since !== undefined) {
      const since = sinceDate(b.sync_since);
      if (!since || since > new Date()) return res.status(400).json({ error: 'Choose a start date that is not in the future.' });
      if (since < account.sync_since) rescan = true;
      data.sync_since = since;
    }
    if (b.include_spam !== undefined && b.include_spam !== account.include_spam) {
      data.include_spam = b.include_spam;
      rescan = rescan || b.include_spam;
    }
    if (b.password !== undefined) {
      if (!configured()) return notConfigured(res);
      if (!allowTest(req.user.id)) return res.status(429).json({ error: 'Too many connection attempts. Wait a few minutes and try again.' });
      try {
        await testConnection({ ...account, password: b.password }, deps);
      } catch (err) {
        return res.status(400).json({ error: friendlyError(err) });
      }
      Object.assign(data, { encrypted_secret: encryptSecret(b.password), status: 'active', last_error: null });
    }
    const updated = await prisma.$transaction(async (tx) => {
      // An earlier start date (or newly added spam folders) means mail the
      // cursors already passed; reading the folders again is safe (dedupe).
      if (rescan) await tx.emailFolderCursor.deleteMany({ where: { account_id: account.id } });
      return tx.emailAccount.update({ where: { id: account.id }, data, select: PUBLIC_FIELDS });
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.post('/accounts/:id/sync', isAuthenticated, async (req, res, next) => {
  try {
    const account = await ownAccount(req);
    if (!account) return res.status(404).json({ error: 'Email account not found.' });
    if (account.status === 'disconnected' || !account.encrypted_secret) return res.status(409).json({ error: 'Connect this account again before syncing.' });
    if (!configured()) return notConfigured(res);
    if (account.last_synced_at && Date.now() - account.last_synced_at.getTime() < SYNC_COOLDOWN_MS) {
      return res.status(429).json({ error: 'This account just synced. Try again in a minute.' });
    }
    const result = await syncAccount(account.id, { ...deps, budgetMs: 25000 });
    if (result.status === 'busy') return res.status(409).json({ error: 'This account is already syncing.' });
    res.json(result);
  } catch (err) { next(err); }
});

// ?delete_data=true also removes every email found through this account.
// Without it the password is erased and the found emails stay.
router.delete('/accounts/:id', isAuthenticated, async (req, res, next) => {
  try {
    const account = await ownAccount(req);
    if (!account) return res.status(404).json({ error: 'Email account not found.' });
    if (req.query.delete_data === 'true') {
      const deleted = await prisma.$transaction(async (tx) => {
        const messages = await tx.emailMessage.deleteMany({ where: { account_id: account.id, user_id: req.user.id } });
        await tx.emailAccount.delete({ where: { id: account.id } });
        return messages.count;
      });
      return res.json({ deleted: true, messages_deleted: deleted });
    }
    await prisma.$transaction([
      prisma.emailFolderCursor.deleteMany({ where: { account_id: account.id } }),
      prisma.emailAccount.update({
        where: { id: account.id },
        data: { encrypted_secret: null, status: 'disconnected', last_error: null, sync_started_at: null },
      }),
    ]);
    res.json({ disconnected: true });
  } catch (err) { next(err); }
});

router._deps = deps;
router._resetLimits = () => testAttempts.clear();
module.exports = router;
