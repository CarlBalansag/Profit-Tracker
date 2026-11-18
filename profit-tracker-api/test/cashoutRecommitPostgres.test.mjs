// Cashout commitments against a real (throwaway) Postgres, with every
// migration applied. A withdrawn commitment keeps its row for the sale's
// history but must not block committing the same item again; buying more of
// an item already committed shares one provider commitment across purchases.
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
  vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }, { id: '102', name: 'PS5 Pro Digital' }] }]);
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

  it('lets several open rows share one item and one EB commitment, and withdrawn rows never collide', async () => {
    const base = { user_id: ME, connection_id: ids.conn, external_deal_id: '2000', external_item_id: '101', quantity: 1 };
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: '101', status: 'active', external_commitment_id: 'x-1' } });
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: '101', status: 'active', external_commitment_id: 'x-1' } });
    await db.cashoutCommitment.create({ data: { ...base, open_item_id: null, status: 'withdrawn', external_commitment_id: 'x-3' } });
    expect(await db.cashoutCommitment.count()).toBe(3);
  });
});

// Buying more of an item already committed: one EB commitment per item, one
// row per purchase. Each purchase commits when its tracking number is added --
// the first creates the commitment, later ones raise it.
describe('buying more of an item already committed (real Postgres)', () => {
  let eb;
  let pendingCommit;
  beforeAll(() => { pendingCommit = require('../services/cashouts/pendingCommit'); });
  beforeEach(() => commits._resetWriteLimits());

  // A small fake of EB's commitments, with a per-item limit.
  const fakeEb = ({ limit = 100 } = {}) => {
    eb = { commits: new Map(), limit, next: 0 };
    const spies = {
      create: vi.spyOn(ebAdapter, 'createCommit').mockImplementation(async (_k, { itemId, quantity }) => {
        if ([...eb.commits.values()].some((c) => c.item_id === itemId)) throw Object.assign(new Error('Already committed to this item'), { status: 400, code: 'INVALID_OPERATION' });
        if (quantity > eb.limit) throw Object.assign(new Error('Over the vendor limit.'), { status: 400 });
        eb.next += 1;
        const commit = { id: `eb-${eb.next}`, item_id: itemId, quantity };
        eb.commits.set(commit.id, commit);
        return { ...commit };
      }),
      update: vi.spyOn(ebAdapter, 'updateCommit').mockImplementation(async (_k, id, { quantity }) => {
        const commit = eb.commits.get(id);
        if (!commit) throw Object.assign(new Error('Not found'), { status: 404 });
        if (quantity > eb.limit) throw Object.assign(new Error('Over the vendor limit.'), { status: 400 });
        commit.quantity = quantity;
        return { ...commit };
      }),
      get: vi.spyOn(ebAdapter, 'getCommit').mockImplementation(async (_k, id) => ({ ...eb.commits.get(id) })),
      list: vi.spyOn(ebAdapter, 'listCommits').mockImplementation(async () => ({ commits: [...eb.commits.values()].map((c) => ({ ...c, status: 'active' })) })),
      remove: vi.spyOn(ebAdapter, 'deleteCommit').mockImplementation(async (_k, id) => { eb.commits.delete(id); return null; }),
      tracking: vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] }),
    };
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }] }]);
    return spies;
  };
  const ebTotal = () => [...eb.commits.values()].reduce((n, c) => n + c.quantity, 0);
  const buy = (quantity, trackingCodes = []) => logPurchase(ME, {
    connectionId: ids.conn, dealId: '2000', itemId: '101', dealName: 'PS5 Pro', itemName: 'PS5 Pro',
    quantity, trackingCodes, vendorId: ids.vendor, paymentMethodId: ids.card,
    unitCost: 400, unitPayout: 480, purchaseDate: '2026-11-18',
  });
  const ship = async (logged, code) => {
    await db.sales.update({ where: { id: logged.sale.id }, data: { tracking_number: code } });
    return pendingCommit.commitPending(ME, logged.commitment.id);
  };
  const rows = () => db.cashoutCommitment.findMany({ orderBy: { created_at: 'asc' } });

  it('logs more of a committed item (no tracking) and raises the commitment when it ships', async () => {
    const spies = fakeEb();
    const a = await buy(2, ['1Z999AA10000000001']);
    expect(ebTotal()).toBe(2);

    const b = await buy(2);
    expect(b).toMatchObject({ commitPending: true, addsToCommitment: true });
    expect(b.commitment).toMatchObject({ status: 'pending', quantity: 2 });
    expect(ebTotal()).toBe(2); // nothing sent until it ships

    const done = await ship(b, '1Z999AA10000000002');
    expect(done.raisedTo).toBe(4);
    expect(ebTotal()).toBe(4);
    expect(spies.create).toHaveBeenCalledTimes(1);
    const [ra, rb] = await rows();
    expect(ra).toMatchObject({ id: a.commitment.id, status: 'active', quantity: 2, sale_id: a.sale.id });
    expect(rb).toMatchObject({ id: b.commitment.id, status: 'active', quantity: 2, sale_id: b.sale.id, external_commitment_id: ra.external_commitment_id, commit_error: null });
    expect(rb.tracking_codes).toEqual(['1Z999AA10000000002']);
    // Separate books for each buy.
    expect(await db.inventory.count()).toBe(2);
    expect(await db.sales.count()).toBe(2);
  });

  it('raises right away when the new purchase is logged with tracking', async () => {
    const spies = fakeEb();
    await buy(1, ['1Z999AA10000000001']);
    const b = await buy(3, ['1Z999AA10000000002']);
    expect(b).toMatchObject({ commitPending: false, addedTo: 4, trackingSubmitted: true });
    expect(ebTotal()).toBe(4);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(spies.tracking).toHaveBeenCalledTimes(2);
  });

  it('two unshipped orders: whichever ships first creates it, the other raises it', async () => {
    for (const order of [['a', 'b'], ['b', 'a']]) {
      await db.cashoutCommitment.deleteMany({});
      await db.sales.deleteMany({});
      await db.inventory.deleteMany({});
      vi.restoreAllMocks();
      const spies = fakeEb();
      const codes = { a: '1Z999AA10000000001', b: '1Z999AA10000000002' };
      const logged = { a: await buy(2), b: await buy(3) };
      expect(ebTotal()).toBe(0);
      await ship(logged[order[0]], codes[order[0]]);
      expect(ebTotal()).toBe(order[0] === 'a' ? 2 : 3);
      await ship(logged[order[1]], codes[order[1]]);
      expect(ebTotal()).toBe(5);
      expect(spies.create).toHaveBeenCalledTimes(1);
      const open = (await rows()).filter((r) => r.open_item_id === '101');
      expect(open).toHaveLength(2);
      expect(open.every((r) => r.status === 'active' && r.external_commitment_id === open[0].external_commitment_id)).toBe(true);
    }
  });

  it('both shipping at the same moment still makes one commitment for the total', async () => {
    const spies = fakeEb();
    const a = await buy(2);
    const b = await buy(3);
    await Promise.all([ship(a, '1Z999AA10000000001'), ship(b, '1Z999AA10000000002')]);
    expect(spies.create).toHaveBeenCalledTimes(1);
    expect(ebTotal()).toBe(5);
  });

  it('a refused raise keeps the purchase logged, pending, with a contact-the-cashout note; a retry works', async () => {
    fakeEb({ limit: 2 });
    await buy(2, ['1Z999AA10000000001']);
    const b = await buy(1);
    await expect(ship(b, '1Z999AA10000000002')).rejects.toThrow(/wouldn't add these 1 to your commitment \(Over the vendor limit\.\)/);
    const kept = (await rows())[1];
    expect(kept).toMatchObject({ status: 'pending', external_commitment_id: null });
    expect(kept.commit_error).toMatch(/logged but not committed\. Contact .* about these units/);
    expect(ebTotal()).toBe(2);
    expect(await db.sales.count()).toBe(2);
    const preview = await pendingCommit.previewPending(ME, b.commitment.id);
    expect(preview).toMatchObject({ adds_to: { committed: 2, new_total: 3 }, commit_error: kept.commit_error });

    eb.limit = 5;
    await pendingCommit.commitPending(ME, b.commitment.id);
    expect(ebTotal()).toBe(3);
    expect((await rows())[1]).toMatchObject({ status: 'active', commit_error: null });
  });

  it('logged with tracking but refused: still saved, flagged, and nothing else sent', async () => {
    const spies = fakeEb({ limit: 1 });
    await buy(1, ['1Z999AA10000000001']);
    const b = await buy(1, ['1Z999AA10000000002']);
    expect(b.commitError).toMatch(/wouldn't add these 1/);
    expect(b.commitPending).toBe(true);
    expect(spies.tracking).toHaveBeenCalledTimes(1);
    expect(await db.inventory.count()).toBe(2);
  });

  it('taking one purchase off lowers the commitment; the last one withdraws it', async () => {
    const spies = fakeEb();
    const a = await buy(2, ['1Z999AA10000000001']);
    const b = await buy(3, ['1Z999AA10000000002']);
    expect(await commits.lowerOfferForSale(b.sale.id)).toMatchObject({ quantity: 3, total: 5, remaining: 2 });

    await commits.deleteCommitment(ME, b.commitment.id);
    expect(ebTotal()).toBe(2);
    expect(spies.remove).not.toHaveBeenCalled();
    let [ra, rb] = await rows();
    expect(ra.status).toBe('active');
    expect(rb).toMatchObject({ status: 'withdrawn', open_item_id: null });

    expect(await commits.lowerOfferForSale(a.sale.id)).toMatchObject({ remaining: 0 });
    await commits.deleteCommitment(ME, a.commitment.id);
    expect(spies.remove).toHaveBeenCalledTimes(1);
    expect(eb.commits.size).toBe(0);
    [ra] = await rows();
    expect(ra.status).toBe('withdrawn');
  });

  it('withdraw all takes every purchase off in one call', async () => {
    const spies = fakeEb();
    const a = await buy(2, ['1Z999AA10000000001']);
    await buy(3, ['1Z999AA10000000002']);
    await commits.deleteCommitment(ME, a.commitment.id, { all: true });
    expect(spies.remove).toHaveBeenCalledTimes(1);
    expect(spies.update).toHaveBeenCalledTimes(1); // only the raise
    expect((await rows()).every((r) => r.status === 'withdrawn' && r.open_item_id === null)).toBe(true);
    // The item can be committed fresh afterwards.
    await buy(1, ['1Z999AA10000000003']);
    expect(spies.create).toHaveBeenCalledTimes(2);
  });

  it("changing one purchase's quantity moves the total by the difference", async () => {
    fakeEb();
    const a = await buy(1, ['1Z999AA10000000001']);
    const b = await buy(1, ['1Z999AA10000000002']);
    await commits.updateCommitment(ME, b.commitment.id, { quantity: 3 });
    expect(ebTotal()).toBe(4);
    const [ra, rb] = await rows();
    expect(ra).toMatchObject({ id: a.commitment.id, quantity: 1 });
    expect(rb.quantity).toBe(3);
  });

  it('a raise with no answer is checked with EB before it counts', async () => {
    const spies = fakeEb();
    await buy(2, ['1Z999AA10000000001']);
    const b = await buy(1);
    // EB took it but the reply was lost.
    spies.update.mockImplementationOnce(async (_k, id, { quantity }) => {
      eb.commits.get(id).quantity = quantity;
      throw Object.assign(new Error('socket hang up'), { status: 502 });
    });
    await ship(b, '1Z999AA10000000002');
    expect((await rows())[1]).toMatchObject({ status: 'active' });

    // EB didn't take it: back to pending, no note, nothing doubled.
    const c = await buy(1);
    spies.update.mockImplementationOnce(async () => { throw Object.assign(new Error('socket hang up'), { status: 502 }); });
    await expect(ship(c, '1Z999AA10000000003')).rejects.toThrow(/still at 3/);
    expect((await rows())[2]).toMatchObject({ status: 'pending', commit_error: null });
    expect(ebTotal()).toBe(3);
  });
});
