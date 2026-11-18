// A pending cashout purchase whose tracking goes on the purchase (the store
// ships straight to EB), and two items in one box sharing a tracking number.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const ebAdapter = require('../services/cashouts/eb');
const { logPurchase } = require('../services/cashouts/logPurchase');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CASHOUT_PLATFORM_ID = 'cashout-platform-1';
const TRACKING = '1Z999AA10123456784';

function seed() {
  harness.db.platform.push({
    id: CASHOUT_PLATFORM_ID, user_id: harness.ids.user, name: 'EB (cashout)', type: 'Cashout',
    fee_pct: 0, workflow_preset: 'CASHOUT',
  });
  const conn = {
    id: 'conn-1', user_id: harness.ids.user, provider: 'eb', display_name: 'EB Primary',
    encrypted_key: encryptKey('live_test_key_1234'), key_last4: '1234', status: 'active',
    platform_id: CASHOUT_PLATFORM_ID, last_synced_at: new Date(), last_error: null,
    created_at: new Date(), updated_at: new Date(),
  };
  harness.db.cashoutConnection.push(conn);
  return conn;
}

const liveDeal = (overrides = {}) => ({
  id: '2000', name: 'PS5 Pro', payout: 495, retail: 400, status: 'active',
  expiresAt: new Date(Date.now() + 86400000).toISOString(),
  items: [{ id: '101', name: 'PS5 Pro' }],
  ...overrides,
});

