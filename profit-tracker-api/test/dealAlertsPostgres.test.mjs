// Cashout deal alerts against a real (throwaway) Postgres with every migration
// applied: new-deal detection from a provider's deal list, profit with each
// user's best card, per-user filters, batching, and one push per alert.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');
const webpush = require('web-push');

const ALICE = '00000000-0000-4000-8000-0000000000d1';
const BOB = '00000000-0000-4000-8000-0000000000d2';
const CAROL = '00000000-0000-4000-8000-0000000000d3';
let pg;
let db;
let alerts;
let push;
let sent;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const deal = (id, { payout = 780, retail = 699.99, stores = ['Best Buy'], name = `Deal ${id}`, limit = null, status = 'active' } = {}) => ({
  id,
  name,
  payout,
  retail,
  status,
  productLinks: [],
  items: [{ id: `${id}-1`, name, vendorLimit: limit, purchaseLinks: stores.map((store) => ({ name: store, url: `https://${store.replace(/\s/g, '').toLowerCase()}.com/x` })) }],
});

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-dealalerts-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('dealalerts_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/dealalerts_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = 'mailto:qa@example.invalid';
  push = require('../services/push');
  alerts = require('../services/cashouts/dealAlerts');
}, 180000);

afterAll(async () => {
  if (push) push.setSender(null);
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  sent = [];
  push.setSender(async (sub, body) => { sent.push({ endpoint: sub.endpoint, ...JSON.parse(body) }); });
  await db.cashoutDealAlert.deleteMany({});
  await db.cashoutDeal.deleteMany({});
  await db.notificationSent.deleteMany({});
  await db.notificationSettings.deleteMany({});
  await db.pushSubscription.deleteMany({});
  await db.paymentMethod.deleteMany({});
  await db.user.deleteMany({});
  for (const [id, name] of [[ALICE, 'alice'], [BOB, 'bob'], [CAROL, 'carol']]) {
    await db.user.create({ data: { id, username: `${name}-dealqa`, email: `${name}-dealqa@example.invalid` } });
  }
  // Alice: alerts on, a 5% Best Buy card. Bob: alerts on, only EB, $50 minimum.
  // Carol: alerts off.
  await db.paymentMethod.create({ data: { user_id: ALICE, name: 'Flat 2%', type: 'Credit', default_cashback_rate: 2 } });
  await db.paymentMethod.create({ data: { user_id: ALICE, name: 'BB Visa', type: 'Credit', default_cashback_rate: 1, category_rates: JSON.stringify([{ store: 'Best Buy', rate: 5 }]) } });
  await db.paymentMethod.create({ data: { user_id: BOB, name: 'Bob Card', type: 'Credit', default_cashback_rate: 1.5 } });
  for (const id of [ALICE, BOB, CAROL]) {
    await db.pushSubscription.create({ data: { user_id: id, endpoint: `https://push.example.invalid/${id}`, p256dh: 'BBBBBBBBBBBB', auth: 'AAAAAAAAAAAA' } });
  }
  await db.notificationSettings.create({ data: { user_id: ALICE, deal_alerts: true } });
  await db.notificationSettings.create({ data: { user_id: BOB, deal_alerts: true, deal_min_profit: 50, deal_providers: ['eb'] } });
  await db.notificationSettings.create({ data: { user_id: CAROL, deal_alerts: false } });
});

