// Log Purchase on EB with no tracking number: the purchase and sale are saved
// now, and the commit with EB happens later -- only once the sale gets a
// tracking number and the user confirms. Adding tracking never commits alone.
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

// Logging checks the deal, which caches it; each test then sets the deal it wants.
const logWithoutTracking = async (conn) => logPurchase(harness.ids.user, {
  connectionId: conn.id, dealId: '2000', itemId: '101', dealName: 'PS5 Pro', itemName: 'PS5 Pro',
  quantity: 2, trackingCodes: [],
  vendorId: harness.ids.vendor, paymentMethodId: harness.ids.card,
  unitCost: 400, taxExempt: false, salesTax: 10,
  unitPayout: 480, purchaseDate: '2026-11-08',
}).finally(() => dealsCache.clear());

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
  // The deal as EB lists it now; tests that need another one override this.
  vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
});

const call = async (method, path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const addTracking = (saleId) => call('PUT', `/api/sales/${saleId}`, { tracking_number: TRACKING });

describe('Log Purchase without a tracking number', () => {
  it('records the purchase and sale with a pending commitment, sending nothing to EB', async () => {
    const conn = seed();
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking');

    const result = await logWithoutTracking(conn);

    expect(commitSpy).not.toHaveBeenCalled();
    expect(trackSpy).not.toHaveBeenCalled();
    expect(result.commitPending).toBe(true);
    expect(result.sale.tracking_number).toBeNull();
    expect(result.sale.unit_price).toBe(480);
    expect(result.inventory.qty_purchased).toBe(2);
    expect(result.commitment).toMatchObject({ status: 'pending', external_commitment_id: null, sale_id: result.sale.id, quantity: 2 });
  });

  it('refuses to log the same item twice while one is waiting', async () => {
    const conn = seed();
    await logWithoutTracking(conn);
    await expect(logWithoutTracking(conn)).rejects.toThrow('already logged and waiting');
    expect(harness.db.inventory).toHaveLength(2); // fixture + the first
  });

  it('still requires a tracking number for a cashout that can only be recorded', async () => {
    harness.db.platform.push({ id: 'p4d-group', user_id: harness.ids.user, name: 'P4D', type: 'Cashout', fee_pct: 0, workflow_preset: 'CASHOUT' });
    harness.db.cashoutConnection.push({
      id: 'conn-p4d', user_id: harness.ids.user, provider: 'p4d', display_name: 'Points4Days',
      encrypted_key: encryptKey('x'), key_last4: 'xxxx', status: 'active', platform_id: 'p4d-group',
      created_at: new Date(), updated_at: new Date(),
    });
    await expect(logWithoutTracking({ id: 'conn-p4d' })).rejects.toThrow('tracking number is required');
    expect(harness.db.inventory).toHaveLength(1);
  });
});

describe('adding tracking to a pending sale', () => {
  it('flags the sale for a commit prompt on edit, without committing', async () => {
    const conn = seed();
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    const { sale, commitment } = await logWithoutTracking(conn);

    const res = await addTracking(sale.id);

    expect(res.status).toBe(200);
    expect(res.body.tracking_number).toBe(TRACKING);
    expect(res.body.cashout_commit_pending).toEqual({ commitment_id: commitment.id });
    expect(commitSpy).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment[0].status).toBe('pending');

    // Saving the sale again with the same number doesn't ask again.
    const again = await call('PUT', `/api/sales/${sale.id}`, { tracking_number: TRACKING, sale_date: '2026-11-09' });
    expect(again.body.cashout_commit_pending).toBeUndefined();
  });

  it('flags the sale when tracking comes from the Add Outbound Tracking action', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);

    const res = await call('POST', `/api/sales/${sale.id}/actions/add_outbound_tracking`, { tracking_number: TRACKING });

    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toEqual({ commitment_id: commitment.id });
  });

  it("doesn't flag an ordinary sale", async () => {
    const res = await call('PUT', `/api/sales/${harness.ids.sale}`, { tracking_number: TRACKING });
    expect(res.status).toBe(200);
    expect(res.body.cashout_commit_pending).toBeUndefined();
  });
});

