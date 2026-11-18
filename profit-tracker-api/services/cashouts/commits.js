// Commitments and tracking submissions against a connected cashout's own
// API. Separate from service.js (which only ever reads deals) because these
// are real, binding writes against a third party -- kept in their own file
// so that boundary stays obvious at a glance.
//
// Every write to the provider goes through ebWrite() below, which:
//   - refuses when the user is over the write rate limit,
//   - records the attempt and its outcome in CashoutWriteLog,
//   - never retries on its own (a retried commit could pledge twice).
// Inputs are checked here, before anything is sent, so the web routes, MCP
// tools and Log Purchase all get the same rules.
const prisma = require('../../prisma');
const { decryptKey } = require('./crypto');
const { getAdapter } = require('./registry');
const { getConnection, fetchConnectionDeals } = require('./service');

const fail = (status, message, extra = {}) => Object.assign(new Error(message), { status, ...extra });
const notFound = (label) => fail(404, `${label} not found or access denied`);

// ---------------------------------------------------------------- inputs

const MAX_QUANTITY = 1000;
const MAX_TRACKING_CODES = 10;
const MAX_TRACKING_LENGTH = 24; // EB's limit
const MIN_INSURED = 200;
const MAX_INSURED = 1500;

function cleanQuantity(quantity) {
  const n = typeof quantity === 'string' && quantity.trim() !== '' ? Number(quantity.trim()) : quantity;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_QUANTITY) {
    throw fail(400, `Quantity must be a whole number from 1 to ${MAX_QUANTITY}.`);
  }
  return n;
}

function cleanItemId(itemId) {
  const value = String(itemId ?? '').trim();
  if (!/^\d{1,18}$/.test(value)) throw fail(400, 'That item id is not valid for this cashout.');
  return value;
}

function cleanDealId(dealId) {
  const value = String(dealId ?? '').trim();
  if (!value || value.length > 64) throw fail(400, 'A deal id is required.');
  return value;
}

// Trimmed, no spaces, letters/digits/dashes only, 24 characters at most.
function cleanTrackingCode(code) {
  const value = String(code ?? '').trim();
  if (!value) throw fail(400, 'A tracking number cannot be blank.');
  if (value.length > MAX_TRACKING_LENGTH || !/^[A-Za-z0-9-]+$/.test(value)) {
    throw fail(400, `"${value.slice(0, 40)}" isn't a tracking number the cashout accepts: letters, digits and dashes only, ${MAX_TRACKING_LENGTH} characters at most.`);
  }
  return value;
}

function cleanTrackingCodes(codes) {
  if (!Array.isArray(codes) || codes.length === 0) throw fail(400, 'At least one tracking number is required.');
  if (codes.length > MAX_TRACKING_CODES) throw fail(400, `Send at most ${MAX_TRACKING_CODES} tracking numbers at a time.`);
  const seen = new Set();
  const out = [];
  for (const code of codes) {
    const value = cleanTrackingCode(code);
    if (!seen.has(value.toUpperCase())) {
      seen.add(value.toUpperCase());
      out.push(value);
    }
  }
  return out;
}

function cleanInsuredValue(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_INSURED || n > MAX_INSURED) {
    throw fail(400, `Insured value must be between $${MIN_INSURED} and $${MAX_INSURED.toLocaleString('en-US')}, or left blank.`);
  }
  return Math.round(n * 100) / 100;
}

const cleanDescription = (value) => String(value ?? '').trim().slice(0, 200) || 'Cashout shipment';

// ------------------------------------------------------- rate limit

// Per user, in memory. Generous for real use (a few writes a day), tight
// enough that a client stuck in a loop can't flood the provider.
const WRITE_LIMIT = 20;
const WRITE_WINDOW_MS = 60 * 1000;
const writeTimes = new Map();

function takeWriteToken(userId) {
  const now = Date.now();
  const recent = (writeTimes.get(userId) || []).filter((t) => now - t < WRITE_WINDOW_MS);
  if (recent.length >= WRITE_LIMIT) {
    const wait = Math.ceil((WRITE_WINDOW_MS - (now - recent[0])) / 1000);
    throw fail(429, `Too many cashout writes in a short time. Nothing was sent. Try again in ${wait}s.`);
  }
  recent.push(now);
  writeTimes.set(userId, recent);
}

