import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { createSeed } from './demoData';

// Motion language for the landing page, modelled on Copilot's: opacity eases
// out on a quart curve, movement on a longer expo curve, and things arrive
// from a slight blur rather than sliding in from far away.
export const EASE_OUT = [0.16, 1, 0.3, 1];
export const EASE_QUART = [0.25, 1, 0.5, 1];

export const blurIn = {
  hidden: { opacity: 0, y: 10, filter: 'blur(6px)' },
  show: {
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { opacity: { duration: 0.6, ease: EASE_QUART }, default: { duration: 0.9, ease: EASE_OUT } },
  },
};

export const popIn = {
  hidden: { opacity: 0, y: 14, scale: 0.94 },
  show: {
    opacity: 1, y: 0, scale: 1,
    transition: { opacity: { duration: 0.5, ease: EASE_QUART }, default: { type: 'spring', stiffness: 300, damping: 26 } },
  },
};

// The demo's starting data, built once per page view.
export function useSeed() {
  const [today] = useState(() => new Date());
  const data = useMemo(() => createSeed(today), [today]);
  return { items: data.items, today };
}

// Plays a short scripted sequence once `start` turns true: returns the index
// of the step reached so far. `times` are ms from the start for steps 1..n.
// With reduced motion it jumps straight to the last step.
export function useSequence(start, times) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const key = times.join(',');
  useEffect(() => {
    if (!start || reduce) return undefined;
    const timers = key.split(',').map((t, i) => setTimeout(() => setStep(i + 1), Number(t)));
    return () => timers.forEach(clearTimeout);
  }, [start, reduce, key]);
  return reduce ? times.length : step;
}