const logWithoutTracking = (conn, itemId = '101') => logPurchase(harness.ids.user, {
  connectionId: conn.id, dealId: '2000', itemId, dealName: 'PS5 Pro', itemName: 'PS5 Pro',
  quantity: 2, trackingCodes: [],
  vendorId: harness.ids.vendor, paymentMethodId: harness.ids.card,
  unitCost: 400, taxExempt: false, salesTax: 10,
  unitPayout: 480, purchaseDate: '2026-11-08',
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
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};



const commitmentFor = (id) => harness.db.cashoutCommitment.find((c) => c.id === id);

describe('tracking added to the purchase of a pending cashout sale', () => {
  it('asks whether it ships straight to the cashout, without copying or committing', async () => {
    const conn = seed();
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    const { inventory, sale, commitment } = await logWithoutTracking(conn);

    const res = await call('PUT', `/api/inventory/${inventory.id}`, { tracking_number: TRACKING });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toEqual({
      commitment_id: commitment.id,
      ask_direct: { sale_id: sale.id, tracking_number: TRACKING, cashout: 'EB Primary' },
    });
    expect(harness.db.sales.find((s) => s.id === sale.id).tracking_number).toBeNull();
    expect(commitSpy).not.toHaveBeenCalled();
    expect(commitmentFor(commitment.id).status).toBe('pending');

    // Saving the same number again doesn't ask again.
    const again = await call('PUT', `/api/inventory/${inventory.id}`, { tracking_number: TRACKING, order_number: 'A-1' });
    expect(again.body.cashout_commit_pending).toBeUndefined();
  });

  it("doesn't ask once the sale has its own tracking number", async () => {
    const conn = seed();
    const { inventory, sale } = await logWithoutTracking(conn);
    await call('PUT', `/api/sales/${sale.id}`, { tracking_number: 'OUTBOUND123' });

    const res = await call('PUT', `/api/inventory/${inventory.id}`, { tracking_number: TRACKING });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toBeUndefined();
  });

  it('asks when the tracking comes from the purchase Add Tracking action', async () => {
    const conn = seed();
    const { inventory, sale, commitment } = await logWithoutTracking(conn);

    const res = await call('POST', `/api/inventory/${inventory.id}/actions/add_tracking`, { tracking_number: TRACKING });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toMatchObject({ commitment_id: commitment.id, ask_direct: { sale_id: sale.id } });
  });

  it("doesn't ask for an ordinary purchase", async () => {
    const res = await call('PUT', `/api/inventory/${harness.ids.inventory}`, { tracking_number: TRACKING });
    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toBeUndefined();
  });

  it('asks when the tracking comes from the transaction editor', async () => {
    const conn = seed();
    const { inventory, sale, commitment } = await logWithoutTracking(conn);

    const res = await call('PUT', `/api/inventory/${inventory.id}/transaction`, {
      inventory: { tracking_number: TRACKING }, sales: [{ id: sale.id }],
    });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toMatchObject({ commitment_id: commitment.id, ask_direct: { sale_id: sale.id } });
  });

  it('offers the plain commit when the transaction editor adds tracking to the sale', async () => {
    const conn = seed();
    const { inventory, sale, commitment } = await logWithoutTracking(conn);

    const res = await call('PUT', `/api/inventory/${inventory.id}/transaction`, {
      inventory: {}, sales: [{ id: sale.id, tracking_number: TRACKING }],
    });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toEqual({ commitment_id: commitment.id });
  });

  it('"Yes" copies the number onto the sale, which then offers the commit', async () => {
    const conn = seed();
    const { inventory, sale, commitment } = await logWithoutTracking(conn);
    const first = await call('PUT', `/api/inventory/${inventory.id}`, { tracking_number: TRACKING });

    const res = await call('PUT', `/api/sales/${first.body.cashout_commit_pending.ask_direct.sale_id}`, { tracking_number: TRACKING });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toEqual({ commitment_id: commitment.id });
    expect(harness.db.sales.find((s) => s.id === sale.id).tracking_number).toBe(TRACKING);
  });
});

describe('two items in one box', () => {
  const twoItemDeal = () => liveDeal({ items: [{ id: '101', name: 'PS5 Pro' }, { id: '102', name: 'PS5 Pro (open box)' }] });

  it('sends the shared tracking number to EB only once', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([twoItemDeal()]);
    vi.spyOn(ebAdapter, 'createCommit')
      .mockResolvedValueOnce({ id: 'commit-a', item_id: 101, quantity: 2 })
      .mockResolvedValueOnce({ id: 'commit-b', item_id: 102, quantity: 2 });
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    const a = await logWithoutTracking(conn, '101');
    const b = await logWithoutTracking(conn, '102');
    await call('PUT', `/api/sales/${a.sale.id}`, { tracking_number: TRACKING });
    await call('PUT', `/api/sales/${b.sale.id}`, { tracking_number: TRACKING.toLowerCase() });

    const first = await call('POST', `/api/cashouts/commitments/${a.commitment.id}/commit`, {});
    const second = await call('POST', `/api/cashouts/commitments/${b.commitment.id}/commit`, {});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ trackingSubmitted: true, trackingShared: false });
    expect(second.body).toMatchObject({ trackingSubmitted: true, trackingShared: true });
    expect(trackSpy).toHaveBeenCalledTimes(1);
    expect(commitmentFor(b.commitment.id)).toMatchObject({ status: 'active', external_commitment_id: 'commit-b' });
    expect(commitmentFor(b.commitment.id).tracking_submitted_at).toBeTruthy();
  });

  it('Log Purchase with a number already sent commits but only sends the new ones', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([twoItemDeal()]);
    vi.spyOn(ebAdapter, 'createCommit')
      .mockResolvedValueOnce({ id: 'commit-a', item_id: 101, quantity: 1 })
      .mockResolvedValueOnce({ id: 'commit-b', item_id: 102, quantity: 1 });
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    const withTracking = (itemId, codes) => logPurchase(harness.ids.user, {
      connectionId: conn.id, dealId: '2000', itemId, dealName: 'PS5 Pro', itemName: 'PS5 Pro',
      quantity: 1, trackingCodes: codes,
      vendorId: harness.ids.vendor, paymentMethodId: harness.ids.card,
      unitCost: 400, taxExempt: false, salesTax: 0, unitPayout: 480, purchaseDate: '2026-11-08',
    });

    const a = await withTracking('101', [TRACKING]);
    const b = await withTracking('102', [TRACKING, 'SECONDBOX1']);

    expect(a).toMatchObject({ trackingSubmitted: true, trackingShared: false });
    expect(b).toMatchObject({ trackingSubmitted: true, trackingShared: true });
    expect(trackSpy).toHaveBeenCalledTimes(2);
    expect(trackSpy.mock.calls[1][1].trackingCodes).toEqual(['SECONDBOX1']);
    expect(b.commitment.tracking_codes).toEqual([TRACKING, 'SECONDBOX1']);
  });

  it('still sends a number that only failed to send before', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([twoItemDeal()]);
    vi.spyOn(ebAdapter, 'createCommit')
      .mockResolvedValueOnce({ id: 'commit-a', item_id: 101, quantity: 2 })
      .mockResolvedValueOnce({ id: 'commit-b', item_id: 102, quantity: 2 });
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking')
      .mockRejectedValueOnce(new Error('EB is down'))
      .mockResolvedValueOnce({ received_tracking_codes: [] });
    const a = await logWithoutTracking(conn, '101');
    const b = await logWithoutTracking(conn, '102');
    await call('PUT', `/api/sales/${a.sale.id}`, { tracking_number: TRACKING });
    await call('PUT', `/api/sales/${b.sale.id}`, { tracking_number: TRACKING });

    await call('POST', `/api/cashouts/commitments/${a.commitment.id}/commit`, {});
    const second = await call('POST', `/api/cashouts/commitments/${b.commitment.id}/commit`, {});

    expect(second.body).toMatchObject({ trackingSubmitted: true, trackingShared: false });
    expect(trackSpy).toHaveBeenCalledTimes(2);
  });
});