// ------------------------------------------------------- write log

async function recordWrite(userId, entry) {
  try {
    await prisma.cashoutWriteLog.create({
      data: {
        user_id: userId,
        connection_id: entry.connectionId || null,
        commitment_id: entry.commitmentId || null,
        action: entry.action,
        request: entry.request || {},
        outcome: entry.outcome,
        error: entry.error ? String(entry.error).slice(0, 500) : null,
        external_id: entry.externalId ? String(entry.externalId) : null,
      },
    });
  } catch (err) {
    // The log must never be the reason a write fails or looks failed.
    console.error('Cashout write log failed:', err.message);
  }
}

// No answer: the provider may or may not have done it.
function isAmbiguous(err) {
  if (!err || err.keyRejected || err.permissionDenied || err.rateLimited) return false;
  if (err.status >= 500) return true;
  if (err.status >= 400) return false;
  return /timed out|network|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket/i.test(String(err.message))
    || err.name === 'TypeError';
}

async function ebWrite(userId, { connectionId, commitmentId, action, request }, fn) {
  takeWriteToken(userId);
  try {
    const result = await fn();
    await recordWrite(userId, { connectionId, commitmentId, action, request, outcome: 'ok', externalId: result?.id });
    return result;
  } catch (err) {
    await recordWrite(userId, {
      connectionId, commitmentId, action, request,
      outcome: isAmbiguous(err) ? 'unknown' : 'failed',
      error: err.message,
    });
    throw err;
  }
}

// ------------------------------------------------------- connection

async function connectionAndAdapter(userId, connectionId, { write = true } = {}) {
  const conn = await getConnection(userId, connectionId);
  const adapter = getAdapter(conn.provider);
  if (typeof adapter.createCommit !== 'function') {
    throw fail(400, `Commitments and tracking aren't supported for ${adapter.name} yet. Commit on its website.`);
  }
  // A key the provider rejected is never used for a write.
  if (write && conn.status !== 'active') {
    throw fail(409, `${conn.display_name || adapter.name} needs attention (${conn.last_error || 'its API key was rejected'}). Reconnect it before committing or sending tracking. Nothing was sent.`);
  }
  return { conn, adapter, rawKey: decryptKey(conn.encrypted_key) };
}

// The deal and item as the provider lists them now. Refuses an item that
// isn't part of the deal, or a deal that has closed, before anything is sent.
async function requireLiveItem(userId, connectionId, dealId, itemId) {
  let deals;
  try {
    ({ deals } = await fetchConnectionDeals(userId, connectionId));
  } catch (err) {
    throw fail(503, `Couldn't check this deal with the cashout right now (${err.message}). Nothing was sent.`);
  }
  const deal = (deals || []).find((d) => String(d.id) === String(dealId));
  if (!deal) throw fail(409, 'This deal is no longer listed. Nothing was sent.');
  const item = (deal.items || []).find((i) => String(i.id) === String(itemId));
  if (!item) throw fail(400, "That item isn't part of this deal. Nothing was sent.");
  const expired = deal.expiresAt && new Date(deal.expiresAt).getTime() <= Date.now();
  if (deal.status !== 'active' || expired) throw fail(409, 'This deal has closed. Nothing was sent.');
  return { deal, item };
}

// ------------------------------------------------------- provider lookup

// The provider's list of commitments, whatever key it nests them under.
function commitsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['commits', 'data', 'items', 'results', 'commitments']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return null;
}

