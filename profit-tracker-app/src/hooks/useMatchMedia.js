import { useEffect, useState } from 'react';

function matches(query) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

// For layouts that swap between two component trees, where hiding one with CSS
// would still load everything in it.
export function useMatchMedia(query) {
  const [matched, setMatched] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setMatched(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matched;
}
