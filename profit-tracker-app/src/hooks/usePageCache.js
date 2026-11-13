import { useContext, useEffect, useRef } from 'react';
import { QueryClientContext } from '@tanstack/react-query';

// For pages that load their own data (instead of through a useQuery hook):
// lets them start from a copy kept in the react-query cache, so a revisit or
// a hover prefetch (data/pagePrefetch.js) shows the page at once while the
// page refreshes it. The cache is cleared when the signed-in user changes
// (AuthContext), so one account never sees another's data.
//
// Without a QueryClientProvider (some tests) there's no cache and the page
// simply loads as before.

export const EXPENSES_PAGE_KEY = ['expenses', 'page'];
export const RECEIPTS_PAGE_KEY = ['receipts', 'page'];

export const useOptionalQueryClient = () => useContext(QueryClientContext);

// Calls onData with the current value of every key whenever one of them is
// fetched (a prefetch landing, say). Writes the page makes itself
// (setQueryData) are ignored.
export function useCacheArrivals(queryClient, keys, onData) {
  const onDataRef = useRef(onData);
  useEffect(() => { onDataRef.current = onData; });
  const keyList = JSON.stringify(keys);

  useEffect(() => {
    if (!queryClient) return undefined;
    const wanted = JSON.parse(keyList);
    const wantedText = wanted.map((key) => JSON.stringify(key));
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action?.type !== 'success' || event.action.manual) return;
      if (!wantedText.includes(JSON.stringify(event.query.queryKey))) return;
      onDataRef.current(wanted.map((key) => queryClient.getQueryData(key)));
    });
  }, [queryClient, keyList]);
}