// Does the provider already have a live commitment for this item? Used when a
// commit got no clear answer, or was refused as a duplicate.
//   { known: true, commit }       found it
//   { known: true, commit: null } the provider says there isn't one
//   { known: false }              couldn't tell (lookup failed or unreadable)
async function findProviderCommit(adapter, rawKey, { dealId, itemId }) {
  try {
    const list = commitsFrom(await adapter.listCommits(rawKey, { dealId, limit: 100 }));
    if (!list) return { known: false };
    const match = list.find((c) => String(c.item_id ?? c.itemId ?? c.item?.id) === String(itemId)
      && !/withdrawn|cancel|deleted/i.test(String(c.status || '')));
    if (!match) return { known: true, commit: null };
    const id = match.id ?? match.commit_id ?? match.uuid;
    if (!id) return { known: false };
    return { known: true, commit: { id: String(id), quantity: Number(match.quantity) || null } };
  } catch {
    return { known: false };
  }
}

// Commits with the provider. A timeout or server error isn't taken as a
// failure: the provider is asked whether the commitment exists, and if it
// does it's used. A "you already have one" refusal is checked the same way,
// which is how a commitment the provider took but we failed to save gets
// picked back up on the next try.
//   { preview, adopted }  -- adopted: it was already on the provider's side
// Throws with ambiguous: true when it still can't tell.
async function commitWithProvider(userId, { conn, adapter, rawKey }, { dealId, itemId, quantity, commitmentId }) {
  const request = { deal_id: dealId, item_id: itemId, quantity };
  try {
    const preview = await ebWrite(userId, { connectionId: conn.id, commitmentId, action: 'commit', request },
      () => adapter.createCommit(rawKey, { itemId: Number(itemId), quantity }));
    if (!preview?.id) {
      throw fail(502, "The cashout's reply had no commitment id, so we can't tell what was saved. Check Commitments before trying again.", { ambiguous: true });
    }
    return { preview, adopted: false };
  } catch (err) {
    if (err.ambiguous) throw err;
    const duplicate = err.code === 'INVALID_OPERATION';
    if (!isAmbiguous(err) && !duplicate) throw err;
    const found = await findProviderCommit(adapter, rawKey, { dealId, itemId });
    if (found.known && found.commit) {
      const taken = await prisma.cashoutCommitment.findFirst({ where: { external_commitment_id: found.commit.id } });
      if (!taken || taken.id === commitmentId) {
        await recordWrite(userId, { connectionId: conn.id, commitmentId, action: 'commit', request, outcome: 'adopted', externalId: found.commit.id });
        return { preview: { id: found.commit.id, quantity: found.commit.quantity ?? quantity }, adopted: true };
      }
    }
    if (isAmbiguous(err) && !found.known) {
      throw fail(502, `${conn.display_name || 'The cashout'} didn't answer (${err.message}), so we can't tell whether the commit went through. Nothing else was sent. Check Commitments in a few minutes before trying again.`, { ambiguous: true });
    }
    throw err;
  }
}

// ------------------------------------------------------- stuck commits

// A pending commit is claimed as "committing" while it's with the provider.
// If the server stopped mid-way, the row can sit there. After a few minutes
// the provider is asked what really happened, and the row follows it.
const STUCK_MS = 2 * 60 * 1000;

async function recoverStuck(userId, record) {
  if (record?.status !== 'committing') return record;
  const since = new Date(record.updated_at || record.created_at || 0).getTime();
  if (Date.now() - since < STUCK_MS) return record;
  let ctx;
  try {
    ctx = await connectionAndAdapter(userId, record.connection_id, { write: false });
  } catch {
    return record;
  }
  const found = await findProviderCommit(ctx.adapter, ctx.rawKey, { dealId: record.external_deal_id, itemId: record.external_item_id });
  if (!found.known) return record;
  if (found.commit) {
    await recordWrite(userId, { connectionId: record.connection_id, commitmentId: record.id, action: 'recover', request: {}, outcome: 'adopted', externalId: found.commit.id });
    return prisma.cashoutCommitment.update({
      where: { id: record.id },
      data: { status: 'active', external_commitment_id: found.commit.id, quantity: found.commit.quantity ?? record.quantity },
    });
  }
  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { status: 'pending' } });
}

// ------------------------------------------------------- commitments

async function listCommits(userId, connectionId, filters) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId, { write: false });
  return adapter.listCommits(rawKey, filters);
}

