import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));

const { authRequest } = await import('./firebaseAuth');

const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status });

describe('authRequest (ideas.md #8: "the first sign-in attempt displayed Could not reach sign-in")', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries and succeeds after a transient network failure (cold backend waking up)', async () => {
    mocks.apiFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const promise = authRequest('intent', { purpose: 'login' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
    expect(mocks.apiFetch).toHaveBeenCalledTimes(2);
  });

  it('retries and succeeds after a non-JSON response (e.g. a proxy error page)', async () => {
    mocks.apiFetch
      .mockResolvedValueOnce(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const promise = authRequest('intent', { purpose: 'login' });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('gives up after exhausting retries and reports a reach-the-server message', async () => {
    mocks.apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const promise = authRequest('intent', { purpose: 'login' });
    const assertion = expect(promise).rejects.toThrow('Could not reach sign-in. Please retry.');
    await vi.runAllTimersAsync();
    await assertion;
  });

  it('never retries a real auth failure -- a parsed error response fails immediately', async () => {
    mocks.apiFetch.mockResolvedValueOnce(jsonResponse(401, { error: 'Invalid credentials' }));

    await expect(authRequest('session', { id_token: 'bad' })).rejects.toThrow('Invalid credentials');
    expect(mocks.apiFetch).toHaveBeenCalledTimes(1);
  });
});
