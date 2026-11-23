// The Automation page's review of what the email sync did on its own.
//   confirm  the user agrees; the change stays and moves to Completed.
//   reject   "No": the change is taken back (Undo), and the order is unlinked
//            or set aside so the next sync doesn't do it again.
// Emails themselves are never touched.
const prisma = require('../../prisma');
const { undoActivity, UNDO_WINDOW_DAYS } = require('../activityLog');

const requestError = (status, message) => Object.assign(new Error(message), { status });

const OPEN = { source: 'email', review_state: null, undone_at: null };

async function toConfirmCount(userId) {
  return prisma.activityLog.count({ where: { user_id: userId, ...OPEN } });
}

async function confirmEntries(userId, ids) {
  const { count } = await prisma.activityLog.updateMany({
    where: { user_id: userId, id: { in: ids }, ...OPEN },
    data: { review_state: 'confirmed', reviewed_at: new Date() },
  });
  return count;
}

// The email order an automatic change came from: tagged on the entry, the
// order itself (links, set-asides), or the order linked to the record it changed.
async function orderIdFor(userId, entry) {
  const d = entry.detail || {};
  if (d.email_order_id) return d.email_order_id;
  if (entry.record_type === 'email_link' || entry.record_type === 'email_sort') return entry.record_id;
  const ids = [entry.record_id, ...(d.rows || []).map((r) => r.id)].filter(Boolean);
  const match = await prisma.emailMatch.findFirst({ where: { user_id: userId, state: 'linked', record_ids: { hasSome: ids } }, orderBy: { decided_at: 'desc' } });
  return match?.order_id || null;
}

const isCreate = (entry) => entry.kind === 'change' && entry.detail?.action === 'create';

// Unlinks an order and keeps it from being linked or added again on its own.
async function unlink(userId, orderId, { declined }) {
  await prisma.$transaction([
    prisma.emailMatch.updateMany({ where: { user_id: userId, order_id: orderId, state: { in: ['linked', 'suggested'] } }, data: { state: 'rejected', decided_at: new Date() } }),
    prisma.emailOrder.updateMany({
      where: { id: orderId, user_id: userId },
      data: { match_state: 'unmatched', applied_status: null, ...(declined ? { leaning: 'declined', leaning_reason: 'You said no to the automatic one' } : {}) },
    }),
  ]);
}

const TABLE = { inventory: 'inventory', sales: 'sales' };
async function undoIfOpen(userId, entry) {
  if (entry.kind === 'event' || entry.undone_at) return;
  await undoActivity(userId, entry.id);
  // Undo leaves the carrier alone (tracking refreshes rewrite it), so the
  // carrier that came with a tracking number the email added goes with it.
  const rows = (entry.detail?.rows || []).filter((r) => TABLE[r.model] && r.fields?.tracking_number && !r.fields.tracking_number.before);
  for (const r of rows) {
    const owner = r.model === 'sales' ? { inventory: { user_id: userId } } : { user_id: userId };
    await prisma[TABLE[r.model]].updateMany({ where: { id: r.id, tracking_number: null, ...owner }, data: { carrier: null } });
  }
  if (entry.kind === 'status' && entry.detail?.fields?.tracking_number && !entry.detail.fields.tracking_number.before) {
    await prisma.inventory.updateMany({ where: { id: entry.record_id, user_id: userId, tracking_number: null }, data: { carrier: null } });
  }
}