async function getCommit(userId, connectionId, commitmentId) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId, { write: false });
  return adapter.getCommit(rawKey, commitmentId);
}

// The open commitment row for this item, if any (pending, committing or active).
const openRowFor = (connectionId, itemId) => prisma.cashoutCommitment.findFirst({
  where: { connection_id: connectionId, open_item_id: String(itemId) },
});

// Commits with the provider, then saves the link locally. Does not touch
// Inventory/Sales -- see logPurchase.js, which calls this and then those.
async function createCommitment(userId, connectionId, { dealId, itemId, quantity, saleId = null }) {
  const deal = cleanDealId(dealId);
  const item = cleanItemId(itemId);
  const qty = cleanQuantity(quantity);
  const ctx = await connectionAndAdapter(userId, connectionId);

  // Checked before the provider is called: a commit the provider takes that we
  // then can't save would be a real pledge with no record of it here.
  const existing = await openRowFor(ctx.conn.id, item);
  if (existing) {
    throw fail(409, existing.status === 'active'
      ? 'You already have a commitment for this item. Change its quantity from Commitments instead.'
      : 'This item is already logged and waiting to be committed. Add its tracking number to commit it.');
  }
  await requireLiveItem(userId, ctx.conn.id, deal, item);

  const { preview, adopted } = await commitWithProvider(userId, ctx, { dealId: deal, itemId: item, quantity: qty });
  try {
    const record = await prisma.cashoutCommitment.create({
      data: {
        user_id: userId,
        connection_id: ctx.conn.id,
        sale_id: saleId,
        external_deal_id: deal,
        external_item_id: item,
        open_item_id: item,
        external_commitment_id: preview.id,
        quantity: preview.quantity ?? qty,
        status: 'active',
      },
    });
    return Object.assign(record, { adopted });
  } catch (err) {
    throw fail(500, `${ctx.conn.display_name || 'The cashout'} accepted the commit, but saving it here failed (${err.message}). Try again: it will pick up that commitment instead of making a second one.`, { committed: true });
  }
}

async function updateCommitment(userId, commitmentRecordId, { quantity }) {
  const qty = cleanQuantity(quantity);
  let record = await prisma.cashoutCommitment.findFirst({ where: { id: commitmentRecordId, user_id: userId } });
  if (!record) throw notFound('Commitment');
  record = await recoverStuck(userId, record);
  // Not committed with the provider yet: only our own row changes.
  if (record.status === 'pending') {
    return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { quantity: qty } });
  }
  if (record.status === 'committing') throw fail(409, 'This commitment is being sent to the cashout right now. Try again in a moment.');
  if (record.status !== 'active' || !record.external_commitment_id) {
    throw fail(409, 'Only an active commitment can be changed.');
  }
  if (record.quantity === qty) return record;

  const ctx = await connectionAndAdapter(userId, record.connection_id);
  const preview = await ebWrite(userId, {
    connectionId: record.connection_id, commitmentId: record.id, action: 'update', request: { commitment: record.external_commitment_id, quantity: qty },
  }, () => ctx.adapter.updateCommit(ctx.rawKey, record.external_commitment_id, { quantity: qty }));

  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { quantity: preview?.quantity ?? qty } });
}

// Withdraws with the provider -- which frees the quantity back to the deal
// immediately on their side -- then marks the local row withdrawn rather
// than deleting it, so the purchase/sale it may be linked to keeps its history.
async function deleteCommitment(userId, commitmentRecordId) {
  let record = await prisma.cashoutCommitment.findFirst({ where: { id: commitmentRecordId, user_id: userId } });
  if (!record) throw notFound('Commitment');
  record = await recoverStuck(userId, record);
  if (record.status === 'withdrawn') return record; // already done; nothing to send
  if (record.status === 'committing') {
    throw fail(409, 'This commitment is being sent to the cashout right now. Try again in a moment.');
  }
  // Never committed with the provider, so there's nothing to withdraw there.
  // The row goes, so the item can be committed again later; the purchase and
  // sale stay.
  if (record.status === 'pending') {
    await prisma.cashoutCommitment.delete({ where: { id: record.id } });
    return { ...record, status: 'removed' };
  }

  const ctx = await connectionAndAdapter(userId, record.connection_id);
  try {
    await ebWrite(userId, {
      connectionId: record.connection_id, commitmentId: record.id, action: 'withdraw', request: { commitment: record.external_commitment_id },
    }, () => ctx.adapter.deleteCommit(ctx.rawKey, record.external_commitment_id));
  } catch (err) {
    // The provider no longer has it: it's withdrawn either way.
    if (err.status !== 404) throw err;
  }

  // open_item_id clears so this item can be committed again later.
  return prisma.cashoutCommitment.update({ where: { id: record.id }, data: { status: 'withdrawn', open_item_id: null } });
}

