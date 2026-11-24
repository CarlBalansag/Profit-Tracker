import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const harness = require('../../qa/harness.cjs');
const { decryptKey } = require('../services/cashouts/crypto');
const { encryptBody, decryptBody } = require('../services/cashouts/parsefile');
const laAdapter = require('../services/cashouts/la');
const { dealsCache, syncBlockedUntil } = require('../services/cashouts/service');

const BASE = 'https://www.earnfrombuying.com';
const LOGIN = JSON.stringify({ email: 'buyer@example.com', password: 'hunter2 ' });
const TEST_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function dealRow(id, overrides = {}) {
  return {
    t_f_id: id,
    t_f_title: `Deal ${id}`,
    t_f_total: 350,
    t_f_retail: 300,
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
      f_model: 'PRO-100',
      f_upc: '123456789012',
      f_enabled: 1,
      f_not_expired: 1,
      f_image: 'img/laptop.jpg',
      f_links: [[1, 'x', 'y', 'https://www.bestbuy.com/site/123'], [2, 'x', 'y', 'https://www.amazon.com/dp/B0D']],
    }],
    ...overrides,
  };
}

function makeSite({ rows = [dealRow(1)], password = 'hunter2 ', tableReadOnly = true } = {}) {
  const site = { rows, calls: [], sessid: null, loggedIn: false, sessionCounter: 0, expireNext: false };
  const reply = (body, sessid) => new Response(JSON.stringify(encryptBody(body, sessid)), { status: 200, headers: { 'content-type': 'application/json' } });
  const html = (text) => new Response(text, { status: 200, headers: { 'content-type': 'text/html' } });
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
      return html(`<script>var config = {"version":"v3","res":"/res/la/","requestSuperCode":false};
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
  laAdapter._sessions.clear();
  dealsCache.clear();
  syncBlockedUntil.clear();
  site = makeSite();
  vi.stubGlobal('fetch', site.fetch);
});

describe('LA (EarnFromBuying) cashout adapter', () => {
  it('has the expected metadata and settings name', () => {
    expect(laAdapter.id).toBe('la');
    expect(laAdapter.name).toBe('LA');
    expect(laAdapter.settingsName).toBe('EarnFromBuying (LA)');
    expect(laAdapter.baseUrl).toBe(BASE);
    expect(laAdapter.credentialType).toBe('login');
  });

  it('builds and masks credentials correctly', () => {
    const cred = laAdapter.buildCredential({ email: 'Buyer@Example.com ', password: 'secretpassword' });
    expect(JSON.parse(cred)).toEqual({ email: 'buyer@example.com', password: 'secretpassword' });
    expect(laAdapter.maskCredential(cred)).toBe('bu•••@example.com');
  });

  it('rejects invalid email or empty password', () => {
    expect(() => laAdapter.buildCredential({ email: 'not-an-email', password: 'pass' })).toThrow(/Enter the email/);
    expect(() => laAdapter.buildCredential({ email: 'buyer@example.com', password: '' })).toThrow(/Password is required/);
  });

  it('signs in and tests key successfully', async () => {
    const result = await laAdapter.testKey(LOGIN);
    expect(result).toEqual({ success: true });
    expect(site.calls).toEqual([
      'GET /p/login',
      'POST /p/login/cmd/menus/screen/1/section/back@mainlayout/_idle/2',
      'POST /p/login/cmd/login/checkLoading/true/screen/1/encrypt/true/_arg/0/section/back@login/_idle/5000',
      'GET /p/home/_version/v2',
    ]);
  });

  it('fetches and normalizes deals into common deal structure', async () => {
    const deals = await laAdapter.fetchDeals(LOGIN);
    expect(deals).toHaveLength(1);
    expect(deals[0]).toMatchObject({
      id: '1',
      provider: 'la',
      name: 'Deal 1',
      payout: 350,
      retail: 300,
      profitMargin: 50,
      status: 'active',
      items: [
        {
          id: '10',
          name: 'Item 1',
          condition: 'new',
          upcs: ['123456789012'],
          sku: 'PRO-100',
          purchaseLinks: [
            { name: 'Best Buy', url: 'https://www.bestbuy.com/site/123' },
            { name: 'Amazon', url: 'https://www.amazon.com/dp/B0D' },
          ],
        },
      ],
    });
  });

  it('links to the site itself when a deal has no usable link of its own', async () => {
    site.rows = [dealRow(1, { t_f_deal_link: '' }), dealRow(2, { t_f_deal_link: 'https://evil.example/deal/2' }), dealRow(3)];
    const deals = await laAdapter.fetchDeals(LOGIN);
    expect(deals.map((d) => d.dealUrl)).toEqual([BASE, BASE, `${BASE}/p/it@deals/deal/3`]);
  });

  it('reuses cached session on subsequent fetch', async () => {
    await laAdapter.fetchDeals(LOGIN);
    const firstCallCount = site.calls.length;
    await laAdapter.fetchDeals(LOGIN);
    // Second fetch should open deals directly without re-authenticating
    const secondPassCalls = site.calls.slice(firstCallCount);
    expect(secondPassCalls.some((c) => c.startsWith('POST /p/login/cmd/login'))).toBe(false);
    expect(secondPassCalls).toContain('GET /f/it@deals');
  });

  it('handles session expiry by re-authenticating', async () => {
    await laAdapter.fetchDeals(LOGIN);
    site.expireNext = true;
    const deals = await laAdapter.fetchDeals(LOGIN);
    expect(deals).toHaveLength(1);
  });
});
