import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { decryptKey } = require('../services/cashouts/crypto');
const { encryptBody, decryptBody, parsePageConfig } = require('../services/cashouts/parsefile');
const p4dAdapter = require('../services/cashouts/p4d');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');

const BASE = 'https://www.points4days.com';
const LOGIN = JSON.stringify({ email: 'buyer@example.com', password: 'hunter2 ' });
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

// ─── A fake Points4Days site behind a mocked fetch ───────────────────────────
// Speaks the same encrypted protocol as the real one, as far as we know it.
function dealRow(id, overrides = {}) {
  return {
    t_f_id: id,
    t_f_title: `Deal ${id}`,
    t_f_total: 232,
    t_f_retail: 179,
    t_f_insurance: 0,
    t_f_enabled: 1,
    t_f_active: 1,
    t_f_not_expired: 1,
    t_f_full: 0,
    t_f_order_required: 0,
    t_f_order_disabled: 0,
    t_f_order_locked: 0,
    t_f_deal_link: `${BASE}/p/it@deals/deal/${id}`,
    t_f_items: [{
      f_id: id * 10,
      f_title: `Item ${id}`,
      f_model: 'MTJV3AM/A',
      f_upc: '194253397106',
      f_enabled: 1,
      f_not_expired: 1,
      f_image: 'img/airpods.jpg',
      f_links: [[1, 'x', 'y', 'https://www.bestbuy.com/site/123'], [2, 'x', 'y', 'https://www.amazon.com/dp/B0D']],
    }],
    ...overrides,
  };
}

function makeSite({ rows = [dealRow(1)], password = 'hunter2 ', tableReadOnly = true, loginPage } = {}) {
  const site = { rows, calls: [], sessid: null, loggedIn: false, sessionCounter: 0, expireNext: false, loginPage };
  const reply = (body, sessid) => new Response(JSON.stringify(encryptBody(body, sessid)), { status: 200, headers: { 'content-type': 'application/json' } });
  const html = (text, extra = {}) => new Response(text, { status: 200, headers: { 'content-type': 'text/html', ...extra } });
  const redirect = (location) => new Response(null, { status: 302, headers: { location } });

  site.fetch = vi.fn(async (href, init = {}) => {
    const url = new URL(href);
    const method = init.method || 'GET';
    const path = decodeURIComponent(url.pathname);
    site.calls.push(`${method} ${path.replace(/\/_dc\/\d+/, '')}`);
    const cookie = Object.fromEntries((init.headers?.Cookie || '').split('; ').filter(Boolean).map((c) => c.split('=')));
    const body = init.body ? decryptBody(JSON.parse(init.body), cookie.SESSID) : null;
    const signedIn = site.loggedIn && cookie.SESSID === site.sessid;

    if (method === 'GET' && path === '/p/login') {
      if (site.loginPage) return html(site.loginPage);
      site.sessionCounter += 1;
      site.sessid = `sess${site.sessionCounter}`;
      site.loggedIn = false;
      return new Response('<script>var x = {"version":"v1"}</script>', {
        status: 200,
        headers: [['set-cookie', `SESSID=${site.sessid}; Path=/; HttpOnly`], ['content-type', 'text/html']],
      });
    }
    if (method === 'POST' && path.startsWith('/p/login/cmd/menus/')) return reply({ success: true }, cookie.SESSID);
    if (method === 'POST' && path.startsWith('/p/login/cmd/login/')) {
      if (body.email !== 'buyer@example.com' || body.password !== password) return reply({ success: false, error: 'Wrong email or password' }, cookie.SESSID);
      site.loggedIn = true;
      return reply({ success: true, location: '/p/home/_version/v2' }, cookie.SESSID);
    }
    if (method === 'GET' && path === '/p/home/_version/v2') return html('<script>var c = {"version":"v2","page":"Home"}</script>');
    if (method === 'GET' && path === '/f/it@deals') {
      if (site.expireNext) { site.expireNext = false; site.loggedIn = false; }
      return signedIn || (site.loggedIn && cookie.SESSID === site.sessid) ? redirect('/p/it@deals/_version/v3/') : redirect('/p/login');
    }
    if (method === 'GET' && path === '/p/it@deals/_version/v3/') {
      return html(`<script>var config = {"version":"v3","res":"/res/p4d/","requestSuperCode":false};
config.tables["it@deals-card"] = {"id":"t_f_id","readOnly":${tableReadOnly},"query":{"view":"card"}};</script>`);
    }
    if (method === 'POST' && path.startsWith('/p/it@deals/cmd/menus/')) return reply({ success: true, scope: { logged_in: signedIn, profile: { id: 7 } } }, cookie.SESSID);
    if (method === 'POST' && path.startsWith('/p/it@deals/_version/v3/_table/it@deals-card/')) {
      if (!signedIn) return reply({ success: false, error: 'Session expired, log in again' }, cookie.SESSID);
      const start = (body.page - 1) * body.limit;
      const page = site.rows.slice(start, start + body.limit);
      return reply({ success: true, loadtable: [{ table: 'it@deals-card', data: { success: true, data: page, count: site.rows.length } }] }, cookie.SESSID);
    }
    return new Response('not found', { status: 404 });
  });
  return site;
}

