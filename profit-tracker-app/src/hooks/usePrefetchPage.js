import { useEffect, useMemo, useRef } from 'react';
import { prefetchPage } from '../data/pagePrefetch';
import { useOptionalQueryClient } from './usePageCache';

// The pointer has to rest on a link this long before its page is prefetched,
// so sweeping across the sidebar doesn't load every page.
const HOVER_INTENT_MS = 90;

// Props to spread on a nav link so hovering, focusing or touching it
// prefetches that page (see data/pagePrefetch.js).
export function usePrefetchProps(path) {
  const queryClient = useOptionalQueryClient();
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(() => {
    const now = () => prefetchPage(queryClient, path);
    return {
      onMouseEnter: () => { clearTimeout(timer.current); timer.current = setTimeout(now, HOVER_INTENT_MS); },
      onMouseLeave: () => clearTimeout(timer.current),
      onFocus: now,
      onTouchStart: now,
    };
  }, [queryClient, path]);
}
