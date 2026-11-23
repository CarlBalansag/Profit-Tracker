// Settings > Data > Fill in costs from store orders, against a real (throwaway)
// Postgres with every migration applied: reading Amazon's order export, pairing
// it with purchases the cashout import saved at $0, and writing costs only to
// purchases that are still waiting for one.
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
let pg;
let db;
let importSold;
let fillCosts;
let activityLog;
let ids;

// ElectronicsBuyer Items Sold: two kinds of stick in one Amazon box (TBA).
const EB_CSV = [
  'Date,Invoice #,Tracking,Item Name,UPC,SKU,Condition,Location,Serial,Sale Price,Owed',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K (Newest Model),840414613300,840414613300,new,DE,S1,20,20',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K (Newest Model),840414613300,840414613300,new,DE,S2,20,20',
  '2026-11-19,325963,TBA336581719552,Fire TV Stick 4K Select,840268958794,840268958794,new,DE,S3,18,18',
  '2026-11-20,325970,1Z3Y67380340447798,Nintendo Switch 2,045496884963,045496884963,new,DE,S4,430,430',
].join('\r\n');

// Amazon's Request Your Data > Your Orders > Retail.OrderHistory.1.csv.
const AMAZON_HEADER = '"Website","Order ID","Order Date","Purchase Order Number","Currency","Unit Price","Unit Price Tax","Shipping Charge","Total Discounts","Total Owed","Shipment Item Subtotal","Shipment Item Subtotal Tax","ASIN","Product Condition","Quantity","Payment Instrument Type","Order Status","Shipment Status","Ship Date","Shipping Option","Shipping Address","Billing Address","Carrier Name & Tracking Number","Product Name","Gift Message","Gift Sender Name","Gift Recipient Contact Details","Item Serial Number"';
const amazonRow = (o) => [
  'Amazon.com', o.id, o.date, 'Not Applicable', o.currency || 'USD', o.price, o.tax ?? '0', o.ship ?? '0', o.discount ?? "'0'", o.total ?? '0', '0', '0',
  o.asin || 'B0TEST0001', 'New', o.qty, o.pay ?? 'Visa - 4242', o.status || 'Closed', 'Shipped', o.date, 'next-1dc', 'EB Warehouse', 'Me',
  o.track ?? 'Not Available', o.name, 'Not Available', 'Not Available', 'Not Available', 'Not Available',
].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');

const AMAZON_CSV = [
  AMAZON_HEADER,
  amazonRow({ id: '112-1111111-1111111', date: '2026-11-16T18:22:31Z', price: '49.99', tax: '3.50', ship: '0', discount: "'-10.00'", qty: 2, track: 'AMZN_US(TBA336581719552)', name: 'Amazon Fire TV Stick 4K (newest model), Wi-Fi 6, Dolby Vision' }),
  amazonRow({ id: '112-1111111-1111111', date: '2026-11-16T18:22:31Z', price: '24.99', tax: '1.75', qty: 2, track: 'AMZN_US(TBA336581719552)', name: 'Amazon Fire TV Stick 4K Select, streaming device' }),
  amazonRow({ id: '112-2222222-2222222', date: '2026-11-17T09:00:00Z', price: '449.99', tax: '31.50', ship: '5.99', qty: 1, track: 'UPS(1Z999AA10123456784)', pay: 'Mastercard - 5555', name: 'Nintendo Switch 2 Console' }),
  amazonRow({ id: '112-3333333-3333333', date: '2026-11-10T09:00:00Z', price: '19.99', qty: 1, status: 'Cancelled', name: 'Fire TV Stick 4K' }),
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
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-costs-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('costs_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/costs_qa`;
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
  fillCosts = require('../services/storeOrders/fillCosts');
  activityLog = require('../services/activityLog');
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  await db.activityLog.deleteMany({});
  await db.sales.deleteMany({});
  await db.inventory.deleteMany({});
  await db.paymentMethod.deleteMany({});
  await db.platform.deleteMany({});
  await db.user.deleteMany({});
  await db.user.create({ data: { id: ME, username: 'costs-qa', email: 'costs-qa@example.invalid' } });
  await db.user.create({ data: { id: OTHER, username: 'costs-other', email: 'costs-other@example.invalid' } });
  const eb = await db.platform.create({ data: { user_id: ME, name: 'EB', type: 'Cashout', workflow_preset: 'CASHOUT' } });
  const amazon = await db.platform.create({ data: { user_id: ME, name: 'Amazon', type: 'Vendor' } });
  const theirEb = await db.platform.create({ data: { user_id: OTHER, name: 'EB', type: 'Cashout' } });
  const visa = await db.paymentMethod.create({ data: { user_id: ME, name: 'Visa', type: 'Credit', last4: '4242' } });
  const mc = await db.paymentMethod.create({ data: { user_id: ME, name: 'MC', type: 'Credit', last4: '5555' } });
  const theirCard = await db.paymentMethod.create({ data: { user_id: OTHER, name: 'Theirs', type: 'Credit', last4: '9999' } });
  ids = { eb: eb.id, amazon: amazon.id, theirEb: theirEb.id, visa: visa.id, mc: mc.id, theirCard: theirCard.id };
});

