// Email connections (phase E1). Owner-only: every query is scoped to
// req.user.id. Passwords are tested, encrypted and never returned or logged.
const router = require('express').Router();
const { z } = require('zod');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { PRESETS, SENDERS, normalizeHost, merchantFor } = require('../services/email/config');
const { encryptSecret, configured } = require('../services/email/crypto');
const { friendlyError } = require('../services/email/imap');
const { syncAccount, testConnection, openAccount, catchUp, catchingUp } = require('../services/email/sync');

// Keeps reading a big inbox until it is caught up, in the background.
// deps.catchUpRuns limits the runs (tests use 1).
const keepSyncing = (accountId) => catchUp(accountId, deps, { maxRuns: deps.catchUpRuns ?? 30 }).catch(() => {});
const { linkMatch, rejectMatch } = require('../services/email/match');
const { linkPreview, willFill } = require('../services/email/linkPreview');
const { toConfirmCount, confirmEntries, rejectEntry, namePurchase } = require('../services/email/review');
const { getSettings, saveSettings, DEFAULTS } = require('../services/email/settings');
const { createExpenseFromOrder, suggestRules, normalizeDomain, labelFor } = require('../services/email/rules');
const { createPurchasesFromOrder, applyCashoutReceipts } = require('../services/email/automations');

// A cash-out receipt the user just linked marks its sales paid right away.
const payLinkedReceipts = async (userId) => applyCashoutReceipts(prisma, userId, await getSettings(prisma, userId));
const { saveInvoice } = require('../services/email/attachments');
const { scanStores, sourceLabel } = require('../services/email/storeScan');

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
    const [accounts, counts, unread] = await Promise.all([
      prisma.emailAccount.findMany({ where: { user_id: req.user.id }, select: PUBLIC_FIELDS, orderBy: { created_at: 'asc' } }),
      prisma.emailMessage.groupBy({ by: ['account_id'], where: { user_id: req.user.id }, _count: { _all: true } }),
      prisma.emailMessage.groupBy({ by: ['account_id'], where: { user_id: req.user.id, status: 'new' }, _count: { _all: true } }),
    ]);
    const byAccount = new Map(counts.map((c) => [c.account_id, c._count._all]));
    const pending = new Map(unread.map((c) => [c.account_id, c._count._all]));
    // pending: emails found but not read yet. catching_up: still going through
    // the inbox (more may be found), so the card shows progress, not "Synced".
    res.json(accounts.map((a) => ({
      ...a, message_count: byAccount.get(a.id) || 0, pending: pending.get(a.id) || 0,
      syncing: Boolean(a.sync_started_at), catching_up: catchingUp.has(a.id),
    })));
  } catch (err) { next(err); }
});

