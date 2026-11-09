import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
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
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
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
      await expect(commits.createCommitment(harness.ids.user, conn.id, { dealId: '2000', itemId: '101', quantity: 0 })).rejects.toThrow('positive');
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
    await expect(commits.submitTracking(harness.ids.user, conn.id, { trackingCodes: [], description: 'x' })).rejects.toThrow('tracking code');
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
        .rejects.toThrow('no linked store/platform');
      expect(spy).not.toHaveBeenCalled();
    });

    it('rejects with no tracking number before ever calling the provider', async () => {
      const conn = seed();
      const spy = vi.spyOn(ebAdapter, 'createCommit');
      await expect(logPurchase(harness.ids.user, { ...basePurchaseFields(), connectionId: conn.id, trackingCodes: [] })).rejects.toThrow('tracking number');
      expect(spy).not.toHaveBeenCalled();
    });
  });
});