// Run the real cashout import (no costs typed), as a new user would.
async function importCashout(userId = ME, platformId = ids.eb) {
  const p = await importSold.preview(userId, { source: 'eb', csv: EB_CSV });
  await importSold.commit(userId, {
    source: 'eb', platformId, groups: p.groups.map((g) => ({ ...g, qty: g.newQty, unitCost: null })),
  });
  return db.inventory.findMany({ where: { user_id: userId }, orderBy: { product_name: 'asc' } });
}

// What the app sends back: each matched purchase with its line's per-unit amounts.
function itemsFrom(preview) {
  const lines = new Map(preview.lines.map((l) => [l.index, l]));
  return preview.purchases.filter((p) => p.lineIndex !== null).map((p) => {
    const l = lines.get(p.lineIndex);
    return {
      inventory_id: p.id,
      unit_cost: l.perUnit.cost,
      sales_tax: Math.round(l.perUnit.tax * p.qty * 100) / 100,
      shipping: Math.round(l.perUnit.shipping * p.qty * 100) / 100,
      order_number: l.orderId,
      order_date: l.orderDate,
      payment_method_id: l.paymentMethodId,
    };
  });
}

describe('reading the Amazon export', () => {
  it('reads tracking, card, discount, tax and shipping per unit, and flags cancelled orders', () => {
    const lines = fillCosts.parseOrders('amazon', AMAZON_CSV);
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatchObject({ orderId: '112-1111111-1111111', orderDate: '2026-11-16', qty: 2, tracking: ['TBA336581719552'], last4: '4242', problem: null });
    expect(lines[0].perUnit).toEqual({ cost: 44.99, tax: 3.5, shipping: 0 });
    expect(lines[2].perUnit).toEqual({ cost: 449.99, tax: 31.5, shipping: 5.99 });
    expect(lines[2]).toMatchObject({ tracking: ['1Z999AA10123456784'], last4: '5555' });
    expect(lines[3].problem).toMatch(/Cancelled/);
  });

  it('pulls tracking numbers out of the carrier column and ignores placeholders', () => {
    expect(fillCosts.trackingNumbers('AMZN_US(TBA336581719552) : UPS(1Z999AA10123456784)')).toEqual(['TBA336581719552', '1Z999AA10123456784']);
    expect(fillCosts.trackingNumbers('Not Available')).toEqual([]);
    expect(fillCosts.cardLast4('Visa - 1234 and Gift Certificate/Card')).toBe('1234');
    expect(fillCosts.cardLast4('Amazon Gift Card Balance')).toBeNull();
  });

  it('reads the older Order History Reports items export too', () => {
    const csv = [
      'Order Date,Order ID,Title,Category,ASIN/ISBN,Purchase Price Per Unit,Quantity,Payment Instrument Type,Order Status,Carrier Name & Tracking Number,Item Subtotal Tax,Item Total',
      '11/16/26,112-4444444-4444444,Echo Dot (5th Gen),Electronics,B09B8V1LZ3,$29.99,2,Visa - 4242,Shipped,AMZN_US(TBA999999999999),$4.20,$64.18',
    ].join('\n');
    const [line] = fillCosts.parseOrders('amazon', csv);
    expect(line).toMatchObject({ orderDate: '2026-11-16', qty: 2, unitPrice: 29.99, tracking: ['TBA999999999999'], problem: null });
    expect(line.perUnit).toEqual({ cost: 29.99, tax: 2.1, shipping: 0 });
  });

  it('refuses a file that is not an Amazon order export, a non-USD line, and unknown stores', () => {
    expect(() => fillCosts.parseOrders('amazon', EB_CSV)).toThrow(/Amazon order export/);
    expect(() => fillCosts.parseOrders('amazon', '')).toThrow(/CSV file/);
    expect(() => fillCosts.parseOrders('walmart', AMAZON_CSV)).toThrow(/which store/);
    const cad = fillCosts.parseOrders('amazon', [AMAZON_HEADER, amazonRow({ id: '1', date: '2026-11-01', price: '10', qty: 1, currency: 'CAD', name: 'X' })].join('\n'));
    expect(cad[0].problem).toMatch(/CAD/);
  });
});

