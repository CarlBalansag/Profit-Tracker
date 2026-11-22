// E3 on Postgres: emails grouped into orders, orders matched to purchases,
// sales and expenses with reasons, sure matches linked (blank fields filled,
// undoable), unsure ones reviewed, rejected ones not suggested again.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

let pg, prisma, server, base, user, other, actingUser, sync, activity, account, vendor, ebay, card;

const freePort = async () => {
  const socket = createServer();
  await new Promise((r) => socket.listen(0, '127.0.0.1', r));
  const { port } = socket.address();
  await new Promise((r) => socket.close(r));
  return port;
};
const send = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
let n = 0;
const email = (data) => prisma.emailMessage.create({ data: {
  user_id: user.id, account_id: account.id, dedupe_key: `k${n += 1}`, folder: 'INBOX', uid: n, from_address: 'x@example.test',
  status: 'extracted', tracking_numbers: [], ...data,
} });
const purchase = (data) => prisma.inventory.create({ data: {
  user_id: user.id, product_name: 'Thing', purchase_date: new Date('2026-03-02T15:00:00Z'), unit_purchase_cost: 10, qty_purchased: 1, qty_on_hand: 1, ...data,
} });

describe('email orders and matching on Postgres', () => {
  beforeAll(async () => {
    const port = await freePort();
    const dir = await mkdtemp(join(tmpdir(), 'profittracker-emailmatch-qa-'));
    pg = new EmbeddedPostgres({ databaseDir: join(dir, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: true, initdbFlags: ['--encoding=UTF8', '--locale=C'], onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('emailmatch_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/emailmatch_qa`;
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url }, stdio: 'pipe' });
    prisma = new PrismaClient({ datasources: { db: { url } } });
    require.cache[require.resolve('../prisma.js')] = { id: 'prisma', filename: require.resolve('../prisma.js'), loaded: true, exports: prisma };
    sync = require('../services/email/sync.js');
    activity = require('../services/activityLog.js');
    const express = require('express');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = actingUser; next(); });
    app.use('/api/email', require('../routes/email.js'));
    app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${server.address().port}`;
  }, 120000);

  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await prisma?.$disconnect();
    await pg?.stop();
  });

  beforeEach(async () => {
    for (const t of ['emailMatch', 'emailMessage', 'emailOrder', 'emailAccount', 'activityLog', 'sales', 'inventory', 'expense', 'paymentMethod', 'platform']) await prisma[t].deleteMany({});
    await prisma.user.deleteMany({});
    user = await prisma.user.create({ data: { email: 'match-qa@example.test' } });
    other = await prisma.user.create({ data: { email: 'match-qa-other@example.test' } });
    actingUser = user;
    account = await prisma.emailAccount.create({ data: { user_id: user.id, provider: 'imap', preset: 'gmail', email_address: 'me@gmail.com', sync_since: new Date('2026-01-01') } });
    vendor = await prisma.platform.create({ data: { user_id: user.id, name: 'Amazon', type: 'Vendor' } });
    ebay = await prisma.platform.create({ data: { user_id: user.id, name: 'eBay', type: 'Marketplace' } });
    card = await prisma.paymentMethod.create({ data: { user_id: user.id, name: 'Sapphire', type: 'Credit', last4: '4242' } });
  });

  it('groups a confirmation, a shipping email and a carrier email into one order', async () => {
    await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', sent_at: new Date('2026-03-01') });
    await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', tracking_numbers: ['9400111899223344556677'], sent_at: new Date('2026-03-02') });
    await email({ merchant: 'usps', kind: 'delivered', tracking_numbers: ['9400111899223344556677'], sent_at: new Date('2026-03-04') });
    await sync.organize(prisma, user.id);
    const orders = await prisma.emailOrder.findMany({ include: { _count: { select: { messages: true } } } });
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ key: 'walmart:2000123-45678901', status: 'delivered', type: 'purchase', tracking_numbers: ['9400111899223344556677'] });
    expect(orders[0]._count.messages).toBe(3);
    expect(orders[0].total.toString()).toBe('64.74');

    // The carrier email arriving first is absorbed once the store email names its tracking number.
    await email({ merchant: 'ups', kind: 'shipped', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-05') });
    await sync.organize(prisma, user.id);
    expect(await prisma.emailOrder.count()).toBe(2);
    await email({ merchant: 'amazon', kind: 'shipped', order_number: '112-1-1', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-05') });
    await sync.organize(prisma, user.id);
    expect((await prisma.emailOrder.findMany()).map((o) => o.key).sort()).toEqual(['amazon:112-1-1', 'walmart:2000123-45678901']);
  });

  it('links a sure match automatically, fills blank fields only, and Undo puts them back', async () => {
    const row = await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8, notes: 'mine' });
    await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', total: '64.74', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-02T16:00:00Z') });
    const summary = await sync.organize(prisma, user.id);
    expect(summary).toMatchObject({ linked: 1 });
    const linked = await prisma.inventory.findUnique({ where: { id: row.id } });
    expect([linked.tracking_number, linked.carrier, linked.order_number, linked.notes]).toEqual(['1Z999AA10123456784', 'UPS', '2000123-45678901', 'mine']);
    const match = await prisma.emailMatch.findFirst();
    expect(match).toMatchObject({ state: 'linked', auto: true, record_type: 'purchase', record_ids: [row.id] });
    expect(match.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['order_number', 'total', 'date']));

    const entry = await prisma.activityLog.findFirst({ where: { source: 'email' } });
    expect(entry).toBeTruthy();
    await activity.undoActivity(user.id, entry.id);
    expect((await prisma.inventory.findUnique({ where: { id: row.id } })).tracking_number).toBe(null);
  });

  it('puts an unsure match up for review, explains it, and accepting fills the order number', async () => {
    const row = await purchase({ product_name: 'Nintendo Switch 2 Console', vendor_id: vendor.id, payment_method_id: card.id, unit_purchase_cost: 449.99, sales_tax: 36 });
    await purchase({ product_name: 'Other thing', vendor_id: vendor.id, unit_purchase_cost: 12, purchase_date: new Date('2026-02-01') });
    await email({ merchant: 'amazon', kind: 'order', order_number: '112-1234567-7654321', total: '485.99', payment_hint: 'Visa 4242',
      items: [{ name: 'Nintendo Switch 2 Console', quantity: 1 }], sent_at: new Date('2026-03-02T15:30:00Z') });
    expect(await sync.organize(prisma, user.id)).toMatchObject({ review: 1, linked: 0 });

    const list = await send('GET', '/api/email/orders?state=review');
    expect(list.body.counts).toMatchObject({ review: 1 });
    const [order] = list.body.orders;
    expect(order.matches).toHaveLength(1);
    expect(order.matches[0]).toMatchObject({ band: 'medium', records: [expect.objectContaining({ name: 'Nintendo Switch 2 Console' })] });
    expect(order.matches[0].reasons.map((r) => r.text)).toEqual(expect.arrayContaining(['Same total', 'Same store', 'Same card (4242)', 'Item names match']));

    actingUser = other;
    expect((await send('POST', `/api/email/matches/${order.matches[0].id}/accept`)).status).toBe(404);
    actingUser = user;
    expect((await send('POST', `/api/email/matches/${order.matches[0].id}/accept`)).body).toEqual({ linked: true });
    expect((await prisma.inventory.findUnique({ where: { id: row.id } })).order_number).toBe('112-1234567-7654321');
    expect((await prisma.emailOrder.findFirst()).match_state).toBe('linked');
  });

  it('never suggests a rejected match again, and Accept all takes the top suggestion', async () => {
    await purchase({ product_name: 'Nintendo Switch 2 Console', vendor_id: vendor.id, unit_purchase_cost: 449.99, sales_tax: 36 });
    await email({ merchant: 'amazon', kind: 'order', order_number: '112-9', total: '485.99', sent_at: new Date('2026-03-02T15:30:00Z') });
    await sync.organize(prisma, user.id);
    const match = await prisma.emailMatch.findFirst();
    await send('POST', `/api/email/matches/${match.id}/reject`);
    await sync.organize(prisma, user.id);
    expect(await prisma.emailMatch.count({ where: { state: 'suggested' } })).toBe(0);
    expect((await prisma.emailOrder.findFirst()).match_state).toBe('unmatched');

    await purchase({ product_name: 'Mario Kart World', vendor_id: vendor.id, unit_purchase_cost: 79.99, purchase_date: new Date('2026-03-10T12:00:00Z') });
    await email({ merchant: 'amazon', kind: 'order', order_number: '112-10', total: '79.99', items: [{ name: 'Mario Kart World' }], sent_at: new Date('2026-03-10T13:00:00Z') });
    await sync.organize(prisma, user.id);
    const all = await send('POST', '/api/email/matches/accept-all');
    expect(all.body.linked).toBeGreaterThanOrEqual(1);
    expect(await prisma.emailOrder.count({ where: { match_state: 'review' } })).toBe(0);
  });

  it('matches sale emails to sales and receipts to expenses, and turning auto-link off keeps them for review', async () => {
    const inv = await purchase({ product_name: 'Pokemon Charizard Card', unit_purchase_cost: 100 });
    const sale = await prisma.sales.create({ data: { inventory_id: inv.id, platform_id: ebay.id, quantity: 1, unit_price: 262.5, sale_date: new Date('2026-03-03T10:00:00Z') } });
    await prisma.expense.create({ data: { user_id: user.id, name: 'Pirate Ship labels', amount: 14.37, date: new Date('2026-03-03T09:00:00Z') } });
    await email({ merchant: 'ebay', kind: 'sale', order_number: '12-34567-89012', total: '262.50', items: [{ name: 'Pokemon Charizard Card' }], sent_at: new Date('2026-03-03T10:05:00Z') });
    await email({ merchant: 'pirateship', kind: 'receipt', total: '14.37', sent_at: new Date('2026-03-03T09:01:00Z') });

    expect((await send('PUT', '/api/email/automation', { linkMatches: false })).body.linkMatches).toBe(false);
    expect(await sync.organize(prisma, user.id)).toMatchObject({ review: 2, linked: 0 });
    const types = (await prisma.emailMatch.findMany()).map((m) => [m.record_type, m.band]).sort();
    expect(types).toEqual([['expense', 'high'], ['sale', 'high']]);
    expect((await prisma.emailMatch.findFirst({ where: { record_type: 'sale' } })).record_ids).toEqual([sale.id]);
    expect((await send('PUT', '/api/email/automation', { nope: true })).status).toBe(400);
  });

  it('dismisses an order that is not business, and deleting an account removes its orders', async () => {
    await email({ merchant: 'target', kind: 'order', order_number: '912000000001', total: '20.00', sent_at: new Date('2026-03-02') });
    await sync.organize(prisma, user.id);
    const order = await prisma.emailOrder.findFirst();
    expect((await send('POST', `/api/email/orders/${order.id}/dismiss`)).body.match_state).toBe('dismissed');
    await sync.organize(prisma, user.id);
    expect((await prisma.emailOrder.findFirst()).match_state).toBe('dismissed');
    await send('DELETE', `/api/email/accounts/${account.id}?delete_data=true`);
    expect(await prisma.emailOrder.count()).toBe(0);
  });
});
