// LA (EarnFromBuying) cashout adapter. EarnFromBuying runs on the parsefile
// platform (identical to Points4Days). Has no public API, so the stored "key"
// is the user's own login, saved as encrypted JSON { email, password }
// like any other key (see crypto.js). Deals only for now: no commitments or
// tracking, so this adapter has none of eb.js's commit/tracking methods and
// commits.js refuses those calls for it.
const crypto = require('node:crypto');
const { ParsefileClient } = require('./parsefile');

const BASE_URL = 'https://www.earnfrombuying.com';
const NAME = 'LA';
const SETTINGS_NAME = 'EarnFromBuying (LA)';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

// Signed-in sessions, kept in memory only and keyed by a hash of the login,
// so a refresh doesn't sign in again every minute. A restart just signs in again.
const sessions = new Map();

function parseLogin(rawKey) {
  let login;
  try {
    login = JSON.parse(rawKey);
  } catch {
    login = null;
  }
  if (!login || typeof login.email !== 'string' || !login.email.trim() || typeof login.password !== 'string' || !login.password) {
    throw Object.assign(new Error(`${SETTINGS_NAME} login is missing. Reconnect with your email and password.`), { keyRejected: true });
  }
  return login;
}

const sessionKey = (rawKey) => crypto.createHash('sha256').update(rawKey).digest('hex');

// Store names for the buy links, from the link's address. Matched on the whole
// host first (short links, store subdomains), then on the site's own name.
const STORE_HOSTS = {
  'a.co': 'Amazon', 'amzn.to': 'Amazon', 'amzn.com': 'Amazon',
  'direct.playstation.com': 'PlayStation Direct',
};
const STORE_NAMES = {
  amazon: 'Amazon', bestbuy: 'Best Buy', walmart: 'Walmart', target: 'Target', costco: 'Costco',
  samsclub: "Sam's Club", newegg: 'Newegg', bhphotovideo: 'B&H', apple: 'Apple', staples: 'Staples',
  gamestop: 'GameStop', dell: 'Dell', microcenter: 'Micro Center', lenovo: 'Lenovo', playstation: 'PlayStation',
  samsung: 'Samsung', microsoft: 'Microsoft', nintendo: 'Nintendo', hp: 'HP', woot: 'Woot', ebay: 'eBay',
  homedepot: 'Home Depot', kohls: "Kohl's", lowes: "Lowe's", google: 'Google', sony: 'Sony',
};
function storeName(url) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (STORE_HOSTS[host]) return STORE_HOSTS[host];
  const labels = host.split('.');
  const site = labels.length > 1 ? labels[labels.length - 2] : labels[0];
  return STORE_NAMES[site] || site.charAt(0).toUpperCase() + site.slice(1);
}

// Into the same deal shape eb.js returns, so the Cashout page shows it as-is.
function toDeal(deal) {
  const notes = [];
  if (deal.commitRequired) notes.push(`Commitment required on ${NAME}.`);
  if (deal.locked) notes.push('Commitments are locked for this deal.');
  if (deal.insurance > 0) notes.push(`Insurance $${deal.insurance.toFixed(2)} per unit.`);

  const items = deal.items.filter((item) => item.active);
  return {
    id: deal.id,
    provider: 'la',
    name: deal.title,
    imageUrl: items.find((item) => item.imageUrl)?.imageUrl || null,
    retail: deal.retail,
    payout: deal.payout,
    profitMargin: deal.retail ? Math.round((deal.payout - deal.retail) * 100) / 100 : 0,
    productLinks: [],
    categoryId: null,
    expiresAt: null,
    startsAt: null,
    featured: false,
    notes: notes.join('\n') || null,
    status: 'active',
    onSaleNow: null,
    createdAt: null,
    avgRemainingPercentage: null,
    commitRequired: deal.commitRequired,
    dealUrl: deal.url,
    items: items.map((item) => ({
      id: item.id,
      name: item.name,
      condition: 'new',
      upcs: item.upc ? [item.upc] : [],
      sku: item.sku,
      purchaseLinks: item.links.map((url) => ({ name: storeName(url), url })),
      vendorLimit: null,
      remainingPercentage: null,
    })),
  };
}

async function signIn(rawKey) {
  const { email, password } = parseLogin(rawKey);
  const client = new ParsefileClient({ baseUrl: BASE_URL, label: SETTINGS_NAME });
  await client.login(email, password);
  sessions.set(sessionKey(rawKey), { ...client.exportSession(), savedAt: Date.now() });
  return client;
}

async function withSession(rawKey, work) {
  const saved = sessions.get(sessionKey(rawKey));
  if (saved && Date.now() - saved.savedAt < SESSION_TTL_MS) {
    const client = new ParsefileClient({ baseUrl: BASE_URL, label: SETTINGS_NAME });
    client.loadSession(saved);
    try {
      const result = await work(client);
      sessions.set(sessionKey(rawKey), { ...client.exportSession(), savedAt: saved.savedAt });
      return result;
    } catch (err) {
      if (!err.sessionExpired) throw err;
      sessions.delete(sessionKey(rawKey));
    }
  }

  // No session, or it expired: sign in once and try again.
  const client = await signIn(rawKey);
  try {
    return await work(client);
  } catch (err) {
    if (err.sessionExpired) {
      sessions.delete(sessionKey(rawKey));
      throw Object.assign(new Error(`${SETTINGS_NAME} signed out right after signing in. Try again later.`), { status: 502 });
    }
    throw err;
  }
}

const laAdapter = {
  id: 'la',
  name: NAME,
  settingsName: SETTINGS_NAME,
  baseUrl: BASE_URL,
  credentialType: 'login',

  // Builds the stored "key" from the connect form's fields.
  buildCredential({ email, password }) {
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      throw Object.assign(new Error(`Enter the email you sign in to ${SETTINGS_NAME} with.`), { status: 400 });
    }
    if (typeof password !== 'string' || !password) {
      throw Object.assign(new Error('Password is required.'), { status: 400 });
    }
    return JSON.stringify({ email: email.trim().toLowerCase(), password });
  },

  // What the connection card shows instead of a key's last 4: a masked email.
  maskCredential(rawKey) {
    const { email } = parseLogin(rawKey);
    const [user, domain] = email.split('@');
    return `${user.slice(0, 2)}•••@${domain}`;
  },

  // Signs in fresh, which is the only way to know the login works.
  async testKey(rawKey) {
    sessions.delete(sessionKey(rawKey));
    await signIn(rawKey);
    return { success: true };
  },

  async fetchDeals(rawKey) {
    const deals = await withSession(rawKey, (client) => client.readDeals());
    return deals.filter((deal) => deal.available && !deal.disabled).map(toDeal);
  },

  _sessions: sessions,
};

module.exports = laAdapter;
