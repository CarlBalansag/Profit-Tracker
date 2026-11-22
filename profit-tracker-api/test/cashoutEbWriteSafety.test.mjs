// Safety probes for every path that writes to EB (commit, change quantity,
// withdraw, send tracking). Each test states the SAFE behavior. EB is always
// stubbed, and any real request to EB fails the test.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const ebAdapter = require('../services/cashouts/eb');
const { logPurchase } = require('../services/cashouts/logPurchase');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');

const TRACKING = '1Z999AA10123456784';
const realFetch = globalThis.fetch;

function seed() {
  harness.db.platform.push({ id: 'cashout-platform-1', user_id: harness.ids.user, name: 'EB', type: 'Cashout', fee_pct: 0, workflow_preset: 'CASHOUT' });
  const conn = {
    id: 'conn-1', user_id: harness.ids.user, provider: 'eb', display_name: 'EB Primary',
    encrypted_key: encryptKey('live_test_key_1234'), key_last4: '1234', status: 'active',
    platform_id: 'cashout-platform-1', last_synced_at: new Date(), last_error: null,
    created_at: new Date(), updated_at: new Date(),
  };
  harness.db.cashoutConnection.push(conn);
  return conn;
}
const liveDeal = (overrides = {}) => ({
  id: '2000', name: 'PS5 Pro', payout: 495, status: 'active',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  items: [{ id: '101', name: 'PS5 Pro' }, { id: '102', name: 'PS5 Pro Digital' }], ...overrides,
});
const purchase = (conn, extra = {}) => logPurchase(harness.ids.user, {
  connectionId: conn.id, dealId: '2000', itemId: '101', dealName: 'PS5 Pro', itemName: 'PS5 Pro',
  quantity: 1, trackingCodes: [], vendorId: harness.ids.vendor, paymentMethodId: harness.ids.card,
  unitCost: 400, salesTax: 0, unitPayout: 495, purchaseDate: '2026-11-18', ...extra,
});

let server;
let baseUrl;
beforeAll(async () => {
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  harness.reset();
  vi.restoreAllMocks();
  dealsCache.clear();
  syncBlockedUntil.clear();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  // Belt and braces: nothing in here may reach the real EB.
  vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...rest) => {
    if (String(url).includes('electronicsbuyer')) throw new Error(`Real EB request attempted: ${url}`);
    return realFetch(url, ...rest);
  });
  vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
});
afterEach(() => vi.restoreAllMocks());

const call = async (method, path, body) => {
  const res = await realFetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const ebWrites = () => ({
  create: vi.spyOn(ebAdapter, 'createCommit'),
  update: vi.spyOn(ebAdapter, 'updateCommit'),
  remove: vi.spyOn(ebAdapter, 'deleteCommit'),
  track: vi.spyOn(ebAdapter, 'submitTracking'),
});

describe('already safe', () => {
  it("another user's commitment can't be changed, withdrawn or committed, and EB is never called", async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push({ id: 'o1', user_id: harness.ids.other, connection_id: conn.id, sale_id: null, external_deal_id: '2000', external_item_id: '101', open_item_id: '101', external_commitment_id: 'eb-o1', quantity: 1, status: 'active', tracking_codes: [], created_at: new Date(), updated_at: new Date() });
    const eb = ebWrites();
    expect((await call('PATCH', '/api/cashouts/commitments/o1', { quantity: 2 })).status).toBe(404);
    expect((await call('DELETE', '/api/cashouts/commitments/o1')).status).toBe(404);
    expect((await call('POST', '/api/cashouts/commitments/o1/commit', {})).status).toBe(404);
    expect(eb.update).not.toHaveBeenCalled();
    expect(eb.remove).not.toHaveBeenCalled();
    expect(eb.create).not.toHaveBeenCalled();
  });

  it("another user's connection can't be used to write", async () => {
    const conn = seed();
    conn.user_id = harness.ids.other;
    const eb = ebWrites();
    expect((await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '101', quantity: 1 })).status).toBe(404);
    expect((await call('POST', `/api/cashouts/connections/${conn.id}/tracking`, { tracking_codes: [TRACKING], description: 'd' })).status).toBe(404);
    expect(eb.create).not.toHaveBeenCalled();
    expect(eb.track).not.toHaveBeenCalled();
  });

  it("EB's error comes back without the API key in it", async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('Deal is closed.'), { code: 'INVALID_OPERATION' }));
    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '101', quantity: 1 });
    expect(JSON.stringify(res.body)).not.toContain('live_test_key');
    expect(res.body.error).toBe('Deal is closed.');
  });
});

