// node-oauth discards response headers on errors, including Retry-After.
// Keep Passport's verification/session flow, but retain token rate-limit data.
function createDiscordTokenExchange(options, { fetchImpl = fetch, now = Date.now } = {}) {
  let blockedUntil = 0;
  const remainingSeconds = () => Math.max(0, Math.ceil((blockedUntil - now()) / 1000));
  const positive = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number <= Number.MAX_SAFE_INTEGER / 1000 ? number : null;
  };
  function rateLimitError(seconds, scope = null, responseType = null) {
    return { statusCode: 429, data: JSON.stringify({ retry_after: seconds }),
      retryAfterSeconds: seconds, rateLimitScope: scope, responseType };
  }
  async function request(code, params) {
    const remaining = remainingSeconds();
    if (remaining) throw rateLimitError(remaining);
    const body = new URLSearchParams(params);
    body.set('client_id', options.clientID);
    body.set('client_secret', options.clientSecret);
    body.set(params.grant_type === 'refresh_token' ? 'refresh_token' : 'code', code);
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
      throw rateLimitError(seconds, ['user', 'global', 'shared'].includes(scope) ? scope : null,
        parsed && typeof parsed === 'object' ? 'json' : 'non-json');
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
