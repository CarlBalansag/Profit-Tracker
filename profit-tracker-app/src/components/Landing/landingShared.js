import { useEffect, useMemo, useState } from 'react';
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

// Plays a short scripted sequence while `start` is true: returns the index of
// the step reached so far. `times` are ms from the start for steps 1..n.
// With `replayAfter` (ms), it goes back to step 0 that long after the last
// step and plays again, for as long as `start` stays true. Each time `start`
// turns true the sequence begins again from step 0.
export function useSequence(start, times, replayAfter = 0) {
  const [step, setStep] = useState(0);
  const [round, setRound] = useState(0);
  const key = times.join(',');
  useEffect(() => {
    if (!start) return undefined;
    const ts = key.split(',').map(Number);
    const timers = [setTimeout(() => setStep(0), 0), ...ts.map((t, i) => setTimeout(() => setStep(i + 1), t))];
    if (replayAfter) timers.push(setTimeout(() => setRound((r) => r + 1), ts[ts.length - 1] + replayAfter));
    return () => timers.forEach(clearTimeout);
  }, [start, key, replayAfter, round]);
  return step;
}

// How often the feature stories replay while they stay on screen.
export const REPLAY_MS = 4500;