describe('H1 orphaned pledge: EB says yes, our save fails', () => {
  it('direct commit refuses an item that already has a pending row, before calling EB', async () => {
    const conn = seed();
    await purchase(conn); // pending row for item 101
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-c1', quantity: 1 });

    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '101', quantity: 1 });

    expect(res.status).toBe(409);
    expect(eb.create).not.toHaveBeenCalled();
  });
});

describe('H2 ambiguous result: EB timed out, but may have committed', () => {
  it('a timed-out commit is checked with EB before the row goes back to pending', async () => {
    const conn = seed();
    const { sale, commitment } = await purchase(conn);
    await call('PUT', `/api/sales/${sale.id}`, { tracking_number: TRACKING });
    const eb = ebWrites();
    eb.create.mockRejectedValue(new Error('Request to ElectronicsBuyer timed out.'));
    const list = vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue({ commits: [{ id: 'eb-late', item_id: 101, quantity: 1 }] });

    await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(list).toHaveBeenCalled();
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'active', external_commitment_id: 'eb-late' });
  });
});

describe('H3 writes against a commitment in the wrong state', () => {
  it('changing the quantity of a withdrawn commitment never calls EB', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push({ id: 'w1', user_id: harness.ids.user, connection_id: conn.id, sale_id: null, external_deal_id: '2000', external_item_id: '101', open_item_id: null, external_commitment_id: 'eb-w1', quantity: 1, status: 'withdrawn', tracking_codes: [], created_at: new Date(), updated_at: new Date() });
    const eb = ebWrites();
    eb.update.mockResolvedValue({ id: 'eb-w1', quantity: 3 });

    const res = await call('PATCH', '/api/cashouts/commitments/w1', { quantity: 3 });

    expect(res.status).toBe(409);
    expect(eb.update).not.toHaveBeenCalled();
  });

  it('changing the quantity while a commit is in flight never calls EB', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push({ id: 'c1', user_id: harness.ids.user, connection_id: conn.id, sale_id: null, external_deal_id: '2000', external_item_id: '101', open_item_id: '101', external_commitment_id: null, quantity: 1, status: 'committing', tracking_codes: [], created_at: new Date(), updated_at: new Date() });
    const eb = ebWrites();

    const res = await call('PATCH', '/api/cashouts/commitments/c1', { quantity: 3 });

    expect(res.status).toBe(409);
    expect(eb.update).not.toHaveBeenCalled();
  });

  it('withdrawing an already withdrawn commitment never calls EB again', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push({ id: 'w2', user_id: harness.ids.user, connection_id: conn.id, sale_id: null, external_deal_id: '2000', external_item_id: '101', open_item_id: null, external_commitment_id: 'eb-w2', quantity: 1, status: 'withdrawn', tracking_codes: [], created_at: new Date(), updated_at: new Date() });
    const eb = ebWrites();
    eb.remove.mockResolvedValue(null);

    await call('DELETE', '/api/cashouts/commitments/w2');

    expect(eb.remove).not.toHaveBeenCalled();
  });
});