describe('committing a pending purchase', () => {
  it("previews the commit at EB's payout now", async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    await addTracking(sale.id);

    const res = await call('GET', `/api/cashouts/commitments/${commitment.id}/pending`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true, quantity: 2, logged_payout: 480, current_payout: 495,
      tracking_number: TRACKING, item_name: 'PS5 Pro', cashout: 'EB Primary',
    });
  });

  it('commits, sends tracking, and moves the sale to the current payout', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-9', item_id: 101, quantity: 2 });
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    await addTracking(sale.id);

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, { insured_value: 600 });

    expect(res.status).toBe(200);
    expect(commitSpy).toHaveBeenCalledWith(expect.anything(), { itemId: 101, quantity: 2 });
    expect(trackSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ trackingCodes: [TRACKING], insuredValue: 600 }));
    expect(res.body).toMatchObject({ trackingSubmitted: true, payout: 495, previousPayout: 480 });
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'active', external_commitment_id: 'commit-uuid-9', tracking_codes: [TRACKING] });
    expect(harness.db.sales.find((x) => x.id === sale.id).unit_price).toBe(495);

    // A second click doesn't commit again.
    const second = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});
    expect(second.status).toBe(409);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('only commits once when two confirms race', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-11', item_id: 101, quantity: 2 });
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    await addTracking(sale.id);

    const results = await Promise.all([
      call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {}),
      call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {}),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the commitment when only the tracking send fails', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal({ payout: 480 })]);
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-10', item_id: 101, quantity: 2 });
    vi.spyOn(ebAdapter, 'submitTracking').mockRejectedValue(new Error('Your weekly tracking submission limit has been reached.'));
    await addTracking(sale.id);

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ trackingSubmitted: false, previousPayout: null });
    expect(res.body.trackingError).toContain('weekly tracking');
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'active', external_commitment_id: 'commit-uuid-10', tracking_codes: [] });
  });

  it('commits nothing when the deal has closed, and stays pending', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal({ status: 'closed' })]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    await addTracking(sale.id);

    const preview = await call('GET', `/api/cashouts/commitments/${commitment.id}/pending`);
    expect(preview.body).toMatchObject({ available: false, reason: 'This deal has closed.', current_payout: null });

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('Nothing was committed');
    expect(commitSpy).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment[0].status).toBe('pending');
    expect(harness.db.sales.find((x) => x.id === sale.id).unit_price).toBe(480);
  });

  it('commits nothing when the deal is no longer listed', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    await addTracking(sale.id);

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('no longer listed');
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('goes back to pending when EB refuses the commit', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('Over the commit limit.'), { status: 400 }));
    const trackSpy = vi.spyOn(ebAdapter, 'submitTracking');
    await addTracking(sale.id);

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Over the commit limit.');
    expect(trackSpy).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment[0]).toMatchObject({ status: 'pending', external_commitment_id: null });
  });

  it("won't commit before the sale has a tracking number", async () => {
    const conn = seed();
    const { commitment } = await logWithoutTracking(conn);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([liveDeal()]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

    const res = await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {});

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Add a tracking number');
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it("can't see or commit another user's pending purchase", async () => {
    const conn = seed();
    const { commitment } = await logWithoutTracking(conn);
    harness.db.cashoutCommitment[0].user_id = harness.ids.other;
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

    expect((await call('GET', `/api/cashouts/commitments/${commitment.id}/pending`)).status).toBe(404);
    expect((await call('POST', `/api/cashouts/commitments/${commitment.id}/commit`, {})).status).toBe(404);
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('removing a pending one deletes only our row and frees the item to log again', async () => {
    const conn = seed();
    const { sale, commitment } = await logWithoutTracking(conn);
    const deleteSpy = vi.spyOn(ebAdapter, 'deleteCommit');

    const res = await call('DELETE', `/api/cashouts/commitments/${commitment.id}`);

    expect(res.status).toBe(200);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment).toHaveLength(0);
    expect(harness.db.sales.find((x) => x.id === sale.id)).toBeTruthy();
    await expect(logWithoutTracking(conn)).resolves.toMatchObject({ commitPending: true });
  });

  it('changing the quantity of a pending one stays local', async () => {
    const conn = seed();
    const { commitment } = await logWithoutTracking(conn);
    const updateSpy = vi.spyOn(ebAdapter, 'updateCommit');

    const res = await call('PATCH', `/api/cashouts/commitments/${commitment.id}`, { quantity: 3 });

    expect(res.status).toBe(200);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(harness.db.cashoutCommitment[0].quantity).toBe(3);
  });
});
