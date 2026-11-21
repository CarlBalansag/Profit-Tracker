// Activity log + undo for setup records (cards, store accounts, platforms,
// buyers, goals, recurring expenses), through the real routes against a real
// (throwaway) Postgres. The point is the foreign keys: deleting a card makes
// the database clear it on every purchase, expense, recurring expense and
// sale label (ON DELETE SET NULL), and undo has to put all of that back.
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

const ME = '00000000-0000-4000-8000-0000000000b1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
let pg;
let db;
let server;
let baseUrl;
let currentUser = ME;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-activity-setup-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('activity_setup_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/activity_setup_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  // Routes and services share ../prisma.js; point it at this database first.
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: currentUser }; next(); });
  app.use('/api/payment-methods', require('../routes/paymentMethods'));
  app.use('/api/platforms', require('../routes/platforms'));
  app.use('/api/accounts', require('../routes/accounts'));
  app.use('/api/buyers', require('../routes/buyers'));
  app.use('/api/goals', require('../routes/goals'));
  app.use('/api/recurring-expenses', require('../routes/recurringExpenses'));
  app.use('/api/activity', require('../routes/activity'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}, 180000);

afterAll(async () => {
  if (server) server.close();
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

const call = async (method, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};
const undo = (id) => call('POST', `/api/activity/${id}/undo`);
const latest = () => db.activityLog.findFirst({ where: { user_id: ME }, orderBy: { created_at: 'desc' } });

let ids;
beforeEach(async () => {
  currentUser = ME;
  await db.$executeRaw`TRUNCATE "User" CASCADE`;
  await db.user.create({ data: { id: ME, username: 'setup-qa', email: 'setup-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'setup-qa-2', email: 'setup-qa-2@example.invalid' } });
  const card = await db.paymentMethod.create({
    data: {
      user_id: ME, name: 'Amazon Store Card', type: 'Credit', default_cashback_rate: 5,
      category_rates: JSON.stringify([{ store: 'Amazon', rate: 5 }]), statement_close_day: 12, due_day: 7, credit_limit: 3000,
    },
  });
  const otherCard = await db.paymentMethod.create({ data: { user_id: ME, name: 'Other Card', type: 'Credit' } });
  const vendor = await db.platform.create({ data: { user_id: ME, name: 'Target', type: 'Vendor', fee_pct: 0 } });
  const market = await db.platform.create({ data: { user_id: ME, name: 'eBay', type: 'Marketplace', fee_pct: 13 } });
  const account = await db.account.create({ data: { user_id: ME, platform_id: vendor.id, name: 'Target main' } });
  const buyer = await db.buyer.create({ data: { user_id: ME, name: 'Local buyer' } });
  const purchases = [];
  for (let i = 0; i < 3; i += 1) {
    purchases.push(await db.inventory.create({
      data: {
        user_id: ME, product_name: `Drill ${i}`, purchase_date: new Date('2026-10-01T12:00:00Z'),
        unit_purchase_cost: 100, qty_purchased: 2, qty_on_hand: 1, receiving_status: 'ON_HAND',
        payment_method_id: card.id, vendor_id: vendor.id, account_id: account.id,
      },
    }));
  }
  const sale = await db.sales.create({
    data: {
      inventory_id: purchases[0].id, quantity: 1, unit_price: 150, sale_date: new Date('2026-10-03T12:00:00Z'),
      status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID',
      platform_id: market.id, buyer_id: buyer.id, sale_shipping: 9, sale_shipping_payment_method_id: card.id,
    },
  });
  const expense = await db.expense.create({ data: { user_id: ME, name: 'Prime', amount: 15, date: new Date('2026-10-05T12:00:00Z'), payment_method_id: card.id } });
  const recurring = await db.recurringExpense.create({
    data: { user_id: ME, name: 'Storage', amount: 50, frequency: 'monthly', start_date: new Date('2026-09-01T12:00:00Z'), payment_method_id: card.id },
  });
  ids = { card: card.id, otherCard: otherCard.id, vendor: vendor.id, market: market.id, account: account.id, buyer: buyer.id, purchases: purchases.map((p) => p.id), sale: sale.id, expense: expense.id, recurring: recurring.id };
});

const cardLinks = async (cardId) => ({
  purchases: await db.inventory.count({ where: { payment_method_id: cardId } }),
  expenses: await db.expense.count({ where: { payment_method_id: cardId } }),
  recurring: await db.recurringExpense.count({ where: { payment_method_id: cardId } }),
  labels: await db.sales.count({ where: { sale_shipping_payment_method_id: cardId } }),
});

describe('removing a card', () => {
  it('is logged with every link it cleared, and undo puts the card and its links back', async () => {
    const before = await db.paymentMethod.findUnique({ where: { id: ids.card } });
    expect(await cardLinks(ids.card)).toEqual({ purchases: 3, expenses: 1, recurring: 1, labels: 1 });

    const removed = await call('DELETE', `/api/payment-methods/${ids.card}`);
    expect(removed.status).toBe(200);
    expect(removed.body.activity_id).toBeTruthy();
    expect(await db.paymentMethod.findUnique({ where: { id: ids.card } })).toBeNull();
    expect(await cardLinks(ids.card)).toEqual({ purchases: 0, expenses: 0, recurring: 0, labels: 0 });

    const entry = await db.activityLog.findUnique({ where: { id: removed.body.activity_id } });
    expect(entry).toMatchObject({ kind: 'change', record_type: 'card', record_id: ids.card });
    expect(entry.detail.action).toBe('delete');
    expect(entry.detail.product_name).toBe('Amazon Store Card');
    const links = entry.detail.rows.filter((r) => r.link);
    expect(links).toHaveLength(6);
    expect(entry.detail.rows.find((r) => r.model === 'paymentMethod').op).toBe('delete');

    const undone = await undo(entry.id);
    expect(undone.status).toBe(200);
    const after = await db.paymentMethod.findUnique({ where: { id: ids.card } });
    expect(after).toMatchObject({ name: before.name, statement_close_day: 12, due_day: 7, credit_limit: 3000, category_rates: before.category_rates });
    expect(await cardLinks(ids.card)).toEqual({ purchases: 3, expenses: 1, recurring: 1, labels: 1 });
    expect((await db.activityLog.findUnique({ where: { id: entry.id } })).undone_at).not.toBeNull();
  });

  it('skips a purchase that was given another card or deleted since, and still restores the rest', async () => {
    const removed = await call('DELETE', `/api/payment-methods/${ids.card}`);
    await db.inventory.update({ where: { id: ids.purchases[1] }, data: { payment_method_id: ids.otherCard } });
    await db.inventory.delete({ where: { id: ids.purchases[2] } });

    const undone = await undo(removed.body.activity_id);
    expect(undone.status).toBe(200);
    expect((await db.inventory.findUnique({ where: { id: ids.purchases[0] } })).payment_method_id).toBe(ids.card);
    expect((await db.inventory.findUnique({ where: { id: ids.purchases[1] } })).payment_method_id).toBe(ids.otherCard);
    // The undo entry only lists what it actually wrote, so undoing it again
    // leaves the purchase that kept its new card alone.
    const undoEntry = await db.activityLog.findUnique({ where: { id: undone.body.entry.id } });
    expect(undoEntry.detail.rows.some((r) => r.id === ids.purchases[1])).toBe(false);
    const again = await undo(undoEntry.id);
    expect(again.status).toBe(200);
    expect(await db.paymentMethod.findUnique({ where: { id: ids.card } })).toBeNull();
    expect((await db.inventory.findUnique({ where: { id: ids.purchases[1] } })).payment_method_id).toBe(ids.otherCard);
  });

  it('refuses a second undo of the same removal, and an undo by another user', async () => {
    const removed = await call('DELETE', `/api/payment-methods/${ids.card}`);
    currentUser = OTHER;
    expect((await undo(removed.body.activity_id)).status).toBe(404);
    currentUser = ME;
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect((await undo(removed.body.activity_id)).status).toBe(409);
    expect(await db.paymentMethod.count({ where: { id: ids.card } })).toBe(1);
  });

  it('does not let one user remove, or log against, another user\'s card', async () => {
    currentUser = OTHER;
    const res = await call('DELETE', `/api/payment-methods/${ids.card}`);
    expect(res.status).toBe(404);
    expect(await db.paymentMethod.count({ where: { id: ids.card } })).toBe(1);
    expect(await db.activityLog.count()).toBe(0);
  });

  it('two removals at once: one succeeds, nothing is logged twice', async () => {
    const results = await Promise.all([
      call('DELETE', `/api/payment-methods/${ids.card}`),
      call('DELETE', `/api/payment-methods/${ids.card}`),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await db.activityLog.count({ where: { record_id: ids.card } })).toBe(1);
  });
});

describe('adding and editing a card', () => {
  it('logs an add; undo removes it while unused, and refuses once a purchase uses it', async () => {
    const added = await call('POST', '/api/payment-methods', { name: 'New Card', type: 'Credit', default_cashback_rate: 2 });
    expect(added.status).toBe(200);
    expect(added.body.activity_id).toBeTruthy();
    const entry = await db.activityLog.findUnique({ where: { id: added.body.activity_id } });
    expect(entry).toMatchObject({ record_type: 'card', record_id: added.body.id });
    expect(entry.detail.action).toBe('create');

    await db.inventory.update({ where: { id: ids.purchases[0] }, data: { payment_method_id: added.body.id } });
    const refused = await undo(entry.id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(/used by 1 purchases/);
    expect(await db.paymentMethod.count({ where: { id: added.body.id } })).toBe(1);

    await db.inventory.update({ where: { id: ids.purchases[0] }, data: { payment_method_id: ids.card } });
    expect((await undo(entry.id)).status).toBe(200);
    expect(await db.paymentMethod.count({ where: { id: added.body.id } })).toBe(0);
  });

  it('logs only the fields an edit changed; undo restores them and refuses after a later edit', async () => {
    const edited = await call('PUT', `/api/payment-methods/${ids.card}`, { name: 'Amazon Prime Card', type: 'Credit', default_cashback_rate: 5, due_day: 9 });
    expect(edited.status).toBe(200);
    const entry = await db.activityLog.findUnique({ where: { id: edited.body.activity_id } });
    const fields = Object.keys(entry.detail.rows[0].fields);
    expect(fields).toEqual(expect.arrayContaining(['name', 'due_day']));
    expect(fields).not.toContain('updated_at');

    await call('PUT', `/api/payment-methods/${ids.card}`, { name: 'Renamed Again', type: 'Credit', default_cashback_rate: 5 });
    expect((await undo(entry.id)).status).toBe(409);
    expect((await db.paymentMethod.findUnique({ where: { id: ids.card } })).name).toBe('Renamed Again');
  });

  it('an edit that changes nothing logs nothing', async () => {
    const card = await db.paymentMethod.findUnique({ where: { id: ids.card } });
    const res = await call('PUT', `/api/payment-methods/${ids.card}`, { name: card.name, type: card.type, default_cashback_rate: 5 });
    expect(res.status).toBe(200);
    expect(res.body.activity_id).toBeNull();
  });

  it('a failed add leaves no entry', async () => {
    const res = await call('POST', '/api/payment-methods', { type: 'Credit' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await db.activityLog.count()).toBe(0);
  });
});

describe('platforms, store accounts, buyers', () => {
  it('removing a platform takes its store accounts; undo brings back both and every link', async () => {
    const removed = await call('DELETE', `/api/platforms/${ids.vendor}`);
    expect(removed.status).toBe(200);
    expect(await db.account.count({ where: { id: ids.account } })).toBe(0);
    expect(await db.inventory.count({ where: { OR: [{ vendor_id: ids.vendor }, { account_id: ids.account }] } })).toBe(0);

    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect(await db.platform.count({ where: { id: ids.vendor } })).toBe(1);
    expect(await db.account.count({ where: { id: ids.account } })).toBe(1);
    expect(await db.inventory.count({ where: { vendor_id: ids.vendor, account_id: ids.account } })).toBe(3);
  });

  it('removing a marketplace and a buyer clears and restores their sale links', async () => {
    const platform = await call('DELETE', `/api/platforms/${ids.market}`);
    const buyer = await call('DELETE', `/api/buyers/${ids.buyer}`);
    const sale = () => db.sales.findUnique({ where: { id: ids.sale } });
    expect(await sale()).toMatchObject({ platform_id: null, buyer_id: null });
    expect((await undo(buyer.body.activity_id)).status).toBe(200);
    expect((await undo(platform.body.activity_id)).status).toBe(200);
    expect(await sale()).toMatchObject({ platform_id: ids.market, buyer_id: ids.buyer });
  });

  it('switching a platform to tax-exempt is one entry with its sales; undo restores the sales', async () => {
    const res = await call('PUT', `/api/platforms/${ids.market}`, { tax_exempt_place: true });
    expect(res.status).toBe(200);
    expect((await db.sales.findUnique({ where: { id: ids.sale } })).customer_tax_exempt).toBe(true);
    const entry = await db.activityLog.findUnique({ where: { id: res.body.activity_id } });
    expect(entry.detail.rows.map((r) => r.model).sort()).toEqual(['platform', 'sales']);
    expect((await undo(entry.id)).status).toBe(200);
    expect((await db.sales.findUnique({ where: { id: ids.sale } })).customer_tax_exempt).toBe(false);
  });

  it('removing a store account clears and restores its purchases', async () => {
    const res = await call('DELETE', `/api/accounts/${ids.account}`);
    expect(res.status).toBe(204);
    const entry = await latest();
    expect(entry).toMatchObject({ record_type: 'account', record_id: ids.account });
    expect(await db.inventory.count({ where: { account_id: ids.account } })).toBe(0);
    expect((await undo(entry.id)).status).toBe(200);
    expect(await db.inventory.count({ where: { account_id: ids.account } })).toBe(3);
  });

  it('a bulk vendor add is one entry listing only the new vendors', async () => {
    const res = await call('POST', '/api/platforms/batch', { vendors: [{ id: ids.vendor, name: 'Target' }, { name: 'Walmart' }, { name: 'Costco' }] });
    expect(res.status).toBe(200);
    const entry = await latest();
    expect(entry.record_type).toBe('platform');
    expect(entry.detail.rows.filter((r) => r.op === 'create')).toHaveLength(2);
    expect(entry.detail.rows.some((r) => r.id === ids.vendor)).toBe(false);
    expect((await undo(entry.id)).status).toBe(200);
    expect(await db.platform.count({ where: { user_id: ME } })).toBe(2);
  });
});

describe('listing by group', () => {
  it('splits setup changes from buys, sales and expenses, and rejects an unknown group', async () => {
    await call('DELETE', `/api/payment-methods/${ids.otherCard}`);
    await db.activityLog.create({ data: { user_id: ME, kind: 'change', record_type: 'purchase', record_id: ids.purchases[0], detail: { action: 'edit', rows: [] } } });
    const types = async (q) => (await call('GET', `/api/activity${q}`)).body.entries.map((e) => e.record_type);
    expect((await types('')).sort()).toEqual(['card', 'purchase']);
    expect(await types('?group=setup')).toEqual(['card']);
    expect(await types('?group=records')).toEqual(['purchase']);
    expect((await call('GET', '/api/activity?group=nope')).status).toBe(400);
  });
});

describe('goals and recurring expenses', () => {
  it('goal add, edit and remove are each logged once and can be undone', async () => {
    const added = await call('POST', '/api/goals', { metric: 'totalRevenue', target_30d: 1000 });
    expect(added.status).toBe(200);
    const edited = await call('PUT', `/api/goals/${added.body.id}`, { target_30d: 2000 });
    const removed = await call('DELETE', `/api/goals/${added.body.id}`);
    expect(await db.activityLog.count({ where: { record_type: 'goal' } })).toBe(3);
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect((await undo(edited.body.activity_id)).status).toBe(200);
    expect(Number((await db.goal.findUnique({ where: { id: added.body.id } })).target_30d)).toBe(1000);
  });

  it('removing a recurring expense logs its generated expenses; undo brings them all back', async () => {
    const created = await call('POST', '/api/recurring-expenses', {
      name: 'Software', amount: 20, frequency: 'monthly', start_date: '2026-08-01', payment_method_id: ids.card,
    });
    expect(created.status).toBe(200);
    const generated = await db.expense.count({ where: { recurring_expense_id: created.body.id } });
    expect(generated).toBeGreaterThan(0);
    const addEntry = await db.activityLog.findUnique({ where: { id: created.body.activity_id } });
    expect(addEntry.detail.rows.filter((r) => r.model === 'expense' && r.op === 'create')).toHaveLength(generated);

    const removed = await call('DELETE', `/api/recurring-expenses/${created.body.id}`);
    expect(await db.expense.count({ where: { recurring_expense_id: created.body.id } })).toBe(0);
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect(await db.recurringExpense.count({ where: { id: created.body.id } })).toBe(1);
    expect(await db.expense.count({ where: { recurring_expense_id: created.body.id } })).toBe(generated);
  });

  it('undoing a recurring expense add removes it and the expenses it generated', async () => {
    const created = await call('POST', '/api/recurring-expenses', {
      name: 'Software', amount: 20, frequency: 'monthly', start_date: '2026-08-01',
    });
    expect((await undo(created.body.activity_id)).status).toBe(200);
    expect(await db.recurringExpense.count({ where: { id: created.body.id } })).toBe(0);
    expect(await db.expense.count({ where: { recurring_expense_id: created.body.id } })).toBe(0);
  });
});
