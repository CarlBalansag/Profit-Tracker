// Undo against a real (throwaway) Postgres through the real Prisma client: the
// in-memory harness can't show Json-null handling, Decimal/Date round trips,
// row locks or foreign keys, which is exactly where a restore could break.
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

const ME = '00000000-0000-4000-8000-0000000000a1';
let pg;
let db;
let activityLog;
let statusTransitions;
let refunds;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-activity-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('activity_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/activity_qa`;
  expect(new URL(url).hostname).toBe('127.0.0.1');
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
    stdio: 'pipe',
  });
  db = new PrismaClient({ datasources: { db: { url } } });
  // The services share ../prisma.js; point it at this database before loading them.
  const prismaPath = require.resolve('../prisma.js');
  require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: db };
  activityLog = require('../services/activityLog');
  statusTransitions = require('../services/statusTransitions');
  refunds = require('../services/refunds');
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

let invId;
let saleId;
beforeEach(async () => {
  await db.$executeRaw`TRUNCATE "User" CASCADE`;
  await db.user.create({ data: { id: ME, username: 'activity-qa', email: 'activity-qa@example.invalid' } });
  const inv = await db.inventory.create({
    data: {
      user_id: ME, product_name: 'Real DB Drill', purchase_date: new Date('2026-10-01T12:00:00Z'),
      unit_purchase_cost: 100, qty_purchased: 5, qty_on_hand: 3, sales_tax: 8, receiving_status: 'ON_HAND',
    },
  });
  invId = inv.id;
  const sale = await db.sales.create({
    data: {
      inventory_id: invId, quantity: 2, unit_price: 150, sale_date: new Date('2026-10-03T12:00:00Z'),
      status: 'PAID', workflow_type: 'STANDARD_MARKETPLACE', workflow_status: 'PAID', paid_at: new Date('2026-10-05T12:00:00Z'),
    },
  });
  saleId = sale.id;
});

const track = (meta, work) => db.$transaction((tx) => activityLog.trackChange(tx, ME, meta, () => work(tx)));

