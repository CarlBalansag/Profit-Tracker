const prisma = require('../../prisma');
const { requireOwned } = require('../ownership');
const { encryptKey, decryptKey, maskKey } = require('./crypto');
const { getAdapter } = require('./registry');

// In-memory cache for live deals per connection
// Key: connectionId -> { deals: CashoutDeal[], fetchedAt: number, error: string | null }
const dealsCache = new Map();

// After a failed provider request, no new attempt until this time (epoch ms), so
// repeated clicks and page refreshes can't hammer a provider that is down or
// rate limiting us. Key: connectionId
const syncBlockedUntil = new Map();

// 60-second TTL for cache and manual sync cooldown
const CACHE_TTL_MS = 60 * 1000;
const MANUAL_SYNC_COOLDOWN_MS = 60 * 1000;
const RETENTION_DAYS = 90;

function safeConnection(conn) {
  if (!conn) return null;
  return {
    id: conn.id,
    provider: conn.provider,
    displayName: conn.display_name,
    keyLast4: conn.key_last4,
    status: conn.status,
    platformId: conn.platform_id,
    platformName: conn.platform?.name || null,
    lastSyncedAt: conn.last_synced_at,
    lastError: conn.last_error,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}

async function listConnections(userId) {
  const connections = await prisma.cashoutConnection.findMany({
    where: { user_id: userId },
    include: { platform: { select: { id: true, name: true } } },
    orderBy: { created_at: 'desc' },
  });
  return connections.map(safeConnection);
}

async function getConnection(userId, connectionId) {
  const conn = await prisma.cashoutConnection.findFirst({
    where: { id: connectionId, user_id: userId },
    include: { platform: { select: { id: true, name: true } } },
  });
  if (!conn) {
    const error = new Error('Cashout connection not found or access denied');
    error.status = 404;
    throw error;
  }
  return conn;
}

async function createConnection(userId, { provider, displayName, apiKey, platformId }) {
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.trim()) {
    const error = new Error('API key is required.');
    error.status = 400;
    throw error;
  }

  const adapter = getAdapter(provider, userId);

  // One key per provider: a second would list every deal twice. A new key
  // replaces the old one on the existing connection.
  const existing = await prisma.cashoutConnection.findFirst({ where: { user_id: userId, provider } });
  if (existing) {
    const error = new Error('This cashout is already connected. Replace its key instead.');
    error.status = 409;
    throw error;
  }

  if (platformId) {
    await requireOwned('platform', platformId, userId, 'Platform');
  }

  // Pre-flight check: verify the key with the provider before saving
  await adapter.testKey(apiKey.trim());

  // A key that actually works is the real gate now -- CASHOUT_BETA_USER_IDS is
  // gone. This is idempotent, so it's safe to set on every successful add.
  await prisma.user.update({ where: { id: userId }, data: { cashout_access_granted: true } });

  // Encrypt the key
  const encryptedKey = encryptKey(apiKey.trim());
  const keyLast4 = maskKey(apiKey);

  const created = await prisma.cashoutConnection.create({
    data: {
      user_id: userId,
      provider,
      display_name: displayName ? displayName.trim() : null,
      encrypted_key: encryptedKey,
      key_last4: keyLast4,
      platform_id: platformId || null,
      status: 'active',
      last_synced_at: new Date(),
    },
    include: { platform: { select: { id: true, name: true } } },
  });

  return safeConnection(created);
}

async function updateConnection(userId, connectionId, { displayName, apiKey, platformId }) {
  const conn = await getConnection(userId, connectionId);
  const adapter = getAdapter(conn.provider, userId);

  const updateData = {};

  if (displayName !== undefined) {
    updateData.display_name = displayName ? displayName.trim() : null;
  }

  if (platformId !== undefined) {
    if (platformId) {
      await requireOwned('platform', platformId, userId, 'Platform');
      updateData.platform_id = platformId;
    } else {
      updateData.platform_id = null;
    }
  }

  if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
    await adapter.testKey(apiKey.trim());
    updateData.encrypted_key = encryptKey(apiKey.trim());
    updateData.key_last4 = maskKey(apiKey);
    updateData.status = 'active';
    updateData.last_error = null;
    updateData.last_synced_at = new Date();
    dealsCache.delete(connectionId);
    syncBlockedUntil.delete(connectionId);
  }

  const updated = await prisma.cashoutConnection.update({
    where: { id: connectionId },
    data: updateData,
    include: { platform: { select: { id: true, name: true } } },
  });

  return safeConnection(updated);
}