const KIND_GROUPS = {
  orders: ['order', 'receipt'],
  shipping: ['shipped', 'delivered', 'pickup'],
  sales: ['sale', 'payout'],
  problems: ['cancelled', 'refund', 'return'],
};
// A link that opens the email in the user's mail app, where one exists.
function emailLink(preset, messageId) {
  const id = String(messageId || '').replace(/^<|>$/g, '');
  if (!id) return null;
  if (preset === 'gmail') return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(id)}`;
  return null;
}

router.get('/messages', isAuthenticated, async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 100000);
    const where = { user_id: req.user.id };
    const group = KIND_GROUPS[req.query.kind];
    if (group) where.kind = { in: group };
    if (req.query.show !== 'all') where.status = { not: 'ignored' };
    const [rows, total] = await Promise.all([
      prisma.emailMessage.findMany({
        where,
        orderBy: [{ sent_at: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        take,
        skip,
        select: {
          id: true, account_id: true, from_address: true, from_name: true, subject: true, sent_at: true, merchant: true, status: true,
          message_id: true, kind: true, order_number: true, currency: true, total: true, subtotal: true, tax: true, shipping: true,
          discount: true, tracking_numbers: true, items: true, payment_hint: true, confidence: true, extract_error: true,
          account: { select: { preset: true } },
        },
      }),
      prisma.emailMessage.count({ where }),
    ]);
    res.json({
      total,
      messages: rows.map(({ account, message_id: messageId, ...m }) => ({ ...m, link: emailLink(account?.preset, messageId) })),
    });
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
    Promise.resolve().then(() => keepSyncing(account.id));
    res.status(201).json({ ...account, message_count: 0, pending: 0, syncing: true, catching_up: true });
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
    if (catchingUp.has(account.id)) return res.status(409).json({ error: 'This account is already syncing.' });
    const result = await syncAccount(account.id, { ...deps, budgetMs: 25000 });
    if (result.status === 'busy') return res.status(409).json({ error: 'This account is already syncing.' });
    // A big inbox keeps going in the background until it is caught up.
    if (result.status === 'ok' && result.more) Promise.resolve().then(() => keepSyncing(account.id));
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
        // Orders made only from this account's emails go with them.
        await tx.emailOrder.deleteMany({ where: { user_id: req.user.id, messages: { none: {} } } });
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

// ---- Orders from email and their matches (E3) ----
const ORDER_STATES = ['review', 'linked', 'unmatched', 'dismissed'];
async function recordSummaries(userId, matches) {
  const ids = (type) => [...new Set(matches.filter((m) => m.record_type === type).flatMap((m) => m.record_ids))];
  const [purchases, sales, expenses] = await Promise.all([
    prisma.inventory.findMany({ where: { id: { in: ids('purchase') }, user_id: userId }, select: { id: true, product_name: true, purchase_date: true, qty_purchased: true, unit_purchase_cost: true, unit_purchase_cost_decimal: true, order_number: true } }),
    prisma.sales.findMany({ where: { id: { in: ids('sale') }, inventory: { user_id: userId } }, select: { id: true, sale_date: true, quantity: true, unit_price: true, unit_price_decimal: true, inventory: { select: { product_name: true } } } }),
    prisma.expense.findMany({ where: { id: { in: ids('expense') }, user_id: userId }, select: { id: true, name: true, date: true, amount: true, amount_decimal: true } }),
  ]);
  const map = new Map();
  for (const p of purchases) map.set(`purchase:${p.id}`, { id: p.id, name: p.product_name, date: p.purchase_date, amount: Number(p.unit_purchase_cost_decimal ?? p.unit_purchase_cost) * p.qty_purchased, quantity: p.qty_purchased });
  for (const x of sales) map.set(`sale:${x.id}`, { id: x.id, name: x.inventory?.product_name, date: x.sale_date, amount: Number(x.unit_price_decimal ?? x.unit_price) * x.quantity, quantity: x.quantity });
  for (const e of expenses) map.set(`expense:${e.id}`, { id: e.id, name: e.name, date: e.date, amount: Number(e.amount_decimal ?? e.amount) });
  return map;
}

router.get('/orders', isAuthenticated, async (req, res, next) => {
  try {
    const take = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const where = { user_id: req.user.id, type: { not: 'shipment' } };
    if (ORDER_STATES.includes(req.query.state)) where.match_state = req.query.state;
    const [orders, total, counts] = await Promise.all([
      prisma.emailOrder.findMany({
        where, take, skip, orderBy: { last_seen: { sort: 'desc', nulls: 'last' } },
        include: {
          matches: { where: { state: { in: ['suggested', 'linked'] } }, orderBy: { score: 'desc' } },
          _count: { select: { messages: true } },
        },
      }),
      prisma.emailOrder.count({ where }),
      prisma.emailOrder.groupBy({ by: ['match_state'], where: { user_id: req.user.id, type: { not: 'shipment' } }, _count: { _all: true } }),
    ]);
    const records = await recordSummaries(req.user.id, orders.flatMap((o) => o.matches));
    const fills = await willFill(prisma, req.user.id, orders.filter((o) => o.match_state === 'review'));
    const withPdf = new Set((await prisma.emailMessage.findMany({
      where: { user_id: req.user.id, order_id: { in: orders.map((o) => o.id) }, attachment_name: { not: null } },
      select: { order_id: true },
    })).map((m) => m.order_id));
    res.json({
      total,
      counts: Object.fromEntries(counts.map((c) => [c.match_state, c._count._all])),
      orders: orders.map(({ _count, matches, user_id: _u, key: _k, ...o }) => ({
        ...o,
        email_count: _count.messages,
        has_invoice: withPdf.has(o.id),
        matches: matches.map((m) => ({
          id: m.id, record_type: m.record_type, score: m.score, band: m.band, reasons: m.reasons, state: m.state, auto: m.auto,
          will_fill: fills.get(m.id) || [],
          records: m.record_ids.map((id) => records.get(`${m.record_type}:${id}`)).filter(Boolean),
        })),
      })),
    });
  } catch (err) { next(err); }
});

// What linking this match would change, before it does (Review & link).
router.get('/matches/:id/preview', isAuthenticated, async (req, res, next) => {
  try {
    const preview = await linkPreview(prisma, req.user.id, req.params.id, await getSettings(prisma, req.user.id));
    if (!preview) return res.status(404).json({ error: 'This match is no longer available.' });
    res.json(preview);
  } catch (err) { next(err); }
});

router.post('/matches/:id/accept', isAuthenticated, async (req, res, next) => {
  try {
    const match = await linkMatch(prisma, req.user.id, req.params.id);
    if (!match) return res.status(404).json({ error: 'This match is no longer available.' });
    await payLinkedReceipts(req.user.id);
    res.json({ linked: true });
  } catch (err) { next(err); }
});

router.post('/matches/:id/reject', isAuthenticated, async (req, res, next) => {
  try {
    const match = await rejectMatch(prisma, req.user.id, req.params.id);
    if (!match) return res.status(404).json({ error: 'This match is no longer available.' });
    res.json({ rejected: true });
  } catch (err) { next(err); }
});

// Accepts the top suggestion of every order waiting for review.
router.post('/matches/accept-all', isAuthenticated, async (req, res, next) => {
  try {
    const orders = await prisma.emailOrder.findMany({
      where: { user_id: req.user.id, match_state: 'review' },
      include: { matches: { where: { state: 'suggested' }, orderBy: { score: 'desc' }, take: 1 } },
      take: 500,
    });
    let linked = 0;
    for (const o of orders) {
      if (o.matches[0] && await linkMatch(prisma, req.user.id, o.matches[0].id)) linked += 1;
    }
    if (linked) await payLinkedReceipts(req.user.id);
    res.json({ linked });
  } catch (err) { next(err); }
});

router.post('/orders/:id/dismiss', isAuthenticated, async (req, res, next) => {
  try {
    const order = await prisma.emailOrder.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const restore = req.body?.restore === true;
    // "Not business" / "Personal": set aside. Brought back: the user says it's
    // business, so automatic sorting never sets it aside again.
    await prisma.emailOrder.update({
      where: { id: order.id },
      data: restore ? { match_state: 'unmatched', leaning: 'kept', leaning_reason: "You said it's business" } : { match_state: 'dismissed', leaning: 'personal', leaning_reason: 'You said personal' },
    });
    res.json({ match_state: restore ? 'unmatched' : 'dismissed' });
  } catch (err) { next(err); }
});

// Automation page review: how many automatic changes wait for a confirm, and
// confirm / reject (services/email/review.js).
router.get('/automation/review', isAuthenticated, async (req, res, next) => {
  try { res.json({ to_confirm: await toConfirmCount(req.user.id) }); } catch (err) { next(err); }
});
const confirmBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict();
router.post('/automation/confirm', isAuthenticated, validateBody(confirmBody), async (req, res, next) => {
  try { res.json({ confirmed: await confirmEntries(req.user.id, req.body.ids) }); } catch (err) { next(err); }
});
// Names a purchase made from an email (e.g. from a past purchase's name).
const nameBody = z.object({ name: z.string().trim().min(1).max(200) }).strict();
router.post('/automation/:id/name', isAuthenticated, validateBody(nameBody), async (req, res, next) => {
  try {
    res.json(await namePurchase(req.user.id, req.params.id, req.body.name));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/automation/:id/reject', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await rejectEntry(req.user.id, req.params.id));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.get('/automation', isAuthenticated, async (req, res, next) => {
  try { res.json(await getSettings(prisma, req.user.id)); } catch (err) { next(err); }
});
const automationBody = z.object({
  ...Object.fromEntries(Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'boolean').map((k) => [k, z.boolean().optional()])),
  homeState: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
  personalWords: z.array(z.string().trim().max(40)).max(50).optional(),
}).strict();
router.put('/automation', isAuthenticated, validateBody(automationBody), async (req, res, next) => {
  try { res.json(await saveSettings(prisma, req.user.id, req.body)); } catch (err) { next(err); }
});

// ---- Trusted store rules and expenses from email (E4) ----
const ruleBody = z.object({
  merchant: z.string().trim().max(80).optional(),
  domain: z.string().trim().max(253).optional(),
  label: z.string().trim().min(1).max(80).optional(),
  action: z.enum(['create_expense', 'ignore']).optional(),
  auto: z.boolean().optional(),
  category: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(80).nullable().optional()),
  tax_category: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(60).nullable().optional()),
  business_use: z.enum(['business', 'mixed']).optional(),
  business_percent: z.coerce.number().min(1).max(100).optional(),
  purpose: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(200).nullable().optional()),
  payment_method_id: z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional()),
}).strict();

async function ownedCard(userId, id) {
  if (!id) return true;
  return Boolean(await prisma.paymentMethod.findFirst({ where: { id, user_id: userId }, select: { id: true } }));
}

router.get('/rules', isAuthenticated, async (req, res, next) => {
  try {
    const [rules, suggestions] = await Promise.all([
      prisma.emailMerchantRule.findMany({ where: { user_id: req.user.id }, orderBy: { label: 'asc' } }),
      suggestRules(prisma, req.user.id),
    ]);
    res.json({ rules, suggestions, stores: SENDERS.map((s) => ({ key: s.key, label: s.label })) });
  } catch (err) { next(err); }
});

router.post('/rules', isAuthenticated, validateBody(ruleBody), async (req, res, next) => {
  try {
    const b = req.body;
    let merchant = b.merchant;
    let domain = null;
    if (b.domain) {
      domain = normalizeDomain(b.domain);
      if (!domain) return res.status(400).json({ error: 'Enter the sender domain, like anthropic.com.' });
      merchant = `custom:${domain}`;
    } else if (!SENDERS.some((s) => s.key === merchant)) {
      return res.status(400).json({ error: 'Choose a store or enter a sender domain.' });
    }
    if (!await ownedCard(req.user.id, b.payment_method_id)) return res.status(404).json({ error: 'Card not found.' });
    const data = {
      label: b.label || labelFor(merchant), action: b.action || 'create_expense', auto: b.auto ?? true,
      category: b.category ?? null, tax_category: b.tax_category ?? null, business_use: b.business_use || 'business',
      business_percent: b.business_use === 'mixed' ? b.business_percent ?? 100 : 100, purpose: b.purpose ?? null,
      payment_method_id: b.payment_method_id ?? null,
    };
    const rule = await prisma.emailMerchantRule.upsert({
      where: { user_id_merchant: { user_id: req.user.id, merchant } },
      create: { user_id: req.user.id, merchant, domain, ...data },
      update: data,
    });
    // A new sender: read the user's mailboxes again so its past emails are found.
    if (domain) {
      await prisma.emailFolderCursor.deleteMany({ where: { account: { user_id: req.user.id } } });
    }
    res.status(201).json(rule);
  } catch (err) { next(err); }
});

router.delete('/rules/:id', isAuthenticated, async (req, res, next) => {
  try {
    const deleted = await prisma.emailMerchantRule.deleteMany({ where: { id: req.params.id, user_id: req.user.id } });
    if (!deleted.count) return res.status(404).json({ error: 'Rule not found.' });
    res.json({ deleted: true });
  } catch (err) { next(err); }
});

// "Add as expense" for an order with no match; optionally remember it as a rule.
router.post('/orders/:id/expense', isAuthenticated, async (req, res, next) => {
  try {
    const order = await prisma.emailOrder.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.total == null) return res.status(400).json({ error: 'This email has no total to record.' });
    const rule = await prisma.emailMerchantRule.findUnique({ where: { user_id_merchant: { user_id: req.user.id, merchant: order.merchant } } });
    const expense = await createExpenseFromOrder(prisma, req.user.id, order, rule);
    res.status(201).json({ expense_id: expense.id });
  } catch (err) { next(err); }
});

// "Create purchase" for an order email with no matching purchase.
router.post('/orders/:id/purchase', isAuthenticated, async (req, res, next) => {
  try {
    const order = await prisma.emailOrder.findFirst({ where: { id: req.params.id, user_id: req.user.id } });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.type !== 'purchase' || order.total == null) return res.status(400).json({ error: 'This email has no order total to record.' });
    if (['cancelled', 'refund'].includes(order.status)) return res.status(400).json({ error: 'This order was cancelled or refunded.' });
    const rows = await createPurchasesFromOrder(prisma, req.user.id, order);
    if (!rows) return res.status(409).json({ error: 'This order is already linked to a purchase.' });
    res.status(201).json({ purchase_ids: rows.map((r) => r.id) });
  } catch (err) { next(err); }
});

// Clears a cancellation/refund reminder once the user has handled it.
router.post('/orders/:id/handled', isAuthenticated, async (req, res, next) => {
  try {
    const done = await prisma.emailOrder.updateMany({ where: { id: req.params.id, user_id: req.user.id }, data: { attention: null } });
    if (!done.count) return res.status(404).json({ error: 'Order not found.' });
    res.json({ handled: true });
  } catch (err) { next(err); }
});

// Saves the order's PDF invoice as the linked record's private receipt.
router.post('/orders/:id/save-invoice', isAuthenticated, async (req, res, next) => {
  try {
    if (!configured()) return notConfigured(res);
    const result = await saveInvoice(prisma, req.user.id, req.params.id, {
      openClient: (account) => openAccount(account, deps),
      cloudinary: deps.cloudinary || require('cloudinary').v2,
    });
    if (result.status !== 200) return res.status(result.status).json({ error: result.error });
    res.json(result);
  } catch (err) {
    if (err?.userFacing || err?.authenticationFailed) return res.status(409).json({ error: friendlyError(err) });
    next(err);
  }
});

// ---- Stores in your email ---------------------------------------------------
// Supported stores come from emails already found; other stores from a scan of
// sender and subject lines that the user starts. A scan logs in to the mail
// server, so it is limited to one per user every 10 minutes.
const SCAN_COOLDOWN_MS = 10 * 60 * 1000;
const lastScan = new Map();

async function storeList(userId) {
  const [found, candidates] = await Promise.all([
    prisma.emailMessage.findMany({ where: { user_id: userId, status: 'extracted' }, select: { merchant: true } }),
    prisma.emailStoreCandidate.findMany({ where: { user_id: userId }, orderBy: [{ order_emails: 'desc' }, { label: 'asc' }], take: 50 }),
  ]);
  // A store we've since learned to read leaves the "not supported" list.
  const visible = candidates.filter((c) => !merchantFor(`x@${c.domain}`));
  const counts = new Map();
  for (const { merchant } of found) counts.set(merchant, (counts.get(merchant) || 0) + 1);
  const supported = [...counts.entries()]
    .filter(([key]) => SENDERS.some((s) => s.key === key))
    .map(([key, count]) => ({ key, label: SENDERS.find((s) => s.key === key).label, order_emails: count }))
    .sort((a, b) => b.order_emails - a.order_emails);
  const scannedAt = (await prisma.emailAccount.findMany({ where: { user_id: userId }, select: { stores_scanned_at: true } }))
    .reduce((latest, x) => (x.stores_scanned_at && (!latest || x.stores_scanned_at > latest) ? x.stores_scanned_at : latest), null);
  return {
    supported,
    candidates: visible.filter((c) => !c.hidden_at).map((c) => ({ id: c.id, domain: c.domain, source: sourceLabel(c.domain), label: c.label, order_emails: c.order_emails, last_seen: c.last_seen, requested: Boolean(c.requested_at) })),
    hidden: visible.filter((c) => c.hidden_at).map((c) => ({ id: c.id, domain: c.domain, source: sourceLabel(c.domain), label: c.label })),
    scanned_at: scannedAt,
    all_stores: SENDERS.map((s) => s.label),
  };
}

router.get('/stores', isAuthenticated, async (req, res, next) => {
  try { res.json(await storeList(req.user.id)); } catch (err) { next(err); }
});

router.post('/stores/scan', isAuthenticated, async (req, res, next) => {
  try {
    if (!configured()) return notConfigured(res);
    const last = lastScan.get(req.user.id);
    if (last && Date.now() - last < SCAN_COOLDOWN_MS) return res.status(429).json({ error: 'Your email was just checked. Try again in a few minutes.' });
    const active = await prisma.emailAccount.count({ where: { user_id: req.user.id, status: 'active' } });
    if (!active) return res.status(409).json({ error: 'Connect an email account first.' });
    lastScan.set(req.user.id, Date.now());
    const result = await scanStores(prisma, req.user.id, { ...deps, budgetMs: 25000 });
    res.json({ ...(await storeList(req.user.id)), scanned: result.scanned, complete: result.complete });
  } catch (err) { next(err); }
});

const setRequested = (requested) => async (req, res, next) => {
  try {
    const updated = await prisma.emailStoreCandidate.updateMany({
      where: { id: req.params.id, user_id: req.user.id },
      data: { requested_at: requested ? new Date() : null },
    });
    if (!updated.count) return res.status(404).json({ error: 'Store not found.' });
    res.json({ requested });
  } catch (err) { next(err); }
};
router.post('/stores/:id/request', isAuthenticated, setRequested(true));
router.delete('/stores/:id/request', isAuthenticated, setRequested(false));

// "Not a store": hides the row (and drops any request for it); DELETE shows it again.
const setHidden = (hidden) => async (req, res, next) => {
  try {
    const updated = await prisma.emailStoreCandidate.updateMany({
      where: { id: req.params.id, user_id: req.user.id },
      data: hidden ? { hidden_at: new Date(), requested_at: null } : { hidden_at: null },
    });
    if (!updated.count) return res.status(404).json({ error: 'Store not found.' });
    res.json(await storeList(req.user.id));
  } catch (err) { next(err); }
};
router.post('/stores/:id/hide', isAuthenticated, setHidden(true));
router.delete('/stores/:id/hide', isAuthenticated, setHidden(false));

// For the ProfitTracker team (cron secret): which stores users asked for,
// counted across users. No user ids or addresses leave this endpoint.
async function storeRequests() {
  const rows = await prisma.emailStoreCandidate.groupBy({
    by: ['domain'], where: { requested_at: { not: null } },
    _count: { _all: true }, _sum: { order_emails: true }, _max: { requested_at: true },
  });
  const labels = await prisma.emailStoreCandidate.findMany({
    where: { domain: { in: rows.map((r) => r.domain) }, requested_at: { not: null } }, select: { domain: true, label: true }, distinct: ['domain'],
  });
  return rows.map((r) => ({
    domain: r.domain, source: sourceLabel(r.domain), label: labels.find((l) => l.domain === r.domain)?.label || r.domain,
    requests: r._count._all, order_emails: r._sum.order_emails || 0, last_requested: r._max.requested_at,
  })).sort((a, b) => b.requests - a.requests || b.order_emails - a.order_emails);
}

router._deps = deps;
router._resetLimits = () => { testAttempts.clear(); lastScan.clear(); };
router.storeRequests = storeRequests;
module.exports = router;
