import { useLayoutEffect } from 'react';

// A page's sections and cards fade up one after another when it opens, instead
// of all appearing at once. Desktop-width screens only; on phones the page
// just crossfades in.
//
// It works on any page without changing the page: starting at the page root,
// it steps down through wrappers that hold only one element, takes the
// children it reaches as the page's sections, and splits a small grid (a row
// of KPI cards) into its cards. Things that show up a little later (the page
// after its loading screen) are brought in the same way, for a short while
// after the page opens.

const DESKTOP = '(min-width: 768px)';
const STAGGER_MS = 70;
const DURATION_MS = 420;
const MAX_STEPS = 10; // later items share the last delay, so nothing waits long
const WATCH_MS = 2500;
const MAX_GRID_CARDS = 8;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const isShown = (el) => el.getClientRects().length > 0;

const isCardGrid = (el) => {
  const kids = [...el.children].filter(isShown);
  return kids.length > 1 && kids.length <= MAX_GRID_CARDS && getComputedStyle(el).display === 'grid';
};

/** The elements that fade in, in page order. */
export function findStaggerItems(root) {
  let node = root;
  while (node && node.children.length === 1) node = node.children[0];
  if (!node) return [];
  const items = [];
  for (const section of node.children) {
    if (!isShown(section)) continue;
    // A grid of cards, or a grid of cards wrapped with its scrollbar, comes
    // in card by card.
    const grid = isCardGrid(section) ? section
      : section.firstElementChild && isCardGrid(section.firstElementChild) ? section.firstElementChild : null;
    if (grid) items.push(...[...grid.children].filter(isShown));
    else items.push(section);
  }
  return items;
}

export default function usePageStagger(ref) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || typeof root.animate !== 'function') return undefined;
    if (!window.matchMedia?.(DESKTOP).matches) return undefined;

    const done = new WeakSet();
    const running = [];
    let step = 0;
    let lastAt = 0;
    const run = () => {
      const fresh = findStaggerItems(root).filter((el) => !done.has(el));
      if (!fresh.length) return;
      // A later batch (content after a loader) starts its own short sequence.
      const now = performance.now();
      if (now - lastAt > 300) step = 0;
      lastAt = now;
      for (const el of fresh) {
        done.add(el);
        running.push(el.animate(
          [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }],
          { duration: DURATION_MS, delay: Math.min(step, MAX_STEPS) * STAGGER_MS, easing: EASE, fill: 'backwards' },
        ));
        step += 1;
      }
    };
    run();

    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(run);
    });
    observer.observe(root, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), WATCH_MS);
    // Leaving (or React's dev-mode remount) drops any that are still running,
    // so an element is never animated twice.
    return () => {
      observer.disconnect(); clearTimeout(stop); cancelAnimationFrame(frame);
      running.forEach((animation) => animation.cancel());
    };
  }, [ref]);
}
