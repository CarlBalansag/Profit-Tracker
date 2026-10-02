const ups = require('./carriers/ups');
const fedex = require('./carriers/fedex');
const usps = require('./carriers/usps');
const statusTransitions = require('./statusTransitions');

// Carrier lookups can cost money once real credentials are configured, so
// checks are capped per user regardless of which item/side they're for.
const TRACK_LIMIT = 10;
const TRACK_WINDOW_MS = 60 * 60 * 1000;

// Reuses the generic durable rate-limit bucket already used for auth attempts
// (selvora-api/routes/firebaseAuth.js) — a plain key/count/expiry row, namespaced
// here so it doesn't collide with the hashed auth-attempt keys.
async function checkTrackingRateLimit(prisma, userId) {
  const now = Date.now();
  const windowIndex = Math.floor(now / TRACK_WINDOW_MS);
  const key = `track:${userId}:${windowIndex}`;
  const expires_at = new Date((windowIndex + 1) * TRACK_WINDOW_MS);
  await prisma.authAttemptBucket.deleteMany({ where: { expires_at: { lt: new Date(now) } } });
  const bucket = await prisma.authAttemptBucket.upsert({
    where: { key },
    create: { key, expires_at },
    update: { count: { increment: 1 } },
  });
  const remaining = Math.max(0, TRACK_LIMIT - bucket.count);
  if (bucket.count > TRACK_LIMIT) {
    return { allowed: false, remaining: 0, resetAt: expires_at, retryAfterSeconds: Math.ceil((expires_at.getTime() - now) / 1000) };
  }
  return { allowed: true, remaining, resetAt: expires_at };
}

// Kept in sync with the client-side chip detector in
// selvora-app/src/utils/carrier.js — this copy is the source of truth for
// which carrier's API gets called.
function detectCarrier(trackingNumber) {
  if (!trackingNumber) return null;
  const tn = trackingNumber.trim();
  if (/^TBA[0-9]+$/i.test(tn)) return 'Amazon';
  if (/^1Z[0-9A-Z]{16}$/i.test(tn)) return 'UPS';
  // USPS's numeric prefixes are checked before FedEx's generic digit-count
  // rule below, since e.g. a 22-digit "94..." number matches both patterns.
  if (/^(94|93|92|95)[0-9]{18,20}$/.test(tn)) return 'USPS';
  if (/^(70|14|23|03)[0-9]{14}$/.test(tn)) return 'USPS';
  if (/^[A-Z]{2}[0-9]{9}[A-Z]{2}$/.test(tn)) return 'USPS';
  if (/^[0-9]{12}$/.test(tn) || /^[0-9]{15}$/.test(tn) || /^[0-9]{20}$/.test(tn) || /^[0-9]{22}$/.test(tn)) return 'FedEx';
  if (/^JD[0-9A-Z]+$/i.test(tn)) return 'DHL';
  if (/^[0-9]{10}$/.test(tn)) return 'DHL';
  if (/^C[0-9]{14}$/.test(tn)) return 'OnTrac';
  return null;
}

const LIVE_CARRIERS = {
  UPS: ups,
  FedEx: fedex,
  USPS: usps,
};

// Calls the matching carrier API and returns a normalized tracking_info shape.
// Never throws — carrier/API failures are represented as trackable: false so
// callers can always persist the result and show something useful.
// `clients` is injectable so tests can substitute fake carrier clients.
async function refreshTracking(trackingNumber, clients = LIVE_CARRIERS) {
  const checkedAt = new Date().toISOString();
  const carrier = detectCarrier(trackingNumber);

  if (!carrier) return { carrier: null, trackable: false, reason: 'unrecognized', checkedAt };

  const client = clients[carrier];
  if (!client) return { carrier, trackable: false, reason: 'not_configured', checkedAt };
  if (!client.isConfigured()) return { carrier, trackable: false, reason: 'not_configured', checkedAt };

  try {
    const { status, events, deliveredAt, estimatedDelivery } = await client.trackByNumber(trackingNumber);
    return { carrier, trackable: true, status, events, deliveredAt, estimatedDelivery, checkedAt };
  } catch (err) {
    if (err.restricted) return { carrier, trackable: false, reason: 'restricted', checkedAt };
    // Logged (not just swallowed into the generic "error" reason) so a real
    // failure — bad credentials, sandbox-vs-production mismatch, carrier
    // outage — is diagnosable from server logs instead of a dead end.
    console.error(`[tracking] ${carrier} lookup failed:`, err.status ? `HTTP ${err.status} —` : '', err.message);
    return { carrier, trackable: false, reason: 'error', checkedAt };
  }
}

