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
  }
  return details;
}

module.exports = { authDiagnostics };
