import React, { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

const DURATION_S = 0.9;
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
 * Shows a formatted number ("$2,313.27") counting up to its value with
 * framer-motion: from 0 the first time, then from the old value to the new one
 * whenever it changes. It plays even when the device asks for reduced motion
 * (a short number count, by choice). Screen readers get only the final value.
 * Text without a number is shown as-is.
 */
export default function CountUp({ value }) {
  const text = String(value ?? '');
  const target = parseValue(text);
  const fromRef = useRef(0);
  // The in-between text, tagged with the value it is counting towards, so a
  // stale frame is never shown for a newer value.
  const [frame, setFrame] = useState(() => (target ? { for: text, text: formatLike(target, 0) } : null));

  useEffect(() => {
    const parsed = parseValue(text);
    if (!parsed) return undefined;
    const controls = animate(fromRef.current, parsed.number, {
      duration: DURATION_S,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => {
        fromRef.current = latest;
        setFrame({ for: text, text: formatLike(parsed, latest) });
      },
      onComplete: () => {
        fromRef.current = parsed.number;
        setFrame(null);
      },
    });
    return () => controls.stop();
  }, [text]);

  if (!target) return <>{text}</>;
  const shown = frame && frame.for === text ? frame.text : text;
  return (
    <>
      <span aria-hidden="true">{shown}</span>
      <span className="sr-only">{text}</span>
    </>
  );
}
