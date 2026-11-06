const prisma = require('../../prisma');
const { requireOwned } = require('../ownership');
const { encryptKey, decryptKey, maskKey } = require('./crypto');
const { getAdapter, listAvailableCashouts, isProviderAllowedForUser } = require('./registry');
const { allocatedCost, allocatedCashback, roundCents } = require('../../../shared/finance.mjs');

// In-memory cache for live deals per connection
// Key: connectionId -> { deals: CashoutDeal[], fetchedAt: number, error: string | null }
const dealsCache = new Map();

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
    platformFeePct: conn.platform?.fee_pct ?? 0,
    lastSyncedAt: conn.last_synced_at,
    lastError: conn.last_error,
    createdAt: conn.created_at,
    updatedAt: conn.updated_at,
  };
}

async function listConnections(userId) {
  const connections = await prisma.cashoutConnection.findMany({
    where: { user_id: userId },
    include: { platform: { select: { id: true, name: true, fee_pct: true } } },
    orderBy: { created_at: 'desc' },
  });
  return connections.map(safeConnection);
}

async function getConnection(userId, connectionId) {
  const conn = await prisma.cashoutConnection.findFirst({
    where: { id: connectionId, user_id: userId },
    include: { platform: { select: { id: true, name: true, fee_pct: true } } },
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

  if (platformId) {
    await requireOwned('platform', platformId, userId, 'Platform');
  }

  // Pre-flight check: verify the key with the provider before saving
  await adapter.testKey(apiKey.trim());

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
    include: { platform: { select: { id: true, name: true, fee_pct: true } } },
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
  }

  const updated = await prisma.cashoutConnection.update({
    where: { id: connectionId },
    data: updateData,
    include: { platform: { select: { id: true, name: true, fee_pct: true } } },
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

    return { success: true, message: 'Connection test passed.' };
  } catch (err) {
    await prisma.cashoutConnection.update({
      where: { id: connectionId },
      data: {
        status: 'attention_needed',
        last_error: err.message,
      },
    });

    return { success: false, message: err.message };
  }
}

async function deleteConnection(userId, connectionId) {
  await getConnection(userId, connectionId);
  dealsCache.delete(connectionId);
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

  try {
    const rawKey = decryptKey(conn.encrypted_key);
    const deals = await adapter.fetchDeals(rawKey);

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
    // If the key was rejected (401/403), mark connection as needing attention
    if (err.keyRejected) {
      await prisma.cashoutConnection.update({
        where: { id: connectionId },
        data: {
          status: 'attention_needed',
          last_error: err.message,
        },
      });
    }

    // If we have cached deals, return them as stale with a warning
    if (cached && cached.deals) {
      return {
        connection: safeConnection(conn),
        deals: cached.deals,
        lastUpdated: new Date(cached.fetchedAt).toISOString(),
        isStale: true,
        warning: `Failed to refresh: ${err.message}. Showing last known data.`,
      };
    }

    throw err;
  }
}

/**
 * Find inventory match and calculate profit for deals.
 */
function normalizeName(name) {
  if (!name || typeof name !== 'string') return '';
  return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function attachProfitToDeals(userId, connection, deals) {
  if (!Array.isArray(deals) || deals.length === 0) return [];

  // Fetch active inventory for user
  const inventories = await prisma.inventory.findMany({
    where: {
      user_id: userId,
      NOT: { status: { in: ['CANCELLED', 'RETURNED', 'DISPUTED'] } },
    },
    include: { payment_method: true, vendor: true },
    orderBy: [
      { qty_on_hand: 'desc' },
      { purchase_date: 'desc' },
    ],
  });

  // Fetch manual overrides
  const manualMatches = await prisma.cashoutItemMatch.findMany({
    where: { user_id: userId, provider: connection.provider },
  });

  const feePct = connection.platformFeePct || 0;

  return deals.map((deal) => {
    // 1. Check for manual match override
    const manualMatch = manualMatches.find((m) => m.external_deal_id === deal.id);
    let matchedInventory = null;
    let matchType = null;

    if (manualMatch && manualMatch.inventory_id) {
      matchedInventory = inventories.find((inv) => inv.id === manualMatch.inventory_id) || null;
      if (matchedInventory) matchType = 'manual';
    }

    // 2. Automatic matching by product_name if no manual match
    if (!matchedInventory) {
      const dealNormalized = normalizeName(deal.name);

      // Prefer on-hand inventory first
      const onHandMatches = inventories.filter((inv) => inv.qty_on_hand > 0);
      const pastMatches = inventories.filter((inv) => inv.qty_on_hand === 0);

      // Exact match
      const exactOnHand = onHandMatches.find((inv) => normalizeName(inv.product_name) === dealNormalized);
      if (exactOnHand) {
        matchedInventory = exactOnHand;
        matchType = 'exact';
      } else {
        const exactPast = pastMatches.find((inv) => normalizeName(inv.product_name) === dealNormalized);
        if (exactPast) {
          matchedInventory = exactPast;
          matchType = 'exact';
        } else {
          // Substring / word overlap
          const fuzzyOnHand = onHandMatches.find((inv) => {
            const invNorm = normalizeName(inv.product_name);
            return invNorm && (dealNormalized.includes(invNorm) || invNorm.includes(dealNormalized));
          });
          if (fuzzyOnHand) {
            matchedInventory = fuzzyOnHand;
            matchType = 'estimate';
          } else {
            const fuzzyPast = pastMatches.find((inv) => {
              const invNorm = normalizeName(inv.product_name);
              return invNorm && (dealNormalized.includes(invNorm) || invNorm.includes(dealNormalized));
            });
            if (fuzzyPast) {
              matchedInventory = fuzzyPast;
              matchType = 'estimate';
            }
          }
        }
      }
    }

    // Profit calculation using shared/finance.mjs
    const payout = Number(deal.payout) || 0;
    const cashoutFee = roundCents((payout * feePct) / 100);
    const netPayout = payout - cashoutFee;

    let unitCost = null;
    let unitCashback = null;
    let estimatedProfit = null;
    let profitMarginPct = null;
    let stockStatus = 'no_match';

    if (matchedInventory) {
      unitCost = roundCents(allocatedCost(matchedInventory, 1));
      unitCashback = roundCents(allocatedCashback(matchedInventory, 1));
      estimatedProfit = roundCents(netPayout - unitCost + unitCashback);
      profitMarginPct = unitCost > 0 ? roundCents(((estimatedProfit / unitCost) * 100)) : 0;
      stockStatus = matchedInventory.qty_on_hand > 0 ? 'in_stock' : 'past_purchase';
    }

    return {
      ...deal,
      match: matchedInventory ? {
        inventoryId: matchedInventory.id,
        productName: matchedInventory.product_name,
        matchProductName: matchedInventory.product_name,
        matchType,
        stockStatus,
        qtyOnHand: matchedInventory.qty_on_hand,
        purchaseDate: matchedInventory.purchase_date,
      } : null,
      financials: {
        payout,
        cashoutFee,
        netPayout,
        unitCost,
        unitCashback,
        estimatedProfit,
        profitMarginPct,
        hasCostData: matchedInventory !== null,
      },
    };
  });
}

/**
 * Set manual item match override.
 */
async function setItemMatch(userId, { provider, externalDealId, dealItemName, inventoryId, inventoryName }) {
  if (inventoryId) {
    await requireOwned('inventory', inventoryId, userId, 'Inventory');
  }

  const match = await prisma.cashoutItemMatch.upsert({
    where: {
      user_id_provider_external_deal_id: {
        user_id: userId,
        provider,
        external_deal_id: externalDealId,
      },
    },
    create: {
      user_id: userId,
      provider,
      external_deal_id: externalDealId,
      deal_item_name: dealItemName,
      inventory_id: inventoryId || null,
      inventory_name: inventoryName || null,
    },
    update: {
      inventory_id: inventoryId || null,
      inventory_name: inventoryName || null,
      deal_item_name: dealItemName,
    },
  });

  return match;
}

/**
 * Remove manual match override.
 */
async function removeItemMatch(userId, { provider, externalDealId }) {
  await prisma.cashoutItemMatch.deleteMany({
    where: {
      user_id: userId,
      provider,
      external_deal_id: externalDealId,
    },
  });
  return { success: true };
}

/**
 * Sync single user connection (manual "Sync now").
 */
async function syncUserConnection(userId, connectionId) {
  const conn = await getConnection(userId, connectionId);

  // Check 60-second cooldown
  if (conn.last_synced_at) {
    const elapsed = Date.now() - new Date(conn.last_synced_at).getTime();
    if (elapsed < MANUAL_SYNC_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((MANUAL_SYNC_COOLDOWN_MS - elapsed) / 1000);
      const error = new Error(`Sync cooldown active. Please wait ${remainingSeconds}s before syncing again.`);
      error.status = 429;
      error.cooldown = true;
      error.remainingSeconds = remainingSeconds;
      throw error;
    }
  }

  return fetchConnectionDeals(userId, connectionId, { forceRefresh: true });
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
  attachProfitToDeals,
  setItemMatch,
  removeItemMatch,
  syncUserConnection,
  getDealHistory,
  dealsCache,
};