async function listLocalCommitments(userId, { connectionId, saleId, status } = {}) {
  const where = {
    user_id: userId,
    ...(connectionId ? { connection_id: connectionId } : {}),
    ...(saleId ? { sale_id: saleId } : {}),
    ...(status ? { status } : {}),
  };
  // Settle any commit left half-way before showing the list.
  const stuck = await prisma.cashoutCommitment.findMany({ where: { ...where, status: 'committing' } });
  for (const row of stuck) await recoverStuck(userId, row).catch(() => null);
  return prisma.cashoutCommitment.findMany({
    where,
    include: { connection: true, sale: { include: { inventory: true } } },
    orderBy: { created_at: 'desc' },
  });
}

// ------------------------------------------------------- tracking

// One tracking send per connection at a time, so two items in the same box
// committed at the same moment can't both send the shared number.
const connectionLocks = new Map();
function withConnectionLock(connectionId, fn) {
  const previous = connectionLocks.get(connectionId) || Promise.resolve();
  const run = previous.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  connectionLocks.set(connectionId, tail);
  tail.then(() => { if (connectionLocks.get(connectionId) === tail) connectionLocks.delete(connectionId); });
  return run;
}

// Tracking codes already sent to this cashout with another commitment. Two
// items in one box share a tracking number, and the cashout only needs it
// once: EB's tracking submission is per account, not per commitment, so a
// second send would just make a duplicate entry there.
async function trackingAlreadySent(userId, connectionId, codes) {
  const wanted = new Set((codes || []).map((c) => String(c).trim().toUpperCase()).filter(Boolean));
  if (!wanted.size) return [];
  const sent = await prisma.cashoutCommitment.findMany({
    where: { user_id: userId, connection_id: connectionId, tracking_submitted_at: { not: null } },
  });
  const found = new Set();
  for (const row of sent) {
    for (const code of row.tracking_codes || []) {
      const key = String(code).trim().toUpperCase();
      if (wanted.has(key)) found.add(key);
    }
  }
  return (codes || []).filter((c) => found.has(String(c).trim().toUpperCase()));
}

// Sends the codes this connection hasn't been sent yet, under the lock.
//   { sent: [...], shared: [...] }  shared = skipped, already sent before
async function sendNewTracking(userId, ctx, { codes, description, insuredValue, commitmentId }) {
  return withConnectionLock(ctx.conn.id, async () => {
    const shared = await trackingAlreadySent(userId, ctx.conn.id, codes);
    const toSend = codes.filter((code) => !shared.includes(code));
    if (toSend.length) {
      await ebWrite(userId, {
        connectionId: ctx.conn.id, commitmentId, action: 'tracking', request: { tracking_codes: toSend, insured_value: insuredValue ?? null },
      }, () => ctx.adapter.submitTracking(ctx.rawKey, { trackingCodes: toSend, description: cleanDescription(description), insuredValue }));
    } else {
      await recordWrite(userId, { connectionId: ctx.conn.id, commitmentId, action: 'tracking', request: { tracking_codes: codes }, outcome: 'skipped' });
    }
    // Recorded before the lock is let go, so the next item in the same box
    // sees these numbers as sent.
    if (commitmentId) {
      const row = await prisma.cashoutCommitment.findFirst({ where: { id: commitmentId } });
      if (row) {
        await prisma.cashoutCommitment.update({
          where: { id: commitmentId },
          data: { tracking_codes: [...new Set([...(row.tracking_codes || []), ...codes])], tracking_submitted_at: new Date(), tracking_error: null },
        });
      }
    }
    return { sent: toSend, shared };
  });
}

