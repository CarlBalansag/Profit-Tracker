// Phone push notifications: turning a device on/off, the user's settings, and
// a test send. What gets sent and when is services/notificationRun.js.
const express = require('express');
const { z } = require('zod');
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { pushConfig, sendToUser } = require('../services/push');
const { DEFAULTS, isValidTimeZone } = require('../services/notificationRun');
const { dealSettings } = require('../services/cashouts/dealAlerts');
const { listAvailableCashouts } = require('../services/cashouts/registry');
const { Prisma } = require('@prisma/client');

const router = express.Router();

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,200}={0,2}$/;
const timezone = z.string().refine(isValidTimeZone, 'Not a time zone.');

const subscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string().url().max(1000).refine((url) => url.startsWith('https://'), 'Push endpoint must be https.'),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().regex(KEY_RE), auth: z.string().regex(KEY_RE) }),
  }),
  device: z.string().trim().max(60).optional(),
  timezone: timezone.optional(),
}).strict();

const unsubscribeBody = z.object({ endpoint: z.string().max(1000) }).strict();

const settingsBody = z.object({
  timezone: timezone.optional(),
  digest_enabled: z.boolean().optional(),
  digest_time: z.string().regex(TIME_RE, 'Time must be HH:MM.').optional(),
  reminder_alerts: z.boolean().optional(),
  urgent_alerts: z.boolean().optional(),
  deal_alerts: z.boolean().optional(),
  deal_min_profit: z.number().finite().min(-100000).max(100000).optional(),
  deal_min_roi: z.number().finite().min(-100).max(1000).nullable().optional(),
  deal_providers: z.array(z.string().trim().min(1).max(40)).max(20).nullable().optional(),
  deal_stores: z.array(z.string().trim().min(1).max(80)).max(50).nullable().optional(),
  deal_quiet_from: z.string().regex(TIME_RE, 'Time must be HH:MM.').nullable().optional(),
  deal_quiet_to: z.string().regex(TIME_RE, 'Time must be HH:MM.').nullable().optional(),
}).strict().refine((body) => Object.keys(body).length > 0, 'Nothing to change.')
  .refine((body) => (body.deal_quiet_from === undefined) === (body.deal_quiet_to === undefined), 'Send both quiet-hour times, or neither.');

const SETTINGS_FIELDS = ['timezone', 'digest_enabled', 'digest_time', 'reminder_alerts', 'urgent_alerts'];
const DEAL_FIELDS = ['deal_alerts', 'deal_min_profit', 'deal_min_roi', 'deal_providers', 'deal_stores', 'deal_quiet_from', 'deal_quiet_to'];
const pick = (row) => {
  const deal = dealSettings(row);
  return {
    ...Object.fromEntries(SETTINGS_FIELDS.map((field) => [field, row?.[field] ?? DEFAULTS[field]])),
    ...Object.fromEntries(DEAL_FIELDS.map((field) => [field, deal[field]])),
  };
};

// Store names and cashout ids are kept once each; an empty list means all.
function cleanSettings(body) {
  const data = { ...body };
  const unique = (list, key) => {
    if (!Array.isArray(list)) return list;
    const seen = new Set();
    return list.filter((entry) => {
      const id = key(entry);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };
  if (data.deal_providers !== undefined) data.deal_providers = unique(data.deal_providers, (entry) => entry.toLowerCase());
  if (data.deal_stores !== undefined) data.deal_stores = unique(data.deal_stores, (entry) => entry.toLowerCase().replace(/[^a-z0-9]/g, ''));
  for (const field of ['deal_providers', 'deal_stores']) {
    if (Array.isArray(data[field]) && data[field].length === 0) data[field] = null;
  }
  if (data.deal_providers) {
    const known = new Set(listAvailableCashouts().map((entry) => entry.id));
    const unknown = data.deal_providers.find((entry) => !known.has(entry));
    if (unknown) {
      const error = new Error(`Unknown cashout: ${unknown}`);
      error.status = 400;
      throw error;
    }
  }
  if (data.deal_providers === null) data.deal_providers = Prisma.DbNull;
  if (data.deal_stores === null) data.deal_stores = Prisma.DbNull;
  return data;
}

async function settingsFor(userId) {
  const [row, devices] = await Promise.all([
    prisma.notificationSettings.findUnique({ where: { user_id: userId } }),
    prisma.pushSubscription.findMany({
      where: { user_id: userId },
      select: { id: true, endpoint: true, device: true, created_at: true, last_success_at: true },
      orderBy: { created_at: 'asc' },
    }),
  ]);
  return { ...pick(row), saved: Boolean(row), devices };
}

// Whether push is set up on the server, and the key browsers subscribe with.
router.get('/config', isAuthenticated, (req, res) => {
  const { enabled, publicKey } = pushConfig();
  res.json({ enabled, public_key: publicKey });
});

router.get('/settings', isAuthenticated, async (req, res, next) => {
  try {
    res.json(await settingsFor(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/settings', isAuthenticated, validateBody(settingsBody), async (req, res, next) => {
  try {
    const data = cleanSettings(req.body);
    await prisma.notificationSettings.upsert({
      where: { user_id: req.user.id },
      create: { user_id: req.user.id, ...DEFAULTS, ...data },
      update: data,
    });
    res.json(await settingsFor(req.user.id));
  } catch (err) {
    next(err);
  }
});

// Turn this device on. The same browser subscribing again (or after switching
// accounts) updates its one row; the endpoint belongs to whoever is signed in.
router.post('/subscriptions', isAuthenticated, validateBody(subscribeBody), async (req, res, next) => {
  try {
    if (!pushConfig().enabled) return res.status(503).json({ error: 'Notifications are not set up on the server yet.' });
    const { subscription, device = null, timezone: zone } = req.body;
    const data = { user_id: req.user.id, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth, device };
    await prisma.pushSubscription.upsert({
      where: { endpoint: subscription.endpoint },
      create: { endpoint: subscription.endpoint, ...data },
      update: data,
    });
    // First device: start the settings from this device's time zone.
    if (zone) {
      await prisma.notificationSettings.upsert({
        where: { user_id: req.user.id },
        create: { user_id: req.user.id, ...DEFAULTS, timezone: zone },
        update: {},
      });
    }
    res.status(201).json(await settingsFor(req.user.id));
  } catch (err) {
    next(err);
  }
});

// Turn a device off: this browser's endpoint, or one of the user's devices by id.
router.delete('/subscriptions', isAuthenticated, validateBody(unsubscribeBody), async (req, res, next) => {
  try {
    await prisma.pushSubscription.deleteMany({ where: { user_id: req.user.id, endpoint: req.body.endpoint } });
    res.json(await settingsFor(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.delete('/subscriptions/:id', isAuthenticated, async (req, res, next) => {
  try {
    const { count } = await prisma.pushSubscription.deleteMany({ where: { user_id: req.user.id, id: req.params.id } });
    if (!count) return res.status(404).json({ error: 'Device not found' });
    res.json(await settingsFor(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.post('/test', isAuthenticated, async (req, res, next) => {
  try {
    if (!pushConfig().enabled) return res.status(503).json({ error: 'Notifications are not set up on the server yet.' });
    const result = await sendToUser(req.user.id, {
      title: 'Profit Tracker',
      body: 'Notifications are working on this device.',
      url: '/todos',
      tag: 'test',
    });
    if (!result.devices) return res.status(409).json({ error: 'Turn notifications on for a device first.' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