describe('recordDealsSeen', () => {
  it('fills the list silently the first time a cashout is seen, then alerts on new deals only', async () => {
    const first = await alerts.recordDealsSeen('eb', [deal('1'), deal('2')]);
    expect(first).toEqual({ created: 0, seeding: true });
    expect(await db.cashoutDeal.count()).toBe(2);
    expect(await db.cashoutDealAlert.count()).toBe(0);

    const second = await alerts.recordDealsSeen('eb', [deal('1'), deal('2'), deal('3')]);
    expect(second.created).toBe(1);
    const [alert] = await db.cashoutDealAlert.findMany({ include: { deal: true } });
    expect(alert).toMatchObject({ kind: 'new' });
    expect(alert.deal.external_deal_id).toBe('3');
    expect(alert.deal.stores).toEqual(['Best Buy']);

    // Seen again: no new alert.
    expect((await alerts.recordDealsSeen('eb', [deal('3')])).created).toBe(0);
  });

  it('keeps each cashout separate and ignores closed or unpriced deals', async () => {
    await alerts.recordDealsSeen('eb', [deal('1')]);
    // LA is seen for the first time: seeding, even though EB is already known.
    expect((await alerts.recordDealsSeen('la', [deal('1')])).seeding).toBe(true);
    const result = await alerts.recordDealsSeen('eb', [deal('9', { status: 'closed' }), deal('10', { payout: 0 })]);
    expect(result.created).toBe(0);
    expect(await db.cashoutDealAlert.count()).toBe(0);
  });

  it('alerts when the payout rises $5 or more since the last alert, not on smaller moves or drops', async () => {
    await alerts.recordDealsSeen('eb', [deal('1', { payout: 700 })]);
    expect((await alerts.recordDealsSeen('eb', [deal('1', { payout: 704 })])).created).toBe(0);
    expect((await alerts.recordDealsSeen('eb', [deal('1', { payout: 690 })])).created).toBe(0);
    expect((await alerts.recordDealsSeen('eb', [deal('1', { payout: 705 })])).created).toBe(1);
    const [alert] = await db.cashoutDealAlert.findMany();
    expect(alert.kind).toBe('payout_up');
    expect(Number(alert.previous_payout)).toBe(700);
    expect(Number(alert.payout)).toBe(705);
    // Back to 704 then 709: only 4 above the last alert (705), so quiet.
    await alerts.recordDealsSeen('eb', [deal('1', { payout: 704 })]);
    expect((await alerts.recordDealsSeen('eb', [deal('1', { payout: 709 })])).created).toBe(0);
  });

  it('alerts again when a deal comes back after a day away', async () => {
    const t0 = new Date('2026-11-20T12:00:00Z');
    await alerts.recordDealsSeen('eb', [deal('1')], { now: t0 });
    await alerts.recordDealsSeen('eb', [deal('2')], { now: new Date('2026-11-20T13:00:00Z') });
    const back = await alerts.recordDealsSeen('eb', [deal('1')], { now: new Date('2026-11-21T13:00:00Z') });
    expect(back.created).toBe(1);
    const kinds = (await db.cashoutDealAlert.findMany({ include: { deal: true } })).map((row) => `${row.deal.external_deal_id}:${row.kind}`).sort();
    expect(kinds).toEqual(['1:relisted', '2:new']);
  });

  it('makes one alert when two syncs see the same new deal at once', async () => {
    await alerts.recordDealsSeen('eb', [deal('1')]);
    await Promise.all([alerts.recordDealsSeen('eb', [deal('5')]), alerts.recordDealsSeen('eb', [deal('5')])]);
    expect(await db.cashoutDealAlert.count()).toBe(1);
  });
});

describe('firstSeenDates', () => {
  it('gives when each deal was first seen, per cashout', async () => {
    const t0 = new Date('2026-11-20T12:00:00Z');
    await alerts.recordDealsSeen('la', [deal('1')], { now: t0 });
    await alerts.recordDealsSeen('la', [deal('1'), deal('2')], { now: new Date('2026-11-21T12:00:00Z') });
    const dates = await alerts.firstSeenDates('la', ['1', 2, '3']);
    expect(Object.fromEntries(dates)).toEqual({ 1: '2026-11-20T12:00:00.000Z', 2: '2026-11-21T12:00:00.000Z' });
    expect((await alerts.firstSeenDates('eb', ['1'])).size).toBe(0);
  });
});