async function testConnection(userId, connectionId) {
  const conn = await getConnection(userId, connectionId);
  const adapter = getAdapter(conn.provider, userId);

  try {
    const rawKey = decryptKey(conn.encrypted_key);
    await adapter.testKey(rawKey);

    const updated = await prisma.cashoutConnection.update({
      where: { id: connectionId },
      data: {
        status: 'active',
        last_error: null,
      },
    });

    // Same idempotent grant as createConnection -- a key that still works on
    // re-test is just as much proof as one that worked the first time.
    await prisma.user.update({ where: { id: userId }, data: { cashout_access_granted: true } });

    return { success: true, message: 'Connection test passed.' };
  } catch (err) {
    await prisma.cashoutConnection.update({
      where: { id: connectionId },
      data: {
        // A failed test only means the key is bad if the provider said so. A
        // timeout or rate limit says nothing about it, and marking it would stop
        // background sync.
        ...(err.keyRejected ? { status: 'attention_needed' } : {}),
        last_error: err.message,
      },
    });

    return { success: false, message: err.message };
  }
}

async function deleteConnection(userId, connectionId) {
  await getConnection(userId, connectionId);
  dealsCache.delete(connectionId);
  syncBlockedUntil.delete(connectionId);
  await prisma.cashoutConnection.delete({
    where: { id: connectionId },
  });
  return { success: true };
}

/**
 * Record deal snapshots if price or status changed.
 */
async function recordSnapshots(userId, connectionId, provider, deals) {
  if (!Array.isArray(deals) || deals.length === 0) return;

  const now = new Date();

  for (const deal of deals) {
    const lastSnapshot = await prisma.cashoutDealSnapshot.findFirst({
      where: {
        user_id: userId,
        provider,
        external_deal_id: deal.id,
      },
      orderBy: { captured_at: 'desc' },
    });

    const currentPayout = Number(deal.payout) || 0;
    const currentStatus = deal.status || 'active';
    const lastPayout = lastSnapshot ? Number(lastSnapshot.payout) : null;
    const lastStatus = lastSnapshot ? lastSnapshot.status : null;

    // Save only on change
    if (lastPayout === null || lastPayout !== currentPayout || lastStatus !== currentStatus) {
      await prisma.cashoutDealSnapshot.create({
        data: {
          user_id: userId,
          connection_id: connectionId,
          provider,
          external_deal_id: deal.id,
          external_item_id: deal.items?.[0]?.id || null,
          item_name: deal.name,
          payout: currentPayout,
          retail: deal.retail !== null ? Number(deal.retail) : null,
          status: currentStatus,
          captured_at: now,
        },
      });
    }
  }

  // Retention cleanup: purge snapshots older than RETENTION_DAYS
  const retentionCutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.cashoutDealSnapshot.deleteMany({
    where: {
      user_id: userId,
      captured_at: { lt: retentionCutoff },
    },
  });
}

/**
 * Fetch deals for one connection with caching, error resilience, and snapshotting.
 */