let site;
beforeEach(() => {
  p4dAdapter._sessions.clear();
  site = makeSite();
  vi.stubGlobal('fetch', site.fetch);
});

describe('parsefile body encryption', () => {
  it('round-trips a body with the SESSID as the password, in the site format', () => {
    const envelope = encryptBody({ email: 'a@b.com', n: 1 }, 'sess-abc');
    const inner = JSON.parse(envelope._encrypted);
    expect(inner.s).toMatch(/^[0-9a-f]{16}$/);
    expect(inner.iv).toMatch(/^[0-9a-f]{32}$/);
    expect(decryptBody(envelope, 'sess-abc')).toEqual({ email: 'a@b.com', n: 1 });
    expect(() => decryptBody(envelope, 'wrong')).toThrow();
  });

  it('passes an unencrypted reply through as-is', () => {
    expect(decryptBody({ success: true }, 'x')).toEqual({ success: true });
  });

  it('reads the page config and its tables', () => {
    const config = parsePageConfig('var config = {"version":"v9","res":"/r/","x":"}{"}; config.tables["it@deals-card"] = {"id":"t_f_id","readOnly":1,"query":{}};');
    expect(config.version).toBe('v9');
    expect(config.tables.get('it@deals-card')).toMatchObject({ id: 't_f_id', readOnly: true });
    expect(() => parsePageConfig('<html>no config</html>')).toThrow();
  });
});

