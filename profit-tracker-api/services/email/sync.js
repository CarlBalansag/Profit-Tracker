// Email sync: for each connected mailbox, search INBOX (and spam/junk when the
// user turned that on) for mail FROM the sender allow-list since the chosen
// date, and save each match's headers. Bodies are never downloaded here.
//
// Cursors: the last UID read per folder, with the folder's UIDVALIDITY. A new
// UIDVALIDITY means the server renumbered the folder, so its cursor resets and
// the window is scanned again; the dedupe key keeps that from adding copies.
const crypto = require('node:crypto');
const defaultPrisma = require('../../prisma');
const { PRESETS, SENDERS, merchantFor, normalizeHost, loginName } = require('./config');
const { decryptSecret } = require('./crypto');
const { resolvePublicHost } = require('./hostCheck');
const { openImap, friendlyError } = require('./imap');
const { parseSource, extractEmail, parserVersion, GENERIC_VERSION } = require('./extract');
const { MERCHANTS } = require('./extract/merchants');
const { groupMessages, recompute } = require('./orders');
const { matchOrders } = require('./match');
const { getSettings } = require('./settings');
const { applyRules, customMerchant } = require('./rules');
const { applyOrderUpdates, applyCashoutReceipts, applyCashoutChecks, createMissingPurchases, namePlaceholderPurchases } = require('./automations');
const { sortOrders } = require('./sorting');
const { pdfText, mergePdfDetails, firstPdf } = require('./attachments');
const { looksPrivate } = require('./extract/generic');

const PRIVATE_ROW = (merchant) => ({ subject: null, status: 'ignored', kind: 'other', parser_version: parserVersion(merchant), extracted_at: new Date() });

const DOMAINS = SENDERS.flatMap((s) => s.domains);
const BATCH = 50;
const MAX_PER_RUN = 500; // per account per run; the rest waits for the next run
const LEASE_MS = 10 * 60 * 1000;
const SPAM_NAME = /(^|[/.])(spam|junk|bulk(\s*mail)?)$/i;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);

// The same email in two connected accounts (a forwarded copy) has the same
// Message-ID, so it is kept once. Without one, the key is per account.
function dedupeKey(accountId, h) {
  if (h.messageId && h.messageId.trim()) return `mid:${sha(h.messageId.trim().toLowerCase())}`;
  return `syn:${sha([accountId, h.fromAddress, h.date ? h.date.toISOString() : '', h.subject || ''].join('\n'))}`;
}

function foldersToRead(preset, includeSpam, listed) {
  const inbox = listed.find((f) => f.path.toUpperCase() === 'INBOX')?.path || 'INBOX';
  if (!includeSpam) return [inbox];
  const spam = listed.length
    ? listed.filter((f) => f.path !== inbox && (f.specialUse === '\\Junk' || SPAM_NAME.test(f.path))).map((f) => f.path)
    : (PRESETS[preset] || PRESETS.other).spamFolders;
  return [inbox, ...new Set(spam)];
}

// Opens a connected account's mailbox (read-only reader), e.g. to fetch an
// invoice again.
async function openAccount(account, deps = {}) {
  let pass;
  try { pass = decryptSecret(account.encrypted_secret); } catch { throw Object.assign(new Error('Enter the app password for this account again.'), { userFacing: true }); }
  return (deps.open || openImap)(await imapTarget(account, pass, deps.resolve));
}

async function imapTarget(account, pass, resolve = resolvePublicHost) {
  const host = normalizeHost(account.imap_host);
  return {
    address: await resolve(host),
    servername: host,
    port: account.imap_port || 993,
    user: loginName(account.preset, account.imap_username, account.email_address),
    pass,
  };
}

// Used before an account is saved, and when its password is replaced.
async function testConnection(details, deps = {}) {
  const client = await (deps.open || openImap)(await imapTarget(details, details.password, deps.resolve));
  try {
    await client.openReadOnly('INBOX');
  } finally {
    await client.close();
  }
}

const clip = (value, max) => (value == null ? null : String(value).slice(0, max));