describe('undo on real Postgres', () => {
  it('undoes an edit across the purchase and sale, Decimal and Date fields included', async () => {
    const { activity } = await track({
      action: 'edit', recordType: 'sale', recordId: saleId,
      refs: async () => ({ inventory: [invId], sales: [saleId] }),
    }, async (tx) => {
      await tx.inventory.update({ where: { id: invId }, data: { qty_on_hand: 2, return_by_date: new Date('2026-11-01T12:00:00Z') } });
      return tx.sales.update({ where: { id: saleId }, data: { quantity: 3, paid_amount: '199.99', payout_date: new Date('2026-10-09T12:00:00Z') } });
    });
    expect(activity.detail.product_name).toBe('Real DB Drill');

    const res = await activityLog.undoActivity(ME, activity.id);
    expect(res.undone.undo_state).toBe('undone');
    const sale = await db.sales.findUnique({ where: { id: saleId } });
    const inv = await db.inventory.findUnique({ where: { id: invId } });
    expect(sale).toMatchObject({ quantity: 2, paid_amount: null, payout_date: null });
    expect(inv).toMatchObject({ qty_on_hand: 3, return_by_date: null });
  });

  it('removes an added sale and puts the very same row back on redo (Json columns left NULL)', async () => {
    const { result, activity } = await track({
      action: 'create', recordType: 'sale', recordId: (s) => s.id,
      refs: async (tx, made) => ({ inventory: [invId], sales: made ? [made.id] : [] }),
    }, async (tx) => {
      await tx.inventory.update({ where: { id: invId }, data: { qty_on_hand: { decrement: 1 } } });
      return tx.sales.create({ data: { inventory_id: invId, quantity: 1, unit_price: 120.5, sale_date: new Date('2026-10-06T12:00:00Z'), paid_amount: '120.50' } });
    });

    const undo = await activityLog.undoActivity(ME, activity.id);
    expect(await db.sales.findUnique({ where: { id: result.id } })).toBeNull();
    expect((await db.inventory.findUnique({ where: { id: invId } })).qty_on_hand).toBe(3);

    await activityLog.undoActivity(ME, undo.entry.id);
    const back = await db.sales.findUnique({ where: { id: result.id } });
    expect(back).toMatchObject({ quantity: 1, unit_price: 120.5, tracking_info: null });
    expect(String(back.paid_amount)).toBe('120.5');
    expect(back.sale_date.toISOString()).toBe('2026-10-06T12:00:00.000Z');
    expect((await db.inventory.findUnique({ where: { id: invId } })).qty_on_hand).toBe(2);
  });

  it('restores an expense whose Json column goes back to NULL', async () => {
    const expense = await db.expense.create({ data: { user_id: ME, name: 'Tape', amount: 12, date: new Date('2026-10-01T12:00:00Z') } });
    const { activity } = await track({
      action: 'edit', recordType: 'expense', recordId: expense.id,
      refs: async () => ({ expense: [expense.id] }),
    }, (tx) => tx.expense.update({ where: { id: expense.id }, data: { amount: 30, tax_details: { line: 'supplies', reviewed: true } } }));

    await activityLog.undoActivity(ME, activity.id);
    const back = await db.expense.findUnique({ where: { id: expense.id } });
    expect(back).toMatchObject({ amount: 12, tax_details: null, tax_version: 1 });
  });

  it('undoes Cancel Sale with row locks: status back, restored units out of stock again', async () => {
    const before = await db.sales.findUnique({ where: { id: saleId }, include: { inventory: true } });
    const activity = await db.$transaction(async (tx) => {
      const transition = await statusTransitions.applyTransition(tx, 'sale', before, 'cancel_sale', { user_id: ME });
      return activityLog.logStatus(tx, ME, 'sale', before, transition);
    });
    expect((await db.inventory.findUnique({ where: { id: invId } })).qty_on_hand).toBe(5);

    await activityLog.undoActivity(ME, activity.id);
    expect(await db.sales.findUnique({ where: { id: saleId } })).toMatchObject({ workflow_status: 'PAID', status: 'PAID', restored_qty: 0, cancelled_at: null });
    expect((await db.inventory.findUnique({ where: { id: invId } })).qty_on_hand).toBe(3);
  });

  it('puts a deleted purchase back after the real cascade: sales, refunds and the cashout link', async () => {
    const conn = await db.cashoutConnection.create({ data: { user_id: ME, provider: 'eb', encrypted_key: 'x', key_last4: '1234' } });
    const commitment = await db.cashoutCommitment.create({
      data: { user_id: ME, connection_id: conn.id, external_deal_id: 'd', external_item_id: 'i', external_commitment_id: 'c-1', quantity: 2, sale_id: saleId },
    });
    await refunds.recordRefund(ME, { inventory_id: invId, amount: 10, quantity: 1, date: '2026-10-10' });
    await refunds.recordRefund(ME, { sale_id: saleId, amount: 7.5, date: '2026-10-11' });
    const refundIds = (await db.refund.findMany({ orderBy: { amount: 'asc' } })).map((r) => r.id);

    // The same snapshot the DELETE route takes, then the real cascading delete.
    const { activity } = await db.$transaction((tx) => activityLog.trackChange(tx, ME, {
      action: 'delete', recordType: 'purchase', recordId: invId, productName: 'Real DB Drill',
      refs: async (t) => ({
        inventory: [invId], sales: [saleId],
        refund: (await t.refund.findMany({ select: { id: true } })).map((r) => r.id),
        cashoutCommitment: [commitment.id],
      }),
    }, () => tx.inventory.delete({ where: { id: invId } })));
    expect(await db.sales.count()).toBe(0);
    expect(await db.refund.count()).toBe(0);
    expect((await db.cashoutCommitment.findUnique({ where: { id: commitment.id } })).sale_id).toBeNull();
    expect(activity.detail.rows.map((r) => `${r.model}:${r.op}`))
      .toEqual(['inventory:delete', 'sales:delete', 'refund:delete', 'refund:delete', 'cashoutCommitment:update']);

    await activityLog.undoActivity(ME, activity.id);
    expect(await db.inventory.findUnique({ where: { id: invId } })).toMatchObject({ product_name: 'Real DB Drill', qty_on_hand: 2, refunded_qty: 1 });
    expect(await db.sales.findUnique({ where: { id: saleId } })).toMatchObject({ quantity: 2, workflow_status: 'PAID' });
    expect((await db.refund.findMany({ orderBy: { amount: 'asc' } })).map((r) => r.id)).toEqual(refundIds);
    expect((await db.cashoutCommitment.findUnique({ where: { id: commitment.id } })).sale_id).toBe(saleId);
  });

  it('undoes a refund and brings it back', async () => {
    const added = await refunds.recordRefund(ME, { inventory_id: invId, amount: 40, quantity: 1, date: '2026-10-10', note: 'one back' });
    expect((await db.inventory.findUnique({ where: { id: invId } })).qty_on_hand).toBe(2);
    const undo = await activityLog.undoActivity(ME, added.activity_id);
    expect(await db.refund.count()).toBe(0);
    await activityLog.undoActivity(ME, undo.entry.id);
    const refund = await db.refund.findFirst();
    expect(refund).toMatchObject({ quantity: 1, note: 'one back' });
    expect(String(refund.amount)).toBe('40');
  });
});
