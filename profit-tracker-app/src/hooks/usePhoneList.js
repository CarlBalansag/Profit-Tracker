import { useEffect, useState } from 'react';

const PHONE_QUERY = '(max-width: 639px)';

function matches(query) {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

// Long lists show a page's worth at a time on phones and everything on larger
// screens. `query` is for lists whose phone layout starts at another width.
export function usePhoneList(items, { step = 25, query = PHONE_QUERY } = {}) {
  const [limit, setLimit] = useState(step);
  const [isPhone, setIsPhone] = useState(() => matches(query));

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(query);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return {
    visible: isPhone ? items.slice(0, limit) : items,
    hiddenCount: isPhone ? Math.max(items.length - limit, 0) : 0,
    showMore: () => setLimit(current => current + step),
  };
}