describe('returned orders, split dates and match scores', () => {
  it('skips returned or refunded lines and takes the earliest of "A and B" order dates', () => {
    const csv = [
      AMAZON_HEADER,
      amazonRow({ id: '112-7000000-0000001', date: '2026-11-05T09:00:00Z and 2026-11-02T10:00:00Z', price: '10', qty: 1, name: 'Split order' }),
      amazonRow({ id: '112-7000000-0000002', date: '2026-11-05T09:00:00Z', price: '10', qty: 1, status: 'Returned', name: 'Sent back' }),
    ].join('\n');
    const [split, returned] = fillCosts.parseOrders('amazon', csv);
    expect(split).toMatchObject({ orderDate: '2026-11-02', problem: null });
    expect(returned.problem).toBe('Returned or refunded.');
  });

  const lineOf = (index, over) => ({ index, orderId: `112-000000${index}-0000000`, orderDate: '2026-11-15', name: 'Nintendo Switch 2 Console', qty: 1, unitPrice: 449.99, tracking: [], problem: null, perUnit: { cost: 449.99, tax: 0, shipping: 0 }, ...over });
  const buy = (over) => ({ id: 'p', name: 'Nintendo Switch 2', date: '2026-11-20', qty: 1, tracking: [], ...over });

  it('applies strong name + date matches with their reasons, and only suggests weak ones', () => {
    const [strong] = fillCosts.matchPurchases([buy()], [lineOf(1)]);
    expect(strong).toMatchObject({ match: 'name', lineIndex: 1, score: 80, reasons: ['Name 100% alike', 'Ordered 5 days before'] });
    // Same name, but ordered 40 days earlier: 60 points, below the bar.
    const [weak] = fillCosts.matchPurchases([buy()], [lineOf(1, { orderDate: '2026-10-11' })]);
    expect(weak).toMatchObject({ match: 'suggested', lineIndex: null, candidates: [1], score: 60 });
    expect(weak.review).toMatch(/Possible match/);
  });

  it('matches by order number first, and never across a different Amazon order number', () => {
    const lines = [lineOf(1, { orderId: '112-1111111-1111111' }), lineOf(2, { orderId: '112-2222222-2222222', tracking: ['TBA1'] })];
    const [byOrder] = fillCosts.matchPurchases([buy({ orderNumber: '112-1111111-1111111', tracking: ['TBA1'] })], lines);
    expect(byOrder).toMatchObject({ match: 'order', lineIndex: 1, score: 100, reasons: ['Same order number', 'Name 100% alike'] });
    // Its order number isn't in the file, so the other order's tracking and name are ruled out.
    const [vetoed] = fillCosts.matchPurchases([buy({ orderNumber: '112-9999999-9999999', tracking: ['TBA1'] })], lines);
    expect(vetoed).toMatchObject({ match: 'none', lineIndex: null, candidates: [] });
    const [tracked] = fillCosts.matchPurchases([buy({ tracking: ['TBA1'] })], lines);
    expect(tracked).toMatchObject({ match: 'tracking', lineIndex: 2, score: 90 });
  });
});