async function fetchConnectionDeals(userId, connectionId, { forceRefresh = false } = {}) {
  const conn = await getConnection(userId, connectionId);
  const adapter = getAdapter(conn.provider, userId);

  const cached = dealsCache.get(connectionId);
  const now = Date.now();

  if (!forceRefresh && cached && !cached.error && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      connection: safeConnection(conn),
      deals: cached.deals,
      lastUpdated: new Date(cached.fetchedAt).toISOString(),
      isStale: false,
    };
  }

  // Backing off after a failure: show what we have rather than asking again.
  if (!forceRefresh && cached && now < (syncBlockedUntil.get(connectionId) || 0)) {
    return {
      connection: safeConnection(conn),
      deals: cached.deals,
      lastUpdated: new Date(cached.fetchedAt).toISOString(),
      isStale: true,
      warning: `Refresh is paused after a failed attempt${conn.last_error ? `: ${conn.last_error.replace(/\.$/, '')}` : ''}. Showing last known data.`,
    };
  }

  try {
    const rawKey = decryptKey(conn.encrypted_key);
    const deals = await adapter.fetchDeals(rawKey);

    syncBlockedUntil.delete(connectionId);
    dealsCache.set(connectionId, {
      deals,
      fetchedAt: now,
      error: null,
    });

    // Record snapshot on successful pull
    await recordSnapshots(userId, connectionId, conn.provider, deals);

    await prisma.cashoutConnection.update({
      where: { id: connectionId },
      data: {
        last_synced_at: new Date(now),
        last_error: null,
        status: 'active',
      },
    });

    return {
      connection: safeConnection(conn),
      deals,
      lastUpdated: new Date(now).toISOString(),
      isStale: false,
    };
  } catch (err) {
    const waitMs = Math.max(MANUAL_SYNC_COOLDOWN_MS, (err.retryAfter || 0) * 1000);
    syncBlockedUntil.set(connectionId, Date.now() + waitMs);

    // Always keep the reason so Manage Connections can show it. Only a rejected
    // key (401/403) needs attention: an outage or rate limit clears up on its own,
    // and background sync skips connections that need attention.
    await prisma.cashoutConnection.update({
      where: { id: connectionId },
      data: err.keyRejected
        ? { status: 'attention_needed', last_error: err.message }
        : { last_error: err.message },
    });

    // If we have cached deals, return them as stale with a warning
    if (cached && cached.deals) {
      return {
        connection: safeConnection(conn),
        deals: cached.deals,
        lastUpdated: new Date(cached.fetchedAt).toISOString(),
        isStale: true,
        warning: `Failed to refresh: ${err.message.replace(/\.$/, '')}. Showing last known data.`,
      };
    }

    throw err;
  }
}

/**
 * Sync single user connection (manual "Sync now").
 */
async function syncUserConnection(userId, connectionId) {
  const conn = await getConnection(userId, connectionId);

  // 60-second cooldown after a successful sync, or longer after a failed one
  const lastSyncedAt = conn.last_synced_at ? new Date(conn.last_synced_at).getTime() : 0;
  const readyAt = Math.max(lastSyncedAt + MANUAL_SYNC_COOLDOWN_MS, syncBlockedUntil.get(connectionId) || 0);
  const remainingMs = readyAt - Date.now();
  if (remainingMs > 0) {
    const remainingSeconds = Math.ceil(remainingMs / 1000);
    const error = new Error(`Sync cooldown active. Please wait ${remainingSeconds}s before syncing again.`);
    error.status = 429;
    error.cooldown = true;
    error.remainingSeconds = remainingSeconds;
    throw error;
  }

  const result = await fetchConnectionDeals(userId, connectionId, { forceRefresh: true });

  // Old data came back because the refresh failed. That is not a successful sync.
  if (result.isStale) {
    const error = new Error(result.warning);
    error.status = 502;
    throw error;
  }

  return result;
}

/**
 * Fetch deal price history snapshots for user.
 */
async function getDealHistory(userId, { externalDealId, provider, limit = 50 }) {
  const where = { user_id: userId };
  if (externalDealId) where.external_deal_id = externalDealId;
  if (provider) where.provider = provider;

  const snapshots = await prisma.cashoutDealSnapshot.findMany({
    where,
    orderBy: { captured_at: 'asc' },
    take: limit,
  });

  const firstSnapshot = await prisma.cashoutDealSnapshot.findFirst({
    where: { user_id: userId },
    orderBy: { captured_at: 'asc' },
  });

  return {
    trackingSince: firstSnapshot?.captured_at || null,
    snapshots: snapshots.map((s) => ({
      id: s.id,
      provider: s.provider,
      dealId: s.external_deal_id,
      itemName: s.item_name,
      payout: Number(s.payout),
      retail: s.retail !== null ? Number(s.retail) : null,
      status: s.status,
      capturedAt: s.captured_at,
    })),
  };
}

module.exports = {
  listConnections,
  getConnection,
  createConnection,
  updateConnection,
  testConnection,
  deleteConnection,
  fetchConnectionDeals,
  syncUserConnection,
  getDealHistory,
  dealsCache,
  syncBlockedUntil,
};