describe('H4 bad input reaching EB', () => {
  it.each([
    ['a fraction', 2.5],
    ['a huge number', 1e9],
    ['a numeric string with junk', '3abc'],
  ])('direct commit refuses %s as the quantity', async (_label, quantity) => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'x', quantity: 1 });
    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '102', quantity });
    expect(res.status).toBe(400);
    expect(eb.create).not.toHaveBeenCalled();
  });

  it('direct commit refuses a non-numeric item id instead of sending item_id: null', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'x', quantity: 1 });
    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: 'abc', quantity: 1 });
    expect(res.status).toBe(400);
    expect(eb.create).not.toHaveBeenCalled();
  });

  it('a quantity change refuses a fraction', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push({ id: 'a1', user_id: harness.ids.user, connection_id: conn.id, sale_id: null, external_deal_id: '2000', external_item_id: '101', open_item_id: '101', external_commitment_id: 'eb-a1', quantity: 1, status: 'active', tracking_codes: [], created_at: new Date(), updated_at: new Date() });
    const eb = ebWrites();
    eb.update.mockResolvedValue({ id: 'eb-a1', quantity: 2 });
    const res = await call('PATCH', '/api/cashouts/commitments/a1', { quantity: 1.5 });
    expect(res.status).toBe(400);
    expect(eb.update).not.toHaveBeenCalled();
  });

  it('tracking refuses codes over 24 characters and blank codes', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.track.mockResolvedValue({});
    const long = await call('POST', `/api/cashouts/connections/${conn.id}/tracking`, { tracking_codes: ['X'.repeat(40)], description: 'd' });
    const blank = await call('POST', `/api/cashouts/connections/${conn.id}/tracking`, { tracking_codes: ['  '], description: 'd' });
    expect(long.status).toBe(400);
    expect(blank.status).toBe(400);
    expect(eb.track).not.toHaveBeenCalled();
  });

  it('insured value outside $200-$1,500 is refused before anything is committed', async () => {
    const conn = seed();
    const { sale, commitment } = await purchase(conn);
    await call('PUT', `/api/sales/${sale.id}`, { tracking_number: TRACKING });
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-1', quantity: 1 });
    eb.track.mockResolvedValue({});
    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, { insured_value: 50000 });
    expect(res.status).toBe(400);
    expect(eb.create).not.toHaveBeenCalled();
  });

  it('Log Purchase refuses an item that is not in the deal, before anything is saved or sent', async () => {
    const conn = seed();
    const eb = ebWrites();
    await expect(purchase(conn, { itemId: '999' })).rejects.toThrow();
    expect(eb.create).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment).toHaveLength(0);
  });
});

describe('H5 connection state', () => {
  it('no writes go to EB through a connection whose key was rejected', async () => {
    const conn = seed();
    conn.status = 'error';
    conn.last_error = 'ElectronicsBuyer API key is invalid or revoked.';
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'x', quantity: 1 });
    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '102', quantity: 1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(eb.create).not.toHaveBeenCalled();
  });
});

describe('H6 stuck "committing" rows', () => {
  it('a row left in committing by a crash can be recovered', async () => {
    const conn = seed();
    const { commitment } = await purchase(conn);
    const row = harness.db.cashoutCommitment.find((c) => c.id === commitment.id);
    row.status = 'committing';
    row.updated_at = new Date(Date.now() - 60 * 60 * 1000); // an hour ago
    vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue({ commits: [] });

    const res = await call('DELETE', `/api/cashouts/commitments/${commitment.id}`);

    expect(res.status).toBe(200);
  });
});

describe('H7 error responses', () => {
  it('a database failure after EB accepted the commit says the pledge was made', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-ok', quantity: 1 });
    eb.track.mockResolvedValue({});
    const prisma = require('../prisma');
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('connection reset'));

    const err = await purchase(conn, { trackingCodes: [TRACKING] }).catch((e) => e);

    expect(err.message).toMatch(/committed/i);
    expect(err.committed).toBe(true);
  });
});

// ---------------------------------------------------------------- the fixes

const activeRow = (conn, overrides = {}) => ({
  id: 'a1', user_id: harness.ids.user, connection_id: conn.id, sale_id: null, external_deal_id: '2000',
  external_item_id: '101', open_item_id: '101', external_commitment_id: 'eb-a1', quantity: 1, status: 'active',
  tracking_codes: [], tracking_submitted_at: null, tracking_error: null, created_at: new Date(), updated_at: new Date(), ...overrides,
});

