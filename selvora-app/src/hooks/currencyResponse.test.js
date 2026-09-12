import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from './useApi';
afterEach(() => vi.unstubAllGlobals());
describe('currency response adapter', () => {
  it('requests precise strings and adapts money/rates for existing displays without changing unrelated strings', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ amount: '0.29', default_cashback_rate: '2.123456', qty: 3, name: '123' })));
    vi.stubGlobal('fetch', request);
    const response = await apiFetch('/api/expenses');
    expect(await response.json()).toEqual({ amount: 0.29, default_cashback_rate: 2.123456, qty: 3, name: '123' });
    expect(request.mock.calls[0][1].headers['X-Currency-Format']).toBe('decimal');
    expect(request.mock.calls[0][1].credentials).toBe('include');
  });
  it('keeps normalized strings for exports and never forwards internal adapter options to fetch', async () => {
    const request = vi.fn(async () => new Response('{"amount":"0.29"}'));
    vi.stubGlobal('fetch', request);
    expect(await (await apiFetch('/api/expenses', { exactCurrency: true })).json()).toEqual({ amount: '0.29' });
    expect(request.mock.calls[0][1]).not.toHaveProperty('exactCurrency');
  });
  it('retains HTTP failure status/error text for existing failure handlers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"Try again"}', { status: 500 })));
    const response = await apiFetch('/api/expenses');
    expect(response.ok).toBe(false);
    expect(await response.json()).toEqual({ error: 'Try again' });
  });
});
