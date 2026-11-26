// LA and Points4Days are checked once a day (they asked us to slow down; we
// sign in to read their deals). EB keeps its one-minute rhythm.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { encryptKey } = require('../services/cashouts/crypto');
const laAdapter = require('../services/cashouts/la');
const p4dAdapter = require('../services/cashouts/p4d');
const ebAdapter = require('../services/cashouts/eb');
const { dealsCache, syncBlockedUntil, fetchConnectionDeals, syncUserConnection } = require('../services/cashouts/service');
const { runScheduledSync } = require('../services/cashouts/syncScheduler');

const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const HOUR = 60 * 60 * 1000;
const DEALS = [{ id: '700', name: 'Switch 2', payout: 410, retail: 450, status: 'active', items: [] }];

const addConnection = (id, provider, extra = {}) => {
  harness.db.cashoutConnection.push({
    id, user_id: harness.ids.user, provider, display_name: provider.toUpperCase(),
    encrypted_key: encryptKey(provider === 'eb' ? 'live_key_eb' : JSON.stringify({ email: 'qa@example.invalid', password: 'qa-only' })),
    key_last4: '1234', status: 'active', platform_id: null, last_synced_at: null, last_error: null, cached_deals: null,
    created_at: new Date(), updated_at: new Date(), ...extra,
  });
};
const ago = (ms) => new Date(Date.now() - ms);

beforeEach(() => {
  harness.reset();
  dealsCache.clear();
  syncBlockedUntil.clear();
  vi.restoreAllMocks();
  process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
});

describe('once-a-day cashouts (LA, Points4Days)', () => {
  it('are set to a day between checks and an hour between Sync nows; EB is not', () => {
    for (const adapter of [laAdapter, p4dAdapter]) {
      expect(adapter.syncIntervalMs).toBe(24 * HOUR);
      expect(adapter.manualSyncCooldownMs).toBe(HOUR);
    }
    expect(ebAdapter.syncIntervalMs).toBeUndefined();
  });

  it('serves the same deals for a day, then checks again, and saves them on the connection', async () => {
    const spy = vi.spyOn(laAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    addConnection('conn-la', 'la');

    await fetchConnectionDeals(harness.ids.user, 'conn-la');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(harness.db.cashoutConnection.find((c) => c.id === 'conn-la').cached_deals).toEqual(DEALS);

    dealsCache.get('conn-la').fetchedAt = Date.now() - 23 * HOUR;
    const sameDay = await fetchConnectionDeals(harness.ids.user, 'conn-la');
    expect(sameDay.deals).toEqual(DEALS);
    expect(spy).toHaveBeenCalledTimes(1);

    dealsCache.get('conn-la').fetchedAt = Date.now() - 25 * HOUR;
    await fetchConnectionDeals(harness.ids.user, 'conn-la');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('after a restart, uses the saved deals instead of signing in again', async () => {
    const spy = vi.spyOn(p4dAdapter, 'fetchDeals').mockResolvedValue([]);
    addConnection('conn-p4d', 'p4d', { last_synced_at: ago(2 * HOUR), cached_deals: DEALS });

    const result = await fetchConnectionDeals(harness.ids.user, 'conn-p4d');

    expect(spy).not.toHaveBeenCalled();
    expect(result.deals).toEqual(DEALS);
    expect(result.lastUpdated).toBe(harness.db.cashoutConnection[0].last_synced_at.toISOString());
  });

  it('EB still refreshes after a minute and saves no deal list', async () => {
    const spy = vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    addConnection('conn-eb', 'eb');
    await fetchConnectionDeals(harness.ids.user, 'conn-eb');
    dealsCache.get('conn-eb').fetchedAt = Date.now() - 2 * 60 * 1000;
    await fetchConnectionDeals(harness.ids.user, 'conn-eb');
    expect(spy).toHaveBeenCalledTimes(2);
    expect(harness.db.cashoutConnection[0].cached_deals).toBeNull();
  });

  it('Sync now waits an hour after the last check, and says how long in minutes', async () => {
    vi.spyOn(laAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    addConnection('conn-la', 'la', { last_synced_at: ago(10 * 60 * 1000) });
    addConnection('conn-eb', 'eb', { last_synced_at: ago(2 * 60 * 1000) });

    const err = await syncUserConnection(harness.ids.user, 'conn-la').catch((e) => e);
    expect(err.cooldown).toBe(true);
    expect(err.message).toContain('50 min');
    expect(err.message).toContain('LA');
    expect(laAdapter.fetchDeals).not.toHaveBeenCalled();

    await expect(syncUserConnection(harness.ids.user, 'conn-eb')).resolves.toBeTruthy();

    harness.db.cashoutConnection.find((c) => c.id === 'conn-la').last_synced_at = ago(61 * 60 * 1000);
    await expect(syncUserConnection(harness.ids.user, 'conn-la')).resolves.toBeTruthy();
    expect(laAdapter.fetchDeals).toHaveBeenCalledTimes(1);
  });

  it('after a failed check with nothing saved, page loads do not sign in again', async () => {
    const spy = vi.spyOn(laAdapter, 'fetchDeals').mockRejectedValue(Object.assign(new Error('Sign-in failed'), { status: 502 }));
    addConnection('conn-la', 'la');

    await expect(fetchConnectionDeals(harness.ids.user, 'conn-la')).rejects.toThrow('Sign-in failed');
    await expect(fetchConnectionDeals(harness.ids.user, 'conn-la')).rejects.toThrow(/paused/);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('the background sync checks them once a day and skips one waiting out a failure', async () => {
    const la = vi.spyOn(laAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    const p4d = vi.spyOn(p4dAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    const eb = vi.spyOn(ebAdapter, 'fetchDeals').mockResolvedValue(DEALS);
    addConnection('la-recent', 'la', { last_synced_at: ago(3 * HOUR) });
    addConnection('la-due', 'la', { last_synced_at: ago(24 * HOUR) });
    addConnection('p4d-blocked', 'p4d', { last_synced_at: ago(48 * HOUR) });
    addConnection('eb-due', 'eb', { last_synced_at: ago(5 * 60 * 1000) });
    syncBlockedUntil.set('p4d-blocked', Date.now() + HOUR);

    const summary = await runScheduledSync();

    expect(summary).toMatchObject({ total: 4, synced: 2, skipped: 2, failed: 0 });
    expect(la).toHaveBeenCalledTimes(1);
    expect(p4d).not.toHaveBeenCalled();
    expect(eb).toHaveBeenCalledTimes(1);
  });
});
