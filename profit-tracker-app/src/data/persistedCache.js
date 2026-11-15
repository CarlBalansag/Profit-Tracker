import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { persistQueryClientRestore, persistQueryClientSubscribe } from '@tanstack/react-query-persist-client';
import { del, get, set } from 'idb-keyval';
import { CURRENT_VERSION } from './changelog';

// Keeps the data cache in IndexedDB, so reloading or reopening the app shows
// the last data at once while each page refreshes it.
//
// Whose data it is: AuthContext records the signed-in user's id under
// CACHE_OWNER_KEY and clears the cache (memory and disk) whenever a
// different user, or nobody, signs in. The cache is restored before the app
// mounts, so it's always in place before that check runs.

export const CACHE_MAX_AGE = 1000 * 60 * 60 * 12; // 12 hours
export const CACHE_OWNER_KEY = 'pt-cache-owner';
const STORAGE_KEY = 'profit-tracker-query-cache';

// Only page data is kept on disk; never tokens, keys or one-off lookups.
const PERSISTED_ROOTS = new Set([
  'inventory', 'sales', 'platforms', 'buyers', 'payment-methods', 'product-names',
  'dashboard', 'expenses', 'receipts', 'creditcard', 'goals',
  'calendar-events', 'calendar-auto-events',
]);
export const shouldPersistQuery = (query) =>
  query.state.status === 'success' && PERSISTED_ROOTS.has(query.queryKey[0]);

const indexedDbAvailable = () => {
  try { return typeof indexedDB !== 'undefined'; } catch { return false; }
};

const persister = createAsyncStoragePersister({
  storage: { getItem: get, setItem: set, removeItem: del },
  key: STORAGE_KEY,
  throttleTime: 1000,
});

const options = (queryClient) => ({
  queryClient,
  persister,
  maxAge: CACHE_MAX_AGE,
  buster: String(CURRENT_VERSION), // a new release starts clean
  dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
});

// Restores the saved cache (giving up after 1.5 s, so a slow disk never holds
// the app), then keeps saving changes. Resolves once the app can mount.
export async function startPersistedCache(queryClient) {
  if (!indexedDbAvailable()) return;
  try {
    await Promise.race([
      persistQueryClientRestore(options(queryClient)),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  } catch {
    // A broken or blocked store just means starting with an empty cache.
  }
  persistQueryClientSubscribe(options(queryClient));
}

// Drops the saved copy right away (sign-out, a different user).
export function clearPersistedCache() {
  if (!indexedDbAvailable()) return;
  persister.removeClient().catch(() => {});
}
