import { createContext, useCallback, useContext, useState } from 'react';
import { useUiPreferences } from '../../hooks/useUiPreferences';

// The page's look. One place, so every view draws the same card.
export const CARD_WIDTH = 316;
export const GAP = 16;
export const OVERLAP = 0.82; // how much of each stacked card the next one hides
export const TILT = 6; // degrees

// { catalogById, play } for every card on the page.
export const CardPageContext = createContext({ catalogById: new Map(), play: false });
export const useCardPage = () => useContext(CardPageContext);

// On unless the person turned it off in Settings > Appearance.
export function usePlayfulMotion() {
  const { preferences } = useUiPreferences();
  return preferences.motion !== 'off';
}

export function useSpring() {
  const { play } = useCardPage();
  return play ? { type: 'spring', stiffness: 260, damping: 22, mass: 0.9 } : { duration: 0 };
}

// The width of an element, so layouts follow the space they really have (the
// sidebar takes part of the screen) instead of the window.
export function useWidth() {
  const [width, setWidth] = useState(0);
  // A callback ref, so it also works when the element first appears later.
  const ref = useCallback((el) => {
    if (!el) return undefined;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

// A tiny tap under the finger, on phones that support it.
export const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { /* not allowed */ } };

export const cardWidth = (space) => Math.max(200, Math.min(CARD_WIDTH, space || CARD_WIDTH));

// The first `step` cards, then more on request, so a big wallet stays short.
export function useLimited(list, step) {
  const [shown, setShown] = useState(step);
  const visible = list.slice(0, shown);
  return { visible, hidden: list.length - visible.length, more: () => setShown((n) => n + step), less: shown > step ? () => setShown(step) : null };
}
