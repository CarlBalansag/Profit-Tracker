// Client for the website platform Points4Days runs on (and, later, MVP Buying
// Group, MaxOut Deals, Big Deal Points and BuyersForPoints, which run on the
// same one). None of these groups has an API, so this signs in with the
// user's own group login and reads the same deals table the group's own
// Deals page loads. Read only: it never commits, saves or uploads anything.
//
// The flow was taken from Monar 0.3.14's client (static analysis, see
// REAFeatures/BUYING_GROUP_DEALS_PLAN.md). Every step fails closed: if a page
// or table doesn't look the way we expect, nothing is synced.
const crypto = require('node:crypto');

const TIMEOUT_MS = 20000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const PAGE_SIZE = 100;
const RECEIVED_ITEMS_TABLE = 'it@receipt-items-details';
const MAX_PAGES = 20;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SCREEN = { width: 1280, height: 720 };
// Anything that needs a person: a captcha, a bot check or a sign-in code.
const CHALLENGE_RE = /captcha|challenge-platform|cf-turnstile|two[- ]factor|multi[- ]factor|verification code|one[- ]time (?:code|password)/i;
const COOKIE_NAME_RE = /^[\w!#$%&'*+.^`|~-]+$/;
const TABLE_DEFAULTS = {
  order: 'f_pos',
  startorder: 'f_pos',
  dialog: false,
  clearSelection: true,
  queryArg: 0,
  totals: 0,
  memorize: { enabled: false, view: false, ids: [] },
  direct: null,
  filters: {},
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTrue = (v) => v === true || v === 1;

function providerError(label, message, flags = {}) {
  return Object.assign(new Error(`${label}: ${message}`), flags);
}

// ─── Request/response body encryption ────────────────────────────────────────
// AES-256-CBC with an OpenSSL EVP_BytesToKey (MD5) key, using the SESSID
// cookie as the password -- the same thing CryptoJS does in the site's own JS.
function deriveKeyIv(password, salt) {
  let out = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (out.length < 48) {
    block = crypto.createHash('md5').update(Buffer.concat([block, password, salt])).digest();
    out = Buffer.concat([out, block]);
  }
  return { key: out.subarray(0, 32), iv: out.subarray(32, 48) };
}

function encryptBody(value, sessid) {
  const salt = crypto.randomBytes(8);
  const { key, iv } = deriveKeyIv(Buffer.from(sessid, 'utf8'), salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    _encrypted: JSON.stringify({ ct: ct.toString('base64'), iv: iv.toString('hex'), s: salt.toString('hex') }),
  };
}

function decryptBody(envelope, sessid) {
  if (!('_encrypted' in envelope)) return envelope;
  const { ct, iv, s } = JSON.parse(envelope._encrypted);
  const { key } = deriveKeyIv(Buffer.from(sessid, 'utf8'), Buffer.from(s, 'hex'));
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(iv, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
  return JSON.parse(plain);
}

// ─── Signed-in page parsing ──────────────────────────────────────────────────
function pageVersion(html) {
  return html.match(/"version"\s*:\s*"([^"]+)"/)?.[1] || '';
}

// Reads one JSON object literal starting at `start`, respecting strings.
function readObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        const parsed = JSON.parse(text.slice(start, i + 1));
        if (isObject(parsed)) return parsed;
        break;
      }
    }
  }
  throw new Error('invalid page declaration');
}

