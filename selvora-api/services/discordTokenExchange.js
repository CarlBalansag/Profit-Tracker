// node-oauth discards response headers on errors, including Retry-After.
// Keep Passport's verification/session flow, but retain token rate-limit data.
function createDiscordTokenExchange(options, { fetchImpl = fetch, now = Date.now } = {}) {
  let blockedUntil = 0;
  let lastRateLimitDetails = {};
  const requestBuckets = new Map();
  function requestCount() {
    const second = Math.floor(now() / 1000);
    for (const key of requestBuckets.keys()) if (key <= second - 60) requestBuckets.delete(key);
    return [...requestBuckets.values()].reduce((sum, count) => sum + count, 0);
  }
  const remainingSeconds = () => Math.max(0, Math.ceil((blockedUntil - now()) / 1000));
  const positive = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER / 1000 ? number : null;
  };
  function rateLimitError(seconds, scope = null, responseType = null, evidence = {}) {
    return { statusCode: 429, data: JSON.stringify({ retry_after: seconds }),
      retryAfterSeconds: seconds, rateLimitScope: scope, responseType,
      ...evidence, tokenRequestsLastMinute: requestCount() };
  }
  async function request(code, params) {
    const remaining = remainingSeconds();
    if (remaining) throw rateLimitError(remaining, null, null, { ...lastRateLimitDetails, requestOrigin: 'local-cooldown' });
    const body = new URLSearchParams(params);
    body.set('client_id', options.clientID);
    body.set('client_secret', options.clientSecret);
    body.set(params.grant_type === 'refresh_token' ? 'refresh_token' : 'code', code);
    requestCount();
    const second = Math.floor(now() / 1000);
    requestBuckets.set(second, (requestBuckets.get(second) || 0) + 1);
    const response = await fetchImpl(options.tokenURL || 'https://discord.com/api/oauth2/token', {
      method: 'POST', headers: { ...options.customHeaders, 'Content-Type': 'application/x-www-form-urlencoded' },
      body, redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    const data = await response.text();
    let parsed;
    try { parsed = JSON.parse(data); } catch { /* Retain status even for an HTML edge response. */ }
    if (response.status === 429) {
      const header = response.headers.get('retry-after');
      const headerDate = header && !Number.isFinite(Number(header)) ? Date.parse(header) : NaN;
      // A fallback cooldown is used only when Discord provides no valid wait.
      const seconds = Math.ceil(Math.max(
        positive(header) || 0,
        Number.isFinite(headerDate) ? positive((headerDate - now()) / 1000) || 0 : 0,
        positive(parsed?.retry_after) || 0,
        positive(response.headers.get('x-ratelimit-reset-after')) || 0,
      ) || 60);
      blockedUntil = Math.max(blockedUntil, now() + seconds * 1000);
      const scope = response.headers.get('x-ratelimit-scope');
      const rateLimitScope = ['user', 'global', 'shared'].includes(scope) ? scope : parsed?.global === true ? 'global' : null;
      const responseType = parsed && typeof parsed === 'object' ? 'json' : 'non-json';
      const cloudflareCode = /(?:error code\s*:\s*|error\s+)(1015|1020|1010)\b/i.exec(data)?.[1];
      const ray = response.headers.get('cf-ray');
      lastRateLimitDetails = {
        rateLimitScope, responseType,
        requestOrigin: 'discord-response',
        discordErrorCode: Number.isSafeInteger(parsed?.code) && parsed.code >= 0 && parsed.code <= 1_000_000_000 ? parsed.code : null,
        cloudflareErrorCode: cloudflareCode ? Number(cloudflareCode) : null,
        cloudflareRay: typeof ray === 'string' && /^[a-f\d]{16,32}-[A-Z]{3}$/i.test(ray) ? ray : null,
        rateLimitReason: cloudflareCode ? 'cloudflare-restriction'
          : parsed?.message === 'You are being rate limited.' ? 'api-rate-limit'
          : typeof parsed?.message === 'string' && /temporarily blocked/i.test(parsed.message) ? 'temporary-block' : null,
      };
      throw rateLimitError(seconds, rateLimitScope, responseType, lastRateLimitDetails);
    }
    if (!response.ok) throw { statusCode: response.status, data };
    if (!parsed || typeof parsed !== 'object') throw { statusCode: response.status, data: '' };
    return parsed;
  }
  function exchange(code, params, callback) {
    request(code, params).then(result => {
      const { access_token, refresh_token, ...extra } = result;
      callback(null, access_token, refresh_token, extra);
    }, error => callback(error));
  }
  return { exchange, remainingSeconds };
}

module.exports = { createDiscordTokenExchange };
