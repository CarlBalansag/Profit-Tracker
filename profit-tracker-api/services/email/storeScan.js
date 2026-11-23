// "Stores in your email": which stores send this user order-like email, so
// the ones ProfitTracker can't read yet can be requested. Only the sender and
// subject line of each email are looked at (envelope fetch, never the body),
// in memory. What is kept: the sender's domain, a store name and a count.
const { SENDERS, merchantFor } = require('./config');
const { looksPrivate, looksLikeMarketing } = require('./extract/generic');
const { openAccount } = require('./sync');

const MONTHS = 12;
const MAX_HEADERS = 4000;
const BATCH = 500;
const MIN_ORDER_EMAILS = 2;

// Mail services people write from: never a store.
const PERSONAL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'zoho.com', 'yandex.com', 'mail.com']);

// Store platforms that send many shops' mail from one domain.
const SHARED = { 'shopifyemail.com': 'shopify', 'shopify.com': 'shopify', 'squarespace.com': 'squarespace', 'bigcommerce.com': 'bigcommerce', 'wixemails.com': 'wix', 'square.com': 'square', 'squareup.com': 'square' };
const PLATFORM_LABEL = { shopify: 'Shopify store', squarespace: 'Squarespace store', bigcommerce: 'BigCommerce store', wix: 'Wix store', square: 'Square seller' };

// Order-like subject lines. Ads also say "order", so marketing wording and
// sign-in mail are left out before counting.
const ORDERISH = /\b(order|receipt|invoice|purchase|shipped|shipment|shipping confirmation|delivered|out for delivery|tracking|refund|return label|payment received|thanks for (your )?(order|purchase))\b/i;

// shop.example.co.uk -> example.co.uk; mail.store.com -> store.com
function baseDomain(address) {
  const domain = String(address || '').toLowerCase().trim().split('@')[1] || '';
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return null;
  const parts = domain.split('.');
  const take = parts.length > 2 && parts[parts.length - 1].length === 2 && ['co', 'com', 'org', 'net', 'ac', 'gov'].includes(parts[parts.length - 2]) ? 3 : 2;
  return parts.slice(-take).join('.');
}

// "Target <orders@oe.target.com>" -> "Target"; no-reply names fall back to the domain.
function storeName(names, domain) {
  const counts = new Map();
  for (const n of names) {
    const clean = String(n || '').replace(/["']/g, '').replace(/\b(no-?reply|do not reply|notifications?|customer service|orders?|support|team|info|mail(er)?)\b/gi, '').replace(/[|·•:-]+$/g, '').trim();
    if (clean.length >= 2 && clean.length <= 40 && !clean.includes('@')) counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  if (!domain) return null;
  const first = domain.split('.')[0];
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// headers: [{ fromAddress, fromName, subject, date }] -> per-domain tallies.
// Supported stores and the user's own trusted senders are counted apart.
function tally(headers, { trusted = new Set() } = {}) {
  const supported = new Map();
  const others = new Map();
  for (const h of headers) {
    const subject = h.subject || '';
    if (!ORDERISH.test(subject) || looksPrivate(subject) || looksLikeMarketing(subject, '')) continue;
    const known = merchantFor(h.fromAddress);
    if (known) { supported.set(known, (supported.get(known) || 0) + 1); continue; }
    const base = baseDomain(h.fromAddress);
    if (!base || PERSONAL.has(base) || trusted.has(base)) continue;
    // Many small shops send through one platform's domain: tell them apart by name.
    let domain = base;
    if (SHARED[base]) {
      const name = storeName([h.fromName], '');
      if (!name) continue;
      domain = `${SHARED[base]}:${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    }
    const row = others.get(domain) || { domain, count: 0, names: [], last: null };
    row.count += 1;
    if (h.fromName) row.names.push(h.fromName);
    if (h.date && (!row.last || h.date > row.last)) row.last = h.date;
    others.set(domain, row);
  }
  return {
    supported: [...supported.entries()].map(([key, count]) => ({ key, label: SENDERS.find((s) => s.key === key)?.label || key, order_emails: count }))
      .sort((a, b) => b.order_emails - a.order_emails),
    candidates: [...others.values()].filter((r) => r.count >= MIN_ORDER_EMAILS)
      .map((r) => ({ domain: r.domain, label: storeName(r.names, r.domain), order_emails: r.count, last_seen: r.last }))
      .sort((a, b) => b.order_emails - a.order_emails)
      .slice(0, 50),
  };
}

// Reads the senders and subjects of the newest emails (up to MAX_HEADERS from
// the last MONTHS) in each connected inbox, then saves the unsupported stores.
async function scanStores(prisma, userId, deps = {}) {
  const started = Date.now();
  const budgetMs = deps.budgetMs || 25000;
  const accounts = await prisma.emailAccount.findMany({ where: { user_id: userId, status: 'active', encrypted_secret: { not: null } } });
  if (!accounts.length) return { scanned: 0, accounts: 0 };
  const rules = await prisma.emailMerchantRule.findMany({ where: { user_id: userId, domain: { not: null } }, select: { domain: true } });
  const trusted = new Set(rules.map((r) => r.domain));
  const since = new Date(Date.now() - MONTHS * 31 * 86400000);
  const headers = [];
  let complete = true;
  for (const account of accounts) {
    let client;
    try {
      client = await openAccount(account, deps);
      await client.openReadOnly('INBOX');
      const uids = await client.searchUids({ domains: [], since });
      const newest = uids.slice(-MAX_HEADERS).reverse();
      if (uids.length > MAX_HEADERS) complete = false;
      for (let i = 0; i < newest.length; i += BATCH) {
        if (Date.now() - started > budgetMs) { complete = false; break; }
        headers.push(...await client.fetchHeaders(newest.slice(i, i + BATCH)));
      }
      await prisma.emailAccount.update({ where: { id: account.id }, data: { stores_scanned_at: new Date() } });
    } catch (err) {
      console.error(`[email] store scan failed for an account: ${err?.code || err?.name || 'error'}`);
      complete = false;
    } finally {
      if (client) await client.close();
    }
  }
  const { supported, candidates } = tally(headers, { trusted });
  const now = new Date();
  // Stores this check didn't find again drop off the list, unless requested or
  // hidden (a hidden store stays hidden if it turns up again).
  if (headers.length) {
    await prisma.emailStoreCandidate.deleteMany({ where: { user_id: userId, requested_at: null, hidden_at: null, domain: { notIn: candidates.map((c) => c.domain) } } });
  }
  for (const c of candidates) {
    await prisma.emailStoreCandidate.upsert({
      where: { user_id_domain: { user_id: userId, domain: c.domain } },
      create: { user_id: userId, ...c, scanned_at: now },
      update: { label: c.label, order_emails: c.order_emails, last_seen: c.last_seen, scanned_at: now },
    });
  }
  return { scanned: headers.length, accounts: accounts.length, complete, supported };
}

// What to show for where a store's mail comes from: its domain, or the platform.
const sourceLabel = (domain) => PLATFORM_LABEL[String(domain).split(':')[0]] || domain;

module.exports = { scanStores, tally, baseDomain, storeName, sourceLabel, PERSONAL, MAX_HEADERS, MONTHS };