// The page declares `var config = {...}` and `config.tables["name"] = {...}`.
function parsePageConfig(html) {
  const head = /\bvar\s+config\s*=\s*(?=\{)/.exec(html);
  if (!head) throw new Error('no page config');
  const config = readObjectAt(html, head.index + head[0].length);
  if (typeof config.version !== 'string' || !/^[a-z0-9._+=%-]{1,200}$/i.test(config.version)) {
    throw new Error('invalid page version');
  }
  const tables = new Map();
  for (const match of html.matchAll(/config\.tables\["([^"]+)"\]\s*=\s*(?=\{)/g)) {
    const table = readObjectAt(html, match.index + match[0].length);
    if (typeof table.id === 'string' && isObject(table.query)) {
      tables.set(match[1], { name: match[1], id: table.id, readOnly: isTrue(table.readOnly), query: table.query });
    }
  }
  return {
    version: config.version,
    tables,
    requiresSecurityCode: Boolean(config.requestSuperCode),
    resourcePath: typeof config.res === 'string' && config.res.length <= 2048 ? config.res : null,
  };
}

// ─── Deal rows ───────────────────────────────────────────────────────────────
function rowId(v) {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
  if (typeof v === 'string' && v.trim() && v.length <= 500 && !/[\x00-\x1f\x7f]/.test(v)) return v.trim();
  throw new Error('invalid record id');
}

function rowText(v, max = 300) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw new Error('invalid label');
  return v.trim() || null;
}

function rowPrice(v, nullable = false) {
  if (nullable && (v === null || v === undefined)) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('invalid price');
  const cents = Math.round(v * 100);
  if (Math.abs(v * 100 - cents) > 1e-5) throw new Error('non-cent price');
  return cents / 100;
}

function httpsUrl(v, origin) {
  if (typeof v !== 'string' || v.length > 2048) return null;
  try {
    const url = new URL(v);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    if (origin && url.origin !== origin) return null;
    return url.href;
  } catch {
    return null;
  }
}

// Item images are often relative to the page's resource folder.
function imageUrl(v, baseUrl, resourcePath) {
  if (typeof v !== 'string' || !v.trim() || v.length > 2048) return null;
  const absolute = httpsUrl(v);
  if (absolute) return absolute;
  if (!resourcePath || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('//')) return null;
  try {
    const base = new URL(resourcePath, baseUrl);
    if (!httpsUrl(base.href) || base.search || base.hash) return null;
    return httpsUrl(new URL(`${base.href.replace(/\/$/, '')}/${v.replace(/^\/+/, '')}`).href);
  } catch {
    return null;
  }
}

// One parsed deal row. Throws on anything malformed, which fails the whole sync.
function parseDealRow(row, baseUrl, resourcePath) {
  if (!Array.isArray(row.t_f_items) || !row.t_f_items.every(isObject)) throw new Error('invalid item list');
  const title = rowText(row.t_f_title);
  if (!title) throw new Error('deal without a title');
  return {
    id: rowId(row.t_f_id),
    title,
    payout: rowPrice(row.t_f_total),
    retail: rowPrice(row.t_f_retail, true),
    insurance: rowPrice(row.t_f_insurance, true) ?? 0,
    available: isTrue(row.t_f_enabled) && isTrue(row.t_f_active) && isTrue(row.t_f_not_expired) && !isTrue(row.t_f_full),
    commitRequired: isTrue(row.t_f_order_required),
    disabled: isTrue(row.t_f_order_disabled),
    locked: isTrue(row.t_f_order_locked),
    url: httpsUrl(row.t_f_deal_link, baseUrl),
    items: row.t_f_items.map((item) => ({
      id: rowId(item.f_id),
      name: rowText(item.f_title) || title,
      sku: rowText(item.f_model, 120),
      upc: rowText(item.f_upc, 80),
      active: isTrue(item.f_enabled) && isTrue(item.f_not_expired),
      imageUrl: imageUrl(item.f_image, baseUrl, resourcePath) || imageUrl(row.t_f_image, baseUrl, resourcePath),
      // Each link is an array; the store URL is its 4th entry.
      links: [...new Set((Array.isArray(item.f_links) ? item.f_links : [])
        .map((link) => (Array.isArray(link) ? httpsUrl(link[3]) : null))
        .filter(Boolean))],
    })),
  };
}

// ─── Client ──────────────────────────────────────────────────────────────────
class ParsefileClient {
  constructor({ baseUrl, label }) {
    this.baseUrl = baseUrl;
    this.label = label;
    this.cookies = new Map();
    this.version = null;
  }

  fail(message, flags) {
    return providerError(this.label, message, flags);
  }

