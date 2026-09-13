import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDiscordTokenExchange } = require('../services/discordTokenExchange');
const { authDiagnostics } = require('../services/authDiagnostics');
const DiscordStrategy = require('passport-discord').Strategy;
const { discordStrategyOptions } = require('../services/discordStrategyOptions');
const options = discordStrategyOptions({ DISCORD_CLIENT_ID: 'fixture', DISCORD_CLIENT_SECRET: 'secret',
  DISCORD_CALLBACK_URL: 'https://example.test/auth/discord/callback' });
const exchange = (client, code = 'fixture-code') => new Promise(resolve => client.exchange(code,
  { grant_type: 'authorization_code', redirect_uri: options.callbackURL },
  (error, access) => resolve({ error, access })));

describe('Discord token rate-limit handling', () => {
  it('respects the longest provider wait, blocks repeated callbacks, then allows retry', async () => {
    let now = 1000;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ retry_after: 2.1 }),
        { status: 429, headers: { 'Retry-After': '5', 'X-RateLimit-Scope': 'global' } }))
      .mockResolvedValueOnce(new Response('{"access_token":"fixture-access"}'));
    const client = createDiscordTokenExchange(options, { fetchImpl, now: () => now });
    const first = await exchange(client);
    expect(authDiagnostics({ oauthError: first.error })).toMatchObject({ httpStatus: 429,
      retryAfterSeconds: 5, rateLimitScope: 'global', responseType: 'json' });
    expect(client.remainingSeconds()).toBe(5);
    const retries = await Promise.all([exchange(client), exchange(client)]);
    expect(retries.every(result => result.error.statusCode === 429)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now = 6000;
    expect(client.remainingSeconds()).toBe(0);
    expect((await exchange(client, 'fresh-code')).access).toBe('fixture-access');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads Retry-After from a non-JSON edge response without logging its contents', async () => {
    const client = createDiscordTokenExchange(options, { now: () => 0,
      fetchImpl: vi.fn().mockResolvedValue(new Response('<html>private-secret</html>',
        { status: 429, headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:00:10 GMT' } })) });
    const result = await exchange(client);
    expect(client.remainingSeconds()).toBe(10);
    const diagnostic = authDiagnostics({ oauthError: result.error });
    expect(diagnostic.responseType).toBe('non-json');
    expect(JSON.stringify(diagnostic)).not.toContain('private-secret');
  });

  it.each([undefined, -1, 'invalid', null])('uses a conservative fallback for invalid provider wait: %j', async wait => {
    const client = createDiscordTokenExchange(options, { now: () => 0,
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({ retry_after: wait }), { status: 429 })) });
    await exchange(client);
    expect(client.remainingSeconds()).toBe(60);
  });

  it('does not treat invalid codes, missing tokens or network failures as a rate limit', async () => {
    for (const response of [new Response('{"error":"invalid_grant"}', { status: 400 }),
      new Response('{}'), new Response('bad JSON')]) {
      const client = createDiscordTokenExchange(options, { fetchImpl: vi.fn().mockResolvedValue(response) });
      expect((await exchange(client)).access).toBeUndefined();
      expect(client.remainingSeconds()).toBe(0);
    }
    const client = createDiscordTokenExchange(options, { fetchImpl: vi.fn().mockRejectedValue({ code: 'ECONNRESET' }) });
    expect((await exchange(client)).error.code).toBe('ECONNRESET');
    expect(client.remainingSeconds()).toBe(0);
  });

  it('passes 429 wait metadata through Passport and does not reach profile/DB verification', async () => {
    const verify = vi.fn();
    const client = new DiscordStrategy(options, verify);
    const transport = createDiscordTokenExchange(options, { fetchImpl: vi.fn().mockResolvedValue(
      new Response('{"retry_after":8}', { status: 429 })) });
    client._oauth2.getOAuthAccessToken = transport.exchange;
    const profile = vi.spyOn(client, '_loadUserProfile');
    const error = await new Promise(resolve => {
      client.error = resolve;
      client.authenticate({ query: { code: 'fixture-code' }, headers: {}, url: '/callback' });
    });
    expect(authDiagnostics(error)).toMatchObject({ httpStatus: 429, retryAfterSeconds: 8 });
    expect(profile).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('preserves successful Passport verification and does not exchange a cancelled authorization', async () => {
    const verify = vi.fn((access, refresh, profile, done) => done(null, { id: 'fixture-user' }));
    const client = new DiscordStrategy(options, verify);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"access_token":"fixture-access","refresh_token":"fixture-refresh"}'));
    client._oauth2.getOAuthAccessToken = createDiscordTokenExchange(options, { fetchImpl }).exchange;
    vi.spyOn(client, '_loadUserProfile').mockImplementation((access, done) => done(null, { id: 'discord-fixture' }));
    const user = await new Promise((resolve, reject) => {
      client.success = resolve;
      client.error = reject;
      client.authenticate({ query: { code: 'fixture-code' }, headers: {}, url: '/callback' });
    });
    expect(user).toEqual({ id: 'fixture-user' });
    expect(verify).toHaveBeenCalledWith('fixture-access', 'fixture-refresh', { id: 'discord-fixture' }, expect.any(Function));
    const failure = await new Promise(resolve => {
      client.fail = resolve;
      client.authenticate({ query: { error: 'access_denied' }, headers: {}, url: '/callback' });
    });
    expect(failure).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('captures safe provider evidence and distinguishes cached cooldowns from actual traffic', async () => {
    let now = 0;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('{"access_token":"fixture-access"}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'You are being rate limited.',
        global: true, code: 20028, retry_after: 120, access_token: 'secret-token' }),
      { status: 429, headers: { 'cf-ray': 'a3a6188e4b8a0c97-SJC' } }));
    const client = createDiscordTokenExchange(options, { fetchImpl, now: () => now });
    await exchange(client);
    const provider = authDiagnostics({ oauthError: (await exchange(client)).error });
    expect(provider).toMatchObject({ requestOrigin: 'discord-response', tokenRequestsLastMinute: 2,
      rateLimitScope: 'global', discordErrorCode: 20028, rateLimitReason: 'api-rate-limit',
      cloudflareRay: 'a3a6188e4b8a0c97-SJC' });
    expect(JSON.stringify(provider)).not.toContain('secret-token');
    now = 61000;
    const local = authDiagnostics({ oauthError: (await exchange(client)).error });
    expect(local).toMatchObject({ requestOrigin: 'local-cooldown', tokenRequestsLastMinute: 0,
      rateLimitScope: 'global', cloudflareRay: provider.cloudflareRay });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('classifies a known edge error without retaining the raw provider response', async () => {
    const client = createDiscordTokenExchange(options, { fetchImpl: vi.fn().mockResolvedValue(
      new Response('<html>Error code: 1015 private-secret</html>', { status: 429,
        headers: { 'cf-ray': 'private-secret' } })) });
    const diagnostic = authDiagnostics({ oauthError: (await exchange(client)).error });
    expect(diagnostic).toMatchObject({ rateLimitReason: 'cloudflare-restriction', cloudflareErrorCode: 1015,
      cloudflareRay: null, responseType: 'non-json', tokenRequestsLastMinute: 1 });
    expect(JSON.stringify(diagnostic)).not.toContain('private-secret');
  });
});
