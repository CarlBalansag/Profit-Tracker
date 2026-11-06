import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import EmbeddedPostgres from 'embedded-postgres';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { resetUserData, receiptFileFromUrl, removeReceiptFiles } = require('../services/dataReset');
const { dealsCache } = require('../services/cashouts/service');
const { PrismaClient } = require('@prisma/client');
const cloudinary = require('cloudinary').v2;

const CLOUD = 'qa-cloud';
const receiptUrl = (type, id, ext = 'png') =>
  `https://res.cloudinary.com/${CLOUD}/image/upload/v17/profittracker/receipts/${type}_${id}_abc.${ext}`;

describe('receiptFileFromUrl', () => {
  const owned = new Set(['inventory:mine', 'expense:mine-too']);
  const parse = (url) => receiptFileFromUrl(url, owned, CLOUD);

  it('turns a receipt URL for an owned row into its public ID', () => {
    expect(parse(receiptUrl('inventory', 'mine'))).toEqual({
      publicId: 'profittracker/receipts/inventory_mine_abc', resourceType: 'image',
    });
    expect(parse(`https://res.cloudinary.com/${CLOUD}/raw/upload/profittracker/receipts/expense_mine-too_abc.pdf`)).toEqual({
      publicId: 'profittracker/receipts/expense_mine-too_abc.pdf', resourceType: 'raw',
    });
  });

  it('refuses a file that belongs to a row outside this reset', () => {
    expect(parse(receiptUrl('inventory', 'someone-elses'))).toBeNull();
  });

  it('refuses anything that is not a receipt in this Cloudinary account', () => {
    expect(parse(`https://res.cloudinary.com/other-cloud/image/upload/profittracker/receipts/inventory_mine_abc.png`)).toBeNull();
    expect(parse(`https://res.cloudinary.com/${CLOUD}/image/upload/profittracker/other/inventory_mine_abc.png`)).toBeNull();
    expect(parse(`https://res.cloudinary.com/${CLOUD}/raw/upload/profittracker/calendar-feeds/token.ics`)).toBeNull();
    expect(parse('https://evil.example/profittracker/receipts/inventory_mine_abc.png')).toBeNull();
    expect(parse('https://mail.google.com/mail/u/0/#inbox/123')).toBeNull();
    expect(parse('not a url')).toBeNull();
    expect(parse(null)).toBeNull();
  });
});

describe('removeReceiptFiles', () => {
  it('keeps going when one file fails', async () => {
    const destroy = vi.spyOn(cloudinary.uploader, 'destroy')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ result: 'ok' });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const files = [1, 2, 3].map((n) => ({ publicId: `p${n}`, resourceType: 'image' }));
    await expect(removeReceiptFiles(files)).resolves.toEqual({ failed: 1 });
    expect(destroy).toHaveBeenCalledTimes(3);
    destroy.mockRestore();
    error.mockRestore();
  });
});