describe('Points4Days adapter', () => {
  it('signs in and maps deals into the Cashout deal shape', async () => {
    const deals = await p4dAdapter.fetchDeals(LOGIN);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      id: '1',
      provider: 'p4d',
      name: 'Deal 1',
      payout: 232,
      retail: 179,
      profitMargin: 53,
      status: 'active',
      dealUrl: `${BASE}/p/it@deals/deal/1`,
      imageUrl: `${BASE}/res/p4d/img/airpods.jpg`,
    });
    expect(deals[0].items[0]).toMatchObject({
      id: '10',
      name: 'Item 1',
      upcs: ['194253397106'],
      purchaseLinks: [
        { name: 'Best Buy', url: 'https://www.bestbuy.com/site/123' },
        { name: 'Amazon', url: 'https://www.amazon.com/dp/B0D' },
      ],
    });
  });

  it('sends the password exactly as typed, including spaces', async () => {
    site = makeSite({ password: 'hunter2' });
    vi.stubGlobal('fetch', site.fetch);
    await expect(p4dAdapter.testKey(LOGIN)).rejects.toMatchObject({ keyRejected: true });
  });

  it('leaves out deals that are full, expired, inactive or disabled, and notes commitment rules', async () => {
    site.rows = [
      dealRow(1, { t_f_order_required: 1, t_f_insurance: 4.5 }),
      dealRow(2, { t_f_full: 1 }),
      dealRow(3, { t_f_not_expired: 0 }),
      dealRow(4, { t_f_active: 0 }),
      dealRow(5, { t_f_order_disabled: 1 }),
    ];
    const deals = await p4dAdapter.fetchDeals(LOGIN);
    expect(deals.map((d) => d.id)).toEqual(['1']);
    expect(deals[0].commitRequired).toBe(true);
    expect(deals[0].notes).toBe('Commitment required on Points4Days.\nInsurance $4.50 per unit.');
  });

  it('reuses the signed-in session instead of signing in on every refresh', async () => {
    await p4dAdapter.fetchDeals(LOGIN);
    await p4dAdapter.fetchDeals(LOGIN);
    expect(site.calls.filter((c) => c === 'GET /p/login')).toHaveLength(1);
  });

  it('signs in again once when the saved session has expired', async () => {
    await p4dAdapter.fetchDeals(LOGIN);
    site.expireNext = true;
    const deals = await p4dAdapter.fetchDeals(LOGIN);
    expect(deals).toHaveLength(1);
    expect(site.calls.filter((c) => c === 'GET /p/login')).toHaveLength(2);
  });

  it('reads every page of a long deals table', async () => {
    site.rows = Array.from({ length: 150 }, (_, i) => dealRow(i + 1));
    const deals = await p4dAdapter.fetchDeals(LOGIN);
    expect(deals).toHaveLength(150);
    expect(site.calls.filter((c) => c.includes('/_table/'))).toHaveLength(2);
  });

  it('rejects a wrong password as a bad login, not an outage', async () => {
    const wrong = JSON.stringify({ email: 'buyer@example.com', password: 'nope' });
    await expect(p4dAdapter.testKey(wrong)).rejects.toMatchObject({ keyRejected: true, message: expect.stringMatching(/email or password/) });
  });

  it('stops at a captcha or sign-in code and asks for a reconnect', async () => {
    site = makeSite({ loginPage: '<div class="cf-turnstile"></div>' });
    vi.stubGlobal('fetch', site.fetch);
    await expect(p4dAdapter.testKey(LOGIN)).rejects.toMatchObject({ keyRejected: true, challenge: true });
    expect(site.calls).toEqual(['GET /p/login']);
  });

  it('syncs nothing when one deal row is malformed', async () => {
    site.rows = [dealRow(1), dealRow(2, { t_f_total: 'lots' })];
    await expect(p4dAdapter.fetchDeals(LOGIN)).rejects.toThrow(/unexpected format. No data was synced/);
  });

  it('refuses to read a deals table the site does not mark read only', async () => {
    site = makeSite({ tableReadOnly: false });
    vi.stubGlobal('fetch', site.fetch);
    await expect(p4dAdapter.fetchDeals(LOGIN)).rejects.toThrow(/not read only/);
  });

  it('never follows a redirect off the Points4Days site', async () => {
    const inner = site.fetch;
    vi.stubGlobal('fetch', vi.fn(async (href, init) => (
      new URL(href).pathname === '/f/it@deals' ? new Response(null, { status: 302, headers: { location: 'https://evil.example/p/it@deals/' } }) : inner(href, init)
    )));
    await expect(p4dAdapter.fetchDeals(LOGIN)).rejects.toThrow(/unexpected redirect/);
  });

  it('honours Retry-After on a rate limit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '120' } })));
    await expect(p4dAdapter.fetchDeals(LOGIN)).rejects.toMatchObject({ rateLimited: true, retryAfter: 120 });
  });

  it('builds and masks the stored login', () => {
    const raw = p4dAdapter.buildCredential({ email: ' Buyer@Example.com ', password: ' pw ' });
    expect(JSON.parse(raw)).toEqual({ email: 'buyer@example.com', password: ' pw ' });
    expect(p4dAdapter.maskCredential(raw)).toBe('bu•••@example.com');
    expect(() => p4dAdapter.buildCredential({ email: 'nope', password: 'x' })).toThrow(/email/);
    expect(() => p4dAdapter.buildCredential({ email: 'a@b.co', password: '' })).toThrow(/Password/);
  });
});

