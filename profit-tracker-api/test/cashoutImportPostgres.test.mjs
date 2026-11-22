// Settings > Data > Import from cashouts, against a real (throwaway) Postgres
// with every migration applied: parsing EB / parsefile reports, matching rows
// already in Profit Tracker, and writing purchases + sales exactly once.
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
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-import-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('import_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/import_qa`;
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
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  await db.sales.deleteMany({});
  await db.cashoutConnection.deleteMany({});
  await db.inventory.deleteMany({});
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

// What the app sends back: the previewed groups it kept, with a cost.
const kept = (groups, costs = {}) => groups
  .filter((g) => g.newQty > 0)
  .map((g) => ({ ...g, qty: g.newQty, unitCost: costs[g.name] ?? null }));

describe('parsing reports', () => {
  it('groups the EB export into one purchase per item, keeping each unit\'s serial', () => {
    const rows = importSold.parseReport('eb', EB_CSV);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => !r.problem && r.paid === false && r.status === 'Owed')).toBe(true);
    const groups = importSold.groupRows(rows);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ name: 'Fire TV Stick 4K (Newest Model)', qty: 2, unitPrice: 20, tracking: ['TBA336581719552'], serials: ['GT55NP0263130S3J', 'GT55NP0263130CRM'] });
    expect(groups[1]).toMatchObject({ name: 'Fire TV Stick 4K Select', qty: 2, unitPrice: 18 });
  });

  it('reads EB Owed = 0 as paid', () => {
    const csv = EB_CSV.replace('GT55NP0263130S3J,20,20', 'GT55NP0263130S3J,20,0');
    const rows = importSold.parseReport('eb', csv);
    expect(rows[0]).toMatchObject({ paid: true, status: 'Paid' });
    expect(importSold.groupRows(rows)).toHaveLength(3); // the paid unit is its own purchase
  });

  it('reads the parsefile received items CSV, leaving voided lines out', () => {
    const rows = importSold.parseReport('la', PARSEFILE_CSV);
    expect(rows[0]).toMatchObject({ ref: 'la:9001', name: 'Apple AirPods Pro 2, USB-C', qty: 2, unitPrice: 191, fee: 0, paid: true, date: '2026-11-02', problem: null });
    expect(rows[1].problem).toMatch(/voided/i);
    expect(rows[2]).toMatchObject({ date: '2026-11-05', paid: false, tracking: ['9400111899223817600000', '9400111899223817600017'] });
  });

  it('refuses a file that is not the report it was picked as', () => {
    expect(() => importSold.parseReport('eb', PARSEFILE_CSV)).toThrow(/Items Sold export/);
    expect(() => importSold.parseReport('p4d', EB_CSV)).toThrow(/received items export/);
    expect(() => importSold.parseReport('eb', '')).toThrow(/CSV file/);
    expect(() => importSold.parseReport('amazon', EB_CSV)).toThrow(/EB, LA or P4D/);
  });

  it('flags rows with no price or a bad date instead of guessing', () => {
    const csv = `${EB_CSV}\r\n2026-13-40,1,TBA1234567,Thing,1,1,new,DE,S1,10,10\r\n2026-11-01,2,TBA1234568,Other,1,1,new,DE,S2,,`;
    const rows = importSold.parseReport('eb', csv);
    expect(rows[4].problem).toMatch(/date/);
    expect(rows[5].problem).toMatch(/price/);
  });
});

