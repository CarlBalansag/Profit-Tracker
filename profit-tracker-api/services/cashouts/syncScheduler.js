const crypto = require('node:crypto');
const prisma = require('../../prisma');
const { fetchConnectionDeals } = require('./service');

// Unique 32-bit integer for Postgres advisory lock for cashout background sync
const ADVISORY_LOCK_ID = 948273615;
const MAX_EXECUTION_BUDGET_MS = 50 * 1000; // 50 seconds max per run
// Skip a connection synced this recently (a Cashout page visit or the last
// run). Under a minute, so a cron every minute reaches every connection each run.
const RECENT_SYNC_SKIP_MS = 45 * 1000;

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

// One scheduled sync at a time. The lock is a transaction-scoped Postgres
// advisory lock, held by one open transaction for the whole run and released
// when it ends (even if the run fails). A session lock can't be used here: the
// unlock ran on a different pooled connection than the lock, so the lock was
// never released and every later run got 409 until the server restarted.
// Without Postgres (the in-memory test harness) it falls back to a flag.
const LOCK_HOLD_MS = 4 * 60 * 1000;
const NO_DB_LOCK = Symbol('no-db-lock');
const LOCKED = Symbol('locked');
let inMemoryLock = false;

async function withRunLock(run) {
  let started = false;
  let result = NO_DB_LOCK;
  try {
    result = await prisma.$transaction(async (tx) => {
      let rows;
      try {
        rows = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(${ADVISORY_LOCK_ID}) AS locked`;
      } catch {
        return NO_DB_LOCK;
      }
      // No answer (the in-memory harness returns no rows): no Postgres lock.
      if (!Array.isArray(rows) || typeof rows[0]?.locked !== 'boolean') return NO_DB_LOCK;
      if (!rows[0].locked) return LOCKED;
      started = true;
      return run();
    }, { maxWait: 10 * 1000, timeout: LOCK_HOLD_MS });
  } catch (err) {
    // A failure inside the run is the run's own. Before it (no interactive
    // transactions in the test harness) fall back to the flag below.
    if (started) throw err;
    result = NO_DB_LOCK;
  }
  if (result !== NO_DB_LOCK) return result;

  if (inMemoryLock) return LOCKED;
  inMemoryLock = true;
  try {
    return await run();
  } finally {
    inMemoryLock = false;
  }
}

/**
 * Run scheduled background sync of all active cashout connections.
 */
async function runScheduledSync() {
  const startTime = Date.now();
  const summary = {
    total: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  const outcome = await withRunLock(async () => {
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

    // Push the new deals this sync found (dealAlerts.js). Best effort.
    try {
      summary.dealAlerts = await require('./dealAlerts').dispatchDealAlerts();
    } catch (err) {
      console.error('[deal-alerts] dispatch failed:', err.message);
    }
    return summary;
  });

  if (outcome === LOCKED) {
    return {
      status: 'locked',
      message: 'Another background cashout sync is already in progress.',
    };
  }
  summary.durationMs = Date.now() - startTime;
  return summary;
}

module.exports = {
  verifySyncSecret,
  runScheduledSync,
  timingSafeEqual,
};