async function rejectEntry(userId, entryId) {
  const entry = await prisma.activityLog.findFirst({ where: { id: entryId, user_id: userId, source: 'email' } });
  if (!entry) throw requestError(404, 'This change was not found.');
  if (entry.review_state === 'rejected') throw requestError(409, 'You already said no to this one.');
  if (entry.undone_at) throw requestError(409, 'This was already undone.');
  if (entry.kind !== 'event' && Date.now() - new Date(entry.created_at).getTime() > UNDO_WINDOW_DAYS * 86400000) {
    throw requestError(409, `Only the last ${UNDO_WINDOW_DAYS} days can be taken back.`);
  }
  const orderId = await orderIdFor(userId, entry);

  if (entry.record_type === 'email_sort') {
    // Set aside as personal -> it's business after all.
    await prisma.emailOrder.updateMany({ where: { id: entry.record_id, user_id: userId, match_state: 'dismissed' }, data: { match_state: 'unmatched', leaning: 'kept', leaning_reason: "You said it's business" } });
  } else if (entry.record_type === 'email_link') {
    // The link and everything the email did through it (the fill is logged
    // just before the link), newest first.
    if (orderId) {
      const related = await prisma.activityLog.findMany({ where: { user_id: userId, source: 'email', undone_at: null, kind: { not: 'event' } }, orderBy: { created_at: 'desc' }, take: 500 });
      for (const other of related) {
        if (other.id === entry.id || isCreate(other)) continue;
        if ((other.detail || {}).email_order_id !== orderId) continue;
        await undoIfOpen(userId, other);
        await prisma.activityLog.update({ where: { id: other.id }, data: { review_state: 'rejected', reviewed_at: new Date() } });
      }
      await unlink(userId, orderId, { declined: false });
    }
  } else {
    await undoIfOpen(userId, entry);
    // A record made from the email: never made again on its own.
    if (isCreate(entry) && orderId) await unlink(userId, orderId, { declined: true });
  }
  await prisma.activityLog.update({ where: { id: entry.id }, data: { review_state: 'rejected', reviewed_at: new Date() } });
  return { rejected: true };
}

module.exports = { toConfirmCount, confirmEntries, rejectEntry, orderIdFor };

// ─── Where a change came from: the email itself, and the store's order page ──
// Gmail opens one message from its Message-ID (search rfc822msgid:), in the
// right account when several are signed in (authuser). Other providers have no
// such link, so only the subject is shown.
const { SENDERS } = require('./config');

const storeLabel = (merchant) => SENDERS.find((s) => s.key === merchant)?.label || String(merchant || '').replace(/^custom:/, '');
function emailUrl(account, messageId) {
  if (!account || !messageId || account.preset !== 'gmail') return null;
  const id = messageId.replace(/^<|>$/g, '');
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email_address)}#search/rfc822msgid%3A${encodeURIComponent(id)}`;
}
// Order pages whose address is the order number (others have no such page).
const ORDER_PAGES = {
  amazon: (n) => /^\d{3}-\d{7}-\d{7}$/.test(n) && `https://www.amazon.com/gp/your-account/order-details?orderID=${n}`,
  walmart: (n) => /^\d{7}-?\d{8}$/.test(n) && `https://www.walmart.com/orders/${n.replace('-', '')}`,
  target: (n) => /^\d{12,15}$/.test(n) && `https://www.target.com/orders/${n}`,
};
const storeOrderUrl = (merchant, n) => (n && ORDER_PAGES[merchant] ? ORDER_PAGES[merchant](n) || null : null);

// Which of the order's emails a change most likely came from.
const SHIPPING_KINDS = ['shipped', 'delivered', 'pickup'];
const FIRST_KINDS = ['order', 'receipt', 'payout', 'sale', 'check'];
function pickEmail(entry, emails) {
  const d = entry.detail || {};
  const fields = { ...(d.fields || {}), ...Object.assign({}, ...(d.rows || []).map((r) => r.fields || {})) };
  const shipping = entry.kind === 'status' || fields.tracking_number || fields.return_by_date;
  const prefer = shipping ? SHIPPING_KINDS : FIRST_KINDS;
  return emails.find((m) => prefer.includes(m.kind)) || emails[0] || null;
}

// A purchase made from an email with no item name ("GameStop order 1101…"):
// names of the user's own past purchases from the same store at the same
// unit price, most used first, so one tap can name it.
const isPlaceholder = (name, store) => String(name || '').startsWith(`${store} order`);
async function nameHints(userId, row, store) {
  const unit = Number(row.unit_purchase_cost);
  if (!store || !Number.isFinite(unit) || unit <= 0) return [];
  const past = await prisma.inventory.findMany({
    where: {
      user_id: userId, id: { not: row.id }, vendor: { name: { equals: store, mode: 'insensitive' } },
      unit_purchase_cost: { gte: unit - 0.01, lte: unit + 0.01 },
      NOT: { product_name: { startsWith: `${store} order` } },
    },
    select: { product_name: true, purchase_date: true },
    orderBy: { purchase_date: 'desc' },
    take: 200,
  });
  const byName = new Map();
  for (const p of past) {
    const key = p.product_name.trim().toLowerCase();
    const hit = byName.get(key) || { name: p.product_name.trim(), times: 0, last_date: p.purchase_date };
    hit.times += 1;
    byName.set(key, hit);
  }
  return [...byName.values()].sort((a, b) => b.times - a.times || b.last_date - a.last_date).slice(0, 3);
}

