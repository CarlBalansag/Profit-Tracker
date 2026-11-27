import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

// First count from 0, and the count to a new value once it's known.
const SETTLE_S = 0.8;
// While new data loads (unless `drift` is off): a slow climb that keeps
// slowing down, so the number is already moving the moment a filter changes.
const DRIFT_S = 10;
const DRIFT_SHARE = 0.3; // climbs up to 30% past where it was
const NUMBER = /-?\d[\d,]*(?:\.\d+)?/;

// The number inside a formatted value ("$2,313.27", "13.98%", "100"), with what
// it needs to be written back the same way.
function parseValue(text) {
  const match = String(text ?? '').match(NUMBER);
  if (!match) return null;
  const raw = match[0];
  const number = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(number)) return null;
  return {
    number,
    before: String(text).slice(0, match.index),
    after: String(text).slice(match.index + raw.length),
    decimals: raw.includes('.') ? raw.split('.')[1].length : 0,
    grouped: raw.includes(','),
  };
}

function formatLike(parsed, number) {
  const digits = number.toLocaleString('en-US', {
    minimumFractionDigits: parsed.decimals,
    maximumFractionDigits: parsed.decimals,
    useGrouping: parsed.grouped || Math.abs(parsed.number) >= 1000,
  });
  return `${parsed.before}${digits}${parsed.after}`;
}

/**
 * Shows a formatted number ("$2,313.27") counting with framer-motion:
 * - first time: from 0 up to the value;
 * - `pending` (new data is loading): starts climbing slowly right away, from
 *   wherever it is, slowing down as it goes; with `drift={false}` it holds
 *   still on the last number instead;
 * - new value: counts from wherever it is to the real number, quickly, up or
 *   down (so a climb that went past it comes back down).
 * It plays even when the device asks for reduced motion (a short number
 * count, by choice). Screen readers get only the final value. Text without a
 * number is shown as-is.
 */
export default function CountUp({ value, pending = false, drift = true }) {
  const text = String(value ?? '');
  const target = parseValue(text);
  const currentRef = useRef(0);
  // The in-between text while counting; null once it has landed on the value.
  // Kept across a value change so the count carries on from where it is
  // instead of flashing the new value first.
  const [frame, setFrame] = useState(() => (target ? formatLike(target, 0) : null));

  useEffect(() => {
    const parsed = parseValue(text);
    if (!parsed) return undefined;
    if (pending && !drift) return undefined;
    const from = currentRef.current;
    const show = (latest) => {
      currentRef.current = latest;
      setFrame(formatLike(parsed, latest));
    };

    const controls = pending
      ? animate(from, from + Math.abs(from) * DRIFT_SHARE, {
        duration: DRIFT_S,
        ease: [0.05, 0.7, 0.1, 1],
        onUpdate: show,
      })
      : animate(from, parsed.number, {
        duration: SETTLE_S,
        ease: [0.16, 1, 0.3, 1],
        onUpdate: show,
        onComplete: () => {
          currentRef.current = parsed.number;
          setFrame(null);
        },
      });
    return () => controls.stop();
  }, [text, pending, drift]);

  if (!target) return <>{text}</>;
  const shown = frame ?? text;
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