describe('notification text', () => {
  it('shortens card names and marks payout rises', () => {
    expect(alerts.shortCard('Blue Business Plus Credit Card from American Express')).toBe('Blue Business Plus');
    expect(alerts.shortCard('Prime Visa')).toBe('Prime Visa');
    const payload = alerts.buildPayload([{
      alert: { id: 'x', kind: 'payout_up', previous_payout: 52, deal: { provider: 'p4d', name: 'Pencil USB-C', stores: ['Walmart'] } },
      evaluation: { payout: 57, retail: 49, profit: 8.98, rewards: 0.98, best_card: { card: { name: 'Blue Business Plus Credit Card from American Express' }, rate: 2, store: 'Walmart' } },
    }]);
    expect(payload).toMatchObject({ title: 'P4D: Pencil USB-C (payout up)', body: 'Cashout $57 (was $52), $49 at Walmart -> +$8.98 (+18.3% ROI) Blue Business Plus', url: '/cashout?tab=new-deals&alert=x' });
  });

  it('puts the ROI (profit over retail, rewards included) after the profit, and none without a retail price', () => {
    expect(alerts.roiLabel({ profit: 8.98, retail: 49 })).toBe('+18.3% ROI');
    expect(alerts.roiLabel({ profit: -2.5, retail: 100 })).toBe('-2.5% ROI');
    expect(alerts.roiLabel({ profit: 0.01, retail: 1000 })).toBe('0% ROI');
    expect(alerts.roiLabel({ profit: null, retail: 49 })).toBeNull();
    expect(alerts.roiLabel({ profit: 5, retail: 0 })).toBeNull();
    expect(alerts.roiLabel({ profit: 5, retail: null })).toBeNull();
    const loss = alerts.buildPayload([{
      alert: { id: 'y', kind: 'new', deal: { provider: 'eb', name: 'Switch', stores: ['Target'] } },
      evaluation: { payout: 290, retail: 300, profit: -10, rewards: null, best_card: null },
    }]);
    expect(loss.body).toBe('Cashout $290, $300 at Target -> -$10 (-3.3% ROI)');
    const noRetail = alerts.buildPayload([{
      alert: { id: 'z', kind: 'new', deal: { provider: 'eb', name: 'Mystery', stores: [] } },
      evaluation: { payout: 50, retail: null, profit: null, rewards: null, best_card: null },
    }]);
    expect(noRetail.body).toBe('Cashout $50, no retail price');
  });
});

describe('evaluateDeal', () => {
  it('picks the best card at the deal store and adds its rewards to the spread', async () => {
    const cards = await db.paymentMethod.findMany({ where: { user_id: ALICE } });
    const result = alerts.evaluateDeal({ payout: 780, retail: 699.99, stores: ['Best Buy'] }, cards);
    expect(result.best_card).toMatchObject({ store: 'Best Buy', rate: 5, card: { name: 'BB Visa' } });
    expect(result.spread).toBe(80.01);
    expect(result.rewards).toBe(35);
    expect(result.profit).toBe(115.01);
    expect(result.roi).toBe(16.43);
    // At another store the flat 2% card wins.
    expect(alerts.evaluateDeal({ payout: 780, retail: 699.99, stores: ['Walmart'] }, cards).best_card.card.name).toBe('Flat 2%');
  });

  it('has no profit without a retail price, and no card when none earns', () => {
    expect(alerts.evaluateDeal({ payout: 100, retail: null, stores: [] }, [{ id: 'x', name: 'Zero', default_cashback_rate: 0 }])).toMatchObject({ profit: null, best_card: null });
  });
});