// The normalized "it arrived" value every carrier client maps its own wording
// onto (services/carriers/*.js normalizeStatus).
const DELIVERED_STATUS = 'Delivered';

/**
 * One carrier request per physical package.
 *
 * Several Inventory and/or Sales rows owned by the same user can legitimately
 * share one tracking number -- one inbound box holding several purchases, or an
 * outbound package relabelled onto a sale. The plan requires a manual check to
 * spend one carrier request for the package, not one per row, so this checks
 * once and writes the normalized result to every matching row inside a single
 * transaction: a partial failure must not leave one row holding a carrier
 * result the others never got.
 *
 * Rows the carrier reports delivered also take their mark_delivered transition
 * in the same transaction. That is gated by statusTransitions.SYSTEM_ACTION_FROM,
 * so a repeated or late check is idempotent and can never move a row backward,
 * and a carrier error or unknown status changes no business status at all.
 *
 * The legacy `status` column is deliberately not touched here: a manual carrier
 * check does not advance it today either, and no live screen reads the new
 * columns yet, so this adds the new-column advance without changing what any
 * current screen shows.
 *
 * `clients` is passed straight through to refreshTracking for tests.
 */
async function refreshSharedTracking({ prisma, userId, trackingNumber, clients }) {
  // Every row of either kind that this one carrier request answers for.
  const [inventoryRows, saleRows] = await Promise.all([
    prisma.inventory.findMany({ where: { user_id: userId, tracking_number: trackingNumber } }),
    prisma.sales.findMany({ where: { tracking_number: trackingNumber, inventory: { user_id: userId } } }),
  ]);

  const tracking_info = clients
    ? await refreshTracking(trackingNumber, clients)
    : await refreshTracking(trackingNumber);

  const delivered = Boolean(tracking_info.trackable) && tracking_info.status === DELIVERED_STATUS;
  const deliveredAt = delivered ? (tracking_info.deliveredAt || tracking_info.checkedAt) : null;

  return prisma.$transaction(async (tx) => {
    const updated = { tracking_info, inventory: [], sales: [], advanced: [] };
    const kinds = [
      { kind: 'inventory', rows: inventoryRows, model: tx.inventory, statusField: 'receiving_status', bucket: 'inventory' },
      { kind: 'sale', rows: saleRows, model: tx.sales, statusField: 'workflow_status', bucket: 'sales' },
    ];

    for (const { kind, rows, model, statusField, bucket } of kinds) {
      for (const row of rows) {
        await model.update({ where: { id: row.id }, data: { tracking_info } });
        let record = { ...row, tracking_info };
        const eligible = statusTransitions.SYSTEM_ACTION_FROM[kind].mark_delivered.includes(row[statusField]);
        if (delivered && eligible) {
          const result = await statusTransitions.applyTransition(
            tx, kind, row, 'mark_delivered', { delivered_at: deliveredAt, user_id: userId },
          );
          record = { ...result.record, tracking_info };
          updated.advanced.push({ kind, id: row.id, from: result.from, to: result.to });
        }
        updated[bucket].push(record);
      }
    }
    return updated;
  });
}

module.exports = { detectCarrier, refreshTracking, checkTrackingRateLimit, refreshSharedTracking, LIVE_CARRIERS };
