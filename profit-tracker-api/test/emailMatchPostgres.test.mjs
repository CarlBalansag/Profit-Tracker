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
    app.use('/api/expenses', require('../routes/expenses.js'));
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
    for (const t of ['emailMerchantRule', 'emailMatch', 'emailMessage', 'emailOrder', 'emailAccount', 'activityLog', 'sales', 'inventory', 'expense', 'paymentMethod', 'platform']) await prisma[t].deleteMany({});
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
    // The user reviewed it, so the fill isn't waiting on the Automation page.
    expect(await prisma.activityLog.findFirst({ where: { source: 'email' } })).toMatchObject({ review_state: 'confirmed' });
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

  describe('trusted stores and documentation (E4)', () => {
    const receipt = () => email({ merchant: 'pirateship', kind: 'receipt', total: '14.37', payment_hint: 'Visa 4242', sent_at: new Date('2026-03-03T09:01:00Z') });

    it('a trusted store rule turns receipts into reviewed expenses once, with Undo', async () => {
      await receipt();
      const rule = await send('POST', '/api/email/rules', { merchant: 'pirateship', category: 'Shipping', tax_category: 'supplies', payment_method_id: card.id });
      expect(rule.status).toBe(201);
      await send('PUT', '/api/email/automation', { createExpenses: true });
      expect(await sync.organize(prisma, user.id)).toMatchObject({ created: 1 });
      await sync.organize(prisma, user.id);
      const expenses = await prisma.expense.findMany();
      expect(expenses).toHaveLength(1);
      expect(expenses[0]).toMatchObject({ name: 'Pirate Ship', category: 'Shipping', payment_method_id: card.id, external_id: expect.stringMatching(/^email:/) });
      expect(expenses[0].tax_details).toMatchObject({ tax_category: 'supplies', reviewed: true, payment_status: 'paid', paid_date: '2026-03-03' });
      expect(await prisma.emailMatch.findFirst({ where: { record_type: 'expense' } })).toMatchObject({ state: 'linked', auto: true });

      const entry = await prisma.activityLog.findFirst({ where: { source: 'email', record_type: 'expense' } });
      await activity.undoActivity(user.id, entry.id);
      expect(await prisma.expense.count()).toBe(0);
    });

    it('without automatic expenses the receipt waits, and Add as expense creates it for review', async () => {
      await receipt();
      await send('POST', '/api/email/rules', { merchant: 'pirateship' });
      await sync.organize(prisma, user.id);
      expect(await prisma.expense.count()).toBe(0);
      const order = await prisma.emailOrder.findFirst();
      const made = await send('POST', `/api/email/orders/${order.id}/expense`);
      expect(made.status).toBe(201);
      expect((await send('POST', `/api/email/orders/${order.id}/expense`)).status).toBe(201); // same expense, no copy
      expect(await prisma.expense.count()).toBe(1);
      actingUser = other;
      expect((await send('POST', `/api/email/orders/${order.id}/expense`)).status).toBe(404);
    });

    it('custom senders: domains are cleaned, past mail is read again, ignore rules set orders aside', async () => {
      const cursor = await prisma.emailFolderCursor.create({ data: { account_id: account.id, folder: 'INBOX', last_uid: 50 } });
      expect((await send('POST', '/api/email/rules', { domain: 'not a domain' })).status).toBe(400);
      const custom = await send('POST', '/api/email/rules', { domain: 'billing@mail.Anthropic.com', label: 'Claude subscription' });
      expect(custom.body).toMatchObject({ merchant: 'custom:mail.anthropic.com', domain: 'mail.anthropic.com' });
      expect(await prisma.emailFolderCursor.findUnique({ where: { id: cursor.id } })).toBe(null);

      await email({ merchant: 'target', kind: 'order', order_number: '912000000002', total: '9.99', sent_at: new Date('2026-03-02') });
      await send('POST', '/api/email/rules', { merchant: 'target', action: 'ignore' });
      await sync.organize(prisma, user.id);
      expect((await prisma.emailOrder.findFirst({ where: { merchant: 'target' } })).match_state).toBe('dismissed');
      expect((await send('POST', '/api/email/rules', { merchant: 'nope' })).status).toBe(400);
    });

    it('suggests rules from expenses the user already entered', async () => {
      await receipt();
      await sync.organize(prisma, user.id);
      for (const d of ['2026-01-05', '2026-02-05']) {
        await prisma.expense.create({ data: { user_id: user.id, name: 'Pirate Ship labels', amount: 10, date: new Date(d), category: 'Shipping', tax_details: { tax_category: 'supplies', business_use: 'business' } } });
      }
      const { body } = await send('GET', '/api/email/rules');
      expect(body.suggestions[0]).toMatchObject({ merchant: 'pirateship', label: 'Pirate Ship', past_expenses: 2, category: 'Shipping', tax_category: 'supplies' });
    });

    it('marks documentation in bulk for owned expenses only', async () => {
      const a = await prisma.expense.create({ data: { user_id: user.id, name: 'Tape', amount: 5, date: new Date('2026-03-01') } });
      const b = await prisma.expense.create({ data: { user_id: user.id, name: 'Boxes', amount: 7, date: new Date('2026-03-01') } });
      const theirs = await prisma.expense.create({ data: { user_id: other.id, name: 'Theirs', amount: 1, date: new Date('2026-03-01') } });
      expect((await send('PATCH', '/api/expenses/documentation', { ids: [a.id, theirs.id], documentation: 'external' })).status).toBe(404);
      const ok = await send('PATCH', '/api/expenses/documentation', { ids: [a.id, b.id], documentation: 'external', note: 'Paper folder' });
      expect(ok.body.updated).toBe(2);
      expect((await prisma.expense.findUnique({ where: { id: b.id } })).documentation_note).toBe('Paper folder');
      await activity.undoActivity(user.id, ok.body.activity_id);
      expect((await prisma.expense.findUnique({ where: { id: a.id } })).documentation).toBe(null);
      expect((await send('PATCH', '/api/expenses/documentation', { ids: [a.id], documentation: 'lost' })).status).toBe(400);
    });
  });

  describe('order updates and purchases from email (E5)', () => {
    const { listTodos } = require('../services/todos.js');
    const linkedWalmart = async (extra = {}) => {
      const row = await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8, receiving_status: 'PURCHASED', ...extra });
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      return row;
    };

    it('shipping and delivery emails move a linked purchase along once, and fill a blank return-by date', async () => {
      const row = await linkedWalmart();
      await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-03T10:00:00Z') });
      await sync.organize(prisma, user.id);
      let r = await prisma.inventory.findUnique({ where: { id: row.id } });
      expect([r.receiving_status, r.tracking_number]).toEqual(['INBOUND', '1Z999AA10123456784']);

      await email({ merchant: 'walmart', kind: 'delivered', order_number: '2000123-45678901', sent_at: new Date('2026-03-05T18:00:00Z') });
      await sync.organize(prisma, user.id);
      r = await prisma.inventory.findUnique({ where: { id: row.id } });
      expect(r.receiving_status).toBe('ON_HAND');
      expect(r.return_by_date.toISOString().slice(0, 10)).toBe('2026-06-03'); // Walmart: 90 days
      const logged = await prisma.activityLog.count({ where: { source: 'email' } });
      await sync.organize(prisma, user.id);
      expect(await prisma.activityLog.count({ where: { source: 'email' } })).toBe(logged);
    });

    it('a cancellation asks first by default, and cancels the purchase when allowed', async () => {
      const row = await linkedWalmart();
      await email({ merchant: 'walmart', kind: 'cancelled', order_number: '2000123-45678901', sent_at: new Date('2026-03-03T10:00:00Z') });
      await sync.organize(prisma, user.id);
      expect((await prisma.inventory.findUnique({ where: { id: row.id } })).cancelled_at).toBe(null);
      const order = await prisma.emailOrder.findFirst();
      expect(order.attention).toBe('cancelled');
      const todos = await listTodos(prisma, user.id, '2026-03-04');
      expect(todos.items.find((t) => t.key === `email-cancelled:${order.id}`)).toMatchObject({ title: 'Walmart order 2000123-45678901 was cancelled', urgency: 'soon' });
      expect((await send('POST', `/api/email/orders/${order.id}/handled`)).body).toEqual({ handled: true });

      await prisma.emailOrder.update({ where: { id: order.id }, data: { applied_status: null } });
      await send('PUT', '/api/email/automation', { cancellations: true });
      await sync.organize(prisma, user.id);
      expect((await prisma.inventory.findUnique({ where: { id: row.id } })).cancelled_at).not.toBe(null);
    });

    it('says which purchase a cancellation is about, clears once it is cancelled, and comes back with Undo', async () => {
      const row = await linkedWalmart();
      await email({ merchant: 'walmart', kind: 'cancelled', order_number: '2000123-45678901', sent_at: new Date('2026-03-03T10:00:00Z') });
      await sync.organize(prisma, user.id);
      const order = await prisma.emailOrder.findFirst();
      const find = async () => (await listTodos(prisma, user.id, '2026-03-04')).items.find((t) => t.key === `email-cancelled:${order.id}`);
      const todo = await find();
      expect(todo).toMatchObject({
        detail: '2 × Pokemon Booster Bundle · Cancel the purchase too, or change its quantity.',
        link: { kind: 'transaction', inventoryId: row.id, saleId: null },
        actions: ['handled', 'snooze', 'dismiss'],
      });
      expect(todo.email_attention).toMatchObject({ order_id: order.id, kind: 'cancelled', store: 'Walmart', order_number: '2000123-45678901' });
      expect(todo.email_attention.records).toMatchObject([{ id: row.id, name: 'Pokemon Booster Bundle', quantity: 2, amount: 59.94, cancelled: false, cancel: { action: 'cancel' } }]);

      // Done, and Undo.
      expect((await send('POST', `/api/email/orders/${order.id}/handled`)).body).toEqual({ handled: true });
      expect(await find()).toBeUndefined();
      expect((await send('POST', `/api/email/orders/${order.id}/handled`, { undo: true })).body).toEqual({ handled: false });
      expect(await find()).toBeTruthy();

      // A purchase that arrived can't be cancelled; one that isn't the user's never shows.
      await prisma.inventory.update({ where: { id: row.id }, data: { receiving_status: 'ON_HAND' } });
      expect((await find()).email_attention.records[0].cancel).toBe(null);
      await prisma.inventory.update({ where: { id: row.id }, data: { user_id: other.id } });
      expect(await find()).toMatchObject({ detail: 'Not linked to a purchase any more. Mark it done.', link: { kind: 'page', to: '/settings', state: { tab: 'email', emailOrders: 'linked' } } });

      // Cancelled: gone from the To-Do and from Settings > Email.
      await prisma.inventory.update({ where: { id: row.id }, data: { user_id: user.id, cancelled_at: new Date('2026-03-04T00:00:00Z') } });
      expect(await find()).toBeUndefined();
      expect((await send('GET', '/api/email/orders?state=linked')).body.orders[0].attention).toBe(null);
    });

    it('a refund clears once one is recorded on the purchase after the email, not by an older one', async () => {
      const row = await linkedWalmart();
      const before = new Date('2026-02-20T12:00:00Z');
      await prisma.refund.create({ data: { user_id: user.id, inventory_id: row.id, amount: 5, date: before, created_at: before } });
      await email({ merchant: 'walmart', kind: 'refund', order_number: '2000123-45678901', sent_at: new Date('2026-03-03T10:00:00Z') });
      await sync.organize(prisma, user.id);
      const order = await prisma.emailOrder.findFirst();
      const find = async () => (await listTodos(prisma, user.id, '2026-03-04')).items.find((t) => t.key === `email-refund:${order.id}`);
      expect(await find()).toMatchObject({ detail: '2 × Pokemon Booster Bundle · Record the refund on the purchase.' });
      await prisma.refund.create({ data: { user_id: user.id, inventory_id: row.id, amount: 20, date: new Date('2026-03-04T12:00:00Z') } });
      expect(await find()).toBeUndefined();
    });

    it('refuses Undo when there is nothing to bring back', async () => {
      await linkedWalmart();
      const order = await prisma.emailOrder.findFirst();
      expect((await send('POST', `/api/email/orders/${order.id}/handled`, { undo: true })).status).toBe(409);
      expect((await send('POST', '/api/email/orders/nope/handled', { undo: true })).status).toBe(404);
    });

    it('creates purchases from an order email, one per item with tax and shipping shared', async () => {
      await prisma.platform.create({ data: { user_id: user.id, name: 'Best Buy', type: 'Vendor' } });
      await email({ merchant: 'bestbuy', kind: 'order', order_number: 'BBY01-806123456789', total: '330.74', subtotal: '300.00', tax: '24.74', shipping: '6.00', payment_hint: 'Visa 4242',
        items: [{ name: 'Headphones', quantity: 1, total: '200.00' }, { name: 'Cable', quantity: 2, total: '100.00' }], sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const order = await prisma.emailOrder.findFirst();
      expect(order.match_state).toBe('unmatched');
      const made = await send('POST', `/api/email/orders/${order.id}/purchase`);
      expect(made.status).toBe(201);
      const rows = await prisma.inventory.findMany({ where: { id: { in: made.body.purchase_ids } }, include: { vendor: true }, orderBy: { product_name: 'asc' } });
      expect(rows.map((r) => [r.product_name, r.qty_purchased, Number(r.unit_purchase_cost_decimal), Number(r.sales_tax_decimal), Number(r.shipping_cost_inbound_decimal), r.vendor?.name, r.payment_method_id === card.id, r.order_number]))
        .toEqual([['Cable', 2, 50, 8.25, 2, 'Best Buy', true, 'BBY01-806123456789'], ['Headphones', 1, 200, 16.49, 4, 'Best Buy', true, 'BBY01-806123456789']]);
      expect((await send('POST', `/api/email/orders/${order.id}/purchase`)).status).toBe(409);
      expect((await prisma.emailOrder.findFirst()).match_state).toBe('linked');
      // Undo removes both.
      const entry = await prisma.activityLog.findFirst({ where: { source: 'email', record_type: 'purchase' } });
      await activity.undoActivity(user.id, entry.id);
      expect(await prisma.inventory.count({ where: { id: { in: made.body.purchase_ids } } })).toBe(0);
    });

    it('automatic purchases wait a day and skip cancelled orders', async () => {
      await send('PUT', '/api/email/automation', { createPurchases: true });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000003', total: '20.00', sent_at: new Date() });
      // Resale-looking (2 of one item): added. One plain item: a To-Do asks instead.
      await email({ merchant: 'target', kind: 'order', order_number: '912000000004', total: '30.00', items: [{ name: 'Echo Show 8', quantity: 2 }], sent_at: new Date(Date.now() - 3 * 86400000) });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000006', total: '15.00', items: [{ name: 'Cat food', quantity: 1 }], sent_at: new Date(Date.now() - 3 * 86400000) });
      await email({ merchant: 'target', kind: 'cancelled', order_number: '912000000005', total: '40.00', sent_at: new Date(Date.now() - 3 * 86400000) });
      expect(await sync.organize(prisma, user.id)).toMatchObject({ purchasesCreated: 1 });
      expect((await prisma.inventory.findMany()).map((r) => r.product_name)).toEqual(['Echo Show 8']);
      expect((await prisma.emailOrder.findFirst({ where: { order_number: '912000000006' } })).leaning).toBe('ask');
    });

    it('sorts orders with no purchase: personal ones set aside and logged, resale ones asked about on the To-Do', async () => {
      await send('PUT', '/api/email/automation', { homeState: 'ca', personalWords: [' Purina ', 'purina'] });
      const recent = new Date(Date.now() - 2 * 86400000);
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-0000000-0000001', total: '24.99', ship_to: 'SACRAMENTO, CA', items: [{ name: 'Pet Supplies', quantity: 1, category: true }], sent_at: recent });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-0000000-0000002', total: '558.00', ship_to: 'MIDDLETOWN, DE', items: [{ name: 'Jewelry', quantity: 1, category: true }], sent_at: recent });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-0000000-0000003', total: '12.00', ship_to: 'MIDDLETOWN, DE', items: [{ name: 'Purina Friskies', quantity: 1 }], sent_at: recent });
      const result = await sync.organize(prisma, user.id);
      expect(result.sorted).toEqual({ resale: 1, personal: 2, ask: 0 });

      const byNumber = async (n) => prisma.emailOrder.findFirst({ where: { order_number: n } });
      expect([(await byNumber('113-0000000-0000001')).match_state, (await byNumber('113-0000000-0000001')).leaning_reason]).toEqual(['dismissed', 'Ships to SACRAMENTO, CA']);
      expect((await byNumber('113-0000000-0000003')).leaning_reason).toBe('Has "Purina"');
      const logged = await prisma.activityLog.findMany({ where: { user_id: user.id, record_type: 'email_sort' } });
      expect(logged.map((e) => e.detail.reason).sort()).toEqual(['Has "Purina"', 'Ships to SACRAMENTO, CA']);
      expect(logged.every((e) => e.source === 'email')).toBe(true);
      // Sorting again changes nothing and logs nothing new.
      await sync.organize(prisma, user.id);
      expect(await prisma.activityLog.count({ where: { user_id: user.id, record_type: 'email_sort' } })).toBe(2);

      const resale = await byNumber('113-0000000-0000002');
      const today = new Date().toISOString().slice(0, 10);
      let todos = await listTodos(prisma, user.id, today);
      expect(todos.items.find((t) => t.key === `email-add:${resale.id}`)).toMatchObject({
        title: 'Add this Amazon order as a purchase?', detail: 'Jewelry · Ships to MIDDLETOWN, DE', amount: 558, email_order: { id: resale.id },
      });

      // "It's business" brings a personal one back for good; "Personal" sets one aside.
      const cat = await byNumber('113-0000000-0000001');
      await send('POST', `/api/email/orders/${cat.id}/dismiss`, { restore: true });
      await sync.organize(prisma, user.id);
      expect([(await byNumber('113-0000000-0000001')).match_state, (await byNumber('113-0000000-0000001')).leaning]).toEqual(['unmatched', 'kept']);
      await send('POST', `/api/email/orders/${resale.id}/dismiss`, {});
      todos = await listTodos(prisma, user.id, today);
      expect(todos.items.some((t) => t.key === `email-add:${resale.id}`)).toBe(false);
      expect(todos.items.some((t) => t.key === `email-add:${cat.id}`)).toBe(true);
      expect((await send('PUT', '/api/email/automation', { homeState: 'California' })).status).toBe(400);
      await prisma.activityLog.deleteMany({ where: { user_id: user.id } });
    });

    it('tax form emails become To-Do items and stay out of orders', async () => {
      const m = await email({ merchant: 'paypal', kind: 'tax_form', sent_at: new Date('2026-01-31') });
      await sync.organize(prisma, user.id);
      expect(await prisma.emailOrder.count()).toBe(0);
      const todos = await listTodos(prisma, user.id, '2026-02-01');
      expect(todos.items.find((t) => t.key === `email-taxform:${m.id}`)).toMatchObject({ title: 'Tax form from PayPal', group: 'bookkeeping' });
    });
  });

  describe('reviewing what the email did (Automation page)', () => {
    const review = () => require('../services/email/review.js');
    const openIds = async () => (await activity.listActivity(user.id, { source: 'email', review: 'open' })).entries.map((e) => e.id);

    it('shows which blanks linking will fill, and previews the record before linking', async () => {
      await purchase({ product_name: 'Nintendo Switch 2 Console', vendor_id: vendor.id, payment_method_id: card.id, unit_purchase_cost: 449.99, sales_tax: 36 });
      await email({ merchant: 'amazon', kind: 'shipped', order_number: '112-1234567-7654321', total: '485.99', tracking_numbers: ['1Z999AA10123456784'],
        items: [{ name: 'Nintendo Switch 2 Console', quantity: 1 }], sent_at: new Date('2026-03-02T15:30:00Z') });
      await send('PUT', '/api/email/automation', { linkMatches: false });
      await sync.organize(prisma, user.id);
      const [order] = (await send('GET', '/api/email/orders?state=review')).body.orders;
      expect(order.matches[0].will_fill).toEqual(['Order #', 'Tracking #', 'Carrier']);

      const preview = await send('GET', `/api/email/matches/${order.matches[0].id}/preview`);
      expect(preview.status).toBe(200);
      expect(preview.body.order).toMatchObject({ store: 'Amazon', order_number: '112-1234567-7654321', total: '485.99' });
      const fields = Object.fromEntries(preview.body.records[0].fields.map((x) => [x.key, x]));
      expect(fields.order_number).toEqual({ key: 'order_number', label: 'Order #', value: null, fill: '112-1234567-7654321' });
      expect(fields.carrier.fill).toBe('UPS');
      expect(fields.product_name).toEqual({ key: 'product_name', label: 'Product', value: 'Nintendo Switch 2 Console' });
      expect(fields.payment_method.value).toBe('Sapphire ••4242');
      // Nothing was written by looking.
      expect(await prisma.inventory.count({ where: { order_number: { not: null } } })).toBe(0);
      actingUser = other;
      expect((await send('GET', `/api/email/matches/${order.matches[0].id}/preview`)).status).toBe(404);
    });

    it('warns when the purchase already has a different order number', async () => {
      const row = await purchase({ product_name: 'Apple Watch Series 11', vendor_id: vendor.id, unit_purchase_cost: 279, qty_purchased: 2, qty_on_hand: 2 });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-3377308-3825054', total: '558.00',
        items: [{ name: 'Apple Watch Series 11', quantity: 2 }], sent_at: new Date('2026-03-01T15:30:00Z') });
      await send('PUT', '/api/email/automation', { linkMatches: false });
      await sync.organize(prisma, user.id);
      const [order] = (await send('GET', '/api/email/orders?state=review')).body.orders;
      // The purchase gets its own (other) order number after the match was suggested.
      await prisma.inventory.update({ where: { id: row.id }, data: { order_number: '113-5291515-4133865' } });
      const preview = (await send('GET', `/api/email/matches/${order.matches[0].id}/preview`)).body;
      expect(preview.warnings).toEqual([{ code: 'order_number', text: expect.stringContaining('different order number (113-5291515-4133865)') }]);
      const field = preview.records[0].fields.find((x) => x.key === 'order_number');
      expect(field).toMatchObject({ value: '113-5291515-4133865', conflict: '113-3377308-3825054' });
      expect(field.fill).toBeUndefined();
    });

    it('treats an order number typed without dashes as the same order', async () => {
      // Bought long before the email, so only the order number finds it.
      const old = await purchase({ product_name: 'Apple Watch Series 11', vendor_id: vendor.id, order_number: '11333773083825054', purchase_date: new Date('2025-12-01T12:00:00Z'), unit_purchase_cost: 279, qty_purchased: 2, qty_on_hand: 2 });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-3377308-3825054', total: '558.00',
        items: [{ name: 'Apple Watch Series 11', quantity: 2 }], sent_at: new Date('2026-03-01T15:30:00Z') });
      await send('PUT', '/api/email/automation', { linkMatches: false });
      await sync.organize(prisma, user.id);
      const [order] = (await send('GET', '/api/email/orders?state=review')).body.orders;
      expect(order.matches[0].record_ids ?? order.matches[0].records.map((r) => r.id)).toEqual([old.id]);
      const codes = order.matches[0].reasons.map((r) => r.code);
      expect(codes).toContain('order_number');
      expect(codes).not.toContain('order_number_conflict');
      const preview = (await send('GET', `/api/email/matches/${order.matches[0].id}/preview`)).body;
      expect(preview.warnings).toEqual([]);
      // What was typed stays as typed.
      expect((await prisma.inventory.findUnique({ where: { id: old.id } })).order_number).toBe('11333773083825054');
    });

    it('still tells apart different numbers, and a bare dash is no number at all', async () => {
      const { scorePurchases, normOrder } = require('../services/email/match.js');
      const order = { merchant: 'amazon', order_number: '113-3377308-3825054', tracking_numbers: [], items: [] };
      const code = (order_number) => scorePurchases(order, [{ order_number, qty_purchased: 1, unit_purchase_cost: 1, purchase_date: new Date() }]).reasons.map((r) => r.code).filter((c) => c.startsWith('order_number'));
      expect(code('113 3377308 3825054')).toEqual(['order_number']);
      expect(code('#113-3377308-3825054')).toEqual(['order_number']);
      expect(code('113-5291515-4133865')).toEqual(['order_number_conflict']);
      expect(code('-')).toEqual([]);
      expect(normOrder(null)).toBe('');
      // Two purchases with only a dash typed are not one order.
      await purchase({ product_name: 'Widget A', order_number: '-', vendor_id: vendor.id, unit_purchase_cost: 100, purchase_date: new Date('2026-03-01T12:00:00Z') });
      await purchase({ product_name: 'Widget B', order_number: '-', vendor_id: vendor.id, unit_purchase_cost: 50, purchase_date: new Date('2026-03-01T12:00:00Z') });
      await email({ merchant: 'amazon', kind: 'order', order_number: '112-5-5', total: '150.00', items: [{ name: 'Widget A' }], sent_at: new Date('2026-03-01T15:30:00Z') });
      await sync.organize(prisma, user.id);
      expect((await prisma.emailMatch.findMany()).every((m) => m.record_ids.length === 1)).toBe(true);
    });

    it('no warning when the purchase has no order number yet', async () => {
      await purchase({ product_name: 'Apple Watch Series 11', vendor_id: vendor.id, unit_purchase_cost: 279, qty_purchased: 2, qty_on_hand: 2 });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-3377308-3825054', total: '558.00',
        items: [{ name: 'Apple Watch Series 11', quantity: 2 }], sent_at: new Date('2026-03-01T15:30:00Z') });
      await send('PUT', '/api/email/automation', { linkMatches: false });
      await sync.organize(prisma, user.id);
      const [order] = (await send('GET', '/api/email/orders?state=review')).body.orders;
      const preview = (await send('GET', `/api/email/matches/${order.matches[0].id}/preview`)).body;
      expect(preview.warnings).toEqual([]);
      expect(preview.records[0].fields.find((x) => x.key === 'order_number')).toMatchObject({ value: null, fill: '113-3377308-3825054' });
    });

    it("confirms changes so they move to Completed, only the user's own", async () => {
      await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8 });
      await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', total: '64.74', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const ids = await openIds();
      expect(ids.length).toBe(2); // the fill and the link
      expect((await send('GET', '/api/email/automation/review')).body).toEqual({ to_confirm: 2 });

      actingUser = other;
      expect((await send('POST', '/api/email/automation/confirm', { ids })).body).toEqual({ confirmed: 0 });
      actingUser = user;
      expect((await send('POST', '/api/email/automation/confirm', { ids: [] })).status).toBe(400);
      expect((await send('POST', '/api/email/automation/confirm', { ids })).body).toEqual({ confirmed: 2 });
      expect((await send('GET', '/api/email/automation/review')).body).toEqual({ to_confirm: 0 });
      const done = (await activity.listActivity(user.id, { source: 'email', review: 'done' })).entries;
      expect(done.map((e) => e.review_state)).toEqual(['confirmed', 'confirmed']);
      // Confirming twice changes nothing.
      expect((await send('POST', '/api/email/automation/confirm', { ids })).body).toEqual({ confirmed: 0 });
    });

    it('"No" on an automatic link puts the blanks back, unlinks it and never links it again', async () => {
      const row = await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8, purchase_date: new Date('2026-03-02T15:00:00Z') });
      await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', total: '64.74', tracking_numbers: ['1Z999AA10123456784'],
        items: [{ name: 'Pokemon Booster Bundle', quantity: 2 }], sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      expect((await prisma.emailOrder.findFirst()).match_state).toBe('linked');
      const link = await prisma.activityLog.findFirst({ where: { record_type: 'email_link' } });

      actingUser = other;
      expect((await send('POST', `/api/email/automation/${link.id}/reject`)).status).toBe(404);
      actingUser = user;
      expect((await send('POST', `/api/email/automation/${link.id}/reject`)).body).toEqual({ rejected: true });
      const after = await prisma.inventory.findUnique({ where: { id: row.id } });
      expect([after.order_number, after.tracking_number, after.carrier]).toEqual(['2000123-45678901', null, null]);
      expect((await prisma.emailOrder.findFirst()).match_state).toBe('unmatched');
      expect(await openIds()).toEqual([]);
      expect((await send('POST', `/api/email/automation/${link.id}/reject`)).status).toBe(409);

      await sync.organize(prisma, user.id);
      expect((await prisma.emailOrder.findFirst()).match_state).not.toBe('linked');
      expect((await prisma.inventory.findUnique({ where: { id: row.id } })).tracking_number).toBe(null);
    });

    it('"No" on a purchase made from an email deletes it and never adds it again', async () => {
      await send('PUT', '/api/email/automation', { createPurchases: true });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000004', total: '30.00', items: [{ name: 'Echo Show 8', quantity: 2 }], sent_at: new Date(Date.now() - 3 * 86400000) });
      expect(await sync.organize(prisma, user.id)).toMatchObject({ purchasesCreated: 1 });
      const made = await prisma.activityLog.findFirst({ where: { source: 'email', record_type: 'purchase' } });
      expect(made.detail.email_order_id).toBe((await prisma.emailOrder.findFirst()).id);
      expect((await send('POST', `/api/email/automation/${made.id}/reject`)).body).toEqual({ rejected: true });
      expect(await prisma.inventory.count()).toBe(0);
      expect(await prisma.emailOrder.findFirst()).toMatchObject({ match_state: 'unmatched', leaning: 'declined' });

      expect(await sync.organize(prisma, user.id)).toMatchObject({ purchasesCreated: 0 });
      expect(await prisma.inventory.count()).toBe(0);
      expect((await prisma.emailOrder.findFirst()).leaning).toBe('declined');
      const today = new Date().toISOString().slice(0, 10);
      const { listTodos } = require('../services/todos.js');
      expect((await listTodos(prisma, user.id, today)).items.some((t) => t.key.startsWith('email-add:'))).toBe(false);
    });

    it('links each change to the email it came from (Gmail) and the store order page', async () => {
      await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8 });
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', message_id: '<order-1@walmart.test>', subject: 'Thanks for your order', sent_at: new Date('2026-03-02T15:00:00Z') });
      await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', total: '64.74', tracking_numbers: ['1Z999AA10123456784'], message_id: '<ship-1@walmart.test>', subject: 'Your order shipped', sent_at: new Date('2026-03-03T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const { entries } = await activity.listActivity(user.id, { source: 'email' });
      const withSource = await review().attachSources(user.id, entries);
      const fill = withSource.find((e) => e.record_type === 'purchase');
      expect(fill.email_source).toMatchObject({ store: 'Walmart', order_number: '2000123-45678901', store_url: 'https://www.walmart.com/orders/200012345678901' });
      // A tracking fill points at the shipping email.
      expect(fill.email_source.email).toMatchObject({ subject: 'Your order shipped', kind: 'shipped' });
      expect(fill.email_source.email.url).toBe('https://mail.google.com/mail/?authuser=me%40gmail.com#search/rfc822msgid%3Aship-1%40walmart.test');
      expect(fill.email_source.emails.map((m) => m.subject)).toEqual(['Thanks for your order', 'Your order shipped']);
      const link = withSource.find((e) => e.record_type === 'email_link');
      expect(link.email_source.email.subject).toBe('Thanks for your order');
      // Not Gmail: no link to open, the subject still shows.
      await prisma.emailAccount.update({ where: { id: account.id }, data: { preset: 'yahoo' } });
      const again = await review().attachSources(user.id, entries);
      expect(again.find((e) => e.record_type === 'email_link').email_source.email).toMatchObject({ subject: 'Thanks for your order', url: null });
      expect(review().storeOrderUrl('lowes', '9101')).toBe(null);
      expect(review().storeOrderUrl('amazon', '113-5291515-4133865')).toBe('https://www.amazon.com/gp/your-account/order-details?orderID=113-5291515-4133865');
    });

    it('names a purchase made from an email once its items are read, unless the user renamed it', async () => {
      await prisma.platform.create({ data: { user_id: user.id, name: 'GameStop', type: 'Vendor' } });
      await email({ merchant: 'gamestop', kind: 'order', order_number: '1101000080429674', total: '27.19', subtotal: '25.00', tax: '2.19', sent_at: new Date('2026-04-16T15:00:00Z') });
      await email({ merchant: 'gamestop', kind: 'order', order_number: '1101000080429675', total: '10.00', sent_at: new Date('2026-04-16T15:00:00Z') });
      await sync.organize(prisma, user.id);
      const [first, second] = await prisma.emailOrder.findMany({ orderBy: { order_number: 'asc' } });
      const a = (await send('POST', `/api/email/orders/${first.id}/purchase`)).body.purchase_ids[0];
      const b = (await send('POST', `/api/email/orders/${second.id}/purchase`)).body.purchase_ids[0];
      expect((await prisma.inventory.findUnique({ where: { id: a } })).product_name).toBe('GameStop order 1101000080429674');
      await prisma.inventory.update({ where: { id: b }, data: { product_name: 'My own name' } });
      // The emails are read again with names (a reader update).
      await prisma.emailMessage.updateMany({ data: { items: [{ name: 'GameStop Pro', quantity: 1 }] } });
      await prisma.emailOrder.updateMany({ data: { items: [{ name: 'GameStop Pro', quantity: 1 }] } });
      await sync.organize(prisma, user.id);
      expect((await prisma.inventory.findUnique({ where: { id: a } })).product_name).toBe('GameStop Pro');
      expect((await prisma.inventory.findUnique({ where: { id: b } })).product_name).toBe('My own name');
      const named = await prisma.activityLog.findFirst({ where: { source: 'email', record_id: a, kind: 'change', detail: { path: ['action'], equals: 'edit' } } });
      expect(named.detail.email_order_id).toBe(first.id);
      await activity.undoActivity(user.id, named.id);
      expect((await prisma.inventory.findUnique({ where: { id: a } })).product_name).toBe('GameStop order 1101000080429674');
    });

    it('suggests names from past purchases at the same store and price, and names the purchase in one tap', async () => {
      const target = await prisma.platform.create({ data: { user_id: user.id, name: 'Target', type: 'Vendor' } });
      for (const name of ['Pokemon 151 Booster Bundle', 'Pokemon 151 Booster Bundle', 'Topps Hanger Box']) {
        await purchase({ product_name: name, vendor_id: target.id, unit_purchase_cost: 29.99, purchase_date: new Date('2026-02-01') });
      }
      await purchase({ product_name: 'Something else', vendor_id: target.id, unit_purchase_cost: 12, purchase_date: new Date('2026-02-01') });
      await purchase({ product_name: 'Other store, same price', vendor_id: vendor.id, unit_purchase_cost: 29.99 });
      const theirs = await prisma.platform.create({ data: { user_id: other.id, name: 'Target', type: 'Vendor' } });
      await prisma.inventory.create({ data: { user_id: other.id, vendor_id: theirs.id, product_name: 'Not yours', purchase_date: new Date(), unit_purchase_cost: 29.99, qty_purchased: 1, qty_on_hand: 1 } });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000077', total: '29.99', sent_at: new Date('2026-03-02T15:00:00Z') });
      await sync.organize(prisma, user.id);
      const order = await prisma.emailOrder.findFirst({ where: { order_number: '912000000077' } });
      const made = (await send('POST', `/api/email/orders/${order.id}/purchase`)).body.purchase_ids[0];
      const { entries } = await activity.listActivity(user.id, { source: 'email' });
      const created = (await review().attachSources(user.id, entries)).find((e) => e.purchase);
      expect(created.purchase).toMatchObject({ id: made, name: 'Target order 912000000077', placeholder: true });
      expect(created.purchase.hints.map((h) => [h.name, h.times])).toEqual([['Pokemon 151 Booster Bundle', 2], ['Topps Hanger Box', 1]]);

      actingUser = other;
      expect((await send('POST', `/api/email/automation/${created.id}/name`, { name: 'x' })).status).toBe(404);
      actingUser = user;
      expect((await send('POST', `/api/email/automation/${created.id}/name`, { name: '  ' })).status).toBe(400);
      expect((await send('POST', `/api/email/automation/${created.id}/name`, { name: 'Pokemon 151 Booster Bundle' })).body).toEqual({ id: made, product_name: 'Pokemon 151 Booster Bundle' });
      expect((await prisma.inventory.findUnique({ where: { id: made } })).product_name).toBe('Pokemon 151 Booster Bundle');
      const after = (await review().attachSources(user.id, (await activity.listActivity(user.id, { source: 'email' })).entries)).find((e) => e.purchase);
      expect(after.purchase).toMatchObject({ name: 'Pokemon 151 Booster Bundle', placeholder: false, hints: [] });
      // The rename is the user's own edit, with Undo.
      expect(await prisma.activityLog.count({ where: { source: 'web', record_id: made } })).toBe(1);
    });

    it('"No" on an order set aside as personal brings it back as business', async () => {
      await send('PUT', '/api/email/automation', { homeState: 'CA' });
      await email({ merchant: 'amazon', kind: 'order', order_number: '113-0000000-0000001', total: '24.99', ship_to: 'SACRAMENTO, CA', items: [{ name: 'Pet Supplies', quantity: 1, category: true }], sent_at: new Date(Date.now() - 2 * 86400000) });
      await sync.organize(prisma, user.id);
      const sorted = await prisma.activityLog.findFirst({ where: { record_type: 'email_sort' } });
      await review().rejectEntry(user.id, sorted.id);
      expect(await prisma.emailOrder.findFirst()).toMatchObject({ match_state: 'unmatched', leaning: 'kept' });
      expect((await prisma.activityLog.findUnique({ where: { id: sorted.id } })).review_state).toBe('rejected');
      await sync.organize(prisma, user.id);
      expect((await prisma.emailOrder.findFirst()).match_state).toBe('unmatched');
    });
  });
  describe('before email goes live: no copies, no stale links, no silent stops', () => {
    // Loaded when used: the test database is swapped in by beforeAll.
    const automations = { createMissingPurchases: (...a) => require('../services/email/automations.js').createMissingPurchases(...a), unappliedOrderIds: (...a) => require('../services/email/automations.js').unappliedOrderIds(...a) };
    const daysAgo = (n) => new Date(Date.now() - n * 86400000);
    const byNumber = (n) => prisma.emailOrder.findFirst({ where: { order_number: n } });
    const statuses = (answers) => answers.map((a) => a.status).sort();

    it('adds an order from email once, however many requests or syncs ask at the same time', async () => {
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-00000001', total: '21.60', subtotal: '20.00', tax: '1.60', items: [{ name: 'Lego Set', quantity: 1, total: '20.00' }], sent_at: daysAgo(3) });
      await sync.organize(prisma, user.id);
      const order = await byNumber('2000123-00000001');
      const answers = await Promise.all([1, 2, 3, 4].map(() => send('POST', `/api/email/orders/${order.id}/purchase`)));
      expect(statuses(answers)).toEqual([201, 409, 409, 409]);
      expect(await prisma.inventory.count()).toBe(1);
      expect(await prisma.emailMatch.count({ where: { order_id: order.id, state: 'linked' } })).toBe(1);
      expect(await prisma.activityLog.count({ where: { source: 'email', record_type: 'purchase' } })).toBe(1);

      // The automatic kind, from two syncs running at once.
      await email({ merchant: 'target', kind: 'order', order_number: '912000000111', total: '30.00', items: [{ name: 'Board Game', quantity: 2, total: '30.00' }], sent_at: daysAgo(3) });
      await sync.organize(prisma, user.id);
      await prisma.emailOrder.updateMany({ where: { order_number: '912000000111' }, data: { leaning: 'kept', match_state: 'unmatched' } });
      const made = await Promise.all([automations.createMissingPurchases(prisma, user.id), automations.createMissingPurchases(prisma, user.id)]);
      expect(made[0] + made[1]).toBe(1);
      expect(await prisma.inventory.count()).toBe(2);
      expect((await byNumber('912000000111')).match_state).toBe('linked');
    });

    it('adds a receipt as an expense once, and only an unlinked store order or receipt', async () => {
      await email({ merchant: 'pirateship', kind: 'receipt', total: '14.37', sent_at: new Date('2026-03-03T09:01:00Z') });
      await sync.organize(prisma, user.id);
      const receipt = await prisma.emailOrder.findFirst({ where: { merchant: 'pirateship' } });
      const answers = await Promise.all([1, 2, 3].map(() => send('POST', `/api/email/orders/${receipt.id}/expense`)));
      expect(statuses(answers)).toEqual([201, 201, 201]);
      expect(new Set(answers.map((a) => a.body.expense_id)).size).toBe(1);
      expect(await prisma.expense.count()).toBe(1);

      // A sale email, a cancelled order, and an order already linked to a purchase.
      await email({ merchant: 'ebay', kind: 'sale', order_number: '12-34567-00001', total: '50.00', sent_at: new Date('2026-03-04T10:00:00Z') });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000222', total: '9.99', sent_at: new Date('2026-03-04T10:00:00Z') });
      await email({ merchant: 'target', kind: 'cancelled', order_number: '912000000222', sent_at: new Date('2026-03-05T10:00:00Z') });
      await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8 });
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const asExpense = async (n) => (await send('POST', `/api/email/orders/${(await byNumber(n)).id}/expense`)).status;
      expect((await byNumber('2000123-45678901')).match_state).toBe('linked');
      expect([await asExpense('12-34567-00001'), await asExpense('912000000222'), await asExpense('2000123-45678901')]).toEqual([400, 400, 409]);
      expect(await prisma.expense.count()).toBe(1);
    });

    it('links a suggestion once, never a rejected one, and never one purchase to two orders', async () => {
      await send('PUT', '/api/email/automation', { linkMatches: false });
      await purchase({});
      const thing = { merchant: 'target', kind: 'order', total: '10.00', items: [{ name: 'Thing' }], sent_at: new Date('2026-03-02T16:00:00Z') };
      await email({ ...thing, order_number: '912000000301' });
      await email({ ...thing, order_number: '912000000302' });
      await sync.organize(prisma, user.id);
      const suggestion = async (n) => prisma.emailMatch.findFirst({ where: { order_id: (await byNumber(n)).id, state: 'suggested' } });
      const first = await suggestion('912000000301');
      const second = await suggestion('912000000302');
      expect([Boolean(first), Boolean(second)]).toEqual([true, true]);

      const answers = await Promise.all([1, 2, 3].map(() => send('POST', `/api/email/matches/${first.id}/accept`)));
      expect(statuses(answers)).toEqual([200, 404, 404]);
      expect(await prisma.emailMatch.count({ where: { state: 'linked' } })).toBe(1);
      // The other order's suggestion pointed at the purchase the first one
      // took: it is withdrawn, the order goes back to no match, and a stale
      // tab can't accept it.
      expect((await prisma.emailMatch.findUnique({ where: { id: second.id } })).state).toBe('rejected');
      expect((await byNumber('912000000302')).match_state).toBe('unmatched');
      expect((await send('POST', `/api/email/matches/${second.id}/accept`)).status).toBe(404);
      await sync.organize(prisma, user.id);
      expect(await suggestion('912000000302')).toBe(null);
      expect(await prisma.emailMatch.count({ where: { state: 'linked' } })).toBe(1);

      // "Not this", then a stale tab says yes.
      await purchase({ product_name: 'Other Gadget', unit_purchase_cost: 33 });
      await email({ merchant: 'target', kind: 'order', order_number: '912000000303', total: '33.00', items: [{ name: 'Other Gadget' }], sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const third = await suggestion('912000000303');
      expect((await send('POST', `/api/email/matches/${third.id}/reject`)).status).toBe(200);
      expect((await send('POST', `/api/email/matches/${third.id}/accept`)).status).toBe(404);
      expect((await byNumber('912000000303')).match_state).toBe('unmatched');
    });

    it('keeps applying updates when a user has more linked orders than one run reads', async () => {
      await prisma.emailOrder.createMany({ data: Array.from({ length: 520 }, (_, i) => ({
        user_id: user.id, key: `walmart:old-${i}`, merchant: 'walmart', order_number: `old-${i}`, type: 'purchase',
        status: 'order', applied_status: 'order', match_state: 'linked', last_seen: new Date('2026-01-01T00:00:00Z'),
      })) });
      const row = await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8, receiving_status: 'PURCHASED' });
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', sent_at: new Date('2026-03-02T16:00:00Z') });
      await email({ merchant: 'walmart', kind: 'shipped', order_number: '2000123-45678901', tracking_numbers: ['1Z999AA10123456784'], sent_at: new Date('2026-03-03T10:00:00Z') });
      await sync.organize(prisma, user.id);
      const after = await prisma.inventory.findUnique({ where: { id: row.id } });
      expect([after.receiving_status, after.tracking_number]).toEqual(['INBOUND', '1Z999AA10123456784']);
      // Nothing is left waiting, and only unapplied orders are ever picked.
      expect(await automations.unappliedOrderIds(prisma, user.id, { type: 'purchase', matchState: 'linked', take: 500 })).toEqual([]);
      await prisma.emailOrder.updateMany({ where: { order_number: { in: ['old-3', 'old-7'] } }, data: { status: 'shipped' } });
      await prisma.emailOrder.updateMany({ where: { order_number: 'old-9' }, data: { applied_status: null } });
      expect(await automations.unappliedOrderIds(prisma, user.id, { type: 'purchase', matchState: 'linked', take: 500 })).toHaveLength(3);
      expect(await automations.unappliedOrderIds(prisma, user.id, { type: 'purchase', matchState: 'linked', take: 2 })).toHaveLength(2);
      expect(await automations.unappliedOrderIds(prisma, other.id, { type: 'purchase', matchState: 'linked', take: 500 })).toEqual([]);
    });

    it('Reset transactions frees the email orders of deleted purchases, and the next sync does not add them back', async () => {
      const { resetUserData } = require('../services/dataReset.js');
      await purchase({ product_name: 'Pokemon Booster Bundle', order_number: '2000123-45678901', unit_purchase_cost: 29.97, qty_purchased: 2, qty_on_hand: 2, sales_tax: 4.8 });
      await email({ merchant: 'walmart', kind: 'order', order_number: '2000123-45678901', total: '64.74', items: [{ name: 'Pokemon Booster Bundle', quantity: 2, total: '59.94' }], sent_at: new Date('2026-03-02T16:00:00Z') });
      await prisma.expense.create({ data: { user_id: user.id, name: 'Pirate Ship labels', amount: 14.37, date: new Date('2026-03-03T09:00:00Z') } });
      await email({ merchant: 'pirateship', kind: 'receipt', total: '14.37', sent_at: new Date('2026-03-03T09:01:00Z') });
      // An order still waiting for a yes or no on its purchase.
      await purchase({});
      await email({ merchant: 'target', kind: 'order', order_number: '912000000301', total: '10.00', items: [{ name: 'Thing' }], sent_at: new Date('2026-03-02T16:00:00Z') });
      await sync.organize(prisma, user.id);
      const states = async () => Object.fromEntries((await prisma.emailOrder.findMany()).map((o) => [o.merchant, [o.match_state, o.leaning]]));
      expect((await states()).walmart[0]).toBe('linked');
      expect((await states()).pirateship[0]).toBe('linked');
      expect((await states()).target[0]).toBe('review');

      await send('PUT', '/api/email/automation', { createPurchases: true });
      await resetUserData(user.id, 'transactions', prisma);
      expect(await prisma.inventory.count()).toBe(0);
      const after = await states();
      expect(after.walmart).toEqual(['unmatched', 'declined']);
      expect(after.target[0]).toBe('unmatched');
      // Expenses are kept by this reset, and so is the receipt's link.
      expect(after.pirateship[0]).toBe('linked');
      expect((await prisma.emailMatch.findMany()).map((m) => m.record_type)).toEqual(['expense']);
      expect((await byNumber('2000123-45678901')).applied_status).toBe(null);

      await sync.organize(prisma, user.id);
      expect(await prisma.inventory.count()).toBe(0);
      // Still there to add by hand.
      expect((await send('POST', `/api/email/orders/${(await byNumber('2000123-45678901')).id}/purchase`)).status).toBe(201);
    });
  });
});
