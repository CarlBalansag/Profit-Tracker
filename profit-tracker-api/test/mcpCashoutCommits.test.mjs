import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const ebAdapter = require('../services/cashouts/eb');
const { dealsCache } = require('../services/cashouts/service');

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CASHOUT_PLATFORM_ID = 'cashout-platform-1';

let server;
let baseUrl;

beforeAll(async () => {
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  server = harness.app().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => server.close());

beforeEach(() => {
  harness.reset();
  vi.restoreAllMocks();
  dealsCache.clear();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'active', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }, { id: '102', name: 'PS5 Pro Digital' }] }]);
  // The QA key is allowed to make cashout writes (off by default for real keys).
  harness.db.apiKey.push({ id: 'qa-api-key', user_id: harness.ids.user, name: 'QA', key_hash: 'qa', key_prefix: 'qa', created_at: new Date(), revoked_at: null, allow_cashout_writes: true });
  harness.db.platform.push({
    id: CASHOUT_PLATFORM_ID, user_id: harness.ids.user, name: 'EB (cashout)', type: 'Cashout',
    fee_pct: 0, workflow_preset: 'CASHOUT',
  });
  harness.db.cashoutConnection.push({
    id: 'conn-1', user_id: harness.ids.user, provider: 'eb', display_name: 'EB Primary',
    encrypted_key: encryptKey('live_test_key_1234'), key_last4: '1234', status: 'active',
    platform_id: CASHOUT_PLATFORM_ID, last_synced_at: new Date(), last_error: null,
    created_at: new Date(), updated_at: new Date(),
  });
});

let nextId = 1;
async function callTool(name, args = {}) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } }),
  });
  const payload = await response.json();
  if (payload.error) return { httpStatus: response.status, rpcError: payload.error };
  const result = payload.result;
  const text = result.content?.[0]?.text;
  const data = text && !result.isError ? JSON.parse(text) : text;
  return { httpStatus: response.status, isError: result.isError || false, data };
}