  challenge() {
    return this.fail('the site is asking for a captcha or a sign-in code. Sign in on the website once, then reconnect here.', { keyRejected: true, challenge: true });
  }

  sessionExpired() {
    return this.fail('session expired.', { sessionExpired: true });
  }

  sameOriginUrl(target, base = this.baseUrl) {
    let url;
    try {
      url = new URL(target, base);
    } catch {
      throw this.fail('returned an invalid redirect.');
    }
    if (url.origin !== this.baseUrl || url.username || url.password) throw this.fail('returned an unexpected redirect.');
    return url;
  }

  captureCookies(response) {
    for (const header of response.headers.getSetCookie()) {
      const [pair, ...attrs] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      const maxAge = attrs.find((a) => /^\s*max-age=/i.test(a))?.split('=')[1];
      const expires = attrs.find((a) => /^\s*expires=/i.test(a))?.replace(/^\s*expires=/i, '');
      const expired = maxAge !== undefined ? Number(maxAge) <= 0 : Boolean(expires && Date.parse(expires) <= Date.now());
      if (expired) this.cookies.delete(name);
      else this.setCookie(name, value);
    }
  }

  setCookie(name, value) {
    if (!COOKIE_NAME_RE.test(name) || /[\r\n;]/.test(value)) throw this.fail('returned an invalid session cookie.');
    this.cookies.set(name, value);
  }

  get sessid() {
    const value = this.cookies.get('SESSID');
    if (!value) throw this.sessionExpired();
    return value;
  }