describe('matching (real Postgres)', () => {
  it('pairs each "Cost needed" purchase by tracking, picking the right item in a shared box', async () => {
    await importCashout();
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    expect(preview.summary).toMatchObject({ lines: 4, problems: 1, costNeeded: 3, byTracking: 2, byName: 1, unmatched: 0 });

    const byName = Object.fromEntries(preview.purchases.map((p) => [p.name, p]));
    const line = (p) => preview.lines.find((l) => l.index === p.lineIndex);
    expect(byName['Fire TV Stick 4K (Newest Model)']).toMatchObject({ match: 'tracking', qty: 2, review: null });
    expect(line(byName['Fire TV Stick 4K (Newest Model)']).name).toMatch(/newest model/);
    expect(line(byName['Fire TV Stick 4K Select']).name).toMatch(/Select/);
    expect(byName['Fire TV Stick 4K Select'].candidates).toHaveLength(2);
    // The cashout's UPS number isn't Amazon's, so the Switch is paired by name + date.
    expect(byName['Nintendo Switch 2']).toMatchObject({ match: 'name' });
    expect(byName['Nintendo Switch 2'].review).toMatch(/name and date/);
    expect(line(byName['Nintendo Switch 2'])).toMatchObject({ orderId: '112-2222222-2222222', paymentMethodId: ids.mc });
    // The cancelled order is never offered.
    expect(preview.lines.some((l) => l.orderId === '112-3333333-3333333')).toBe(false);
  });

  it('only lists this user\'s purchases that are still $0 with the note', async () => {
    const mine = await importCashout();
    await importCashout(OTHER, ids.theirEb);
    await db.inventory.update({ where: { id: mine[0].id }, data: { unit_purchase_cost: 40 } });
    await db.inventory.update({ where: { id: mine[1].id }, data: { notes: 'my own note' } });
    await db.inventory.create({ data: { user_id: ME, product_name: 'Fire TV Stick 4K Select', purchase_date: new Date('2026-11-18'), unit_purchase_cost: 0, qty_purchased: 1, qty_on_hand: 1, tracking_number: 'TBA336581719552' } });
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    expect(preview.purchases.map((p) => p.id)).toEqual([mine[2].id]);
  });

  it('does not use a name match from an order placed after the cashout got the item, or too long before', () => {
    const purchase = { id: 'p', name: 'Nintendo Switch 2', date: '2026-11-20', qty: 1, tracking: [] };
    const line = (index, orderDate) => ({ index, orderDate, name: 'Nintendo Switch 2 Console', qty: 1, tracking: [], perUnit: {}, problem: null });
    expect(fillCosts.matchPurchases([purchase], [line(0, '2026-11-21')])[0].match).toBe('none');
    expect(fillCosts.matchPurchases([purchase], [line(0, '2026-08-01')])[0].match).toBe('none');
    expect(fillCosts.matchPurchases([purchase], [line(0, '2026-11-02')])[0].match).toBe('name');
  });

  it('uses each order line\'s units only once for name matches', () => {
    const p = (id) => ({ id, name: 'Nintendo Switch 2', date: '2026-11-20', qty: 1, tracking: [] });
    const line = { index: 0, orderDate: '2026-11-15', name: 'Nintendo Switch 2 Console', qty: 1, tracking: [], perUnit: {}, problem: null };
    const [a, b] = fillCosts.matchPurchases([p('a'), p('b')], [line]);
    expect(a).toMatchObject({ match: 'name', lineIndex: 0 });
    expect(b).toMatchObject({ match: 'none', lineIndex: null, candidates: [0] });
    expect(b.review).toMatch(/already used/);
  });
});