// The purchase a "made from email" change created (one row only), for naming.
const createdPurchaseId = (entry) => {
  const d = entry.detail || {};
  if (entry.record_type !== 'purchase' || d.action !== 'create') return null;
  const rows = (d.rows || []).filter((r) => r.model === 'inventory' && r.op === 'create');
  return rows.length === 1 ? rows[0].id : null;
};

// Names the purchase an automatic change made (Use this name). Logged as the
// user's edit, with Undo.
async function namePurchase(userId, entryId, name) {
  const { trackChange } = require('../activityLog');
  const entry = await prisma.activityLog.findFirst({ where: { id: entryId, user_id: userId, source: 'email' } });
  const id = entry && createdPurchaseId(entry);
  if (!id) throw requestError(404, 'This change has no purchase to name.');
  const row = await prisma.inventory.findFirst({ where: { id, user_id: userId }, select: { id: true } });
  if (!row) throw requestError(404, 'This purchase no longer exists.');
  await prisma.$transaction((tx) => trackChange(tx, userId, {
    action: 'edit', recordType: 'purchase', source: 'web', recordId: id,
    refs: async () => ({ inventory: [id] }),
  }, () => tx.inventory.update({ where: { id }, data: { product_name: name } })));
  return { id, product_name: name };
}

// Adds `email_source` to each Automation entry: { store, order_number,
// store_url, email: { subject, sent_at, url }, emails }, and for a purchase
// made from an email, `purchase`: { id, name, placeholder, hints }.
async function attachSources(userId, entries) {
  const withPurchases = await attachPurchases(userId, entries);
  return attachEmails(userId, withPurchases);
}

async function attachPurchases(userId, entries) {
  const ids = entries.map(createdPurchaseId).filter(Boolean);
  if (!ids.length) return entries;
  const rows = await prisma.inventory.findMany({ where: { id: { in: ids }, user_id: userId }, select: { id: true, product_name: true, unit_purchase_cost: true, vendor: { select: { name: true } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = [];
  for (const entry of entries) {
    const row = byId.get(createdPurchaseId(entry));
    if (!row) { out.push(entry); continue; }
    const store = row.vendor?.name || String(entry.detail?.product_name || '').replace(/ order.*$/, '');
    const placeholder = isPlaceholder(row.product_name, store);
    out.push({ ...entry, purchase: { id: row.id, name: row.product_name, placeholder, hints: placeholder ? await nameHints(userId, row, store) : [] } });
  }
  return out;
}

async function attachEmails(userId, entries) {
  const orderIds = new Map();
  for (const entry of entries) orderIds.set(entry.id, await orderIdFor(userId, entry).catch(() => null));
  const ids = [...new Set([...orderIds.values()].filter(Boolean))];
  if (!ids.length) return entries;
  const orders = await prisma.emailOrder.findMany({
    where: { id: { in: ids }, user_id: userId },
    select: {
      id: true, merchant: true, order_number: true,
      messages: { select: { subject: true, sent_at: true, kind: true, message_id: true, account: { select: { preset: true, email_address: true } } }, orderBy: { sent_at: 'asc' }, take: 20 },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  return entries.map((entry) => {
    const order = byId.get(orderIds.get(entry.id));
    if (!order) return entry;
    const best = pickEmail(entry, order.messages);
    const email = (m) => ({ subject: m.subject, sent_at: m.sent_at, kind: m.kind, url: emailUrl(m.account, m.message_id) });
    return {
      ...entry,
      email_source: {
        store: storeLabel(order.merchant), order_number: order.order_number,
        store_url: storeOrderUrl(order.merchant, order.order_number),
        email: best ? email(best) : null,
        emails: order.messages.map(email),
      },
    };
  });
}

module.exports.attachSources = attachSources;
module.exports.namePurchase = namePurchase;
module.exports.emailUrl = emailUrl;
module.exports.storeOrderUrl = storeOrderUrl;
