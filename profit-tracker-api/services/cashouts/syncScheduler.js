const crypto = require('node:crypto');
const prisma = require('../../prisma');
const { fetchConnectionDeals } = require('./service');

// Unique 32-bit integer for Postgres advisory lock for cashout background sync
const ADVISORY_LOCK_ID = 948273615;
const MAX_EXECUTION_BUDGET_MS = 50 * 1000; // 50 seconds max per run
const RECENT_SYNC_SKIP_MS = 60 * 1000; // Skip if synced within last 60s

/**
 * Timing-safe string comparison to protect bearer token verification from timing attacks.
 */
function timingSafeEqual(strA, strB) {
  if (typeof strA !== 'string' || typeof strB !== 'string') return false;
  const bufA = Buffer.from(strA, 'utf8');
  const bufB = Buffer.from(strB, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify CASHOUT_SYNC_SECRET bearer token.
 */
function verifySyncSecret(authHeader) {
  const secret = process.env.CASHOUT_SYNC_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length === 0) {
    return { ok: false, status: 401, message: 'Cashout sync secret is not configured on server.' };
  }

  if (!authHeader || typeof authHeader !== 'string') {
    return { ok: false, status: 401, message: 'Missing Authorization header.' };
  }

  const parts = authHeader.trim().split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return { ok: false, status: 401, message: 'Invalid Authorization header format. Expected Bearer token.' };
  }

  const providedToken = parts[1];
  if (!timingSafeEqual(providedToken, secret.trim())) {
    return { ok: false, status: 401, message: 'Invalid sync bearer token.' };
  }

  return { ok: true };
}

/**
 * Attempt to acquire Postgres advisory lock.
 * If in-memory mock or non-Postgres, falls back to in-memory boolean flag.
 */
let inMemoryLock = false;

async function acquireLock() {
  try {
    const result = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) as locked`;
    if (Array.isArray(result) && result[0]) {
      return Boolean(result[0].locked);
    }
  } catch (err) {
    // If $queryRaw fails (e.g. SQLite / in-memory test harness), use in-memory lock
  }

  if (inMemoryLock) return false;
  inMemoryLock = true;
  return true;
}

async function releaseLock() {
  try {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
  } catch (err) {
    // Ignore query failure on test harness
  }
  inMemoryLock = false;
}

/**
 * Run scheduled background sync of all active cashout connections.
 */
async function runScheduledSync() {
  const startTime = Date.now();
  const locked = await acquireLock();
  if (!locked) {
    return {
      status: 'locked',
      message: 'Another background cashout sync is already in progress.',
    };
  }

  const summary = {
    total: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  try {
    const connections = await prisma.cashoutConnection.findMany({
      where: {
        status: 'active', // Exclude attention_needed or disconnected
      },
      orderBy: { last_synced_at: 'asc' }, // Prioritize least-recently synced
    });

    summary.total = connections.length;

    for (const conn of connections) {
      // Check execution time budget to prevent server timeouts
      if (Date.now() - startTime > MAX_EXECUTION_BUDGET_MS) {
        summary.skipped += (connections.length - (summary.synced + summary.failed + summary.skipped));
        break;
      }

      // Skip if synced very recently
      if (conn.last_synced_at && Date.now() - new Date(conn.last_synced_at).getTime() < RECENT_SYNC_SKIP_MS) {
        summary.skipped++;
        continue;
      }

      try {
        const result = await fetchConnectionDeals(conn.user_id, conn.id, { forceRefresh: true });
        // A failed refresh hands back old deals instead of throwing.
        if (result.isStale) summary.failed++;
        else summary.synced++;
      } catch (err) {
        summary.failed++;
        // Single connection failure must not abort the rest of the connections
      }
    }
  } finally {
    await releaseLock();
    summary.durationMs = Date.now() - startTime;
  }

  return summary;
}

module.exports = {
  verifySyncSecret,
  runScheduledSync,
  timingSafeEqual,
};
