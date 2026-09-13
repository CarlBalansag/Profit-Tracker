import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { authDiagnostics } = require('../services/authDiagnostics');

describe('Discord callback diagnostics', () => {
  it('exposes the hidden token endpoint reason without logging secrets', () => {
    const result = authDiagnostics({
      message: 'Failed to obtain access token',
      oauthError: { statusCode: 400, data: JSON.stringify({
        error: 'invalid_grant', error_description: 'secret-code',
        access_token: 'secret-token', client_secret: 'secret-client',
      }) },
    });
    expect(result).toEqual({ providerCode: 'invalid_grant', httpStatus: 400, networkCode: null, databaseCode: null });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('handles parsed Passport TokenError and a provider rate limit', () => {
    expect(authDiagnostics({ code: 'invalid_client' }).providerCode).toBe('invalid_client');
    expect(authDiagnostics({ oauthError: { statusCode: 429, data: '<html>private-data</html>' } }))
      .toEqual({ providerCode: null, httpStatus: 429, networkCode: null, databaseCode: null });
  });

  it('distinguishes network failures from database cold starts', () => {
    expect(authDiagnostics({ oauthError: { code: 'ECONNRESET' } }).networkCode).toBe('ECONNRESET');
    expect(authDiagnostics({ code: 'P1001' }).databaseCode).toBe('P1001');
    expect(authDiagnostics({ code: 'P2024' }).databaseCode).toBe('P2024');
  });

  it.each([undefined, null, {}, { oauthError: { data: '{broken' } },
    { code: 'secret-code', oauthError: { statusCode: 'secret-status', data: '{"error":"secret-error"}' } },
  ])('omits missing, malformed and unknown provider data: %j', error => {
    expect(authDiagnostics(error)).toEqual({ providerCode: null, httpStatus: null, networkCode: null, databaseCode: null });
  });
});