async function syncAccount(accountId, deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const now = deps.now ? deps.now() : new Date();
  const budgetMs = deps.budgetMs ?? 40000;
  const started = Date.now();

  // One sync per account at a time. A lease older than LEASE_MS is a crashed
  // run and can be taken over.
  const claim = await prisma.emailAccount.updateMany({
    where: {
      id: accountId,
      status: { not: 'disconnected' },
      encrypted_secret: { not: null },
      OR: [{ sync_started_at: null }, { sync_started_at: { lt: new Date(now.getTime() - LEASE_MS) } }],
    },
    data: { sync_started_at: now },
  });
  if (claim.count === 0) return { status: 'busy' };
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });

  let client = null;
  let found = 0;
  let more = false;
  try {
    let pass;
    try {
      pass = decryptSecret(account.encrypted_secret);
    } catch {
      throw Object.assign(new Error('Enter the app password for this account again.'), { userFacing: true, needsUser: true });
    }
    client = await (deps.open || openImap)(await imapTarget(account, pass, deps.resolve));

    // The user's own trusted senders (subscriptions, tools) join the search.
    const customRules = await prisma.emailMerchantRule.findMany({ where: { user_id: account.user_id, domain: { not: null } }, select: { merchant: true, domain: true } });
    const domains = [...DOMAINS, ...customRules.map((r) => r.domain)];
    const merchantOf = (address) => merchantFor(address) || customMerchant(address, customRules);

    let listed = [];
    if (account.include_spam) {
      try { listed = await client.listFolders(); } catch { listed = []; }
    }
    let remaining = MAX_PER_RUN;
    for (const folder of foldersToRead(account.preset, account.include_spam, listed)) {
      if (remaining <= 0 || Date.now() - started > budgetMs) { more = true; break; }
      let box;
      try {
        box = await client.openReadOnly(folder);
      } catch (err) {
        if (folder.toUpperCase() === 'INBOX') throw err;
        continue; // a guessed spam folder that doesn't exist
      }
      const cursor = await prisma.emailFolderCursor.findUnique({ where: { account_id_folder: { account_id: account.id, folder } } });
      const renumbered = cursor?.uid_validity && box.uidValidity && cursor.uid_validity !== box.uidValidity;
      let lastUid = cursor && !renumbered ? cursor.last_uid : 0;

      let uids = await client.searchUids({ domains, since: account.sync_since, afterUid: lastUid });
      // Senders added since this folder was last read (a new built-in store)
      // are searched over the whole window once. Emails already saved are
      // skipped by their dedupe key.
      const known = lastUid > 0 && cursor?.domains?.length ? cursor.domains : null;
      const added = lastUid > 0 ? domains.filter((d) => !known || !known.includes(d)) : [];
      if (added.length) {
        const earlier = (await client.searchUids({ domains: added, since: account.sync_since })).filter((u) => u <= lastUid);
        uids = [...new Set([...earlier, ...uids])].sort((a, b) => a - b);
      }
      const take = uids.slice(0, remaining);
      if (uids.length > take.length) more = true;
      // The cursor's sender list: senders whose emails up to last_uid have all
      // been looked at. Added senders join it once their earlier emails are done.
      const caughtUp = () => (!added.length || take.length === uids.length ? { domains } : {});
      const saveCursor = (done = false) => prisma.emailFolderCursor.upsert({
        where: { account_id_folder: { account_id: account.id, folder } },
        create: { account_id: account.id, folder, uid_validity: box.uidValidity, last_uid: lastUid, ...(done ? caughtUp() : {}) },
        update: { uid_validity: box.uidValidity, last_uid: lastUid, ...(done ? caughtUp() : {}) },
      });

      for (let i = 0; i < take.length; i += BATCH) {
        if (Date.now() - started > budgetMs) { more = true; break; }
        const batch = take.slice(i, i + BATCH);
        const headers = await client.fetchHeaders(batch);
        const rows = headers
          .map((h) => ({ h, merchant: merchantOf(h.fromAddress) }))
          .filter(({ merchant }) => merchant)
          .map(({ h, merchant }) => ({
            user_id: account.user_id,
            account_id: account.id,
            dedupe_key: dedupeKey(account.id, h),
            message_id: clip(h.messageId, 500),
            folder,
            uid: h.uid,
            from_address: clip(h.fromAddress, 320),
            from_name: clip(h.fromName, 200),
            subject: clip(h.subject, 256),
            sent_at: h.date && !Number.isNaN(h.date.getTime()) ? h.date : null,
            merchant,
            uid_validity: box.uidValidity,
            // Sign-in codes and security notices: never read, subject not kept.
            ...(looksPrivate(h.subject) ? PRIVATE_ROW(merchant) : {}),
          }));
        if (rows.length) {
          const saved = await prisma.emailMessage.createMany({ data: rows, skipDuplicates: true });
          found += saved.count;
        }
        lastUid = Math.max(lastUid, ...batch);
        remaining -= batch.length;
        await saveCursor(i + BATCH >= take.length);
      }
      if (!take.length) await saveCursor(true);
    }

    const read = Date.now() - started < budgetMs
      ? await extractPending(prisma, client, account, { started, budgetMs, onRead: deps.onRead })
      : { read: 0, more: true };

    const matched = await organize(prisma, account.user_id);

    // Only while this run still holds the lease: a disconnect during the run
    // clears it, and must not be undone here.
    await prisma.emailAccount.updateMany({
      where: { id: account.id, sync_started_at: now },
      data: { status: 'active', last_error: null, last_synced_at: now, sync_started_at: null },
    });
    return { status: 'ok', found, read: read.read, more: more || read.more, matched };
  } catch (err) {
    // A rejected password needs the user; anything else is retried next run.
    const needsUser = Boolean(err?.needsUser || err?.authenticationFailed);
    console.error(`[email] sync failed for account ${account.id}: ${err?.code || (needsUser ? 'auth' : 'error')}`);
    await prisma.emailAccount.updateMany({
      where: { id: account.id, sync_started_at: now },
      data: { status: needsUser ? 'error' : 'active', last_error: friendlyError(err), sync_started_at: null },
    });
    return { status: 'error', found, error: friendlyError(err) };
  } finally {
    if (client) await client.close();
  }
}

