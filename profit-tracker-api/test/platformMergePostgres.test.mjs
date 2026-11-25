// Merging two cashout groups through the real routes against a throwaway
// Postgres: everything on one moves to the other, nothing is lost, the totals
// stay the same, and one undo puts it all back.
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

const ME = '00000000-0000-4000-8000-0000000000d1';
const OTHER = '00000000-0000-4000-8000-0000000000d2';
const NOWHERE = '00000000-0000-4000-8000-0000000000ff';
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
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-merge-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('merge_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/merge_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = currentUser ? { id: currentUser } : null; next(); });
  app.use('/api/platforms', require('../routes/platforms'));
  app.use('/api/sales', require('../routes/sales'));
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
const merge = (from, into) => call('POST', `/api/platforms/${from}/merge`, { into });
const undo = (id) => call('POST', `/api/activity/${id}/undo`);

const addSale = async (platformId, userId = ME, price = 450) => {
  const purchase = await db.inventory.create({
    data: { user_id: userId, product_name: 'Switch 2', purchase_date: new Date('2026-10-01T12:00:00Z'), unit_purchase_cost: 400, qty_purchased: 1, qty_on_hand: 0, receiving_status: 'ON_HAND' },
  });
  return db.sales.create({
    data: { inventory_id: purchase.id, quantity: 1, unit_price: price, sale_date: new Date('2026-10-02T12:00:00Z'), status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID', platform_id: platformId },
  });
};

// Every row of the models a merge touches, ignoring automatic timestamps.
const everything = async () => {
  const strip = (rows) => rows.map(({ updated_at, ...row }) => row).sort((a, b) => (a.id < b.id ? -1 : 1));
  const all = { orderBy: { id: 'asc' } };
  return JSON.parse(JSON.stringify({
    platforms: strip(await db.platform.findMany(all)),
    sales: strip(await db.sales.findMany(all)),
    inventory: strip(await db.inventory.findMany(all)),
    accounts: strip(await db.account.findMany(all)),
    connections: strip(await db.cashoutConnection.findMany(all)),
    batches: strip(await db.importBatch.findMany(all)),
    forms: strip(await db.taxForm1099K.findMany(all)),
  }));
};

let ids;
beforeEach(async () => {
  currentUser = ME;
  await db.$executeRaw`TRUNCATE "User" CASCADE`;
  await db.user.create({ data: { id: ME, username: 'merge-qa', email: 'merge-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'merge-qa-2', email: 'merge-qa-2@example.invalid' } });
  const group = (data) => db.platform.create({ data: { type: 'Cashout', fee_pct: 0, user_id: ME, ...data } });
  const la = await group({ name: 'LA Cashout', notes: 'Drops Tuesdays', address: '1 Main St' });
  const efb = await group({ name: 'EarnFromBuying', notes: 'Wholesale / Cashout' });
  const third = await group({ name: 'Windy City' });
  const theirs = await group({ name: 'Their group', user_id: OTHER });
  const shop = await group({ name: 'eBay', type: 'Marketplace' });
  const sales = [await addSale(la.id), await addSale(la.id, ME, 99.99), await addSale(efb.id)];
  const theirSale = await addSale(theirs.id, OTHER);
  const account = await db.account.create({ data: { user_id: ME, platform_id: la.id, name: 'Main' } });
  const bought = await db.inventory.create({
    data: { user_id: ME, product_name: 'Bought there', vendor_id: la.id, account_id: account.id, unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 2, purchase_date: new Date('2026-10-01T12:00:00Z') },
  });
  await db.cashoutConnection.create({ data: { user_id: ME, provider: 'la', encrypted_key: 'secret-cipher', key_last4: '1234', platform_id: la.id } });
  await db.importBatch.create({ data: { user_id: ME, source: 'la', platform_id: la.id } });
  await db.taxForm1099K.create({ data: { user_id: ME, year: 2026, payer_name: 'LA', platform_id: la.id, gross_amount: 549.99 } });
  ids = { la: la.id, efb: efb.id, third: third.id, theirs: theirs.id, shop: shop.id, sales: sales.map((s) => s.id), theirSale: theirSale.id, account: account.id, bought: bought.id };
});

describe('preview', () => {
  it('counts what would move, and changes nothing', async () => {
    const before = await everything();
    const { status, body } = await call('GET', `/api/platforms/${ids.la}/merge-preview`);
    expect(status).toBe(200);
    expect(body.counts).toEqual({ sales: 2, purchases: 1, store_accounts: 1, connections: 1, imports: 1, tax_forms: 1 });
    expect((await call('GET', `/api/platforms/${ids.third}/merge-preview`)).body.counts.sales).toBe(0);
    expect(await everything()).toEqual(before);
  });

  it("refuses another user's group, a missing one, a marketplace and signed-out", async () => {
    expect((await call('GET', `/api/platforms/${ids.theirs}/merge-preview`)).status).toBe(404);
    expect((await call('GET', `/api/platforms/${NOWHERE}/merge-preview`)).status).toBe(404);
    expect((await call('GET', `/api/platforms/${ids.shop}/merge-preview`)).status).toBe(400);
    currentUser = null;
    expect((await call('GET', `/api/platforms/${ids.la}/merge-preview`)).status).toBe(401);
  });
});

describe('merge', () => {
  it('moves everything to the kept group, changes nothing else, and removes the other', async () => {
    const before = await everything();
    const { status, body } = await merge(ids.la, ids.efb);
    expect(status).toBe(200);
    expect(body.moved).toEqual({ sales: 2, purchases: 1, store_accounts: 1, connections: 1, imports: 1, tax_forms: 1 });

    const swap = (rows, key) => rows.map((r) => (r[key] === ids.la ? { ...r, [key]: ids.efb } : r));
    const after = await everything();
    expect(after).toEqual({
      platforms: before.platforms.filter((p) => p.id !== ids.la).map((p) => (p.id === ids.efb
        ? { ...p, address: '1 Main St', notes: 'Wholesale / Cashout\nDrops Tuesdays' } : p)),
      sales: swap(before.sales, 'platform_id'),
      inventory: swap(before.inventory, 'vendor_id'),
      accounts: swap(before.accounts, 'platform_id'),
      connections: swap(before.connections, 'platform_id'),
      batches: swap(before.batches, 'platform_id'),
      forms: swap(before.forms, 'platform_id'),
    });
  });

  it('is one Activity entry that names both groups and holds no key', async () => {
    const { body } = await merge(ids.la, ids.efb);
    const entries = await db.activityLog.findMany({ where: { user_id: ME } });
    expect(entries.map((e) => e.id)).toEqual([body.activity_id]);
    expect(entries[0]).toMatchObject({ record_type: 'platform', record_id: ids.la, detail: { action: 'merge', product_name: 'LA Cashout', merged_into: 'EarnFromBuying' } });
    expect(JSON.stringify(entries[0].detail)).not.toContain('secret-cipher');
    expect(entries[0].detail.rows.filter((r) => r.link)).toHaveLength(7);
  });

  it('works on a group with nothing on it, and leaves the kept one as it was', async () => {
    const kept = await db.platform.findUnique({ where: { id: ids.efb } });
    expect((await merge(ids.third, ids.efb)).status).toBe(200);
    expect(await db.platform.findUnique({ where: { id: ids.third } })).toBeNull();
    expect(await db.platform.findUnique({ where: { id: ids.efb } })).toEqual(kept);
  });

  it('keeps each sale\'s own tax setting when the kept group is tax exempt', async () => {
    await db.platform.update({ where: { id: ids.efb }, data: { tax_exempt_place: true } });
    await merge(ids.la, ids.efb);
    expect(await db.sales.findUnique({ where: { id: ids.sales[0] } })).toMatchObject({ taxable: true, customer_tax_exempt: false });
    expect((await db.platform.findUnique({ where: { id: ids.efb } })).tax_exempt_place).toBe(true);
  });

  it('refuses bad requests and changes nothing', async () => {
    const before = await everything();
    expect((await merge(ids.la, ids.la)).status).toBe(400);
    expect((await merge(ids.la, 'not-an-id')).status).toBe(400);
    expect((await call('POST', `/api/platforms/${ids.la}/merge`, {})).status).toBe(400);
    expect((await merge(ids.la, ids.shop)).status).toBe(400);
    expect((await merge(ids.shop, ids.la)).status).toBe(400);
    expect((await merge(ids.la, NOWHERE)).status).toBe(404);
    expect((await merge(ids.la, ids.theirs)).status).toBe(404);
    expect((await merge(ids.theirs, ids.la)).status).toBe(404);
    currentUser = null;
    expect((await merge(ids.la, ids.efb)).status).toBe(401);
    expect(await everything()).toEqual(before);
    expect(await db.activityLog.count()).toBe(0);
  });

  it('merges once when pressed twice, and never both ways at once', async () => {
    const twice = await Promise.all([merge(ids.la, ids.efb), merge(ids.la, ids.efb)]);
    expect(twice.map((r) => r.status).sort()).toEqual([200, 404]);
    const both = await Promise.all([merge(ids.efb, ids.third), merge(ids.third, ids.efb)]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 404]);
    expect(await db.sales.count({ where: { inventory: { user_id: ME }, platform_id: null } })).toBe(0);
    expect(await db.platform.count({ where: { user_id: ME, type: 'Cashout' } })).toBe(1);
  });

  it('never loses a sale recorded at the same moment', async () => {
    const [merged, ...added] = await Promise.allSettled([
      merge(ids.la, ids.efb), ...Array.from({ length: 6 }, () => addSale(ids.la)),
    ]);
    expect(merged.value.status).toBe(200);
    // Each one was either saved in time and moved, or refused; none is left
    // without a group.
    const saved = added.filter((r) => r.status === 'fulfilled').length;
    expect(await db.sales.count({ where: { platform_id: ids.efb } })).toBe(3 + saved);
    expect(await db.sales.count({ where: { platform_id: null } })).toBe(0);
  });

  it('handles hundreds of sales, there and back', async () => {
    const purchase = await db.inventory.findUnique({ where: { id: ids.bought } });
    await db.sales.createMany({
      data: Array.from({ length: 600 }, () => ({ inventory_id: purchase.id, quantity: 1, unit_price: 5, sale_date: new Date('2026-10-02T12:00:00Z'), status: 'PAID', platform_id: ids.la })),
    });
    const { body } = await merge(ids.la, ids.efb);
    expect(body.moved.sales).toBe(602);
    expect((await undo(body.activity_id)).status).toBe(200);
    expect(await db.sales.count({ where: { platform_id: ids.la } })).toBe(602);
  }, 60000);
});

describe('undo', () => {
  it('puts both groups and everything on them back exactly, and redo merges again', async () => {
    const before = await everything();
    const { body } = await merge(ids.la, ids.efb);
    const after = await everything();
    const undone = await undo(body.activity_id);
    expect(undone.status).toBe(200);
    expect(await everything()).toEqual(before);

    expect((await undo(undone.body.entry.id)).status).toBe(200);
    expect(await everything()).toEqual(after);
    expect((await undo(body.activity_id)).status).toBe(409);
  });

  it('leaves what was moved or added since where it is', async () => {
    const { body } = await merge(ids.la, ids.efb);
    await db.sales.update({ where: { id: ids.sales[0] }, data: { platform_id: ids.third } });
    const later = await addSale(ids.efb);
    expect((await undo(body.activity_id)).status).toBe(200);
    const on = async (id) => (await db.sales.findUnique({ where: { id } })).platform_id;
    expect(await on(ids.sales[0])).toBe(ids.third);
    expect(await on(ids.sales[1])).toBe(ids.la);
    expect(await on(later.id)).toBe(ids.efb);
  });

  it('refuses once the kept group is gone, until that is undone first', async () => {
    const first = await merge(ids.third, ids.efb);
    const second = await merge(ids.efb, ids.la);
    const refused = await undo(first.body.activity_id);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toContain('EarnFromBuying was merged or removed since');
    expect((await undo(second.body.activity_id)).status).toBe(200);
    expect((await undo(first.body.activity_id)).status).toBe(200);
    expect(await db.platform.count({ where: { user_id: ME, type: 'Cashout' } })).toBe(3);
  });

  it("is refused for another user's merge", async () => {
    const { body } = await merge(ids.la, ids.efb);
    currentUser = OTHER;
    expect((await undo(body.activity_id)).status).toBe(404);
  });

  it('of a plain delete also relinks past imports', async () => {
    const removed = await call('DELETE', `/api/platforms/${ids.la}`);
    expect((await db.importBatch.findFirst({ where: { user_id: ME } })).platform_id).toBeNull();
    expect((await undo(removed.body.activity_id)).status).toBe(200);
    expect((await db.importBatch.findFirst({ where: { user_id: ME } })).platform_id).toBe(ids.la);
  });
});