describe('preview and commit (real Postgres)', () => {
  it('imports new rows as purchases + sales, then skips them on a second import', async () => {
    const first = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    expect(first.summary).toMatchObject({ rows: 4, groups: 2, new: 2, imported: 0, existing: 0, newUnits: 4, newPayout: 76 });

    const result = await importSold.commit(ME, {
      source: 'eb', platformId: ids.eb, vendorId: ids.store,
      groups: kept(first.groups, { 'Fire TV Stick 4K Select': 12.5 }),
    });
    expect(result).toEqual({ created: 2, units: 4, costNeeded: 1, skipped: 0 });

    const purchases = await db.inventory.findMany({ where: { user_id: ME }, include: { sales: true }, orderBy: { product_name: 'asc' } });
    expect(purchases).toHaveLength(2);
    const [fourK, select] = purchases;
    expect(fourK).toMatchObject({ qty_purchased: 2, qty_on_hand: 0, unit_purchase_cost: 0, vendor_id: ids.store, tracking_number: 'TBA336581719552' });
    expect(fourK.notes).toMatch(/Cost needed/);
    expect(select).toMatchObject({ unit_purchase_cost: 12.5, notes: null });
    expect(fourK.sales[0]).toMatchObject({
      platform_id: ids.eb, quantity: 2, unit_price: 20, status: 'SHIPPED_OUT',
      workflow_type: 'CASHOUT', workflow_status: 'WAITING_FOR_PAYMENT', paid_at: null,
    });
    expect(fourK.sales[0].import_refs).toEqual(['eb:325963:GT55NP0263130S3J', 'eb:325963:GT55NP0263130CRM']);
    expect(fourK.sales[0].notes).toMatch(/invoice 325963.*Serials: GT55NP0263130S3J, GT55NP0263130CRM/);

    const again = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    expect(again.summary).toMatchObject({ new: 0, imported: 2, newUnits: 0 });
  });

  it('marks a paid line paid, with the commission bonus in the payout', async () => {
    const preview = await importSold.preview(ME, { source: 'p4d', csv: PARSEFILE_CSV });
    expect(preview.summary).toMatchObject({ rows: 3, problems: 1, groups: 2 });
    await importSold.commit(ME, { source: 'p4d', platformId: ids.eb, groups: kept(preview.groups) });
    const sale = await db.sales.findFirst({ where: { import_refs: { has: 'p4d:9001' } } });
    expect(sale).toMatchObject({ status: 'PAID', workflow_status: 'PAID', quantity: 2, unit_price: 191, commission_fee: 0 });
    expect(Number(sale.paid_amount)).toBe(382);
    expect(sale.paid_at.toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('treats a sale already logged with the same tracking number as already recorded, by quantity', async () => {
    // One 4K stick logged through Log Purchase before the import.
    const inv = await db.inventory.create({ data: { user_id: ME, product_name: 'Fire TV Stick 4K', purchase_date: new Date('2026-11-15'), unit_purchase_cost: 15, qty_purchased: 1, qty_on_hand: 0 } });
    await db.sales.create({ data: { inventory_id: inv.id, platform_id: ids.eb, quantity: 1, unit_price: 20, sale_date: new Date('2026-11-15'), tracking_number: 'tba336581719552' } });

    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const fourK = preview.groups.find((g) => g.name.startsWith('Fire TV Stick 4K (Newest'));
    const select = preview.groups.find((g) => g.name.endsWith('Select'));
    expect(fourK).toMatchObject({ match: 'partial', newQty: 1 });
    expect(select).toMatchObject({ match: 'new', newQty: 2 });

    await importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: kept(preview.groups) });
    expect(await db.sales.count()).toBe(3);
    const after = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    expect(after.summary).toMatchObject({ new: 0, newUnits: 0 });
  });

  it('does not import twice when the same commit is sent twice at once', async () => {
    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const body = { source: 'eb', platformId: ids.eb, groups: kept(preview.groups) };
    const results = await Promise.allSettled([importSold.commit(ME, body), importSold.commit(ME, body)]);
    const created = results.filter((r) => r.status === 'fulfilled').reduce((n, r) => n + r.value.created, 0);
    expect(created).toBe(2);
    expect(await db.sales.count()).toBe(2);
  });

  it('refuses another user\'s cashout or a non-cashout platform, writing nothing', async () => {
    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const groups = kept(preview.groups);
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.theirs, groups })).rejects.toMatchObject({ status: 404 });
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.ebay, groups })).rejects.toThrow(/one of your cashouts/);
    await expect(importSold.commit(ME, { source: 'eb', platformId: null, groups })).rejects.toThrow(/Pick which cashout/);
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, vendorId: ids.theirs, groups })).rejects.toMatchObject({ status: 404 });
    expect(await db.sales.count()).toBe(0);
  });

  it('rejects a bad row without saving any of the others', async () => {
    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const groups = kept(preview.groups);
    groups[1] = { ...groups[1], unitCost: 'abc' };
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups })).rejects.toThrow(/Row 2: cost is not a valid amount/);
    groups[1] = { ...groups[1], unitCost: null, refs: [] };
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups })).rejects.toThrow(/report reference/);
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: [] })).rejects.toThrow(/Nothing selected/);
    expect(await db.inventory.count()).toBe(0);
  });

  it('does not see another user\'s imports as already imported', async () => {
    const preview = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    await importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: kept(preview.groups) });
    const theirs = await importSold.preview(OTHER, { source: 'eb', csv: EB_CSV });
    expect(theirs.summary).toMatchObject({ new: 2, imported: 0 });
  });
});

