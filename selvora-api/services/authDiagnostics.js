// Passport wraps token endpoint failures in oauthError. Log only known codes
// and HTTP status; raw provider bodies can contain credentials or user data.
const PROVIDER_CODES = new Set([
  'invalid_request', 'invalid_client', 'invalid_grant', 'unauthorized_client',
  'unsupported_grant_type', 'invalid_scope', 'access_denied', 'server_error',
  'temporarily_unavailable',
]);
const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN',
  'CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const DATABASE_CODES = new Set(['P1001', 'P2024']);

function authDiagnostics(error) {
  const underlying = error?.oauthError;
  let providerCode = PROVIDER_CODES.has(error?.code) ? error.code : null;
  if (!providerCode && typeof underlying?.data === 'string') {
    try {
      const body = JSON.parse(underlying.data);
      if (PROVIDER_CODES.has(body?.error)) providerCode = body.error;
    } catch { /* HTML, malformed JSON and raw bodies must never enter logs. */ }
  }
  const status = underlying?.statusCode;
  const httpStatus = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  const networkCode = [underlying?.code, error?.code].find(code => NETWORK_CODES.has(code)) || null;
  const databaseCode = DATABASE_CODES.has(error?.code) ? error.code : null;
  const details = { providerCode, httpStatus, networkCode, databaseCode };
  if (httpStatus === 429) {
    details.retryAfterSeconds = Number.isSafeInteger(underlying?.retryAfterSeconds) && underlying.retryAfterSeconds > 0
      ? underlying.retryAfterSeconds : null;
    details.rateLimitScope = ['user', 'global', 'shared'].includes(underlying?.rateLimitScope) ? underlying.rateLimitScope : null;
    details.responseType = ['json', 'non-json'].includes(underlying?.responseType) ? underlying.responseType : null;
    details.requestOrigin = ['discord-response', 'local-cooldown'].includes(underlying?.requestOrigin) ? underlying.requestOrigin : null;
    details.tokenRequestsLastMinute = Number.isSafeInteger(underlying?.tokenRequestsLastMinute) && underlying.tokenRequestsLastMinute >= 0
      ? underlying.tokenRequestsLastMinute : null;
    details.discordErrorCode = Number.isSafeInteger(underlying?.discordErrorCode) && underlying.discordErrorCode >= 0 && underlying.discordErrorCode <= 1_000_000_000
      ? underlying.discordErrorCode : null;
    details.cloudflareErrorCode = [1015, 1020, 1010].includes(underlying?.cloudflareErrorCode) ? underlying.cloudflareErrorCode : null;
    details.cloudflareRay = typeof underlying?.cloudflareRay === 'string' && /^[a-f\d]{16,32}-[A-Z]{3}$/i.test(underlying.cloudflareRay)
      ? underlying.cloudflareRay : null;
    details.rateLimitReason = ['cloudflare-restriction', 'api-rate-limit', 'temporary-block'].includes(underlying?.rateLimitReason)
      ? underlying.rateLimitReason : null;
  }
  return details;
}

module.exports = { authDiagnostics };