describe('saving costs (real Postgres)', () => {
  it('fills cost, tax, shipping, order number, store, card and order date, and replaces the note', async () => {
    await importCashout();
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    const result = await fillCosts.commit(ME, { source: 'amazon', vendorId: ids.amazon, useOrderDate: true, items: itemsFrom(preview) });
    expect(result).toEqual({ updated: 3, skipped: 0 });

    const rows = Object.fromEntries((await db.inventory.findMany({ where: { user_id: ME } })).map((r) => [r.product_name, r]));
    const fourK = rows['Fire TV Stick 4K (Newest Model)'];
    expect(fourK).toMatchObject({ unit_purchase_cost: 44.99, sales_tax: 7, shipping_cost_inbound: 0, order_number: '112-1111111-1111111', vendor_id: ids.amazon, payment_method_id: ids.visa });
    expect(Number(fourK.unit_purchase_cost_decimal)).toBe(44.99);
    expect(fourK.purchase_date.toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(fourK.notes).toBe('Cost from Amazon order 112-1111111-1111111.');
    expect(rows['Fire TV Stick 4K Select']).toMatchObject({ unit_purchase_cost: 24.99, sales_tax: 1.75, qty_purchased: 1 });
    expect(rows['Nintendo Switch 2']).toMatchObject({ unit_purchase_cost: 449.99, sales_tax: 31.5, shipping_cost_inbound: 5.99, payment_method_id: ids.mc });

    // Nothing left waiting, so a second preview offers nothing and a resend skips all.
    const again = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    expect(again.summary.costNeeded).toBe(0);
    expect(await fillCosts.commit(ME, { source: 'amazon', items: itemsFrom(preview) })).toEqual({ updated: 0, skipped: 3 });
  });

  it('keeps a store, card, order number and date the purchase already has', async () => {
    const [fourK] = await importCashout();
    const other = await db.platform.create({ data: { user_id: ME, name: 'Best Buy', type: 'Vendor' } });
    await db.inventory.update({ where: { id: fourK.id }, data: { vendor_id: other.id, payment_method_id: ids.mc, order_number: 'MINE', purchase_date: new Date('2026-11-01T12:00:00Z') } });
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    await fillCosts.commit(ME, { source: 'amazon', vendorId: ids.amazon, paymentMethodId: ids.visa, useOrderDate: true, items: itemsFrom(preview) });
    const after = await db.inventory.findUnique({ where: { id: fourK.id } });
    expect(after).toMatchObject({ vendor_id: other.id, payment_method_id: ids.mc, order_number: 'MINE', unit_purchase_cost: 44.99 });
    expect(after.purchase_date.toISOString()).toBe('2026-11-01T12:00:00.000Z');
  });

  it('skips a purchase whose cost was typed in meanwhile, and never touches another user\'s', async () => {
    const mine = await importCashout();
    const theirs = await importCashout(OTHER, ids.theirEb);
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    await db.inventory.update({ where: { id: mine[0].id }, data: { unit_purchase_cost: 41 } });
    const items = [...itemsFrom(preview), { inventory_id: theirs[0].id, unit_cost: 1 }];
    expect(await fillCosts.commit(ME, { source: 'amazon', items })).toEqual({ updated: 2, skipped: 2 });
    expect((await db.inventory.findUnique({ where: { id: mine[0].id } })).unit_purchase_cost).toBe(41);
    expect(await db.inventory.findUnique({ where: { id: theirs[0].id } })).toMatchObject({ unit_purchase_cost: 0 });
  });

  it('saves once when the same commit is sent twice at once', async () => {
    await importCashout();
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    const body = { source: 'amazon', items: itemsFrom(preview) };
    const results = await Promise.all([fillCosts.commit(ME, body), fillCosts.commit(ME, body)]);
    expect(results.reduce((n, r) => n + r.updated, 0)).toBe(3);
    expect(await db.activityLog.count({ where: { user_id: ME, record_type: 'purchase' } })).toBe(1);
  });

  it('refuses bad input and other users\' stores or cards, writing nothing', async () => {
    const [fourK] = await importCashout();
    const item = { inventory_id: fourK.id, unit_cost: 10 };
    const go = (body) => fillCosts.commit(ME, { source: 'amazon', items: [item], ...body });
    await expect(go({ items: [] })).rejects.toMatchObject({ status: 400 });
    await expect(go({ items: [{ ...item, unit_cost: 0 }] })).rejects.toThrow(/above \$0/);
    await expect(go({ items: [{ ...item, sales_tax: -1 }] })).rejects.toThrow(/negative/);
    await expect(go({ items: [{ ...item, unit_cost: 'abc' }] })).rejects.toThrow(/valid amount/);
    await expect(go({ items: [item, item] })).rejects.toThrow(/twice/);
    await expect(go({ items: [{ ...item, order_date: '2026-02-31' }] })).rejects.toThrow(/order date/);
    await expect(go({ vendorId: ids.eb })).rejects.toThrow(/stores/);
    await expect(go({ vendorId: ids.theirEb })).rejects.toMatchObject({ status: 404 });
    await expect(go({ paymentMethodId: ids.theirCard })).rejects.toMatchObject({ status: 404 });
    await expect(go({ items: [{ ...item, payment_method_id: ids.theirCard }] })).rejects.toMatchObject({ status: 404 });
    await expect(go({ source: 'ebay' })).rejects.toMatchObject({ status: 400 });
    expect(await db.inventory.findUnique({ where: { id: fourK.id } })).toMatchObject({ unit_purchase_cost: 0 });
  });

  it('logs one Activity entry that undoes the whole save', async () => {
    await importCashout();
    const preview = await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV });
    await fillCosts.commit(ME, { source: 'amazon', vendorId: ids.amazon, useOrderDate: true, items: itemsFrom(preview) });
    const entries = await db.activityLog.findMany({ where: { user_id: ME, record_type: 'purchase' } });
    expect(entries).toHaveLength(1);
    expect(entries[0].detail.product_name).toBe('Costs from Amazon for 3 purchases');
    await activityLog.undoActivity(ME, entries[0].id);
    const rows = await db.inventory.findMany({ where: { user_id: ME } });
    expect(rows.every((r) => r.unit_purchase_cost === 0 && r.notes === importSold.COST_NEEDED_NOTE && r.vendor_id === null)).toBe(true);
    expect((await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV })).summary.costNeeded).toBe(3);
  });
});