const READ_BATCH = 20;
const READ_PER_RUN = 200;

// Reads order details out of emails found earlier (status "new") or read by
// an older version of a store's reader. Each body is fetched, read in memory
// and dropped; only the details are saved.
async function extractPending(prisma, client, account, { started, budgetMs, onRead }) {
  // Only emails that still need reading: never read, or read by an older
  // version of the shared reader or of their store's template. (Asking for the
  // newest 2,000 of all emails left older ones in a big inbox unread forever.)
  const read = { in: ['extracted', 'ignored'] };
  const candidates = await prisma.emailMessage.findMany({
    where: {
      account_id: account.id,
      OR: [
        { status: 'new' },
        { status: read, parser_version: null },
        { status: read, parser_version: { lt: GENERIC_VERSION * 1000 } },
        ...Object.keys(MERCHANTS).map((merchant) => ({ status: read, merchant, parser_version: { lt: parserVersion(merchant) } })),
      ],
    },
    select: { id: true, folder: true, uid: true, uid_validity: true, message_id: true, merchant: true, status: true, parser_version: true, subject: true, order_id: true, order_number: true, tracking_numbers: true },
    orderBy: [{ sent_at: { sort: 'desc', nulls: 'last' } }],
    take: 2000,
  });
  // Orders whose emails were read again: their totals and status are worked
  // out again at the end, and an order left with no emails goes away.
  const stale = new Set();
  try {
    return await readDue(prisma, client, account, candidates, stale, { started, budgetMs, onRead });
  } finally {
    for (const id of stale) await recompute(prisma, id);
  }
}

// An email read again stays in its order while its order number and tracking
// numbers are the same (so links, "Not this" and "Not business" choices are
// kept); otherwise it leaves the order and is grouped again.
function leavesOrder(m, details) {
  if (details.status !== 'extracted') return true;
  const same = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());
  return (m.order_number || null) !== (details.order_number || null) || !same(m.tracking_numbers, details.tracking_numbers);
}