describe('MCP cashout commits and tracking tools', () => {
  it('commit_cashout_deal commits with the provider and returns the saved commitment', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 3, created_at: 1732924800 });
    const { data } = await callTool('commit_cashout_deal', { deal_id: '2000', item_id: '101', quantity: 3 });
    expect(data.provider_commitment_id).toBe('commit-uuid-1');
    expect(data.quantity).toBe(3);
    expect(data.status).toBe('active');
    expect(data.cashout).toBe('EB Primary');
  });

  it('commit_cashout_deal surfaces the provider\'s real rejection reason', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('You have already committed to this item.'), { code: 'INVALID_OPERATION' }));
    const { isError, data } = await callTool('commit_cashout_deal', { deal_id: '2000', item_id: '101', quantity: 1 });
    expect(isError).toBe(true);
    expect(data).toContain('already committed');
  });

  it('list_cashout_commitments lists what was committed, filterable by status', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    await callTool('commit_cashout_deal', { deal_id: '2000', item_id: '101', quantity: 2 });

    const all = await callTool('list_cashout_commitments', {});
    expect(all.data).toHaveLength(1);
    expect(all.data[0].item_id).toBe('101');

    const withdrawn = await callTool('list_cashout_commitments', { status: 'withdrawn' });
    expect(withdrawn.data).toHaveLength(0);
  });

  it('update_cashout_commitment and delete_cashout_commitment round-trip through our own record id', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    const created = await callTool('commit_cashout_deal', { deal_id: '2000', item_id: '101', quantity: 2 });

    vi.spyOn(ebAdapter, 'updateCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 5, created_at: 1732924800 });
    const updated = await callTool('update_cashout_commitment', { commitment_id: created.data.id, quantity: 5 });
    expect(updated.data.quantity).toBe(5);

    const deleteSpy = vi.spyOn(ebAdapter, 'deleteCommit').mockResolvedValue(null);
    const withdrawn = await callTool('delete_cashout_commitment', { commitment_id: created.data.id });
    expect(deleteSpy).toHaveBeenCalled();
    expect(withdrawn.data.status).toBe('withdrawn');
  });

  it('submit_cashout_tracking reports received codes, and the weekly-cap error without retrying', async () => {
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: ['1Z999AA10123456784'] });
    const ok = await callTool('submit_cashout_tracking', { tracking_codes: ['1Z999AA10123456784'], description: 'Deal #1000' });
    expect(ok.data.received_tracking_codes).toEqual(['1Z999AA10123456784']);

    const spy = vi.spyOn(ebAdapter, 'submitTracking').mockRejectedValue(Object.assign(new Error('Your weekly tracking submission limit has been reached.'), { code: 'TRACKING_SUBMISSIONS_LIMIT_EXCEEDED' }));
    const limited = await callTool('submit_cashout_tracking', { tracking_codes: ['9400111899223397521787'], description: 'Deal #1001' });
    expect(limited.isError).toBe(true);
    expect(limited.data).toContain('weekly');
    expect(spy).toHaveBeenCalledTimes(1); // confirms no auto-retry happened
  });

  it('list_cashout_tracking_submissions returns the provider\'s history', async () => {
    vi.spyOn(ebAdapter, 'listTrackingSubmissions').mockResolvedValue({ tracking_numbers: ['1Z999AA10123456784'], total: 1 });
    const { data } = await callTool('list_cashout_tracking_submissions', {});
    expect(data).toEqual({ tracking_numbers: ['1Z999AA10123456784'], total: 1 });
  });

  it('log_cashout_purchase commits, submits tracking, and records the purchase + sale in one call', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 1, created_at: 1732924800 });
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });

    const { data } = await callTool('log_cashout_purchase', {
      deal_id: '2000', item_id: '101', deal_name: 'PS5 Pro', quantity: 1,
      tracking_codes: ['1Z999AA10123456784'],
      store: 'QA Store', payment_method: 'QA Credit Card',
      unit_cost: 400, unit_payout: 480,
    });

    expect(data.tracking_submitted).toBe(true);
    expect(data.commitment.provider_commitment_id).toBe('commit-uuid-1');
    expect(data.purchase_id).toBeTruthy();
    expect(data.sale_id).toBeTruthy();
    expect(harness.db.inventory.some((i) => i.id === data.purchase_id)).toBe(true);
    expect(harness.db.sales.some((s) => s.id === data.sale_id)).toBe(true);
  });

  it('log_cashout_purchase writes nothing when the commit itself is refused', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('This deal has expired.'), { code: 'INVALID_OPERATION' }));
    const before = harness.db.inventory.length;

    const { isError, data } = await callTool('log_cashout_purchase', {
      deal_id: '2000', item_id: '101', quantity: 1, tracking_codes: ['1Z999AA10123456784'],
      store: 'QA Store', payment_method: 'QA Credit Card', unit_cost: 400, unit_payout: 480,
    });

    expect(isError).toBe(true);
    expect(data).toContain('expired');
    expect(harness.db.inventory).toHaveLength(before);
  });
});