  // Redirects are followed by hand so they can't leave the group's site, and
  // so every Set-Cookie along the way is kept. Returns { response, url }.
  async request(path, options = {}) {
    let url = this.sameOriginUrl(path);
    const signal = AbortSignal.timeout(TIMEOUT_MS);
    for (let hop = 0; hop < MAX_REDIRECTS; hop += 1) {
      let response;
      try {
        response = await fetch(url.href, {
          ...options,
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json, text/plain, */*',
            ...options.headers,
            Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          },
          redirect: 'manual',
          signal,
        });
      } catch (err) {
        if (err.name === 'TimeoutError' || err.name === 'AbortError') throw this.fail('request timed out.');
        throw this.fail('could not be reached.');
      }
      this.captureCookies(response);

      if (response.status === 429) {
        await response.body?.cancel();
        const retryAfter = parseInt(response.headers.get('Retry-After'), 10) || 60;
        throw this.fail(`rate limit hit. Retry after ${retryAfter}s.`, { rateLimited: true, retryAfter });
      }

      const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
      if (!isRedirect || (options.method && options.method !== 'GET')) return { response, url };

      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) throw this.fail('returned an invalid redirect.');
      url = this.sameOriginUrl(location, url.href);
    }
    throw this.fail('redirected too many times.');
  }

  async readText(response) {
    if (Number(response.headers.get('content-length')) > MAX_BODY_BYTES) throw this.fail('response is too large.');
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw this.fail('response is too large.');
    return text;
  }

  // Decrypts and checks one JSON reply. `kind` is 'bootstrap', 'login' or 'session'.
  async readReply(response, kind) {
    const text = await this.readText(response);
    if (!response.ok) {
      if (CHALLENGE_RE.test(text)) throw this.challenge();
      if (response.status >= 300 && response.status < 400 && kind === 'session') throw this.sessionExpired();
      if (kind === 'login' && (response.status === 401 || response.status === 403)) {
        throw this.fail('the email or password was not accepted.', { keyRejected: true });
      }
      throw this.fail(`returned HTTP ${response.status}.`, { status: response.status });
    }

    let reply;
    try {
      const envelope = JSON.parse(text);
      if (!isObject(envelope)) throw new Error('not an object');
      reply = decryptBody(envelope, this.cookies.get('SESSID') || '');
      if (!isObject(reply)) throw new Error('not an object');
      if (envelope.success === false || (reply.success === undefined && typeof envelope.success === 'boolean')) {
        reply.success = envelope.success;
      }
    } catch {
      if (CHALLENGE_RE.test(text)) throw this.challenge();
      throw this.fail('returned an unreadable response.');
    }

    if (reply.success !== true) {
      const message = [reply.error, reply.message].filter((m) => typeof m === 'string').join(' ');
      if (CHALLENGE_RE.test(message)) throw this.challenge();
      if (kind === 'login') throw this.fail('the email or password was not accepted.', { keyRejected: true });
      if (kind === 'session' && (reply.success !== false || /session|log.?in|unauth|access denied/i.test(message))) {
        throw this.sessionExpired();
      }
      throw this.fail('refused the request. Try again shortly.');
    }

    if (reply.cookies !== undefined) {
      if (!isObject(reply.cookies)) throw this.fail('returned invalid session cookies.');
      for (const [name, value] of Object.entries(reply.cookies)) {
        this.setCookie(name, encodeURIComponent(JSON.stringify(value)));
      }
    }
    if (typeof reply.version === 'string' && reply.version) this.version = reply.version;
    return reply;
  }

  postJson(path, body, referer) {
    return this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8', Referer: referer },
      body: JSON.stringify(encryptBody(body, this.sessid)),
    });
  }

  async login(email, password) {
    this.cookies.clear();
    this.version = null;
    const loginUrl = `${this.baseUrl}/p/login`;

    const { response: page } = await this.request('/p/login');
    const pageText = await this.readText(page);
    if (CHALLENGE_RE.test(pageText)) throw this.challenge();
    if (!page.ok) throw this.fail(`returned HTTP ${page.status} on the sign-in page.`, { status: page.status });
    if (!this.cookies.get('SESSID') || !pageVersion(pageText)) throw this.fail('sign-in page did not start a session.');

    const boot = await this.postJson(`/p/login/cmd/menus/screen/1/section/back@mainlayout/_idle/2/_dc/${Date.now()}`, { screen: SCREEN }, loginUrl);
    await this.readReply(boot.response, 'bootstrap');

    const signIn = await this.postJson(
      `/p/login/cmd/login/checkLoading/true/screen/1/encrypt/true/_arg/0/section/back@login/_idle/5000/_dc/${Date.now()}`,
      { email: email.trim().toLowerCase(), password, screen: SCREEN },
      loginUrl,
    );
    const reply = await this.readReply(signIn.response, 'login');
    if (typeof reply.location !== 'string' || !reply.location) {
      throw this.fail('the email or password was not accepted.', { keyRejected: true });
    }

    const landing = this.sameOriginUrl(reply.location);
    if (/\/(?:p|f)\/(?:login|logout|it@deals-home)(?:\/|$)/i.test(landing.pathname)) {
      throw this.fail('the email or password was not accepted.', { keyRejected: true });
    }
    const { response: home } = await this.request(landing.href, { headers: { Referer: loginUrl } });
    const homeText = await this.readText(home);
    if (CHALLENGE_RE.test(homeText)) throw this.challenge();
    if (!home.ok) throw this.fail(`returned HTTP ${home.status} after sign-in.`, { status: home.status });
    if (/"page"\s*:\s*"Login"/i.test(homeText)) throw this.fail('the email or password was not accepted.', { keyRejected: true });

    const version = pageVersion(homeText) || landing.pathname.match(/\/_version\/([^/]+)/)?.[1];
    if (!version || !this.cookies.get('SESSID')) throw this.fail('did not open the signed-in page.');
    this.version = version;
  }

  exportSession() {
    return { cookies: [...this.cookies], version: this.version };
  }

  loadSession(session) {
    this.cookies = new Map(session.cookies);
    this.version = session.version;
  }

  // Opens a signed-in page by name and reads its config. Lands on the login
  // page (or anywhere else) when the session has expired.
  async openPage(page) {
    const { response, url } = await this.request(`/f/${page}`);
    const text = await this.readText(response);
    if (CHALLENGE_RE.test(text)) throw this.challenge();
    if (!response.ok) throw this.fail(`returned HTTP ${response.status}.`, { status: response.status });
    if (!url.pathname.startsWith(`/p/${page}/`)) throw this.sessionExpired();

    let config;
    try {
      config = parsePageConfig(text);
    } catch {
      throw this.fail('the deals page has changed. No data was synced.');
    }
    if (config.requiresSecurityCode) throw this.challenge();
    this.version = config.version;

    const menus = await this.postJson(
      `/p/${page}/cmd/menus/screen/1/section/back@mainlayout/_idle/1/_dc/${Date.now()}`,
      { session: {} },
      `${this.baseUrl}/p/${page}/_version/${this.version}`,
    );
    const scope = (await this.readReply(menus.response, 'session')).scope;
    if (!isObject(scope) || !isTrue(scope.logged_in)) throw this.sessionExpired();
    config.version = this.version;
    return { page, ...config };
  }

  async fetchTablePage(page, table, query, pageNumber) {
    const referer = `${this.baseUrl}/p/${page}/_version/${this.version}`;
    const { response } = await this.postJson(
      `/p/${page}/_version/${this.version}/_table/${encodeURIComponent(table)}/prompt/undefined/checkLoading/0/init/0/cmd/load/instance/table/_idle/5000/_dc/${Date.now()}`,
      { ...TABLE_DEFAULTS, ...query, limit: PAGE_SIZE, page: pageNumber },
      referer,
    );
    const reply = await this.readReply(response, 'session');
    if (reply.location || reply.assign) throw this.sessionExpired();
    const loads = Array.isArray(reply.loadtable) ? reply.loadtable : isObject(reply.loadtable) ? Object.values(reply.loadtable) : [];
    const data = loads.find((entry) => isObject(entry) && entry.table === table)?.data;
    if (!isObject(data) || data.success !== true || !Array.isArray(data.data) || !data.data.every(isObject)
      || !Number.isSafeInteger(data.count) || data.count < data.data.length) {
      throw this.fail('returned an incomplete table. No data was synced.');
    }
    return data;
  }

  // Reads every page of a table, checking the pages add up.
  async readTable(context, table, what = 'deals') {
    const def = context.tables.get(table);
    if (!def) throw this.fail(`no longer has the ${what} table. No data was synced.`);
    const rows = [];
    const seen = new Set();
    let total = null;
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const data = await this.fetchTablePage(context.page, table, def.query, pageNumber);
      if (total !== null && total !== data.count) throw this.fail(`the ${what} table changed while reading. Try again.`);
      total = data.count;
      for (const row of data.data) {
        const id = rowId(row[def.id]);
        if (seen.has(id)) throw this.fail(`repeated a page of ${what}. No data was synced.`);
        seen.add(id);
        rows.push(row);
      }
      if (rows.length >= total || data.data.length < PAGE_SIZE) break;
    }
    if (rows.length !== total) throw this.fail(`the full ${what} table could not be read. No data was synced.`);
    return rows;
  }

  async readDeals() {
    const context = await this.openPage('it@deals');
    // Only ever read from a table the site itself marks read only.
    if (!context.tables.get('it@deals-card')?.readOnly) throw this.fail('the deals table is not read only. No data was synced.');
    const rows = await this.readTable(context, 'it@deals-card');
    try {
      return rows.map((row) => parseDealRow(row, this.baseUrl, context.resourcePath));
    } catch {
      throw this.fail('returned a deal in an unexpected format. No data was synced.');
    }
  }

  // Receiving analytics > Received items: one row per received line (item,
  // qty, payout, tracking). Read only, like the deals table. Raw rows; the
  // import (importSold.js parseParsefileTableRows) checks and maps them.
  async readReceivedItems() {
    const context = await this.openPage('it@analysis');
    if (!context.tables.get(RECEIVED_ITEMS_TABLE)?.readOnly) throw this.fail('the received items table is not read only. Nothing was read.');
    return this.readTable(context, RECEIVED_ITEMS_TABLE, 'received items');
  }
}

module.exports = {
  ParsefileClient,
  encryptBody,
  decryptBody,
  parsePageConfig,
  parseDealRow,
};
