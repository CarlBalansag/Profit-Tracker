import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const { dealsCache } = require('../services/cashouts/service');
const ebAdapter = require('../services/cashouts/eb');
const commits = require('../services/cashouts/commits');
const { logPurchase } = require('../services/cashouts/logPurchase');

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CASHOUT_PLATFORM_ID = 'cashout-platform-1';

function seed() {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
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

const basePurchaseFields = () => ({
  dealId: '2000', itemId: '101', dealName: 'PS5 Pro', itemName: 'PS5 Pro',
  quantity: 2, trackingCodes: ['1Z999AA10123456784'], insuredValue: 500,
  vendorId: harness.ids.vendor, paymentMethodId: harness.ids.card,
  unitCost: 400, taxExempt: false, salesTax: 10,
  unitPayout: 480, purchaseDate: '2026-11-08', saleDate: '2026-11-08',
});

describe('cashout commits and tracking', () => {
  beforeEach(() => {
    harness.reset();
    vi.restoreAllMocks();
    dealsCache.clear();
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    // The deal as EB lists it: every write checks the item is part of it.
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }, { id: '102', name: 'PS5 Pro Digital' }] }]);
  });

  describe('createCommitment', () => {
    it('commits with the provider and saves the link locally', async () => {
      const conn = seed();
      vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });

      const record = await commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 });

      expect(record.external_commitment_id).toBe('commit-uuid-1');
      expect(record.external_deal_id).toBe('2000');
      expect(record.external_item_id).toBe('101');
      expect(record.quantity).toBe(2);
      expect(record.status).toBe('active');
      expect(harness.db.cashoutCommitment).toHaveLength(1);
    });

    it('does not create a local row when the provider rejects the commit', async () => {
      const conn = seed();
      vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('Already committed to this item'), { code: 'INVALID_OPERATION' }));

      await expect(commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 }))
        .rejects.toThrow('Already committed');
      expect(harness.db.cashoutCommitment).toHaveLength(0);
    });

    it('rejects a quantity of 0 before ever calling the provider', async () => {
      const conn = seed();
      const spy = vi.spyOn(ebAdapter, 'createCommit');
      await expect(commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 0 })).rejects.toThrow('whole number');
      expect(spy).not.toHaveBeenCalled();
    });
  });

  it('updateCommitment changes the quantity with the provider and locally', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    const record = await commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 });

    vi.spyOn(ebAdapter, 'updateCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 5, created_at: 1732924800 });
    const updated = await commits.updateCommitment(harness.ids.user, record.id, { quantity: 5 });
    expect(updated.quantity).toBe(5);
  });

  it('deleteCommitment withdraws with the provider and marks the local row withdrawn, not deleted', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    const record = await commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 });

    const deleteSpy = vi.spyOn(ebAdapter, 'deleteCommit').mockResolvedValue(null);
    const withdrawn = await commits.deleteCommitment(harness.ids.user, record.id);
    expect(deleteSpy).toHaveBeenCalledWith(expect.any(String), 'commit-uuid-1');
    expect(withdrawn.status).toBe('withdrawn');
    expect(harness.db.cashoutCommitment).toHaveLength(1); // still there, not removed
  });

  it('listLocalCommitments includes the connection and linked sale', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    await commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 });

    const list = await commits.listLocalCommitments(harness.ids.user, {});
    expect(list).toHaveLength(1);
    expect(list[0].connection.id).toBe(conn.id);
  });

  it('submitTracking requires at least one code before calling the provider', async () => {
    const conn = seed();
    const spy = vi.spyOn(ebAdapter, 'submitTracking');
    await expect(commits.submitTracking(harness.ids.user, conn.id, { trackingCodes: [], description: 'x' })).rejects.toThrow('tracking number');
    expect(spy).not.toHaveBeenCalled();
  });

  describe('logPurchase', () => {
    it('commits, submits tracking, and writes the purchase and sale together', async () => {
      const conn = seed();
      vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
      vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });

      const result = await logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id });

      expect(result.trackingSubmitted).toBe(true);
      expect(result.trackingError).toBeNull();
      expect(result.inventory.product_name).toBe('PS5 Pro');
      expect(result.inventory.qty_purchased).toBe(2);
      expect(result.inventory.qty_on_hand).toBe(0);
      expect(result.sale.platform_id).toBe(CASHOUT_PLATFORM_ID);
      expect(result.sale.unit_price).toBe(480);
      expect(result.sale.tracking_number).toBe('1Z999AA10123456784');
      expect(result.sale.status).toBe('SHIPPED_OUT');
      expect(result.sale.workflow_status).toBe('OUTBOUND');
      expect(result.commitment.sale_id).toBe(result.sale.id);
      expect(result.commitment.tracking_codes).toEqual(['1Z999AA10123456784']);
      expect(harness.db.inventory).toHaveLength(2); // fixture + mine
      expect(harness.db.sales).toHaveLength(2); // fixture + mine
      expect(harness.db.cashoutCommitment).toHaveLength(1);
    });

    it('writes nothing at all when the provider refuses the commit', async () => {
      const conn = seed();
      vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('This deal is closed.'), { code: 'INVALID_OPERATION' }));
      const submitSpy = vi.spyOn(ebAdapter, 'submitTracking');

      await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id })).rejects.toThrow('closed');

      expect(submitSpy).not.toHaveBeenCalled();
      expect(harness.db.inventory).toHaveLength(1); // fixture only
      expect(harness.db.sales).toHaveLength(1); // fixture only
      expect(harness.db.cashoutCommitment).toHaveLength(0);
    });

    it('still saves the purchase, sale, and commitment when only the tracking submission fails', async () => {
      const conn = seed();
      vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
      vi.spyOn(ebAdapter, 'submitTracking').mockRejectedValue(Object.assign(new Error('Your weekly tracking submission limit has been reached.'), { code: 'TRACKING_SUBMISSIONS_LIMIT_EXCEEDED' }));

      const result = await logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id });

      expect(result.trackingSubmitted).toBe(false);
      expect(result.trackingError).toContain('weekly tracking submission limit');
      expect(harness.db.inventory).toHaveLength(2); // fixture + mine
      expect(harness.db.sales).toHaveLength(2); // fixture + mine
      expect(harness.db.cashoutCommitment).toHaveLength(1);
      expect(harness.db.cashoutCommitment[0].tracking_error).toContain('weekly');
      expect(harness.db.cashoutCommitment[0].tracking_codes).toEqual([]);
    });

    it('rejects when the cashout has no linked platform to sell to', async () => {
      process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
      const conn = { id: 'conn-no-platform', user_id: harness.ids.user, provider: 'eb', display_name: 'EB No Platform',
        encrypted_key: encryptKey('live_test_key_9999'), key_last4: '9999', status: 'active',
        platform_id: null, last_synced_at: new Date(), created_at: new Date(), updated_at: new Date() };
      harness.db.cashoutConnection.push(conn);
      const spy = vi.spyOn(ebAdapter, 'createCommit');

      await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id }))
        .rejects.toThrow('Pick which cashout group');
      expect(spy).not.toHaveBeenCalled();
    });

    // No tracking number no longer refuses: it logs without committing. The
    // full commit-later flow is in cashoutPendingCommit.test.mjs.
    it('never calls the provider without a tracking number', async () => {
      const conn = seed();
      const spy = vi.spyOn(ebAdapter, 'createCommit');
      const result = await logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, trackingCodes: [] });
      expect(spy).not.toHaveBeenCalled();
      expect(result.commitPending).toBe(true);
      expect(result.commitment.status).toBe('pending');
    });

    it('sells to the cashout group the form picked when the connection has none linked', async () => {
      const conn = seed();
      conn.platform_id = null;
      vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
      vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });

      const result = await logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, platformId: CASHOUT_PLATFORM_ID });
      expect(result.sale.platform_id).toBe(CASHOUT_PLATFORM_ID);
    });

    it("refuses to sell to a store, or to a group that isn't yours, before calling the provider", async () => {
      const conn = seed();
      const spy = vi.spyOn(ebAdapter, 'createCommit');
      harness.db.platform.push({ id: 'other-users-group', user_id: 'someone-else', name: 'Theirs', type: 'Cashout' });

      await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, platformId: harness.ids.vendor }))
        .rejects.toThrow('cashout groups');
      await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, platformId: 'other-users-group' }))
        .rejects.toMatchObject({ status: expect.any(Number) });
      expect(spy).not.toHaveBeenCalled();
      expect(harness.db.inventory).toHaveLength(1); // fixture only
    });

    describe('LA and Points4Days (no commitments yet)', () => {
      function seedP4d(provider = 'p4d') {
        process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
        harness.db.platform.push({ id: 'p4d-group', user_id: harness.ids.user, name: 'POINTS4DAYS', type: 'Cashout', fee_pct: 0, workflow_preset: 'CASHOUT' });
        const conn = {
          id: 'conn-p4d', user_id: harness.ids.user, provider, display_name: null,
          encrypted_key: encryptKey(JSON.stringify({ email: 'buyer@example.com', password: 'pw' })), key_last4: 'bu•••@example.com',
          status: 'active', platform_id: null, last_synced_at: new Date(), last_error: null, created_at: new Date(), updated_at: new Date(),
        };
        harness.db.cashoutConnection.push(conn);
        return conn;
      }

      it.each(['la', 'p4d'])('saves the %s purchase and sale without a tracking number, and never calls the cashout', async (provider) => {
        for (const trackingCodes of [[], ['   '], undefined]) {
          harness.reset();
          const conn = seedP4d(provider);
          const fetchSpy = vi.fn();
          vi.stubGlobal('fetch', fetchSpy);

          const result = await logPurchase(harness.ids.user, {
            ...basePurchaseFields(), connectionId: conn.id, trackingCodes, platformId: 'p4d-group', unitPayout: 1222,
          });

          expect(fetchSpy).not.toHaveBeenCalled();
          expect(result).toMatchObject({ recordedOnly: true, commitPending: false, trackingSubmitted: false });
          expect(result.commitment).toBeNull();
          expect(result.sale).toMatchObject({ platform_id: 'p4d-group', unit_price: 1222, tracking_number: null, status: 'SOLD', workflow_status: 'AWAITING_SHIPMENT' });
          expect(result.inventory).toMatchObject({ qty_purchased: 2, qty_on_hand: 0 });
          expect(harness.db.inventory).toHaveLength(2); // fixture + this
          expect(harness.db.sales).toHaveLength(2);
          expect(harness.db.cashoutCommitment).toHaveLength(0);
          vi.unstubAllGlobals();
        }
      });

      it('saves the purchase and sale with the tracking number, and never calls Points4Days', async () => {
        const conn = seedP4d();
        const fetchSpy = vi.fn();
        vi.stubGlobal('fetch', fetchSpy);

        const result = await logPurchase(harness.ids.user, {
          ...basePurchaseFields(), connectionId: conn.id, trackingCodes: [' 1Z999AA10123456784 '], platformId: 'p4d-group', unitPayout: 1222,
        });

        expect(fetchSpy).not.toHaveBeenCalled();
        expect(result.recordedOnly).toBe(true);
        expect(result.commitment).toBeNull();
        expect(result.trackingSubmitted).toBe(false);
        expect(result.sale.platform_id).toBe('p4d-group');
        expect(result.sale.unit_price).toBe(1222);
        expect(result.sale.tracking_number).toBe('1Z999AA10123456784');
        expect(result.sale.status).toBe('SHIPPED_OUT');
        expect(result.inventory.qty_purchased).toBe(2);
        expect(harness.db.cashoutCommitment).toHaveLength(0);
        vi.unstubAllGlobals();
      });

      it('still needs a cashout group, store and payment method', async () => {
        const conn = seedP4d();
        await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, trackingCodes: ['1Z999AA10123456784'] }))
          .rejects.toThrow('Pick which cashout group');
        await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, platformId: 'p4d-group', vendorId: '' }))
          .rejects.toThrow('Store is required');
        expect(harness.db.inventory).toHaveLength(1); // fixture only
      });
    });
  });

  // The form and the route have to agree on field names: the service tests
  // above call logPurchase directly, so they can't catch a body the route
  // doesn't read. This sends exactly what the Log Purchase form sends.
  describe('POST /connections/:id/log-purchase', () => {
    let server;
    let baseUrl;
    beforeAll(async () => {
      server = harness.app().listen(0, '127.0.0.1');
      await new Promise((resolve) => server.once('listening', resolve));
      baseUrl = `http://127.0.0.1:${server.address().port}`;
    });
    afterAll(() => server.close());

    const post = async (connId, body) => {
      const res = await fetch(`${baseUrl}/api/cashouts/connections/${connId}/log-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json() };
    };

    const formBody = () => ({
      deal_id: '2000', item_id: '101', deal_name: 'PS5 Pro', item_name: 'PS5 Pro',
      quantity: 2, tracking_codes: ['1Z999AA10123456784'], insured_value: 500,
      vendor_id: harness.ids.vendor, payment_method_id: harness.ids.card,
      unit_cost: 400, tax_exempt: false, sales_tax: 10,
      cashback_rate: 2, cashback_earned: 16, unit_payout: 480, purchase_date: '2026-11-08',
    });

    it('commits, sends tracking and saves the purchase and sale from the form body', async () => {
      const conn = seed();
      const commitSpy = vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
      vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });

      const res = await post(conn.id, formBody());

      expect(res.status).toBe(201);
      expect(commitSpy).toHaveBeenCalledTimes(1);
      expect(res.body.trackingSubmitted).toBe(true);
      expect(res.body.inventory.vendor_id).toBe(harness.ids.vendor);
      expect(res.body.inventory.payment_method_id).toBe(harness.ids.card);
      expect(res.body.inventory.qty_purchased).toBe(2);
      expect(res.body.inventory.cashback_earned).toBe(16);
      expect(res.body.sale.platform_id).toBe(CASHOUT_PLATFORM_ID);
      expect(res.body.sale.unit_price).toBe(480);
      expect(res.body.commitment.sale_id).toBe(res.body.sale.id);
    });

    it('rejects a missing store or card before calling EB, saving nothing', async () => {
      const conn = seed();
      const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

      const noStore = await post(conn.id, { ...formBody(), vendor_id: undefined });
      expect(noStore.status).toBe(400);
      expect(noStore.body.error).toBe('Store is required.');
      const noCard = await post(conn.id, { ...formBody(), payment_method_id: undefined });
      expect(noCard.status).toBe(400);
      expect(noCard.body.error).toBe('Payment method is required.');

      expect(commitSpy).not.toHaveBeenCalled();
      expect(harness.db.inventory).toHaveLength(1); // fixture only
      expect(harness.db.cashoutCommitment).toHaveLength(0);
    });

    it("won't use another user's store or card", async () => {
      const conn = seed();
      harness.db.paymentMethod.push({ id: 'foreign-card', user_id: harness.ids.other, name: 'Not mine', type: 'Credit' });
      const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

      const foreignStore = await post(conn.id, { ...formBody(), vendor_id: harness.ids.foreign });
      expect(foreignStore.status).toBeGreaterThanOrEqual(400);
      const foreignCard = await post(conn.id, { ...formBody(), payment_method_id: 'foreign-card' });
      expect(foreignCard.status).toBeGreaterThanOrEqual(400);

      expect(commitSpy).not.toHaveBeenCalled();
      expect(harness.db.inventory).toHaveLength(1);
    });
  });
});

describe('deal end dates for the To-Do list', () => {
  const ENDS = '2026-12-01T05:00:00.000Z';
  const { syncDealEnds } = require('../services/cashouts/dealEnds');

  beforeEach(() => {
    harness.reset();
    vi.restoreAllMocks();
    dealsCache.clear();
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: ENDS, items: [{ id: '101', name: 'PS5 Pro' }] }]);
  });

  it('saves when the deal ends on a commitment made now', async () => {
    const conn = seed();
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    const record = await commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 2 });
    expect(record.deal_expires_at.toISOString()).toBe(ENDS);
  });

  it('saves it on a purchase logged to commit later', async () => {
    const conn = seed();
    const result = await logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, trackingCodes: [] });
    expect(result.commitment.status).toBe('pending');
    expect(harness.db.cashoutCommitment[0].deal_expires_at.toISOString()).toBe(ENDS);
  });

  it('refreshes open commitments from the deal list, leaving closed ones and other deals alone', async () => {
    const conn = seed();
    const row = (fields) => harness.db.cashoutCommitment.push({
      id: `c-${harness.db.cashoutCommitment.length}`, user_id: harness.ids.user, connection_id: conn.id, external_deal_id: '2000',
      external_item_id: '101', quantity: 1, status: 'active', deal_expires_at: null, ...fields,
    });
    row({});
    row({ status: 'withdrawn' });
    row({ external_deal_id: '9999' });
    row({ status: 'pending', deal_expires_at: new Date(ENDS) });
    const changed = await syncDealEnds(harness.ids.user, conn.id, [{ id: '2000', expiresAt: ENDS }, { id: '9999', expiresAt: null }]);
    expect(changed).toBe(1);
    expect(harness.db.cashoutCommitment.map((c) => c.deal_expires_at?.toISOString() ?? null)).toEqual([ENDS, null, null, ENDS]);
  });
});
