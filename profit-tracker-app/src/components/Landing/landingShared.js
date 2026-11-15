import { useMemo, useState } from 'react';
import { createSeed } from './demoData';

// Shared by the landing page's animated pieces.
export const EASE_OUT = [0.16, 1, 0.3, 1];

// The demo's starting data, built once per page view.
export function useSeed() {
  const [today] = useState(() => new Date());
  const data = useMemo(() => createSeed(today), [today]);
  return { items: data.items, today };
}
