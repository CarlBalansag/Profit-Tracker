// Settings > Data > Past imports, against a real (throwaway) Postgres with
// every migration applied: each cashout import is listed, can be viewed, and
// can be undone in one step that Activity can reverse.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const { PrismaClient } = require('@prisma/client');

const ME = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
let pg;
let db;
let importSold;
let history;
let activityLog;
let ids;

// The ElectronicsBuyer Items Sold export as it comes (one row per unit).
const EB_CSV = [
  'Date,Invoice #,Tracking,Item Name,UPC,SKU,Condition,Location,Serial,Sale Price,Owed',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K (Newest Model),840414613300,840414613300,new,DE,GT55NP0263130S3J,20,20',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K (Newest Model),840414613300,840414613300,new,DE,GT55NP0263130CRM,20,20',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K Select,840268958794,840268958794,new,DE,GT533M0753030C32,18,18',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K Select,840268958794,840268958794,new,DE,GT533M07530303KN,18,18',
].join('\r\n');

const PARSEFILE_CSV = [
  '"VERIFIED","VOID","ID","RECEIPT ID","CREATED DATE","USER","ITEM","WAREHOUSE","QTY","PRICE","TAX","COMMISSION","EXT TOTAL","STATUS","DELIVERY","TRACKING NUMBERS"',
  '"Yes","No","9001","13","2026-11-02 10:15:00","8124","Apple AirPods Pro 2, USB-C","DE","2","$189.00","0","$2.00","$382.00","Paid","UPS","1Z3Y67380340447798"',
  '"Yes","Yes","9002","13","2026-11-02 10:15:00","8124","iPad Air 11","DE","1","499","0","0","499","Pending","UPS","1Z3Y67387740617798"',
  '"No","No","9003","15","11/05/2026","8124","Nintendo Switch 2","DE","1","430","0","0","430","Pending","USPS","9400111899223817600000, 9400111899223817600017"',
].join('\n');

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-history-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('history_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/history_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
  importSold = require('../services/cashouts/importSold');
  history = require('../services/cashouts/importHistory');
  activityLog = require('../services/activityLog');
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  await db.activityLog.deleteMany({});
  await db.refund.deleteMany({});
  await db.sales.deleteMany({});
  await db.cashoutConnection.deleteMany({});
  await db.inventory.deleteMany({});
  await db.importBatch.deleteMany({});
  await db.paymentMethod.deleteMany({});
  await db.platform.deleteMany({});
  await db.user.deleteMany({});
  await db.user.create({ data: { id: ME, username: 'import-qa', email: 'import-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'import-other', email: 'import-other@example.invalid' } });
  const eb = await db.platform.create({ data: { user_id: ME, name: 'EB', type: 'Cashout', workflow_preset: 'CASHOUT' } });
  const store = await db.platform.create({ data: { user_id: ME, name: 'Amazon', type: 'Vendor' } });
  const ebay = await db.platform.create({ data: { user_id: ME, name: 'eBay', type: 'Marketplace' } });
  const theirs = await db.platform.create({ data: { user_id: OTHER, name: 'Their EB', type: 'Cashout' } });
  ids = { eb: eb.id, store: store.id, ebay: ebay.id, theirs: theirs.id };
});

const kept = (groups, costs = {}) => groups
  .filter((g) => g.newQty > 0)
  .map((g) => ({ ...g, qty: g.newQty, unitCost: costs[g.name] ?? null }));

async function importEb(fileName = 'eb-items-sold.csv') {
  const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
  return importSold.commit(ME, { source: 'eb', platformId: ids.eb, vendorId: ids.store, fileName, groups: kept(preview.groups, { 'Fire TV Stick 4K Select': 12.5 }) });
}

describe('past imports', () => {
  it('lists each import with what it added and shows its purchases and sales', async () => {
    const res = await importEb();
    expect(res).toMatchObject({ created: 2, importId: expect.any(String) });
    const [row, ...rest] = await history.list(ME);
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({
      id: res.importId, source: 'eb', sourceName: 'ElectronicsBuyer', cashoutName: 'EB', fileName: 'eb-items-sold.csv',
      purchases: 2, units: 4, payout: 76, costNeeded: 1, remaining: 2,
    });
    const view = await history.detail(ME, res.importId);
    expect(view.purchases).toHaveLength(2);
    const fourK = view.purchases.find((p) => p.name.startsWith('Fire TV Stick 4K (Newest'));
    expect(fourK).toMatchObject({ qty: 2, unitCost: 0, costNeeded: true, store: 'Amazon' });
    expect(fourK.sales).toEqual([expect.objectContaining({ qty: 2, unitPrice: 20, cashout: 'EB', status: 'WAITING_FOR_PAYMENT' })]);
    expect(view.purchases.find((p) => p.name.endsWith('Select'))).toMatchObject({ unitCost: 12.5, costNeeded: false });
    // A cost typed in later (the edit window keeps the note) no longer counts as needed.
    await db.inventory.update({ where: { id: fourK.id }, data: { unit_purchase_cost: 15 } });
    expect((await history.detail(ME, res.importId)).purchases.find((p) => p.id === fourK.id)).toMatchObject({ unitCost: 15, costNeeded: false });
  });

  it('keeps no record of an import that added nothing', async () => {
    await importEb();
    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    // Every row is already in; send them anyway (a stale tab).
    const stale = preview.groups.map((g) => ({ ...g, qty: g.qty, unitCost: null }));
    const res = await importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: stale });
    expect(res).toMatchObject({ created: 0, skipped: 2, importId: null });
    expect(await db.importBatch.count()).toBe(1);
  });

  it('counts what is still there after a purchase is deleted elsewhere', async () => {
    const { importId } = await importEb();
    const one = await db.inventory.findFirst({ where: { import_batch_id: importId } });
    await db.inventory.delete({ where: { id: one.id } });
    expect((await history.list(ME))[0]).toMatchObject({ purchases: 2, remaining: 1 });
    expect((await history.detail(ME, importId)).purchases).toHaveLength(1);
  });

  it('undoes an import, edits and refunds included, and Activity puts it all back', async () => {
    const { importId } = await importEb();
    const other = await db.inventory.create({ data: { user_id: ME, product_name: 'Not imported', purchase_date: new Date('2026-11-01'), unit_purchase_cost: 5, qty_purchased: 1, qty_on_hand: 1 } });
    const fourK = await db.inventory.findFirst({ where: { import_batch_id: importId, product_name: { startsWith: 'Fire TV Stick 4K (Newest' } }, include: { sales: true } });
    // Edited after the import, with a refund on its sale and a commitment linked to it.
    await db.inventory.update({ where: { id: fourK.id }, data: { unit_purchase_cost: 14, notes: 'Fixed by hand' } });
    await db.refund.create({ data: { user_id: ME, sale_id: fourK.sales[0].id, amount: 5, date: new Date('2026-11-20') } });

    const res = await history.undo(ME, importId);
    expect(res).toMatchObject({ removed: 2, sales: 2, activity_id: expect.any(String) });
    expect(await db.inventory.count({ where: { user_id: ME } })).toBe(1);
    expect(await db.inventory.findUnique({ where: { id: other.id } })).not.toBeNull();
    expect(await db.sales.count()).toBe(0);
    expect(await db.refund.count()).toBe(0);
    expect((await history.list(ME))[0]).toMatchObject({ remaining: 0 });
    // The rows are gone, so the report reads as new again.
    expect((await importSold.preview(ME, { source: 'eb', csv: EB_CSV })).summary).toMatchObject({ new: 2, imported: 0 });

    const entry = await db.activityLog.findUnique({ where: { id: res.activity_id } });
    expect(entry.detail.product_name).toBe('ElectronicsBuyer import (2 purchases)');
    await activityLog.undoActivity(ME, res.activity_id);
    const back = await db.inventory.findUnique({ where: { id: fourK.id }, include: { sales: true } });
    expect(back).toMatchObject({ unit_purchase_cost: 14, notes: 'Fixed by hand', import_batch_id: importId });
    expect(back.sales[0].import_refs).toEqual(fourK.sales[0].import_refs);
    expect(await db.refund.count()).toBe(1);
    expect((await history.list(ME))[0]).toMatchObject({ remaining: 2 });
  });

  it('refuses a second undo, and two undos at once remove things only once', async () => {
    const { importId } = await importEb();
    const results = await Promise.allSettled([history.undo(ME, importId), history.undo(ME, importId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected').reason).toMatchObject({ status: 409, message: 'Everything from this import is already gone.' });
    expect(await db.activityLog.count()).toBe(1);
    await expect(history.undo(ME, importId)).rejects.toMatchObject({ status: 409 });
  });

  it('never shows or undoes another user\'s import', async () => {
    const { importId } = await importEb();
    expect(await history.list(OTHER)).toEqual([]);
    await expect(history.detail(OTHER, importId)).rejects.toMatchObject({ status: 404 });
    await expect(history.undo(OTHER, importId)).rejects.toMatchObject({ status: 404 });
    await expect(history.detail(ME, 'nope')).rejects.toMatchObject({ status: 404 });
    expect(await db.inventory.count({ where: { import_batch_id: importId } })).toBe(2);
  });
});