describe('POST /api/data-reset', () => {
  let server;
  let url;
  const post = (body, headers = {}) => fetch(`${url}/api/data-reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

  beforeAll(async () => {
    server = harness.app().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    url = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());
  beforeEach(() => harness.reset());

  it('requires a signed-in user', async () => {
    const response = await post({ scope: 'everything', confirmation: 'RESET' }, { 'x-qa-unauthenticated': 'true' });
    expect(response.status).toBe(401);
    expect(harness.db.inventory).toHaveLength(1);
  });

  it.each([
    [{}],
    [{ scope: 'everything' }],
    [{ scope: 'everything', confirmation: 'reset' }],
    [{ scope: 'all', confirmation: 'RESET' }],
    [{ scope: 'everything', confirmation: 'RESET', user_id: harness.ids.other }],
    [{ scope: 'everything', confirmation: 'RESET', userId: harness.ids.other }],
  ])('deletes nothing for %j', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.platform).toHaveLength(3);
  });

  it('reports what it deleted, and republishes the calendar feed', async () => {
    const response = await post({ scope: 'transactions', confirmation: 'RESET' });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ scope: 'transactions', deleted: { purchases: 1, sales: 1 } });
    expect(harness.db.inventory).toHaveLength(0);
    expect(harness.db.paymentMethod).toHaveLength(1);
    expect(harness.calls.some((call) => call.model === 'cloudinary' && call.op === 'upload')).toBe(true);
  });

  it('leaves everything in place and removes no files when a delete fails', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    harness.db.inventory[0].receipt_url = receiptUrl('inventory', harness.ids.inventory);
    harness.faults['sales.deleteMany'] = true;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect((await post({ scope: 'everything', confirmation: 'RESET' })).status).toBe(500);

    expect(harness.db.inventory).toHaveLength(1);
    expect(harness.db.refund).toHaveLength(0);
    expect(harness.db.sales).toHaveLength(1);
    expect(harness.calls.filter((call) => call.model === 'cloudinary')).toHaveLength(0);
    error.mockRestore();
    delete process.env.CLOUDINARY_CLOUD_NAME;
  });

  it('removes the receipt file only after the delete succeeds', async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    harness.db.inventory[0].receipt_url = receiptUrl('inventory', harness.ids.inventory);
    await post({ scope: 'transactions', confirmation: 'RESET' });
    await vi.waitFor(() => {
      const destroy = harness.calls.find((call) => call.op === 'destroy');
      expect(destroy.publicId).toBe(`profittracker/receipts/inventory_${harness.ids.inventory}_abc`);
    });
    delete process.env.CLOUDINARY_CLOUD_NAME;
  });
});

// Foreign keys, cascades, rollback and locking only exist in a real database,
// so this block runs on a throwaway Postgres on 127.0.0.1.
describe('resetUserData on a real database', () => {
  const ME = '00000000-0000-4000-8000-000000000001';
  const OTHER = '00000000-0000-4000-8000-000000000002';
  let pg;
  let db;

  const freePort = () => new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

  // One of every user-owned record, all linked the way the app links them.
  async function seedUser(id, label) {
    const tag = (name) => `${label}-${name}`;
    await db.user.create({ data: { id, email: `${label}@example.test`, username: label, accounting_preferences: '{"theme":"x"}', calendar_token: tag('calendar') } });
    await db.localCredential.create({ data: { user_id: id, email: `${label}@example.test`, password_hash: 'hash' } });
    const identity = await db.firebaseIdentity.create({ data: { project_id: 'p', firebase_uid: tag('uid'), user_id: id, email: `${label}@example.test` } });
    await db.firebaseSession.create({ data: { fingerprint: tag('session'), identity_id: identity.id, expires_at: new Date(Date.now() + 1e7) } });
    await db.apiKey.create({ data: { user_id: id, key_hash: tag('hash'), key_prefix: 'pt_' } });

    const vendor = await db.platform.create({ data: { user_id: id, name: tag('vendor'), type: 'Vendor' } });
    const marketplace = await db.platform.create({ data: { user_id: id, name: tag('market'), type: 'Marketplace' } });
    const cashout = await db.platform.create({ data: { user_id: id, name: tag('cashout'), type: 'Cashout' } });
    await db.account.create({ data: { user_id: id, platform_id: marketplace.id, name: tag('account') } });
    const buyer = await db.buyer.create({ data: { user_id: id, name: tag('buyer') } });
    await db.invoice.create({ data: { user_id: id, buyer_id: buyer.id, issue_date: new Date(), due_date: new Date(), total_amount: 5, status: 'Unpaid' } });
    const card = await db.paymentMethod.create({ data: { user_id: id, name: tag('card'), type: 'Credit' } });

    const purchase = await db.inventory.create({ data: {
      user_id: id, product_name: tag('item'), vendor_id: vendor.id, payment_method_id: card.id,
      purchase_date: new Date(), unit_purchase_cost: 10, qty_purchased: 2, qty_on_hand: 1,
      receipt_url: receiptUrl('inventory', tag('purchase')),
    } });
    const sale = await db.sales.create({ data: {
      inventory_id: purchase.id, platform_id: marketplace.id, buyer_id: buyer.id,
      sale_shipping_payment_method_id: card.id, quantity: 1, unit_price: 20, sale_date: new Date(),
    } });
    await db.refund.create({ data: { user_id: id, sale_id: sale.id, amount: 1, date: new Date() } });
    await db.refund.create({ data: { user_id: id, inventory_id: purchase.id, amount: 1, date: new Date() } });
    await db.transactionNote.create({ data: { user_id: id, entity_type: 'sale', entity_id: sale.id, body: 'note' } });
    await db.transactionNote.create({ data: { user_id: id, entity_type: 'purchase', entity_id: purchase.id, body: 'gone', deleted_at: new Date() } });
    await db.attachment.create({ data: { user_id: id, entity_type: 'purchase', entity_id: purchase.id, url: 'https://mail.google.com/x' } });
    await db.changeLog.create({ data: { user_id: id, table_name: 'Sales', record_id: sale.id, field: 'unit_price' } });
    await db.changeLog.create({ data: { user_id: id, table_name: 'Platform', record_id: vendor.id, field: 'name' } });
    await db.mcpWriteLog.create({ data: { user_id: id, tool: 'add_sale', payload: {} } });

    const recurring = await db.recurringExpense.create({ data: {
      user_id: id, name: tag('rent'), amount: 9, frequency: 'monthly', start_date: new Date(), payment_method_id: card.id,
    } });
    await db.expense.create({ data: {
      user_id: id, name: tag('expense'), amount: 9, date: new Date(), payment_method_id: card.id,
      recurring_expense_id: recurring.id, receipt_url: receiptUrl('expense', tag('expense')),
    } });
    await db.goal.create({ data: { user_id: id, metric: 'netProfit' } });
    await db.productNote.create({ data: { user_id: id, product_name: tag('item'), note: 'n' } });
    await db.calendarEvent.create({ data: { user_id: id, title: 't', date: '2026-11-06' } });

    const connection = await db.cashoutConnection.create({ data: {
      user_id: id, provider: 'eb', encrypted_key: 'x', key_last4: '1234', platform_id: cashout.id,
    } });
    await db.cashoutDealSnapshot.create({ data: {
      user_id: id, connection_id: connection.id, provider: 'eb', external_deal_id: '1', item_name: 'i', payout: 1,
    } });
    await db.cashoutItemMatch.create({ data: {
      user_id: id, connection_id: connection.id, provider: 'eb', external_deal_id: '1', deal_item_name: 'i', inventory_id: purchase.id,
    } });
    return { purchase, sale, connection };
  }

  async function counts(userId) {
    const where = { user_id: userId };
    return {
      inventory: await db.inventory.count({ where }),
      sales: await db.sales.count({ where: { inventory: { user_id: userId } } }),
      refund: await db.refund.count({ where }),
      transactionNote: await db.transactionNote.count({ where }),
      attachment: await db.attachment.count({ where }),
      changeLog: await db.changeLog.count({ where }),
      cashoutItemMatch: await db.cashoutItemMatch.count({ where }),
      cashoutDealSnapshot: await db.cashoutDealSnapshot.count({ where }),
      cashoutConnection: await db.cashoutConnection.count({ where }),
      platform: await db.platform.count({ where }),
      account: await db.account.count({ where }),
      paymentMethod: await db.paymentMethod.count({ where }),
      buyer: await db.buyer.count({ where }),
      invoice: await db.invoice.count({ where }),
      expense: await db.expense.count({ where }),
      recurringExpense: await db.recurringExpense.count({ where }),
      goal: await db.goal.count({ where }),
      productNote: await db.productNote.count({ where }),
      calendarEvent: await db.calendarEvent.count({ where }),
      mcpWriteLog: await db.mcpWriteLog.count({ where }),
    };
  }

  const FULL = {
    inventory: 1, sales: 1, refund: 2, transactionNote: 2, attachment: 1, changeLog: 2, cashoutItemMatch: 1,
    cashoutDealSnapshot: 1, cashoutConnection: 1, platform: 3, account: 1, paymentMethod: 1, buyer: 1, invoice: 1,
    expense: 1, recurringExpense: 1, goal: 1, productNote: 1, calendarEvent: 1, mcpWriteLog: 1,
  };

  async function expectLoginIntact(id) {
    const user = await db.user.findUnique({ where: { id }, include: {
      local_credential: true, firebase_identity: { include: { sessions: true } }, api_keys: true,
    } });
    expect(user.local_credential).not.toBeNull();
    expect(user.firebase_identity.sessions).toHaveLength(1);
    expect(user.api_keys).toHaveLength(1);
    expect(user.accounting_preferences).toBe('{"theme":"x"}');
    expect(user.calendar_token).toBeTruthy();
  }

  beforeAll(async () => {
    const directory = mkdtempSync(join(tmpdir(), 'profittracker-data-reset-'));
    const port = await freePort();
    pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
    await pg.initialise();
    await pg.start();
    await pg.createDatabase('data_reset_qa');
    const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/data_reset_qa`;
    expect(new URL(url).hostname).toBe('127.0.0.1');
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate'], {
      cwd: join(import.meta.dirname, '..'),
      env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
      stdio: 'pipe',
    });
    db = new PrismaClient({ datasources: { db: { url } } });
  }, 120000);

  afterAll(async () => {
    if (db) await db.$disconnect();
    if (pg) await pg.stop();
  });

  beforeEach(async () => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
    await db.$executeRaw`TRUNCATE "User", ebay_price_cache CASCADE`;
    await db.ebayPriceCache.create({ data: { product_name: 'shared', last_sold_price: 1 } });
    await seedUser(ME, 'me');
    await seedUser(OTHER, 'other');
  });

  it('transactions scope removes only transaction data', async () => {
    const result = await resetUserData(ME, 'transactions', db);

    expect(await counts(ME)).toEqual({
      ...FULL, inventory: 0, sales: 0, refund: 0, transactionNote: 0, attachment: 0,
      cashoutItemMatch: 0, changeLog: 1,
    });
    expect(result.deleted).toEqual({
      purchases: 1, sales: 1, refunds: 2, transactionNotes: 2, attachments: 1, changeLogs: 1, cashoutItemMatches: 1,
    });
    expect(await counts(OTHER)).toEqual(FULL);
    await expectLoginIntact(ME);
  });

  it('everything scope leaves the user with no records but a working login', async () => {
    const result = await resetUserData(ME, 'everything', db);

    expect(Object.values(await counts(ME)).every((count) => count === 0)).toBe(true);
    await expectLoginIntact(ME);
    expect(result.deleted).toMatchObject({ platforms: 3, paymentMethods: 1, accounts: 1, cashoutConnections: 1, changeLogs: 2 });
    expect(result.connectionIds).toHaveLength(1);
  });

  it('never touches another user or the shared price cache', async () => {
    const before = await db.$queryRaw`SELECT count(*)::int AS n FROM "User"`;
    await resetUserData(ME, 'everything', db);

    expect(await counts(OTHER)).toEqual(FULL);
    await expectLoginIntact(OTHER);
    expect(await db.ebayPriceCache.count()).toBe(1);
    expect(await db.$queryRaw`SELECT count(*)::int AS n FROM "User"`).toEqual(before);
  });

  it('only offers up receipt files for the rows it deleted', async () => {
    const me = await db.inventory.findFirst({ where: { user_id: ME } });
    await db.inventory.update({ where: { id: me.id }, data: { receipt_url: receiptUrl('inventory', me.id) } });
    const myExpense = await db.expense.findFirst({ where: { user_id: ME } });
    await db.expense.update({ where: { id: myExpense.id }, data: { receipt_url: receiptUrl('expense', myExpense.id) } });

    const transactions = await resetUserData(ME, 'transactions', db);
    expect(transactions.receiptFiles).toEqual([
      { publicId: `profittracker/receipts/inventory_${me.id}_abc`, resourceType: 'image' },
    ]);
  });

  it('will not destroy a receipt a user pasted from someone else', async () => {
    const theirs = await db.inventory.findFirst({ where: { user_id: OTHER } });
    const stolenUrl = receiptUrl('inventory', theirs.id);
    await db.inventory.updateMany({ where: { user_id: ME }, data: { receipt_url: stolenUrl } });
    await db.expense.updateMany({ where: { user_id: ME }, data: { receipt_url: stolenUrl } });
    await db.attachment.updateMany({ where: { user_id: ME }, data: { url: stolenUrl } });

    const { receiptFiles } = await resetUserData(ME, 'everything', db);
    expect(receiptFiles).toEqual([]);
  });

  it('rolls back every delete when the last one fails', async () => {
    await db.$executeRawUnsafe(`CREATE FUNCTION fail_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe('CREATE TRIGGER fail_delete BEFORE DELETE ON "PaymentMethod" FOR EACH ROW EXECUTE FUNCTION fail_delete()');
    try {
      await expect(resetUserData(ME, 'everything', db)).rejects.toThrow('injected failure');
      expect(await counts(ME)).toEqual(FULL);
      expect(await counts(OTHER)).toEqual(FULL);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER fail_delete ON "PaymentMethod"');
      await db.$executeRawUnsafe('DROP FUNCTION fail_delete');
    }
  });

  it.each([
    ['purchase', (mine) => db.inventory.updateMany({ where: { user_id: OTHER }, data: { vendor_id: mine.vendor.id } })],
    ['sale', (mine) => db.sales.updateMany({ where: { inventory: { user_id: OTHER } }, data: { platform_id: mine.vendor.id } })],
    ['expense', (mine) => db.expense.updateMany({ where: { user_id: OTHER }, data: { payment_method_id: mine.card.id } })],
    ['account', (mine) => db.account.updateMany({ where: { user_id: OTHER }, data: { platform_id: mine.vendor.id } })],
  ])("stops rather than change another user's %s linked to my records", async (_, link) => {
    const mine = {
      vendor: await db.platform.findFirst({ where: { user_id: ME, type: 'Vendor' } }),
      card: await db.paymentMethod.findFirst({ where: { user_id: ME } }),
    };
    await link(mine);
    const before = await db.inventory.findFirst({ where: { user_id: OTHER } });

    await expect(resetUserData(ME, 'everything', db)).rejects.toThrow('Data reset stopped');

    expect(await counts(ME)).toEqual(FULL);
    expect(await db.inventory.findFirst({ where: { user_id: OTHER } })).toEqual(before);
  });

  it('is safe to repeat', async () => {
    await resetUserData(ME, 'everything', db);
    const second = await resetUserData(ME, 'everything', db);
    expect(Object.values(second.deleted).every((count) => count === 0)).toBe(true);
    await expectLoginIntact(ME);
  });

  it('runs concurrent resets one at a time without errors', async () => {
    const results = await Promise.all([
      resetUserData(ME, 'everything', db),
      resetUserData(ME, 'everything', db),
      resetUserData(ME, 'transactions', db),
    ]);
    expect(results.filter((result) => result.deleted.purchases === 1)).toHaveLength(1);
    expect(Object.values(await counts(ME)).every((count) => count === 0)).toBe(true);
  });

  it('holds back a purchase saved during a reset until the reset has finished', async () => {
    const reset = resetUserData(ME, 'transactions', db);
    await vi.waitFor(async () => {
      const [{ n }] = await db.$queryRaw`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'transactionid' AND granted`;
      expect(n).toBeGreaterThan(0);
    }, { interval: 1 });
    const save = db.inventory.create({ data: {
      user_id: ME, product_name: 'late', purchase_date: new Date(), unit_purchase_cost: 1, qty_purchased: 1, qty_on_hand: 1,
    } });
    await Promise.all([reset, save]);

    // Whichever ran first, the reset never leaves half a purchase behind and
    // never fails: the new row either survived intact or was deleted whole.
    const left = await db.inventory.findMany({ where: { user_id: ME } });
    expect(left.every((row) => row.product_name === 'late')).toBe(true);
  });

  it('forgets cached deals for removed connections', async () => {
    const { finishReset } = require('../services/dataReset');
    const connection = await db.cashoutConnection.findFirst({ where: { user_id: ME } });
    dealsCache.set(connection.id, { deals: [] });
    const result = await resetUserData(ME, 'everything', db);
    harness.reset();
    harness.db.user[0].calendar_token = null;
    await finishReset(ME, result);
    expect(dealsCache.has(connection.id)).toBe(false);
  });
});
