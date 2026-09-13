import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import http from 'node:http';
const require = createRequire(import.meta.url);
const DiscordStrategy = require('passport-discord').Strategy;
const { discordStrategyOptions } = require('../services/discordStrategyOptions');
const { authDiagnostics } = require('../services/authDiagnostics');
const { createDiscordTokenExchange } = require('../services/discordTokenExchange');
let server;
let base;
let requests = [];
beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ headers: req.headers, body });
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/reject') {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Test expired code' }));
    } else {
      res.end(JSON.stringify({ access_token: 'fixture-access', refresh_token: 'fixture-refresh' }));
    }
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

function strategy(path = '/token') {
  const options = { ...discordStrategyOptions({
    DISCORD_CLIENT_ID: 'fixture-client', DISCORD_CLIENT_SECRET: 'fixture-secret',
    DISCORD_CALLBACK_URL: 'https://api.profittracker.carltechs.com/auth/discord/callback',
  }), tokenURL: `${base}${path}` };
  const client = new DiscordStrategy(options, () => {});
  client._oauth2.getOAuthAccessToken = createDiscordTokenExchange(options).exchange;
  return client;
}

describe('Discord OAuth HTTP contract', () => {
  it('sends Discord-compliant identification and preserves token exchange parameters', async () => {
    const client = strategy();
    const tokens = await new Promise((resolve, reject) => client._oauth2.getOAuthAccessToken('fixture-code', {
      grant_type: 'authorization_code', redirect_uri: client._callbackURL,
    }, (err, access, refresh) => err ? reject(err) : resolve({ access, refresh })));
    expect(tokens).toEqual({ access: 'fixture-access', refresh: 'fixture-refresh' });
    const request = requests.at(-1);
    expect(request.headers['user-agent']).toMatch(/^DiscordBot \(https:\/\/github\.com\/CarlBalansag\/Profit-Tracker, [\d.]+\)$/);
    expect(request.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(Object.fromEntries(new URLSearchParams(request.body))).toEqual({
      grant_type: 'authorization_code', redirect_uri: client._callbackURL,
      client_id: 'fixture-client', client_secret: 'fixture-secret', code: 'fixture-code',
    });
  });

  it('also identifies authenticated profile HTTP requests', async () => {
    await new Promise((resolve, reject) => strategy()._oauth2.get(`${base}/profile`, 'fixture-access',
      err => err ? reject(err) : resolve()));
    expect(requests.at(-1).headers['user-agent']).toMatch(/^DiscordBot /);
    expect(requests.at(-1).headers.authorization).toBe('Bearer fixture-access');
  });

  it('keeps provider failure diagnostics actionable and does not retry rejected codes', async () => {
    const count = requests.length;
    const failure = await new Promise(resolve => strategy('/reject')._oauth2.getOAuthAccessToken('expired-code',
      { grant_type: 'authorization_code' }, err => resolve(err)));
    expect(requests.length).toBe(count + 1);
    expect(authDiagnostics({ oauthError: failure })).toEqual({
      providerCode: 'invalid_grant', httpStatus: 400, networkCode: null, databaseCode: null,
    });
  });
});