async function readDue(prisma, client, account, candidates, stale, { started, budgetMs, onRead }) {
  // Saved before this check existed: drop the subject without reading the email.
  const hidden = candidates.filter((m) => m.subject && looksPrivate(m.subject));
  for (const m of hidden) {
    await prisma.emailMessage.update({ where: { id: m.id }, data: { ...PRIVATE_ROW(m.merchant), order_id: null } });
    if (m.order_id) stale.add(m.order_id);
  }
  for (const m of hidden) { m.status = 'ignored'; m.parser_version = parserVersion(m.merchant); }
  const due = candidates.filter((m) => m.status === 'new' || (m.parser_version || 0) < parserVersion(m.merchant)).slice(0, READ_PER_RUN);
  let read = 0;
  const byFolder = new Map();
  for (const m of due) byFolder.set(m.folder, [...(byFolder.get(m.folder) || []), m]);

  for (const [folder, messages] of byFolder) {
    if (Date.now() - started > budgetMs) return { read, more: true };
    let box;
    try { box = await client.openReadOnly(folder); } catch { box = null; }
    // Where the folder was renumbered, look each email up again by Message-ID.
    const located = [];
    for (const m of messages) {
      if (box && m.uid_validity && m.uid_validity === box.uidValidity) { located.push({ m, uid: m.uid }); continue; }
      const uid = box ? await client.findUidByMessageId(m.message_id) : null;
      if (uid) located.push({ m, uid });
      else await markFailed(prisma, m.id, 'This email is no longer in the mailbox.');
    }
    for (let i = 0; i < located.length; i += READ_BATCH) {
      if (Date.now() - started > budgetMs) return { read, more: true };
      const batch = located.slice(i, i + READ_BATCH);
      const sources = new Map((await client.fetchSources(batch.map((b) => b.uid))).map((s) => [s.uid, s.source]));
      for (const { m, uid } of batch) {
        const source = sources.get(uid);
        if (!source) { await markFailed(prisma, m.id, 'This email is no longer in the mailbox.'); continue; }
        try {
          const parsed = await parseSource(source);
          let details = extractEmail({ merchant: m.merchant, ...parsed });
          const pdf = firstPdf(parsed.attachments);
          if (pdf) {
            try {
              const text = await pdfText(pdf.content);
              details = mergePdfDetails(details, extractEmail({ merchant: m.merchant, subject: parsed.subject, text }));
            } catch { /* an unreadable PDF leaves the body's details as they are */ }
            details.attachment_name = String(pdf.filename || 'invoice.pdf').slice(0, 200);
          }
          const leaves = m.order_id && leavesOrder(m, details);
          await prisma.emailMessage.update({
            where: { id: m.id },
            data: { ...details, uid, uid_validity: box.uidValidity, extracted_at: new Date(), extract_error: null, ...(leaves ? { order_id: null } : {}) },
          });
          if (m.order_id) stale.add(m.order_id);
          if (onRead) await onRead({ message: m, parsed, details });
          read += 1;
        } catch (err) {
          console.error(`[email] could not read message ${m.id}: ${err?.code || 'parse'}`);
          await markFailed(prisma, m.id, 'This email could not be read.');
        }
      }
    }
  }
  return { read, more: due.length >= READ_PER_RUN };
}