// The manual "send tracking" route and MCP tool: exactly what was asked.
async function submitTracking(userId, connectionId, { trackingCodes, description, insuredValue }) {
  const codes = cleanTrackingCodes(trackingCodes);
  const insured = cleanInsuredValue(insuredValue);
  const ctx = await connectionAndAdapter(userId, connectionId);
  return withConnectionLock(ctx.conn.id, () => ebWrite(userId, {
    connectionId: ctx.conn.id, action: 'tracking', request: { tracking_codes: codes, insured_value: insured ?? null },
  }, () => ctx.adapter.submitTracking(ctx.rawKey, { trackingCodes: codes, description: cleanDescription(description), insuredValue: insured })));
}

// Sends a committed purchase's current sale tracking number: after the number
// changed, or when the first send failed. Skips a number already sent.
async function sendCommitmentTracking(userId, commitmentRecordId) {
  const record = await prisma.cashoutCommitment.findFirst({
    where: { id: commitmentRecordId, user_id: userId },
    include: { sale: true },
  });
  if (!record) throw notFound('Commitment');
  if (record.status !== 'active') throw fail(409, 'Only an active commitment can have tracking sent.');
  const tracking = cleanTrackingCode(record.sale?.tracking_number || '');
  const already = (record.tracking_codes || []).some((c) => c.toUpperCase() === tracking.toUpperCase());
  if (already && record.tracking_submitted_at && !record.tracking_error) {
    return { record, sent: [], shared: [tracking] };
  }
  const ctx = await connectionAndAdapter(userId, record.connection_id);
  const result = await sendNewTracking(userId, ctx, {
    codes: [tracking], description: `Commitment ${record.external_deal_id} x${record.quantity}`, commitmentId: record.id,
  });
  const updated = await prisma.cashoutCommitment.update({
    where: { id: record.id },
    data: {
      tracking_codes: [...new Set([...(record.tracking_codes || []), tracking])],
      tracking_submitted_at: new Date(),
      tracking_error: null,
    },
  });
  return { record: updated, ...result };
}

async function listTrackingSubmissions(userId, connectionId, pagination) {
  const { adapter, rawKey } = await connectionAndAdapter(userId, connectionId, { write: false });
  return adapter.listTrackingSubmissions(rawKey, pagination);
}

// For the sale routes: an active commitment whose sale tracking number is new
// to the cashout (changed after committing, or never sent).
async function trackingChangedForSale(saleId, trackingNumber) {
  const value = String(trackingNumber || '').trim();
  if (!value) return null;
  const record = await prisma.cashoutCommitment.findFirst({
    where: { sale_id: saleId, status: 'active' },
    include: { connection: true },
  });
  if (!record) return null;
  if ((record.tracking_codes || []).some((c) => c.toUpperCase() === value.toUpperCase())) return null;
  return {
    commitment_id: record.id,
    tracking_number: value,
    cashout: record.connection?.display_name || record.connection?.provider || 'the cashout',
  };
}

module.exports = {
  connectionAndAdapter,
  requireLiveItem,
  commitWithProvider,
  recoverStuck,
  openRowFor,
  ebWrite,
  recordWrite,
  isAmbiguous,
  listCommits,
  getCommit,
  createCommitment,
  updateCommitment,
  deleteCommitment,
  listLocalCommitments,
  submitTracking,
  sendNewTracking,
  sendCommitmentTracking,
  trackingAlreadySent,
  trackingChangedForSale,
  listTrackingSubmissions,
  cleanQuantity,
  cleanItemId,
  cleanDealId,
  cleanTrackingCode,
  cleanTrackingCodes,
  cleanInsuredValue,
  takeWriteToken,
  _resetWriteLimits: () => writeTimes.clear(),
  STUCK_MS,
};
