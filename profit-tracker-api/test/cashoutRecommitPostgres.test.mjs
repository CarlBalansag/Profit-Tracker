// One open commitment per item, against a real (throwaway) Postgres: the
// in-memory harness doesn't enforce unique indexes, and this rule lives in one.
// A withdrawn commitment keeps its row for the sale's history, but must not
// block committing the same item again.
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

const ME = '00000000-0000-4000-8000-0000000000b1';
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
let pg;
let db;
let ebAdapter;
let commits;
let logPurchase;
let encryptKey;
let ids;

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

beforeAll(async () => {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  const directory = mkdtempSync(join(tmpdir(), 'profittracker-recommit-'));
  const port = await freePort();
  pg = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port, user: 'postgres', password: 'isolated-qa-only', persistent: false, onLog: () => {}, onError: () => {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('recommit_qa');
  const url = `postgresql://postgres:isolated-qa-only@127.0.0.1:${port}/recommit_qa`;
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
  ebAdapter = require('../services/cashouts/eb');
  commits = require('../services/cashouts/commits');
  ({ logPurchase } = require('../services/cashouts/logPurchase'));
  ({ encryptKey } = require('../services/cashouts/crypto'));
}, 180000);

afterAll(async () => {
  if (db) await db.$disconnect();
  if (pg) await pg.stop();
});

beforeEach(async () => {
  vi.restoreAllMocks();
  await db.cashoutCommitment.deleteMany({});
  await db.sales.deleteMany({});
  await db.inventory.deleteMany({});
  await db.cashoutConnection.deleteMany({});
  await db.paymentMethod.deleteMany({});
  await db.platform.deleteMany({});
  await db.user.deleteMany({});
  await db.user.create({ data: { id: ME, username: 'recommit-qa', email: 'recommit-qa@example.invalid' } });
  const group = await db.platform.create({ data: { user_id: ME, name: 'EB (cashout)', type: 'Cashout', workflow_preset: 'CASHOUT' } });
  const vendor = await db.platform.create({ data: { user_id: ME, name: 'Store', type: 'Vendor' } });
  const card = await db.paymentMethod.create({ data: { user_id: ME, name: 'Card', type: 'Credit' } });
  const conn = await db.cashoutConnection.create({
    data: { user_id: ME, provider: 'eb', encrypted_key: encryptKey('live_test_key_1234'), key_last4: '1234', platform_id: group.id },
  });
  ids = { conn: conn.id, vendor: vendor.id, card: card.id };
});

let commitNumber = 0;
const mockEb = () => {
  const commitSpy = vi.spyOn(ebAdapter, 'createCommit').mockImplementation(async (_key, { itemId, quantity }) => {
    commitNumber += 1;
    return { id: `eb-commit-${commitNumber}`, item_id: itemId, quantity };
  });
  vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
  vi.spyOn(ebAdapter, 'deleteCommit').mockResolvedValue(null);
  return commitSpy;
};

const log = (trackingCodes = ['1Z999AA10123456784']) => logPurchase(ME, {
  connectionId: ids.conn, dealId: '2000', itemId: '101', dealName: 'PS5 Pro', itemName: 'PS5 Pro',
  quantity: 1, trackingCodes, vendorId: ids.vendor, paymentMethodId: ids.card,
  unitCost: 400, unitPayout: 480, purchaseDate: '2026-11-08',
});

describe('committing an item again after withdrawing it (real Postgres)', () => {
  it('works, and keeps the withdrawn row linked to its sale', async () => {
    const commitSpy = mockEb();
    const first = await log();
    await commits.deleteCommitment(ME, first.commitment.id);

    const second = await log();

    expect(commitSpy).toHaveBeenCalledTimes(2);
    const rows = await db.cashoutCommitment.findMany({ orderBy: { created_at: 'asc' } });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ status: 'withdrawn', open_item_id: null, sale_id: first.sale.id, external_item_id: '101' });
    expect(rows[1]).toMatchObject({ status: 'active', open_item_id: '101', sale_id: second.sale.id, external_item_id: '101' });
  });

  it('works for a purchase logged before it ships, too', async () => {
    mockEb();
    const first = await log();
    await commits.deleteCommitment(ME, first.commitment.id);

    const pending = await log([]);

    expect(pending.commitment).toMatchObject({ status: 'pending', open_item_id: '101' });
  });

  it('can withdraw and re-commit more than once', async () => {
    mockEb();
    for (let round = 0; round < 3; round += 1) {
      const result = await log();
      await commits.deleteCommitment(ME, result.commitment.id);
    }
    await log();
    const rows = await db.cashoutCommitment.findMany();
    expect(rows.filter((r) => r.status === 'withdrawn')).toHaveLength(3);
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('refuses a second open commitment before calling EB, saving nothing', async () => {
    const commitSpy = mockEb();
    await log();

    await expect(log()).rejects.toThrow('already have a commitment for this item');
    await expect(log([])).rejects.toThrow('already have a commitment for this item');

    expect(commitSpy).toHaveBeenCalledTimes(1);
    expect(await db.inventory.count()).toBe(1);
    expect(await db.sales.count()).toBe(1);
  });

  it('refuses logging again while one is pending, before calling EB', async () => {
    const commitSpy = mockEb();
    await log([]);

    await expect(log()).rejects.toThrow('already logged and waiting');
    expect(commitSpy).not.toHaveBeenCalled();
    expect(await db.inventory.count()).toBe(1);
  });

  it('the database itself still blocks two open rows for one item', async () => {
    const base = { user_id: ME, connection_id: ids.conn, external_deal_id: '2000', external_item_id: '101', quantity: 1 };
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: '101', status: 'active', external_commitment_id: 'x-1' } });
    await expect(db.cashoutCommitment.create({ data: { ...base, open_item_id: '101', status: 'active', external_commitment_id: 'x-2' } }))
      .rejects.toThrow(/Unique constraint/);
    // Withdrawn rows (null open_item_id) never collide.
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: null, status: 'withdrawn', external_commitment_id: 'x-3' } });
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: null, status: 'withdrawn', external_commitment_id: 'x-4' } });
    expect(await db.cashoutCommitment.count()).toBe(3);
  });
});