describe('recovering from no answer', () => {
  it('keeps a pending commit blocked (not back to pending) when EB gave no answer and the lookup fails too', async () => {
    const conn = seed();
    const { sale, commitment } = await purchase(conn);
    await call('PUT', `/api/sales/${sale.id}`, { tracking_number: TRACKING });
    const eb = ebWrites();
    eb.create.mockRejectedValue(new Error('Request to ElectronicsBuyer timed out.'));
    vi.spyOn(ebAdapter, 'listCommits').mockRejectedValue(new Error('Request to ElectronicsBuyer timed out.'));

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});
    const again = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ambiguous: true });
    expect(res.body.error).toContain("can't tell whether the commit went through");
    expect(harness.db.cashoutCommitment[0].status).toBe('committing');
    expect(again.status).toBe(409);
    expect(eb.create).toHaveBeenCalledTimes(1);
    expect(eb.track).not.toHaveBeenCalled();
  });

  it('goes back to pending when EB gave no answer but has no such commitment', async () => {
    const conn = seed();
    const { sale, commitment } = await purchase(conn);
    await call('PUT', `/api/sales/${sale.id}`, { tracking_number: TRACKING });
    const eb = ebWrites();
    eb.create.mockRejectedValue(Object.assign(new Error('ElectronicsBuyer returned HTTP 503.'), { status: 503 }));
    vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue({ data: [] });

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(503);
    expect(harness.db.cashoutCommitment[0].status).toBe('pending');
  });

  it("picks up a commitment EB already has (refused as a duplicate) instead of losing it", async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockRejectedValue(Object.assign(new Error('You have already committed to this item.'), { code: 'INVALID_OPERATION', status: 400 }));
    vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue([{ id: 'eb-existing', item_id: 102, quantity: 2 }]);

    const res = await call('POST', `/api/cashouts/connections/${conn.id}/commits`, { deal_id: '2000', item_id: '102', quantity: 2 });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ external_commitment_id: 'eb-existing', quantity: 2, status: 'active', adopted: true });
    expect(harness.db.cashoutWriteLog.map((l) => l.outcome)).toEqual(['failed', 'adopted']);
  });

  it('a stuck commit whose EB commitment exists becomes active when the list is opened', async () => {
    const conn = seed();
    const { commitment } = await purchase(conn);
    Object.assign(harness.db.cashoutCommitment[0], { status: 'committing', updated_at: new Date(Date.now() - 10 * 60 * 1000) });
    vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue({ commits: [{ id: 'eb-found', item_id: '101', quantity: 1 }] });

    const res = await call('GET', '/api/cashouts/commitments');

    expect(res.status).toBe(200);
    expect(res.body.find((c) => c.id === commitment.id)).toMatchObject({ status: 'active', external_commitment_id: 'eb-found' });
  });

  it("doesn't touch a commit that is only a few seconds into committing", async () => {
    const conn = seed();
    const { commitment } = await purchase(conn);
    Object.assign(harness.db.cashoutCommitment[0], { status: 'committing', updated_at: new Date() });
    const list = vi.spyOn(ebAdapter, 'listCommits').mockResolvedValue({ commits: [] });

    const res = await call('DELETE', `/api/cashouts/commitments/${commitment.id}`);

    expect(res.status).toBe(409);
    expect(list).not.toHaveBeenCalled();
  });
});

describe('Log Purchase when saving fails after the commit', () => {
  it('says it committed, and logging again records it without committing twice', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-ok', quantity: 1 });
    eb.track.mockResolvedValue({});
    const prisma = require('../prisma');
    vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(new Error('connection reset'));

    const first = await purchase(conn, { trackingCodes: [TRACKING] }).catch((e) => e);
    expect(first.message).toContain('Committed to EB Primary and tracking sent');
    expect(harness.db.inventory).toHaveLength(1); // only the fixture
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'active', sale_id: null, tracking_codes: [TRACKING] });

    const second = await purchase(conn, { trackingCodes: [TRACKING] });

    expect(eb.create).toHaveBeenCalledTimes(1);
    expect(eb.track).toHaveBeenCalledTimes(1); // the shared number isn't sent again
    expect(second.commitment).toMatchObject({ id: harness.db.cashoutCommitment[0].id, sale_id: second.sale.id });
    expect(harness.db.inventory).toHaveLength(2);
  });

  it('refuses to attach when the quantity differs, sending nothing', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push(activeRow(conn, { quantity: 3 }));
    const eb = ebWrites();

    await expect(purchase(conn, { quantity: 1, trackingCodes: [TRACKING] })).rejects.toThrow('Log Purchase with quantity 3');
    expect(eb.create).not.toHaveBeenCalled();
    expect(eb.track).not.toHaveBeenCalled();
  });
});