describe('MCP log_cashout_purchase without tracking, then commit_cashout_purchase', () => {
  const purchase = (extra = {}) => ({
    deal_id: '2000', item_id: '101', deal_name: 'PS5 Pro', quantity: 2,
    store: 'QA Store', payment_method: 'QA Credit Card', unit_cost: 400, unit_payout: 480,
    order_number: '112-1234567-7654321', ...extra,
  });
  const qaKey = () => harness.db.apiKey.find((k) => k.id === 'qa-api-key');

  it('logs the purchase + sale with a pending commitment and sends nothing to the cashout', async () => {
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    const trackingSpy = vi.spyOn(ebAdapter, 'submitTracking');
    // Nothing is sent, so a key without cashout writes can do it.
    qaKey().allow_cashout_writes = false;

    const { isError, data } = await callTool('log_cashout_purchase', purchase());

    expect(isError).toBe(false);
    expect(data.mode).toBe('pending');
    expect(data.commitment.status).toBe('pending');
    expect(data.commitment.provider_commitment_id).toBeNull();
    expect(data.commitment.sale_id).toBe(data.sale_id);
    expect(data.order_number).toBe('112-1234567-7654321');
    expect(data.activity_id).toBeTruthy();
    expect(data.commit_activity_id).toBeNull();
    expect(commitSpy).not.toHaveBeenCalled();
    expect(trackingSpy).not.toHaveBeenCalled();

    const inv = harness.db.inventory.find((i) => i.id === data.purchase_id);
    expect(inv.order_number).toBe('112-1234567-7654321');
    expect(inv.qty_purchased).toBe(2);
    const sale = harness.db.sales.find((s) => s.id === data.sale_id);
    expect(sale.platform_id).toBe(CASHOUT_PLATFORM_ID);
    expect(sale.unit_price).toBe(480);
    expect(sale.tracking_number).toBeNull();

    const pending = await callTool('list_cashout_commitments', { status: 'pending' });
    expect(pending.data.map((c) => c.id)).toEqual([data.commitment.id]);
  });

  it('undo_activity removes the purchase, sale and pending commitment', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    const undone = await callTool('undo_activity', { activity_id: logged.data.activity_id, confirm: true });
    expect(undone.isError).toBe(false);
    expect(harness.db.inventory.some((i) => i.id === logged.data.purchase_id)).toBe(false);
    expect(harness.db.sales.some((s) => s.id === logged.data.sale_id)).toBe(false);
    expect(harness.db.cashoutCommitment.some((c) => c.id === logged.data.commitment.id)).toBe(false);
  });

  it('commit_cashout_purchase adds the tracking, commits with the cashout and moves it to active', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-9', item_id: 101, quantity: 2, created_at: 1732924800 });
    const trackingSpy = vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: ['1Z999AA10123456784'] });

    const { isError, data } = await callTool('commit_cashout_purchase', {
      commitment_id: logged.data.commitment.id, tracking_codes: ['1Z999AA10123456784'],
    });

    expect(isError).toBe(false);
    expect(data.committed).toBe(true);
    expect(data.commit_error).toBeNull();
    expect(data.commitment.status).toBe('active');
    expect(data.commitment.provider_commitment_id).toBe('commit-uuid-9');
    expect(data.tracking_submitted).toBe(true);
    expect(data.activity_id).toBeTruthy();
    expect(data.commit_activity_id).toBeTruthy();
    expect(commitSpy).toHaveBeenCalledWith(expect.anything(), { itemId: 101, quantity: 2 });
    expect(trackingSpy).toHaveBeenCalledTimes(1);
    expect(trackingSpy.mock.calls[0][1].trackingCodes).toEqual(['1Z999AA10123456784']);
    expect(harness.db.sales.find((s) => s.id === logged.data.sale_id).tracking_number).toBe('1Z999AA10123456784');

    const again = await callTool('commit_cashout_purchase', { commitment_id: logged.data.commitment.id, tracking_codes: ['1Z999AA10123456784'] });
    expect(again.isError).toBe(true);
    expect(again.data).toContain('already committed');
    expect(commitSpy).toHaveBeenCalledTimes(1);
  });

  it('commit_cashout_purchase also finds the pending commitment by purchase_id and sends every tracking number', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-9', item_id: 101, quantity: 2, created_at: 1732924800 });
    const trackingSpy = vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });

    const { data } = await callTool('commit_cashout_purchase', {
      purchase_id: logged.data.purchase_id, tracking_codes: ['1Z999AA10123456784', '9400111899223397521787'],
    });

    expect(data.committed).toBe(true);
    expect(trackingSpy.mock.calls.flatMap((c) => c[1].trackingCodes)).toEqual(['1Z999AA10123456784', '9400111899223397521787']);
    expect(data.commitment.tracking_codes).toEqual(['1Z999AA10123456784', '9400111899223397521787']);
  });

  it('a refused commit keeps the records, stays pending and returns commit_error', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    vi.spyOn(ebAdapter, 'createCommit').mockRejectedValue(Object.assign(new Error('Quantity exceeds the deal limit.'), { status: 400, code: 'LIMIT_EXCEEDED' }));
    const trackingSpy = vi.spyOn(ebAdapter, 'submitTracking');

    const { isError, data } = await callTool('commit_cashout_purchase', {
      commitment_id: logged.data.commitment.id, tracking_codes: ['1Z999AA10123456784'],
    });

    expect(isError).toBe(false);
    expect(data.committed).toBe(false);
    expect(data.commit_error).toContain('deal limit');
    expect(data.commitment.status).toBe('pending');
    expect(data.commitment.commit_error).toContain('deal limit');
    expect(trackingSpy).not.toHaveBeenCalled();
    expect(harness.db.inventory.some((i) => i.id === logged.data.purchase_id)).toBe(true);
    // The tracking number stays on the sale for the next try.
    expect(harness.db.sales.find((s) => s.id === logged.data.sale_id).tracking_number).toBe('1Z999AA10123456784');
    const row = harness.db.cashoutCommitment.find((c) => c.id === logged.data.commitment.id);
    expect(row.status).toBe('pending');
    expect(row.external_commitment_id).toBeNull();
  });

  it('a closed deal is refused the same way, without calling the cashout', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    dealsCache.clear();
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue([{ id: '2000', name: 'PS5 Pro', payout: 480, status: 'closed', expiresAt: null, items: [{ id: '101', name: 'PS5 Pro' }] }]);
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

    const { data } = await callTool('commit_cashout_purchase', { commitment_id: logged.data.commitment.id, tracking_codes: ['1Z999AA10123456784'] });

    expect(data.committed).toBe(false);
    expect(data.commit_error).toContain('closed');
    expect(data.commitment.status).toBe('pending');
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it('commit_cashout_purchase needs a key allowed to make cashout writes', async () => {
    const logged = await callTool('log_cashout_purchase', purchase());
    qaKey().allow_cashout_writes = false;
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');
    const { isError, data } = await callTool('commit_cashout_purchase', { commitment_id: logged.data.commitment.id, tracking_codes: ['1Z999AA10123456784'] });
    expect(isError).toBe(true);
    expect(data).toContain('Allow cashout writes');
    expect(commitSpy).not.toHaveBeenCalled();
    expect(harness.db.sales.find((s) => s.id === logged.data.sale_id).tracking_number).toBeNull();
  });

  it('refuses the same order_number for the same deal item, in either mode, before anything is sent', async () => {
    const first = await callTool('log_cashout_purchase', purchase());
    const before = harness.db.inventory.length;
    const commitSpy = vi.spyOn(ebAdapter, 'createCommit');

    const again = await callTool('log_cashout_purchase', purchase({ order_number: ' 112-1234567-7654321 ' }));
    expect(again.isError).toBe(true);
    expect(again.data).toContain('already logged');
    expect(again.data).toContain(first.data.purchase_id);

    const withTracking = await callTool('log_cashout_purchase', purchase({ tracking_codes: ['1Z999AA10123456784'] }));
    expect(withTracking.isError).toBe(true);
    expect(withTracking.data).toContain('already logged');
    expect(commitSpy).not.toHaveBeenCalled();
    expect(harness.db.inventory).toHaveLength(before);

    // The same order's other item is its own purchase.
    const otherItem = await callTool('log_cashout_purchase', purchase({ item_id: '102' }));
    expect(otherItem.isError).toBe(false);
    expect(harness.db.inventory).toHaveLength(before + 1);
  });

  it('with tracking still commits in one call, and stores order_number and an activity id', async () => {
    vi.spyOn(ebAdapter, 'createCommit').mockResolvedValue({ id: 'commit-uuid-1', item_id: 101, quantity: 2, created_at: 1732924800 });
    vi.spyOn(ebAdapter, 'submitTracking').mockResolvedValue({ received_tracking_codes: [] });
    const { data } = await callTool('log_cashout_purchase', purchase({ tracking_codes: ['1Z999AA10123456784'] }));
    expect(data.mode).toBe('committed');
    expect(data.commitment.status).toBe('active');
    expect(data.order_number).toBe('112-1234567-7654321');
    expect(data.activity_id).toBeTruthy();
    expect(data.commit_activity_id).toBeTruthy();
  });
});