// Rows as the parsefile site's own Received items table returns them
// (it@receipt-items-details, read with the saved login). Values made up.
const tableRow = (over) => ({
  f_id: 12140, f_receipt: 13905, f_item: 'AMZ-ECHO-DOT-5-CHARCOAL', f_upc: '840080503653', f_model: 'B09B8V1LZ3',
  f_qty: 4, f_price: 39.99, f_commission: 2.51, f_total_price: 42.5, f_ext_total: 170, f_ext_expense: 0, f_net_total: 170,
  f_created: 'Mon Oct 12 2026 12:51:21 -0700', f_tracking: 'TBA335237415475', f_paid: null, f_void: 0, f_verified: 1, f_status: 'RECEIVING',
  ...over,
});

describe('received items read with the saved login', () => {
  it('maps a table row: payout is price + commission, date as the site shows it', () => {
    const [row] = importSold.parseParsefileTableRows('la', [tableRow()]);
    expect(row).toMatchObject({
      ref: 'la:12140', invoice: '13905', date: '2026-10-12', name: 'AMZ-ECHO-DOT-5-CHARCOAL', upc: '840080503653',
      qty: 4, unitPrice: 42.5, fee: 0, paid: false, tracking: ['TBA335237415475'], problem: null,
    });
  });

  it('keeps only rows created in the date range, and flags voided lines', () => {
    const rows = importSold.parseParsefileTableRows('p4d', [
      tableRow({ f_id: 1, f_created: 'Fri Nov 20 2026 16:52:45 -0800' }),
      tableRow({ f_id: 2, f_created: 'Sat Oct 31 2026 09:00:00 -0700' }),
      tableRow({ f_id: 3, f_created: 'Sun Nov 01 2026 09:00:00 -0800', f_void: 1 }),
    ], { from: '2026-11-01', to: '2026-11-30' });
    expect(rows.map((r) => r.ref)).toEqual(['p4d:1', 'p4d:3']);
    expect(rows[1].problem).toMatch(/Voided/);
  });

  it('takes an expense the group charged out of the payout', () => {
    const [row] = importSold.parseParsefileTableRows('la', [tableRow({ f_ext_expense: 5, f_net_total: 165, f_paid: '11/19/2026' })]);
    expect(row).toMatchObject({ unitPrice: 42.5, fee: 5, paid: true });
  });

  it('pulls through the connection with a date range, and only for cashouts that support it', async () => {
    const { encryptKey } = require('../services/cashouts/crypto');
    const service = require('../services/cashouts/service');
    const laAdapter = require('../services/cashouts/la');
    process.env.CASHOUT_KEY_ENCRYPTION_KEY ||= '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const la = await db.cashoutConnection.create({ data: { user_id: ME, provider: 'la', encrypted_key: encryptKey(JSON.stringify({ email: 'a@b.co', password: 'x' })), key_last4: 'b.co' } });
    const eb = await db.cashoutConnection.create({ data: { user_id: ME, provider: 'eb', encrypted_key: encryptKey('key_1234'), key_last4: '1234' } });
    const spy = vi.spyOn(laAdapter, 'fetchReceivedItems').mockResolvedValue([tableRow(), tableRow({ f_id: 9, f_created: 'Thu Jan 01 2026 09:00:00 -0800' })]);

    const pulled = await service.pullReceivedItems(ME, la.id, { from: '2026-10-01', to: '2026-10-31' });
    expect(spy).toHaveBeenCalledWith(JSON.stringify({ email: 'a@b.co', password: 'x' }));
    expect(pulled.source).toBe('la');
    expect(pulled.rows.map((r) => r.ref)).toEqual(['la:12140']);

    await expect(service.pullReceivedItems(ME, eb.id, { from: '2026-10-01', to: '2026-10-31' })).rejects.toThrow(/Upload its CSV/);
    await expect(service.pullReceivedItems(ME, la.id, { from: '2026-11-01', to: '2026-10-01' })).rejects.toThrow(/start date is after/);
    await expect(service.pullReceivedItems(ME, la.id, { from: '', to: '2026-10-01' })).rejects.toThrow(/Pick a start and end date/);
    await expect(service.pullReceivedItems(OTHER, la.id, { from: '2026-10-01', to: '2026-10-31' })).rejects.toBeTruthy();
    spy.mockRestore();
  });
});
