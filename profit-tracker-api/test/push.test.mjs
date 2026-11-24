import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const webpush = require('web-push');
const push = require('../services/push.js');
const run = require('../services/notificationRun.js');

let server;
let baseUrl;
let sent;
let failNext;

const keys = webpush.generateVAPIDKeys();
const SECRET = 'qa-notifications-secret-value';

beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => {
  server.close();
  push.setSender(null);
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_SUBJECT;
  delete process.env.NOTIFICATIONS_CRON_SECRET;
});

const TODAY = new Date().toISOString().slice(0, 10);
const dayStr = (offset) => new Date(Date.parse(`${TODAY}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
const at = (hhmm) => `${TODAY}T${hhmm}:00Z`; // the test user's zone is UTC

const request = async (method, path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
};
const runAt = (hhmm, auth = `Bearer ${SECRET}`) => request('POST', '/internal/notifications/run', { now: at(hhmm) }, { Authorization: auth });

const P256DH = 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM';
const AUTH = 'tBHItJI5svbpez7KI4CCXg';
const subscription = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, keys: { p256dh: P256DH, auth: AUTH } });
const { ids } = harness;

function enable() {
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:qa@example.invalid';
  process.env.NOTIFICATIONS_CRON_SECRET = SECRET;
}

beforeEach(() => {
  harness.reset();
  enable();
  sent = [];
  failNext = null;
  push.setSender(async (sub, body) => {
    if (failNext) { const err = failNext; failNext = null; throw err; }
    sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) });
  });
  // Nothing on the To-Do list unless a test adds it.
  harness.db.sales = [];
  Object.assign(harness.db.paymentMethod[0], { due_day: Number(dayStr(15).slice(8, 10)), statement_close_day: Number(dayStr(-15).slice(8, 10)) });
});

describe('push config', () => {
  it('is off until the VAPID keys are set', async () => {
    delete process.env.VAPID_PRIVATE_KEY;
    const off = await request('GET', '/api/push/config');
    expect(off.body).toEqual({ enabled: false, public_key: null });
    const subscribe = await request('POST', '/api/push/subscriptions', { subscription: subscription() });
    expect(subscribe.status).toBe(503);
    enable();
    const on = await request('GET', '/api/push/config');
    expect(on.body).toEqual({ enabled: true, public_key: keys.publicKey });
  });
});

describe('devices', () => {
  it('turns a device on, starting settings from its time zone', async () => {
    const res = await request('POST', '/api/push/subscriptions', { subscription: subscription(), device: 'iPhone', timezone: 'America/Chicago' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ timezone: 'America/Chicago', digest_enabled: true, digest_time: '08:00', saved: true, devices: [{ device: 'iPhone' }] });
    // Again from the same browser: still one device.
    await request('POST', '/api/push/subscriptions', { subscription: subscription(), device: 'iPhone' });
    expect(harness.db.pushSubscription).toHaveLength(1);
  });

  it('keeps chosen settings when another device turns on', async () => {
    await request('PUT', '/api/push/settings', { timezone: 'Europe/London', digest_time: '07:30' });
    await request('POST', '/api/push/subscriptions', { subscription: subscription(), timezone: 'Asia/Tokyo' });
    const { body } = await request('GET', '/api/push/settings');
    expect(body).toMatchObject({ timezone: 'Europe/London', digest_time: '07:30' });
  });

  it('moves a browser to whoever is signed in now', async () => {
    harness.db.pushSubscription.push({ id: 'old-row', user_id: ids.other, endpoint: subscription().endpoint, p256dh: 'x', auth: 'y' });
    await request('POST', '/api/push/subscriptions', { subscription: subscription() });
    expect(harness.db.pushSubscription).toEqual([expect.objectContaining({ user_id: ids.user, endpoint: subscription().endpoint })]);
  });

  it('rejects bad subscriptions without saving', async () => {
    const bad = await Promise.all([
      request('POST', '/api/push/subscriptions', {}),
      request('POST', '/api/push/subscriptions', { subscription: { ...subscription(), endpoint: 'http://insecure.example/x' } }),
      request('POST', '/api/push/subscriptions', { subscription: { ...subscription(), keys: { p256dh: 'bad key!', auth: AUTH } } }),
      request('POST', '/api/push/subscriptions', { subscription: subscription(), timezone: 'Mars/Olympus' }),
      request('POST', '/api/push/subscriptions', { subscription: subscription(), extra: 1 }),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400, 400]);
    expect(harness.db.pushSubscription).toHaveLength(0);
  });

  it('turns a device off by endpoint or id, only the user\'s own', async () => {
    await request('POST', '/api/push/subscriptions', { subscription: subscription(1) });
    await request('POST', '/api/push/subscriptions', { subscription: subscription(2) });
    harness.db.pushSubscription.push({ id: 'theirs', user_id: ids.other, endpoint: 'https://push.example/theirs', p256dh: 'x', auth: 'y' });
    const byEndpoint = await request('DELETE', '/api/push/subscriptions', { endpoint: subscription(1).endpoint });
    expect(byEndpoint.body.devices).toHaveLength(1);
    const mine = harness.db.pushSubscription.find((row) => row.user_id === ids.user);
    expect((await request('DELETE', `/api/push/subscriptions/${mine.id}`)).status).toBe(200);
    expect((await request('DELETE', '/api/push/subscriptions/theirs')).status).toBe(404);
    await request('DELETE', '/api/push/subscriptions', { endpoint: 'https://push.example/theirs' });
    expect(harness.db.pushSubscription).toEqual([expect.objectContaining({ id: 'theirs' })]);
  });

  it('requires a signed-in user', async () => {
    const res = await request('GET', '/api/push/settings', undefined, { 'x-qa-unauthenticated': 'true' });
    expect(res.status).toBe(401);
  });
});

describe('settings', () => {
  it('starts from the defaults and saves only what changed', async () => {
    const first = await request('GET', '/api/push/settings');
    expect(first.body).toMatchObject({ timezone: 'America/New_York', digest_enabled: true, digest_time: '08:00', reminder_alerts: true, urgent_alerts: true, saved: false, devices: [] });
    const saved = await request('PUT', '/api/push/settings', { digest_enabled: false, digest_time: '06:45' });
    expect(saved.body).toMatchObject({ digest_enabled: false, digest_time: '06:45', urgent_alerts: true, saved: true });
  });

  it('rejects bad values', async () => {
    const bad = await Promise.all([
      request('PUT', '/api/push/settings', {}),
      request('PUT', '/api/push/settings', { digest_time: '8am' }),
      request('PUT', '/api/push/settings', { timezone: 'Nowhere/Land' }),
      request('PUT', '/api/push/settings', { urgent_alerts: 'yes' }),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400]);
    expect(harness.db.notificationSettings).toHaveLength(0);
  });
});

describe('cashout deal alert settings', () => {
  it('are off by default and save the filters', async () => {
    const first = await request('GET', '/api/push/settings');
    expect(first.body).toMatchObject({ deal_alerts: false, deal_min_profit: 0, deal_providers: [], deal_stores: [], deal_quiet_from: null, deal_quiet_to: null });
    const saved = await request('PUT', '/api/push/settings', {
      deal_alerts: true, deal_min_profit: 25.5, deal_providers: ['eb', 'eb', 'la'], deal_stores: ['Best Buy', 'best-buy', 'Target'], deal_quiet_from: '22:00', deal_quiet_to: '07:00',
    });
    expect(saved.status).toBe(200);
    expect(saved.body).toMatchObject({ deal_alerts: true, deal_min_profit: 25.5, deal_providers: ['eb', 'la'], deal_stores: ['Best Buy', 'Target'], deal_quiet_from: '22:00', deal_quiet_to: '07:00' });
    // Empty lists mean "all"; quiet hours clear with nulls.
    const cleared = await request('PUT', '/api/push/settings', { deal_providers: [], deal_stores: null, deal_quiet_from: null, deal_quiet_to: null });
    expect(cleared.body).toMatchObject({ deal_alerts: true, deal_providers: [], deal_stores: [], deal_quiet_from: null, deal_quiet_to: null });
  });

  it('rejects unknown cashouts, half-set quiet hours and bad numbers', async () => {
    const bad = await Promise.all([
      request('PUT', '/api/push/settings', { deal_providers: ['nope'] }),
      request('PUT', '/api/push/settings', { deal_quiet_from: '22:00' }),
      request('PUT', '/api/push/settings', { deal_min_profit: 'lots' }),
      request('PUT', '/api/push/settings', { deal_alerts: 'on' }),
    ]);
    expect(bad.map((res) => res.status)).toEqual([400, 400, 400, 400]);
    expect(harness.db.notificationSettings).toHaveLength(0);
  });

  it('lists the week of new deals with profit from the signed-in user cards', async () => {
    const now = new Date();
    harness.db.paymentMethod.push({ id: 'card-bb', user_id: ids.user, name: 'BB Visa', type: 'Credit', default_cashback_rate: 1, category_rates: JSON.stringify([{ store: 'Best Buy', rate: 5 }]) });
    harness.db.cashoutDeal.push({ id: 'deal-1', provider: 'eb', external_deal_id: '1', name: 'PS5 Pro', payout: 780, retail: 699.99, stores: ['Best Buy'], vendor_limit: 3, last_seen_at: now, first_seen_at: now });
    harness.db.cashoutDealAlert.push({ id: 'alert-1', deal_id: 'deal-1', kind: 'new', payout: 780, retail: 699.99, previous_payout: null, created_at: now, dispatched_at: null });
    harness.db.cashoutDealAlert.push({ id: 'alert-old', deal_id: 'deal-1', kind: 'new', payout: 780, retail: 699.99, previous_payout: null, created_at: new Date(now.getTime() - 9 * 86400000), dispatched_at: now });
    const res = await request('GET', '/api/cashouts/deal-alerts');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ id: 'alert-1', profit: 115.01, rewards: 35, best_card: { rate: 5, store: 'Best Buy', card: { name: 'BB Visa' } }, deal: { name: 'PS5 Pro', provider_name: 'ElectronicsBuyer', live: true } });
    expect(JSON.stringify(res.body)).not.toContain('category_rates');
    const anon = await request('GET', '/api/cashouts/deal-alerts', undefined, { 'x-qa-unauthenticated': 'true' });
    expect(anon.status).toBe(401);
  });
});

describe('test notification', () => {
  it('sends to every device and drops ones the push service says are gone', async () => {
    expect((await request('POST', '/api/push/test')).status).toBe(409);
    await request('POST', '/api/push/subscriptions', { subscription: subscription(1) });
    await request('POST', '/api/push/subscriptions', { subscription: subscription(2) });
    failNext = Object.assign(new Error('Gone'), { statusCode: 410 });
    const res = await request('POST', '/api/push/test');
    expect(res.body).toMatchObject({ sent: 1, removed: 1, failed: 0 });
    expect(sent[0]).toMatchObject({ title: 'Profit Tracker', url: '/todos' });
    expect(harness.db.pushSubscription).toHaveLength(1);
  });
});

describe('scheduled run', () => {
  const turnOn = async (settings = {}) => {
    await request('POST', '/api/push/subscriptions', { subscription: subscription(), timezone: 'UTC' });
    if (Object.keys(settings).length) await request('PUT', '/api/push/settings', settings);
  };
  const addSale = (fields) => harness.db.sales.push({
    id: `${Math.random()}`.slice(2, 10).padEnd(8, '0') + '-0000-4000-8000-000000000000', inventory_id: ids.inventory, platform_id: ids.platform,
    quantity: 1, unit_price: 100, status: 'SOLD', sale_date: new Date(`${TODAY}T12:00:00Z`), workflow_status: 'AWAITING_SHIPMENT',
    workflow_status_changed_at: new Date(`${TODAY}T12:00:00Z`), paid_at: null, payout_short_amount: null, refunded_amount: 0, refunded_qty: 0, ...fields,
  });

  it('needs the secret', async () => {
    expect((await runAt('09:00', 'Bearer wrong')).status).toBe(401);
    expect((await runAt('09:00', '')).status).toBe(401);
  });

  it('does nothing when push is not set up', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    expect((await runAt('09:00')).body).toMatchObject({ status: 'disabled' });
  });

  it('sends the morning summary once, at or after its time, and not when nothing is due', async () => {
    await turnOn();
    expect((await runAt('09:00')).body).toMatchObject({ users: 1, sent: 0 }); // empty list

    addSale({ workflow_status: 'DISPUTED' });
    await runAt('07:55');
    expect(sent).toHaveLength(0);
    await runAt('08:05');
    expect(sent).toEqual([expect.objectContaining({ title: 'To-Do: 1 thing needs you', body: '1 today. Open dispute', url: '/todos', badge: 1 })]);
    await runAt('08:10');
    expect(sent).toHaveLength(1);
  });

  it('keeps quiet after 9 PM', async () => {
    await turnOn();
    addSale({ workflow_status: 'DISPUTED' });
    await runAt('21:30');
    expect(sent).toHaveLength(0);
  });

  it('alerts for something that turns urgent after the summary, once', async () => {
    await turnOn();
    addSale({ workflow_status: 'DISPUTED' });
    await runAt('08:00'); // summary covers the first dispute
    addSale({ workflow_status: 'DISPUTED', inventory_id: ids.inventory });
    await runAt('10:00');
    await runAt('10:05');
    expect(sent.map((n) => n.title)).toEqual(['To-Do: 1 thing needs you', 'Open dispute']);
  });

  it('sends urgent alerts on their own when the summary is off', async () => {
    await turnOn({ digest_enabled: false });
    addSale({ workflow_status: 'DISPUTED' });
    addSale({ workflow_status: 'DISPUTED' });
    await runAt('09:00');
    expect(sent).toEqual([expect.objectContaining({ title: '2 things need you today' })]);
  });

  it('alerts at a reminder\'s time, not early and not hours late', async () => {
    await turnOn({ digest_enabled: false });
    harness.db.reminder.push({ id: 'rem-1', user_id: ids.user, title: 'Call Amex', due_date: TODAY, due_time: '15:30', repeat: 'none', done_at: null, notes: null });
    harness.db.reminder.push({ id: 'rem-2', user_id: ids.user, title: 'Too late now', due_date: TODAY, due_time: '06:00', repeat: 'none', done_at: null, notes: null });
    await runAt('15:20');
    expect(sent).toHaveLength(0);
    await runAt('15:31');
    await runAt('15:36');
    expect(sent).toEqual([expect.objectContaining({ title: 'Reminder: Call Amex', body: 'Due today at 3:30 PM', tag: 'reminder-rem-1' })]);
  });

  it('respects each setting being off', async () => {
    await turnOn({ digest_enabled: false, urgent_alerts: false, reminder_alerts: false });
    addSale({ workflow_status: 'DISPUTED' });
    harness.db.reminder.push({ id: 'rem-1', user_id: ids.user, title: 'Call Amex', due_date: TODAY, due_time: '09:00', repeat: 'none', done_at: null, notes: null });
    await runAt('09:05');
    expect(sent).toHaveLength(0);
  });

  it('retries next run when no device got it', async () => {
    await turnOn();
    addSale({ workflow_status: 'DISPUTED' });
    failNext = Object.assign(new Error('Push service down'), { statusCode: 503 });
    await runAt('08:00');
    expect(sent).toHaveLength(0);
    await runAt('08:05');
    expect(sent).toHaveLength(1);
  });

  it('only sends to users with a device on', async () => {
    addSale({ workflow_status: 'DISPUTED' });
    expect((await runAt('09:00')).body).toMatchObject({ users: 0, sent: 0 });
  });
});

describe('time zones', () => {
  it('reads the local date and time in the user\'s zone', () => {
    const now = new Date('2026-11-21T03:30:00Z');
    expect(run.localNow(now, 'America/New_York')).toEqual({ date: '2026-11-20', time: '22:30' });
    expect(run.localNow(now, 'Asia/Tokyo')).toEqual({ date: '2026-11-21', time: '12:30' });
    expect(run.localNow(now, 'not a zone')).toEqual({ date: '2026-11-20', time: '22:30' });
    expect(run.isValidTimeZone('Europe/Paris')).toBe(true);
    expect(run.isValidTimeZone('Mars/Olympus')).toBe(false);
  });
});

describe('weekly review', () => {
  const settings = { ...run.DEFAULTS };
  const todos = {
    items: [
      { key: 'payout:1', type: 'payout_late', urgency: 'overdue', title: 'Payout late', amount: 2707.3 },
      { key: 'payout:2', type: 'payout_late', urgency: 'soon', title: 'Payout late', amount: 2707.3 },
      { key: 'ship:1', type: 'ship', urgency: 'soon', title: 'Ship it', amount: 540 },
      { key: 'aging:1', type: 'aging_stock', urgency: 'info', title: 'Sitting 220 days, not listed', amount: 720 },
    ],
  };

  it('turns Sunday\'s summary into a weekly review led by money', () => {
    const plan = run.planNotifications({ todos, settings, local: { date: '2026-11-22', time: '09:00' } }); // a Sunday
    expect(plan.digest.key).toBe('digest:2026-11-22');
    expect(plan.digest.payload.title).toBe('Weekly review: 4 open');
    expect(plan.digest.payload.body).toBe('$5,415 in late payouts · $540 to ship · $720 in unlisted stock · 1 overdue.');
  });

  it('ends the weekly review with what got done this week', () => {
    const week = { since: '2026-11-16', payouts: 3, paid_total: 1240, sales_moved: 1, bills_paid: 0 };
    const plan = run.planNotifications({ todos: { ...todos, cleared_week: week }, settings, local: { date: '2026-11-22', time: '09:00' } });
    expect(plan.digest.payload.body).toBe('$5,415 in late payouts · $540 to ship · $720 in unlisted stock · 1 overdue. Done this week: 3 payouts in ($1,240), 1 sale moved on.');
  });

  it('keeps the normal summary on other days', () => {
    const plan = run.planNotifications({ todos, settings, local: { date: '2026-11-23', time: '09:00' } }); // a Monday
    expect(plan.digest.payload.title).toBe('To-Do: 4 things need you');
  });

  it('alerts for a payout once it is overdue', () => {
    const plan = run.planNotifications({ todos, settings, local: { date: '2026-11-23', time: '09:00' } });
    expect(plan.urgent.map((entry) => entry.key)).toEqual(['payout:1']);
  });
});