describe('minimum ROI filter', () => {
  const deal = { provider: 'eb', stores: ['Best Buy'] };
  const settings = (extra) => alerts.dealSettings({ deal_alerts: true, ...extra });

  it('is off unless set, then needs both the profit and the ROI', () => {
    const thin = { profit: 20, retail: 1000, roi: 2 };
    expect(alerts.passesFilters(deal, thin, settings({}))).toBe(true);
    expect(alerts.passesFilters(deal, thin, settings({ deal_min_roi: 5 }))).toBe(false);
    expect(alerts.passesFilters(deal, { profit: 20, retail: 200, roi: 10 }, settings({ deal_min_roi: 5 }))).toBe(true);
    expect(alerts.passesFilters(deal, { profit: 20, retail: 200, roi: 10 }, settings({ deal_min_roi: 5, deal_min_profit: 50 }))).toBe(false);
    expect(alerts.passesFilters(deal, { profit: 10, retail: 200, roi: 5 }, settings({ deal_min_roi: 5 }))).toBe(true);
  });

  it('keeps a deal with no retail price out when a minimum ROI above 0 is set', () => {
    const unpriced = { profit: null, retail: null, roi: null };
    expect(alerts.passesFilters(deal, unpriced, settings({}))).toBe(true);
    expect(alerts.passesFilters(deal, unpriced, settings({ deal_min_roi: 0 }))).toBe(true);
    expect(alerts.passesFilters(deal, unpriced, settings({ deal_min_roi: 3 }))).toBe(false);
  });

  it('holds back a push below the saved minimum ROI', async () => {
    // Alice makes $115.01 on $699.99 (16.4%): 20% blocks it, 15% lets it through.
    await db.notificationSettings.update({ where: { user_id: ALICE }, data: { deal_min_roi: 20 } });
    await alerts.recordDealsSeen('eb', [{ id: 'seed', name: 'Seed', payout: 10, retail: 9, status: 'active', items: [], productLinks: [] }]);
    await alerts.recordDealsSeen('eb', [{ id: 'r1', name: 'Roi Deal', payout: 780, retail: 699.99, status: 'active', productLinks: [], items: [{ id: 'r1-1', name: 'Roi Deal', purchaseLinks: [{ name: 'Best Buy', url: 'https://bestbuy.com/x' }] }] }]);
    await alerts.dispatchDealAlerts();
    expect(sent.filter((entry) => entry.endpoint.endsWith(ALICE))).toHaveLength(0);

    await db.notificationSettings.update({ where: { user_id: ALICE }, data: { deal_min_roi: 15 } });
    await alerts.recordDealsSeen('eb', [{ id: 'r2', name: 'Roi Deal 2', payout: 780, retail: 699.99, status: 'active', productLinks: [], items: [{ id: 'r2-1', name: 'Roi Deal 2', purchaseLinks: [{ name: 'Best Buy', url: 'https://bestbuy.com/x' }] }] }]);
    await alerts.dispatchDealAlerts();
    expect(sent.filter((entry) => entry.endpoint.endsWith(ALICE))).toHaveLength(1);
  });
});