// Groups newly read emails into orders and matches orders to records. Open
// orders from the last 60 days are matched again too, since a purchase may
// be entered after its email arrived. A failure here never fails the sync.
async function organize(prisma, userId) {
  try {
    const changed = await groupMessages(prisma, userId);
    const open = await prisma.emailOrder.findMany({
      where: { user_id: userId, match_state: { in: ['unmatched', 'review'] }, last_seen: { gte: new Date(Date.now() - 60 * 86400000) }, id: { notIn: changed } },
      select: { id: true }, orderBy: { last_seen: 'desc' }, take: 100,
    });
    const settings = await getSettings(prisma, userId);
    const matched = await matchOrders(prisma, userId, [...changed, ...open.map((o) => o.id)], { autoLink: settings.linkMatches });
    const ruled = await applyRules(prisma, userId, { createExpenses: settings.createExpenses });
    const sorted = await sortOrders(prisma, userId, settings);
    const purchases = settings.createPurchases ? await createMissingPurchases(prisma, userId) : 0;
    const updates = await applyOrderUpdates(prisma, userId, settings);
    await namePlaceholderPurchases(prisma, userId).catch((err) => console.error('[email] naming purchases skipped:', err?.code || err?.message));
    const cashoutsPaid = await applyCashoutReceipts(prisma, userId, settings);
    // Checks after receipts, so a receipt and its check in one sync line up.
    const checksMoved = await applyCashoutChecks(prisma, userId, settings);
    return { ...matched, ...ruled, sorted, purchasesCreated: purchases, updates, cashoutsPaid, checksMoved };
  } catch (err) {
    console.error(`[email] matching failed for user ${userId}: ${err?.code || err?.name || 'error'}`);
    return null;
  }
}

const markFailed = (prisma, id, message) => prisma.emailMessage.update({
  where: { id }, data: { status: 'failed', extract_error: message, extracted_at: new Date() },
});

// Keeps syncing one account until it is caught up (a new connection, or Sync
// now on a big inbox), instead of leaving the rest for the cron's next runs.
// Accounts being caught up are listed in `catchingUp` (this server only), so
// the Settings card can show that more is coming.
const catchingUp = new Set();
async function catchUp(accountId, deps = {}, { maxRuns = 30, maxMs = 15 * 60 * 1000 } = {}) {
  if (catchingUp.has(accountId)) return { status: 'busy' };
  catchingUp.add(accountId);
  const started = Date.now();
  let result = { status: 'ok', more: true };
  try {
    for (let run = 0; run < maxRuns && result.more && Date.now() - started < maxMs; run += 1) {
      result = await syncAccount(accountId, deps);
      if (result.status !== 'ok') break;
    }
  } finally {
    catchingUp.delete(accountId);
  }
  return result;
}

// Called by the outside cron. Oldest-synced accounts go first; whatever doesn't
// fit in the time budget goes first next time.
async function runScheduledEmailSync(deps = {}) {
  const prisma = deps.prisma || defaultPrisma;
  const totalBudget = deps.totalBudgetMs ?? 50000;
  const started = Date.now();
  const accounts = await prisma.emailAccount.findMany({
    where: { status: 'active', encrypted_secret: { not: null } },
    orderBy: [{ last_synced_at: { sort: 'asc', nulls: 'first' } }],
    select: { id: true },
    take: 50,
  });
  const summary = { accounts: accounts.length, synced: 0, found: 0, errors: 0, skipped: 0 };
  for (const { id } of accounts) {
    const left = totalBudget - (Date.now() - started);
    if (left < 5000) { summary.skipped += 1; continue; }
    const result = await syncAccount(id, { ...deps, budgetMs: Math.min(deps.budgetMs ?? 40000, left - 2000) });
    if (result.status === 'ok') { summary.synced += 1; summary.found += result.found; }
    else if (result.status === 'error') summary.errors += 1;
    else summary.skipped += 1;
  }
  return summary;
}

function verifySyncSecret(authHeader) {
  const secret = process.env.EMAIL_SYNC_SECRET?.trim();
  if (!secret) return { ok: false, status: 401, message: 'Email sync secret is not configured on server.' };
  const match = /^Bearer\s+(\S+)$/i.exec(String(authHeader || '').trim());
  if (!match) return { ok: false, status: 401, message: 'Missing or invalid Authorization header.' };
  const given = Buffer.from(match[1]);
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return { ok: false, status: 401, message: 'Invalid email sync secret.' };
  }
  return { ok: true };
}

module.exports = { openAccount, organize, extractPending, syncAccount, catchUp, catchingUp, runScheduledEmailSync, testConnection, verifySyncSecret, dedupeKey, foldersToRead, MAX_PER_RUN };