describe('withdraw and change', () => {
  it('withdrawing something EB no longer has marks it withdrawn', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push(activeRow(conn));
    ebWrites().remove.mockRejectedValue(Object.assign(new Error('Not found'), { status: 404 }));

    const res = await call('DELETE', '/api/cashouts/commitments/a1');

    expect(res.status).toBe(200);
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'withdrawn', open_item_id: null });
  });

  it('changing to the same quantity sends nothing', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push(activeRow(conn, { quantity: 2 }));
    const eb = ebWrites();
    const res = await call('PATCH', '/api/cashouts/commitments/a1', { quantity: 2 });
    expect(res.status).toBe(200);
    expect(eb.update).not.toHaveBeenCalled();
  });
});

describe('write log and rate limit', () => {
  it('records every write with its outcome, never the API key', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-1', quantity: 1 });
    eb.track.mockRejectedValue(new Error('Your weekly tracking submission limit has been reached.'));

    await purchase(conn, { trackingCodes: [TRACKING] });

    expect(harness.db.cashoutWriteLog.map((l) => [l.action, l.outcome])).toEqual([['commit', 'ok'], ['tracking', 'failed']]);
    expect(harness.db.cashoutWriteLog[0]).toMatchObject({ external_id: 'eb-1', connection_id: conn.id });
    expect(JSON.stringify(harness.db.cashoutWriteLog)).not.toContain('live_test_key');
  });

  it('stops a burst of writes before they reach EB', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.track.mockResolvedValue({});
    const results = [];
    for (let i = 0; i < 22; i += 1) {
      results.push(await call('POST', `/api/cashouts/connections/${conn.id}/tracking`, { tracking_codes: [`1ZBURST${i}`], description: 'd' }));
    }
    expect(results.filter((r) => r.status === 201)).toHaveLength(20);
    expect(results[21]).toMatchObject({ status: 429 });
    expect(results[21].body.error).toContain('Nothing was sent');
    expect(eb.track).toHaveBeenCalledTimes(20);
  });
});

describe('tracking changed after committing', () => {
  it('offers to send a new number, sends it once, and not again', async () => {
    const conn = seed();
    const eb = ebWrites();
    eb.create.mockResolvedValue({ id: 'eb-1', quantity: 1 });
    eb.track.mockResolvedValue({});
    const { sale, commitment } = await purchase(conn, { trackingCodes: [TRACKING] });

    const edit = await call('PUT', `/api/sales/${sale.id}`, { tracking_number: '1ZNEWNUMBER0001' });
    expect(edit.body.cashout_tracking_changed).toEqual({ commitment_id: commitment.id, tracking_number: '1ZNEWNUMBER0001', cashout: 'EB Primary', account: null });

    const send = await call('POST', `/api/cashouts/commitments/${commitment.id}/tracking`);
    const again = await call('POST', `/api/cashouts/commitments/${commitment.id}/tracking`);

    expect(send.status).toBe(200);
    expect(send.body.sent).toEqual(['1ZNEWNUMBER0001']);
    expect(again.body.sent).toEqual([]);
    expect(eb.track).toHaveBeenCalledTimes(2); // the first send at log time, then this one
    expect(harness.db.cashoutCommitment[0].tracking_codes).toEqual([TRACKING, '1ZNEWNUMBER0001']);

    const unchanged = await call('PUT', `/api/sales/${sale.id}`, { tracking_number: '1ZNEWNUMBER0001', sale_date: '2026-11-19' });
    expect(unchanged.body.cashout_tracking_changed).toBeUndefined();
  });

  it("refuses to send a sale tracking number EB won't accept", async () => {
    const conn = seed();
    harness.db.sales[0].tracking_number = 'not a tracking number!';
    harness.db.cashoutCommitment.push(activeRow(conn, { sale_id: harness.ids.sale }));
    const eb = ebWrites();
    const res = await call('POST', '/api/cashouts/commitments/a1/tracking');
    expect(res.status).toBe(400);
    expect(eb.track).not.toHaveBeenCalled();
  });
});

describe('two items in one box, at the same moment', () => {
  it('sends the shared number once even when both commits run together', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    const eb = ebWrites();
    eb.create.mockImplementation(async (_k, { itemId }) => ({ id: `eb-${itemId}`, quantity: 1 }));
    eb.track.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 20)));
    const a = await purchase(conn, { itemId: '101' });
    const b = await purchase(conn, { itemId: '102' });
    await call('PUT', `/api/sales/${a.sale.id}`, { tracking_number: TRACKING });
    await call('PUT', `/api/sales/${b.sale.id}`, { tracking_number: TRACKING });

    const results = await Promise.all([
      call('POST', `/api/cashouts/commitments/${a.commitment.id}/commit`, {}),
      call('POST', `/api/cashouts/commitments/${b.commitment.id}/commit`, {}),
    ]);

    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(eb.track).toHaveBeenCalledTimes(1);
  });
});