describe('store orders in the cashout import review (real Postgres)', () => {
  // What the cashout review sends back for one group, with its matched order.
  function withOrder(group, match, lines) {
    const l = lines.find((x) => x.index === match.lineIndex);
    if (!l) return { ...group, qty: group.newQty, unitCost: null };
    return {
      ...group,
      qty: group.newQty,
      unitCost: l.perUnit.cost,
      salesTax: Math.round(l.perUnit.tax * group.newQty * 100) / 100,
      shipping: Math.round(l.perUnit.shipping * group.newQty * 100) / 100,
      orderNumber: l.orderId,
      orderDate: l.orderDate,
      orderStore: 'Amazon',
      vendorId: ids.amazon,
      paymentMethodId: l.paymentMethodId,
    };
  }

  it('matches the groups about to be imported and saves them with real costs', async () => {
    const p = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const groups = p.groups.filter((g) => g.newQty > 0);
    const matched = await fillCosts.matchReport(ME, {
      source: 'amazon', csv: AMAZON_CSV,
      groups: groups.map((g) => ({ key: g.key, name: g.name, date: g.date, qty: g.newQty, tracking: g.tracking })),
    });
    expect(matched.summary).toMatchObject({ byTracking: 2, byName: 1, unmatched: 0 });
    const byKey = new Map(matched.matches.map((m) => [m.key, m]));
    const result = await importSold.commit(ME, {
      source: 'eb', platformId: ids.eb,
      groups: groups.map((g) => withOrder(g, byKey.get(g.key), matched.lines)),
    });
    expect(result).toMatchObject({ created: 3, costNeeded: 0 });

    const rows = Object.fromEntries((await db.inventory.findMany({ where: { user_id: ME } })).map((r) => [r.product_name, r]));
    const fourK = rows['Fire TV Stick 4K (Newest Model)'];
    expect(fourK).toMatchObject({ unit_purchase_cost: 44.99, sales_tax: 7, order_number: '112-1111111-1111111', vendor_id: ids.amazon, payment_method_id: ids.visa, notes: 'Cost from Amazon order 112-1111111-1111111.' });
    expect(fourK.purchase_date.toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(rows['Nintendo Switch 2']).toMatchObject({ unit_purchase_cost: 449.99, shipping_cost_inbound: 5.99, payment_method_id: ids.mc });
    // Nothing is left for the later "fill in costs" step.
    expect((await fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV })).summary.costNeeded).toBe(0);
  });

  it('keeps the cashout date when the order date is later, and "Cost needed" for rows left without a cost', async () => {
    const p = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const [first, ...rest] = p.groups.filter((g) => g.newQty > 0);
    await importSold.commit(ME, {
      source: 'eb', platformId: ids.eb,
      groups: [
        { ...first, qty: first.newQty, unitCost: 10, orderDate: '2026-12-01', orderNumber: 'X', orderStore: 'Amazon' },
        ...rest.map((g) => ({ ...g, qty: g.newQty, unitCost: null })),
      ],
    });
    const rows = await db.inventory.findMany({ where: { user_id: ME }, orderBy: { product_name: 'asc' } });
    expect(rows[0].purchase_date.toISOString()).toBe(`${first.date}T12:00:00.000Z`);
    expect(rows.filter((r) => r.notes === importSold.COST_NEEDED_NOTE)).toHaveLength(rest.length);
  });

  it('refuses another user\'s store or card on a row, and bad match requests', async () => {
    const p = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const g = p.groups[0];
    const base = { source: 'eb', platformId: ids.eb };
    await expect(importSold.commit(ME, { ...base, groups: [{ ...g, qty: g.newQty, unitCost: 5, paymentMethodId: ids.theirCard }] })).rejects.toMatchObject({ status: 404 });
    await expect(importSold.commit(ME, { ...base, groups: [{ ...g, qty: g.newQty, unitCost: 5, vendorId: ids.theirEb }] })).rejects.toMatchObject({ status: 404 });
    await expect(importSold.commit(ME, { ...base, groups: [{ ...g, qty: g.newQty, unitCost: 5, salesTax: -1 }] })).rejects.toThrow(/negative/);
    expect(await db.inventory.count()).toBe(0);
    await expect(fillCosts.matchReport(ME, { source: 'amazon', csv: AMAZON_CSV, groups: [] })).rejects.toThrow(/report first/);
    await expect(fillCosts.matchReport(ME, { source: 'amazon', csv: AMAZON_CSV, groups: [{ key: 'k', name: 'X', date: 'nope', qty: 1 }] })).rejects.toThrow(/invalid/);
  });
});