// ─── Through the API ─────────────────────────────────────────────────────────
describe('Points4Days connections API', () => {
  let server;
  let baseUrl;
  const realFetch = globalThis.fetch;

  beforeAll(async () => {
    server = harness.app().listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server.close());

  beforeEach(() => {
    harness.reset();
    dealsCache.clear();
    syncBlockedUntil.clear();
    process.env.CASHOUT_KEY_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
    // Calls to our own test server go through; Points4Days goes to the fake site.
    vi.stubGlobal('fetch', vi.fn((href, init) => (String(href).startsWith(BASE) ? site.fetch(href, init) : realFetch(href, init))));
  });

  const api = async (method, path, body) => {
    const res = await realFetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  it('connects with an email and password, stores them encrypted and shows only a masked email', async () => {
    const res = await api('POST', '/api/cashouts/connections', { provider: 'p4d', email: 'buyer@example.com', password: 'hunter2 ' });
    expect(res.status).toBe(201);
    expect(res.body.keyLast4).toBe('bu•••@example.com');
    expect(JSON.stringify(res.body)).not.toContain('hunter2');

    const stored = harness.db.cashoutConnection.find((c) => c.id === res.body.id);
    expect(stored.encrypted_key).not.toContain('hunter2');
    expect(JSON.parse(decryptKey(stored.encrypted_key))).toEqual({ email: 'buyer@example.com', password: 'hunter2 ' });

    const deals = await api('GET', '/api/cashouts/deals');
    expect(deals.status).toBe(200);
    expect(deals.body.results[0].deals[0]).toMatchObject({ provider: 'p4d', payout: 232 });
  });

  it('saves nothing when the login is wrong or incomplete', async () => {
    const wrong = await api('POST', '/api/cashouts/connections', { provider: 'p4d', email: 'buyer@example.com', password: 'nope' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/email or password/);

    const missing = await api('POST', '/api/cashouts/connections', { provider: 'p4d', email: 'buyer@example.com' });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/Password is required/);

    const none = await api('POST', '/api/cashouts/connections', { provider: 'p4d' });
    expect(none.status).toBe(400);
    expect(harness.db.cashoutConnection).toHaveLength(0);
  });

  it('replacing the login keeps the old one when the new one is rejected', async () => {
    const created = await api('POST', '/api/cashouts/connections', { provider: 'p4d', email: 'buyer@example.com', password: 'hunter2 ' });
    const before = harness.db.cashoutConnection.find((c) => c.id === created.body.id).encrypted_key;
    const res = await api('PATCH', `/api/cashouts/connections/${created.body.id}`, { email: 'buyer@example.com', password: 'nope' });
    expect(res.status).toBe(400);
    expect(harness.db.cashoutConnection.find((c) => c.id === created.body.id).encrypted_key).toBe(before);
  });

  it('refuses commitments and tracking for Points4Days with a clear message', async () => {
    const created = await api('POST', '/api/cashouts/connections', { provider: 'p4d', email: 'buyer@example.com', password: 'hunter2 ' });
    const commit = await api('POST', `/api/cashouts/connections/${created.body.id}/commits`, { deal_id: '1', item_id: '10', quantity: 1 });
    expect(commit.status).toBe(400);
    expect(commit.body.error).toMatch(/aren't supported for Points4Days/);
    const tracking = await api('GET', `/api/cashouts/connections/${created.body.id}/tracking`);
    expect(tracking.status).toBe(400);
  });

  it('still requires an API key for ElectronicsBuyer', async () => {
    const res = await api('POST', '/api/cashouts/connections', { provider: 'eb', email: 'buyer@example.com', password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/API key is required/);
  });
});