describe('dispatchDealAlerts', () => {
  async function seedThenAdd(newDeals, provider = 'eb') {
    await alerts.recordDealsSeen(provider, [deal('seed')]);
    await alerts.recordDealsSeen(provider, newDeals);
  }

  it('pushes a new deal to users who turned alerts on and whose filters it passes', async () => {
    await seedThenAdd([deal('1', { name: 'PS5 Pro', limit: 3 })]);
    const summary = await alerts.dispatchDealAlerts();
    expect(summary).toMatchObject({ alerts: 1, sent: 2 });
    const byUser = Object.fromEntries(sent.map((entry) => [entry.endpoint.split('/').pop(), entry]));
    expect(Object.keys(byUser).sort()).toEqual([ALICE, BOB].sort());
    expect(byUser[ALICE].title).toBe('EB: PS5 Pro');
    expect(byUser[ALICE].body).toBe('Cashout $780, $699.99 at Best Buy -> +$115.01 (+16.4% ROI) BB Visa');
    expect(byUser[ALICE].url).toMatch(/^\/cashout\?tab=new-deals&alert=/);
    // Bob: 80.01 + 1.5% of 699.99 = 90.51, above his $50.
    expect(byUser[BOB].body).toBe('Cashout $780, $699.99 at Best Buy -> +$90.51 (+12.9% ROI) Bob Card');

    // Sent once: a second run sends nothing.
    sent = [];
    expect((await alerts.dispatchDealAlerts()).alerts).toBe(0);
    expect(sent).toEqual([]);
  });

  it('respects the minimum profit, cashout and store filters', async () => {
    await db.notificationSettings.update({ where: { user_id: ALICE }, data: { deal_stores: ['Target'] } });
    // EB deal at Best Buy with $20 profit: Alice wants Target only; Bob wants $50+.
    await seedThenAdd([deal('1', { payout: 120, retail: 100 })]);
    await alerts.dispatchDealAlerts();
    expect(sent).toEqual([]);

    // An LA deal: Bob only wants EB.
    await db.notificationSettings.update({ where: { user_id: ALICE }, data: { deal_stores: null } });
    await seedThenAdd([deal('2', { payout: 900, retail: 700 })], 'la');
    await alerts.dispatchDealAlerts();
    expect(sent.map((entry) => entry.endpoint.split('/').pop())).toEqual([ALICE]);
  });

  it('only passes a deal with no retail price when the minimum is $0', async () => {
    await seedThenAdd([deal('1', { retail: null })]);
    await alerts.dispatchDealAlerts();
    expect(sent.map((entry) => entry.endpoint.split('/').pop())).toEqual([ALICE]);
    expect(sent[0].body).toBe('Cashout $780, no retail price');
  });

  it('sends several new deals as one push, best profit first', async () => {
    await seedThenAdd([deal('1', { name: 'Small', payout: 110, retail: 100 }), deal('2', { name: 'Big', payout: 900, retail: 700 }), deal('3', { name: 'Mid', payout: 400, retail: 350 })]);
    await alerts.dispatchDealAlerts();
    const alice = sent.find((entry) => entry.endpoint.endsWith(ALICE));
    expect(alice.title).toBe('3 new cashout deals');
    expect(alice.body.split('\n')).toEqual(['EB: Big +$235 (+33.6% ROI)', 'EB: Mid +$67.50 (+19.3% ROI)', 'EB: Small +$15 (+15% ROI)']);
  });

  it('holds nothing back for quiet hours: those deals are skipped, the feed keeps them', async () => {
    await db.notificationSettings.update({ where: { user_id: ALICE }, data: { timezone: 'UTC', deal_quiet_from: '22:00', deal_quiet_to: '07:00' } });
    const night = new Date('2026-11-22T23:30:00Z');
    await alerts.recordDealsSeen('eb', [deal('seed')], { now: night });
    await alerts.recordDealsSeen('eb', [deal('1')], { now: night });
    await alerts.dispatchDealAlerts({ now: night });
    expect(sent.map((entry) => entry.endpoint.split('/').pop())).toEqual([BOB]);
    const feed = await alerts.listDealFeed(ALICE, { now: night });
    expect(feed.items).toHaveLength(1);
  });

  it('never pushes alerts more than 2 hours old', async () => {
    const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
    await alerts.recordDealsSeen('eb', [deal('seed')], { now: old });
    await alerts.recordDealsSeen('eb', [deal('1')], { now: old });
    const summary = await alerts.dispatchDealAlerts();
    expect(summary).toMatchObject({ alerts: 0, stale: 1 });
    expect(sent).toEqual([]);
    expect((await db.cashoutDealAlert.findFirst()).dispatched_at).not.toBeNull();
  });

  it('does not send to a user with no device', async () => {
    await db.pushSubscription.deleteMany({ where: { user_id: ALICE } });
    await seedThenAdd([deal('1')]);
    await alerts.dispatchDealAlerts();
    expect(sent.map((entry) => entry.endpoint.split('/').pop())).toEqual([BOB]);
  });
});

describe('listDealFeed', () => {
  it("shows the week's alerts with this user's profit and whether they match their filters", async () => {
    await alerts.recordDealsSeen('eb', [deal('seed')]);
    await alerts.recordDealsSeen('eb', [deal('1', { payout: 120, retail: 100 })]);
    const alice = await alerts.listDealFeed(ALICE);
    expect(alice.alerts_on).toBe(true);
    expect(alice.items).toHaveLength(1);
    expect(alice.items[0]).toMatchObject({ kind: 'new', profit: 25, matches_filters: true, deal: { provider: 'eb', provider_name: 'ElectronicsBuyer', live: true, stores: ['Best Buy'] } });
    const bob = await alerts.listDealFeed(BOB);
    expect(bob.items[0]).toMatchObject({ profit: 21.5, matches_filters: false });
    const carol = await alerts.listDealFeed(CAROL);
    expect(carol.alerts_on).toBe(false);
    expect(carol.items[0].best_card).toBeNull();
  });
});