describe('deleting with an active pledge', () => {
  it('says the EB commitment is still active', async () => {
    const conn = seed();
    harness.db.cashoutCommitment.push(activeRow(conn, { sale_id: harness.ids.sale }));
    const res = await call('DELETE', `/api/sales/${harness.ids.sale}`);
    expect(res.status).toBe(200);
    expect(res.body.cashout_warning).toContain('still active');
  });

  it('says nothing for an ordinary purchase', async () => {
    seed();
    const res = await call('DELETE', `/api/inventory/${harness.ids.inventory}`);
    expect(res.status).toBe(200);
    expect(res.body.cashout_warning).toBeUndefined();
  });
});

describe('route errors', () => {
  it("never shows a database error's details", async () => {
    const conn = seed();
    const prisma = require('../prisma');
    vi.spyOn(prisma.cashoutCommitment, 'findFirst').mockRejectedValueOnce(Object.assign(new Error('Invalid `prisma.cashoutCommitment.findFirst()` invocation: secret detail'), { code: 'P2010' }));
    const res = await call('PATCH', '/api/cashouts/commitments/a1', { quantity: 2 });
    expect(res.status).toBe(500);
    expect(res.body.error).not.toContain('secret detail');
    expect(res.body.error).toContain('check Commitments');
    expect(conn).toBeTruthy();
  });
});

describe('MCP write permission', () => {
  const callTool = async (name, args) => {
    const res = await realFetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const { result } = await res.json();
    return { isError: Boolean(result.isError), text: result.content?.[0]?.text };
  };

  it('a key without the permission can\'t commit, withdraw or send tracking', async () => {
    const conn = seed();
    harness.db.apiKey.push({ id: 'qa-api-key', user_id: harness.ids.user, name: 'QA', key_hash: 'qa', key_prefix: 'qa', created_at: new Date(), revoked_at: null, allow_cashout_writes: false });
    harness.db.cashoutCommitment.push(activeRow(conn));
    const eb = ebWrites();

    const results = [
      await callTool('commit_cashout_deal', { deal_id: '2000', item_id: '102', quantity: 1 }),
      await callTool('delete_cashout_commitment', { commitment_id: 'a1' }),
      await callTool('submit_cashout_tracking', { tracking_codes: [TRACKING], description: 'd' }),
    ];

    for (const r of results) {
      expect(r.isError).toBe(true);
      expect(r.text).toContain('Allow cashout writes');
    }
    expect(eb.create).not.toHaveBeenCalled();
    expect(eb.remove).not.toHaveBeenCalled();
    expect(eb.track).not.toHaveBeenCalled();
  });

  it('the owner can turn it on per key, and rotating keeps it', async () => {
    harness.db.apiKey.push({ id: 'k1', user_id: harness.ids.user, name: 'Claude', key_hash: 'h1', key_prefix: 'pt_1', created_at: new Date(), revoked_at: null, allow_cashout_writes: false });
    harness.db.apiKey.push({ id: 'k2', user_id: harness.ids.other, name: 'Theirs', key_hash: 'h2', key_prefix: 'pt_2', created_at: new Date(), revoked_at: null, allow_cashout_writes: false });

    const on = await call('PATCH', '/api/api-keys/k1', { allow_cashout_writes: true });
    const theirs = await call('PATCH', '/api/api-keys/k2', { allow_cashout_writes: true });
    const junk = await call('PATCH', '/api/api-keys/k1', { allow_cashout_writes: 'yes' });
    const rotated = await call('POST', '/api/api-keys/k1/rotate');

    expect(on.body.allow_cashout_writes).toBe(true);
    expect(theirs.status).toBe(404);
    expect(junk.status).toBe(400);
    expect(rotated.body.allow_cashout_writes).toBe(true);
    expect(harness.db.apiKey.find((k) => k.id === 'k2').allow_cashout_writes).toBe(false);
  });
});
