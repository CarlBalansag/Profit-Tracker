import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { CACHE_OWNER_KEY, shouldPersistQuery } from '../data/persistedCache';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../hooks/useApi', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('../components/Auth/ServerWakeUpScreen', () => ({ default: () => <p>waking</p> }));

// This test environment has no working localStorage; use an in-memory one.
const memoryStorage = () => {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    clear: () => items.clear(),
  };
};
beforeEach(() => vi.stubGlobal('localStorage', memoryStorage()));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const Who = () => <p>user: {useAuth().user?.id ?? 'none'}</p>;
const signedInAs = (id) => mocks.apiFetch.mockResolvedValue(
  id ? { ok: true, status: 200, json: async () => ({ id, username: id }) } : { ok: false, status: 401, json: async () => ({}) },
);
const start = (queryClient) => render(
  <QueryClientProvider client={queryClient}><AuthProvider><Who /></AuthProvider></QueryClientProvider>,
);

describe('Whose saved cache it is', () => {
  let queryClient;
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient();
    queryClient.setQueryData(['inventory'], [{ id: 'item-of-u1' }]); // as restored from disk
  });

  it('keeps the restored cache when the same user signs in again', async () => {
    localStorage.setItem(CACHE_OWNER_KEY, 'u1');
    signedInAs('u1');
    start(queryClient);
    expect(await screen.findByText('user: u1')).toBeInTheDocument();
    expect(queryClient.getQueryData(['inventory'])).toEqual([{ id: 'item-of-u1' }]);
  });

  it('clears it when a different user signs in, and records the new owner', async () => {
    localStorage.setItem(CACHE_OWNER_KEY, 'u1');
    signedInAs('u2');
    start(queryClient);
    expect(await screen.findByText('user: u2')).toBeInTheDocument();
    expect(queryClient.getQueryData(['inventory'])).toBeUndefined();
    expect(localStorage.getItem(CACHE_OWNER_KEY)).toBe('u2');
  });

  it('clears it when nobody is signed in', async () => {
    localStorage.setItem(CACHE_OWNER_KEY, 'u1');
    signedInAs(null);
    start(queryClient);
    expect(await screen.findByText('user: none')).toBeInTheDocument();
    expect(queryClient.getQueryData(['inventory'])).toBeUndefined();
    await waitFor(() => expect(localStorage.getItem(CACHE_OWNER_KEY)).toBeNull());
  });

  it('clears it when there is no recorded owner', async () => {
    signedInAs('u1');
    start(queryClient);
    expect(await screen.findByText('user: u1')).toBeInTheDocument();
    expect(queryClient.getQueryData(['inventory'])).toBeUndefined();
  });
});

describe('What is saved to disk', () => {
  const query = (queryKey, status = 'success') => ({ queryKey, state: { status } });

  it('saves page data that loaded', () => {
    for (const key of [['inventory'], ['sales'], ['dashboard', 'All', '30 Days'], ['expenses', 'page'], ['receipts', 'page'], ['creditcard', '2026-11']]) {
      expect(shouldPersistQuery(query(key))).toBe(true);
    }
  });

  it('never saves tokens, keys, failed loads or anything not on the list', () => {
    for (const key of [['calendar-token'], ['api-keys'], ['product-note', 'x'], ['cashout', 'deals', null]]) {
      expect(shouldPersistQuery(query(key))).toBe(false);
    }
    expect(shouldPersistQuery(query(['inventory'], 'error'))).toBe(false);
  });
});