describe('several Amazon files and accounts (real Postgres)', () => {
  const [header, fourK, select, switch2, cancelled] = AMAZON_CSV.split('\n');
  const fileA = [header, fourK, select].join('\n');
  const fileB = [header, switch2, cancelled].join('\n');
  let cb;
  let bizz;
  beforeEach(async () => {
    cb = await db.account.create({ data: { user_id: ME, platform_id: ids.amazon, name: 'CBAmazon' } });
    bizz = await db.account.create({ data: { user_id: ME, platform_id: ids.amazon, name: 'Bizz' } });
  });
  const groupsOf = async () => {
    const p = await importSold.preview(ME, { source: 'eb', csv: EB_CSV });
    const groups = p.groups.filter((g) => g.newQty > 0);
    return { groups, sent: groups.map((g) => ({ key: g.key, name: g.name, date: g.date, qty: g.newQty, tracking: g.tracking })) };
  };

  it('reads one file per account as one order list and saves each purchase with its account', async () => {
    const { groups, sent } = await groupsOf();
    const matched = await fillCosts.matchReport(ME, {
      source: 'amazon', groups: sent,
      files: [{ id: 1, csv: fileA, accountId: cb.id }, { id: 2, csv: fileB, accountId: bizz.id }],
    });
    expect(matched.summary).toMatchObject({ byTracking: 2, byName: 1, unmatched: 0 });
    expect(matched.summary.files).toEqual([
      { id: 1, accountId: cb.id, lines: 2, problems: 0, duplicates: 0 },
      { id: 2, accountId: bizz.id, lines: 2, problems: 1, duplicates: 0 },
    ]);
    const lines = new Map(matched.lines.map((l) => [l.index, l]));
    // Line numbers start at file id * stride, so adding a file never renumbers another's.
    expect([...lines.keys()].every((i) => i >= fillCosts.FILE_STRIDE)).toBe(true);
    const byKey = new Map(matched.matches.map((m) => [m.key, m]));
    const result = await importSold.commit(ME, {
      source: 'eb', platformId: ids.eb,
      groups: groups.map((g) => {
        const l = lines.get(byKey.get(g.key).lineIndex);
        return { ...g, qty: g.newQty, unitCost: l.perUnit.cost, orderNumber: l.orderId, orderStore: 'Amazon', paymentMethodId: l.paymentMethodId, accountId: l.accountId };
      }),
    });
    expect(result).toMatchObject({ created: 3, costNeeded: 0 });
    const rows = Object.fromEntries((await db.inventory.findMany({ where: { user_id: ME } })).map((r) => [r.product_name, r]));
    expect(rows['Fire TV Stick 4K (Newest Model)']).toMatchObject({ account_id: cb.id, vendor_id: ids.amazon });
    expect(rows['Nintendo Switch 2']).toMatchObject({ account_id: bizz.id, vendor_id: ids.amazon, unit_purchase_cost: 449.99 });
    expect(lines.get(byKey.get(groups.find((g) => g.name === 'Nintendo Switch 2').key).lineIndex)).toMatchObject({ accountName: 'Bizz', vendorId: ids.amazon });
  });

  it('uses a line once when two files overlap, and asks which account an untagged file is from', async () => {
    const { sent } = await groupsOf();
    const matched = await fillCosts.matchReport(ME, {
      source: 'amazon', groups: sent,
      files: [{ id: 1, csv: AMAZON_CSV, accountId: cb.id }, { id: 3, csv: fileA, accountId: cb.id }],
    });
    expect(matched.summary.files[1]).toMatchObject({ id: 3, lines: 2, duplicates: 2 });
    expect(matched.summary).toMatchObject({ byTracking: 2, byName: 1 });
    const fourKLine = matched.lines.find((l) => l.orderId === '112-1111111-1111111');
    expect(fourKLine).toMatchObject({ index: fillCosts.FILE_STRIDE, accountId: cb.id });
    // Two Amazon logins saved: every file has to say which one it's from.
    await expect(fillCosts.matchReport(ME, { source: 'amazon', groups: sent, files: [{ id: 1, csv: fileA, accountId: cb.id }, { id: 2, csv: fileB }] }))
      .rejects.toThrow('Choose which Amazon account file 2 is from.');
    await expect(fillCosts.preview(ME, { source: 'amazon', csv: AMAZON_CSV })).rejects.toThrow('Choose which Amazon account this file is from.');
    // The same order under two different accounts can't be right: set aside.
    const clash = await fillCosts.matchReport(ME, {
      source: 'amazon', groups: sent,
      files: [{ id: 1, csv: fileA, accountId: cb.id }, { id: 2, csv: fileA, accountId: bizz.id }],
    });
    expect(clash.summary).toMatchObject({ byTracking: 0 });
    expect(clash.summary.files[0].problems).toBe(2);
  });

  it('fills an account later only where the purchase has none and is at that store', async () => {
    const rows = await importCashout();
    const best = await db.platform.create({ data: { user_id: ME, name: 'Best Buy', type: 'Vendor' } });
    const select = rows.find((r) => r.product_name === 'Fire TV Stick 4K Select');
    await db.inventory.update({ where: { id: select.id }, data: { vendor_id: best.id } });
    const preview = await fillCosts.preview(ME, { source: 'amazon', files: [{ id: 5, csv: AMAZON_CSV, accountId: cb.id }] });
    const lines = new Map(preview.lines.map((l) => [l.index, l]));
    const items = itemsFrom(preview).map((it) => ({ ...it, account_id: lines.get(preview.purchases.find((p) => p.id === it.inventory_id).lineIndex).accountId }));
    expect(await fillCosts.commit(ME, { source: 'amazon', items })).toEqual({ updated: 3, skipped: 0 });
    const after = Object.fromEntries((await db.inventory.findMany({ where: { user_id: ME } })).map((r) => [r.product_name, r]));
    expect(after['Fire TV Stick 4K (Newest Model)']).toMatchObject({ account_id: cb.id, vendor_id: ids.amazon });
    expect(after['Fire TV Stick 4K Select']).toMatchObject({ account_id: null, vendor_id: best.id });
  });

  it('refuses another user\'s account, an account on a cashout, and bad file lists, writing nothing', async () => {
    const { groups, sent } = await groupsOf();
    const theirAmazon = await db.platform.create({ data: { user_id: OTHER, name: 'Amazon', type: 'Vendor' } });
    const theirs = await db.account.create({ data: { user_id: OTHER, platform_id: theirAmazon.id, name: 'Theirs' } });
    const onCashout = await db.account.create({ data: { user_id: ME, platform_id: ids.eb, name: 'EB login' } });
    const match = (files) => fillCosts.matchReport(ME, { source: 'amazon', groups: sent, files });
    await expect(match([{ id: 1, csv: fileA, accountId: theirs.id }])).rejects.toMatchObject({ status: 404 });
    await expect(match([{ id: 1, csv: fileA, accountId: onCashout.id }])).rejects.toMatchObject({ status: 400 });
    await expect(match([{ id: 1, csv: fileA, accountId: cb.id }, { id: 1, csv: fileB, accountId: cb.id }])).rejects.toThrow(/twice/);
    await expect(match([{ id: 0, csv: fileA }])).rejects.toThrow(/invalid/);
    await expect(match(Array.from({ length: 11 }, (_, i) => ({ id: i + 1, csv: fileA })))).rejects.toThrow(/at most/);
    await expect(match([{ id: 1, csv: fileA, accountId: cb.id }, { id: 2, csv: 'a,b\n1,2', accountId: bizz.id }])).rejects.toThrow(/^File 2:/);
    const g = groups[0];
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: [{ ...g, qty: g.newQty, unitCost: 5, accountId: theirs.id }] })).rejects.toMatchObject({ status: 404 });
    await expect(importSold.commit(ME, { source: 'eb', platformId: ids.eb, groups: [{ ...g, qty: g.newQty, unitCost: 5, accountId: onCashout.id }] })).rejects.toMatchObject({ status: 400 });
    expect(await db.inventory.count()).toBe(0);
    const rows = await importCashout();
    await expect(fillCosts.commit(ME, { source: 'amazon', items: [{ inventory_id: rows[0].id, unit_cost: 5, account_id: theirs.id }] })).rejects.toMatchObject({ status: 404 });
    expect((await db.inventory.findUnique({ where: { id: rows[0].id } })).unit_purchase_cost).toBe(0);
  });
});
