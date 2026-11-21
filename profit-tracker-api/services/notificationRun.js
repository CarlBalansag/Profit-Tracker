// One pass of the notification scheduler (POST /internal/notifications/run,
// called every few minutes by an outside cron). For each user with a device
// turned on, in their own time zone:
//
//   - Reminder alerts: a reminder with a time, once that time arrives (up to
//     2 hours late, so a stalled cron doesn't send stale ones).
//   - Morning summary: once a day at their chosen time, if anything is on
//     the To-Do list. Not after 9 PM.
//   - Urgent alerts: things that turn urgent after the summary (card due,
//     return window closing, a cash-out needing a reconnect...), one
//     notification per run, between the summary time and 9 PM.
//
// Every notification has a key, claimed in NotificationSent before sending, so
// a repeated or overlapping run never sends one twice. If no device got it
// (and none was simply gone), the claim is dropped so the next run retries.
const crypto = require('node:crypto');
const prisma = require('../prisma');
const { listTodos } = require('./todos');
const { sendToUser, pushConfig } = require('./push');

const QUIET_FROM = '21:00';
const REMINDER_GRACE_MINUTES = 120;
const KEEP_SENT_DAYS = 30;
const DEFAULTS = { timezone: 'America/New_York', digest_enabled: true, digest_time: '08:00', reminder_alerts: true, urgent_alerts: true };

// Items worth interrupting someone for, once they're overdue or due today.
const URGENT_TYPES = new Set([
  'card_due', 'card_overdue', 'return_window', 'reconnect_cashout', 'tracking_failed',
  'commit_pending', 'deal_closed_unshipped', 'open_dispute',
]);

function isValidTimeZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// The user's local date (YYYY-MM-DD) and time (HH:MM) at `now`.
function localNow(now, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: isValidTimeZone(zone) ? zone : DEFAULTS.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

const minutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

function summaryBody(todos) {
  const by = { overdue: 0, today: 0, soon: 0, info: 0 };
  for (const entry of todos.items) by[entry.urgency] += 1;
  const counts = [
    by.overdue && `${by.overdue} overdue`,
    by.today && `${by.today} today`,
    by.soon && `${by.soon} this week`,
  ].filter(Boolean).join(' · ') || `${todos.items.length} for your info`;
  const top = todos.items.slice(0, 3).map((entry) => entry.title).join(', ');
  return `${counts}. ${top}`;
}

// Decides what could go out to one user right now. Pure, so it's tested
// directly. Whether each one actually goes is up to its claim (runForUser).
//   returns { reminders: [{ key, payload }], digest: { key, payload } | null, urgent: [todo items] }
function planNotifications({ todos, settings, local }) {
  const now = minutes(local.time);
  const badge = todos.items.length;
  const awake = now >= minutes(settings.digest_time) && now < minutes(QUIET_FROM);
  const plan = { reminders: [], digest: null, urgent: [] };

  if (settings.reminder_alerts) {
    for (const entry of todos.items) {
      const rem = entry.reminder;
      if (entry.type !== 'reminder' || !rem?.due_time || rem.due_date !== local.date) continue;
      const late = now - minutes(rem.due_time);
      if (late < 0 || late > REMINDER_GRACE_MINUTES) continue;
      plan.reminders.push({
        key: `reminder:${rem.id}:${rem.due_date}`,
        payload: { title: `Reminder: ${rem.title}`, body: entry.detail, url: '/todos', tag: `reminder-${rem.id}`, badge },
      });
    }
  }

  if (settings.digest_enabled && awake && todos.items.length) {
    plan.digest = {
      key: `digest:${local.date}`,
      payload: { title: `To-Do: ${todos.items.length} ${todos.items.length === 1 ? 'thing needs' : 'things need'} you`, body: summaryBody(todos), url: '/todos', tag: 'digest', badge },
    };
  }

  if (settings.urgent_alerts && awake) {
    plan.urgent = todos.items.filter((entry) => URGENT_TYPES.has(entry.type) && (entry.urgency === 'overdue' || entry.urgency === 'today'));
  }
  return plan;
}

async function claim(userId, key) {
  try {
    await prisma.notificationSent.create({ data: { user_id: userId, key } });
    return true;
  } catch (err) {
    if (err.code === 'P2002' || /Unique constraint/i.test(err.message)) return false;
    throw err;
  }
}

const unclaim = (userId, keys) => prisma.notificationSent.deleteMany({ where: { user_id: userId, key: { in: keys } } });

async function deliver(userId, keys, payload) {
  const result = await sendToUser(userId, payload);
  if (!result.sent && !result.removed) await unclaim(userId, keys);
  return result.sent > 0;
}

async function runForUser(userId, now) {
  const stored = await prisma.notificationSettings.findUnique({ where: { user_id: userId } });
  const settings = { ...DEFAULTS, ...(stored || {}) };
  const local = localNow(now, settings.timezone);
  const todos = await listTodos(prisma, userId, local.date);
  const plan = planNotifications({ todos, settings, local });
  const badge = todos.items.length;
  let sent = 0;

  for (const step of plan.reminders) {
    if (await claim(userId, step.key) && await deliver(userId, [step.key], step.payload)) sent += 1;
  }

  // The summary that goes out now already covers what's urgent at this
  // moment, so those are only claimed; anything that turns urgent later gets
  // its own alert on a later run.
  const summaryNow = plan.digest && await claim(userId, plan.digest.key);
  const fresh = [];
  for (const entry of plan.urgent) {
    if (await claim(userId, `urgent:${entry.key}`)) fresh.push(entry);
  }
  if (summaryNow) {
    // If no device got the summary, its urgent claims go too, so they retry.
    const keys = [plan.digest.key, ...fresh.map((entry) => `urgent:${entry.key}`)];
    if (await deliver(userId, keys, plan.digest.payload)) sent += 1;
  } else if (fresh.length) {
    const payload = fresh.length === 1
      ? { title: fresh[0].title, body: fresh[0].detail, url: '/todos', tag: `urgent-${fresh[0].key}`, badge }
      : { title: `${fresh.length} things need you today`, body: fresh.map((entry) => entry.title).join(', '), url: '/todos', tag: 'urgent', badge };
    if (await deliver(userId, fresh.map((entry) => `urgent:${entry.key}`), payload)) sent += 1;
  }
  return sent;
}

async function runNotifications({ now = new Date() } = {}) {
  if (!pushConfig().enabled) return { status: 'disabled', users: 0, sent: 0 };
  const devices = await prisma.pushSubscription.findMany({ select: { user_id: true } });
  const userIds = [...new Set(devices.map((device) => device.user_id))];
  let sent = 0;
  const errors = [];
  for (const userId of userIds) {
    try {
      sent += await runForUser(userId, now);
    } catch (err) {
      errors.push(userId);
      console.error(`[notifications] run failed for user ${userId}:`, err.message);
    }
  }
  await prisma.notificationSent.deleteMany({ where: { sent_at: { lt: new Date(now.getTime() - KEEP_SENT_DAYS * 86400000) } } });
  return { status: 'ok', users: userIds.length, sent, errors: errors.length };
}

// The run endpoint is called by an outside cron with
// "Authorization: Bearer <NOTIFICATIONS_CRON_SECRET>".
function verifyRunSecret(authHeader) {
  const secret = process.env.NOTIFICATIONS_CRON_SECRET?.trim();
  if (!secret) return { ok: false, status: 401, message: 'Notification run secret is not configured on server.' };
  const match = /^Bearer\s+(\S+)$/i.exec(String(authHeader || '').trim());
  if (!match) return { ok: false, status: 401, message: 'Missing or invalid Authorization header.' };
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, message: 'Invalid notification run secret.' };
  }
  return { ok: true };
}

module.exports = { verifyRunSecret, runNotifications, planNotifications, localNow, isValidTimeZone, DEFAULTS, URGENT_TYPES };
