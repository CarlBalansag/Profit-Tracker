import React, { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;
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

const canAnimate = () =>
  typeof window !== 'undefined'
  && typeof window.requestAnimationFrame === 'function'
  && !(typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/**
 * Shows a formatted number ("$2,313.27") counting up to its value: from 0 the
 * first time, then from the old value to the new one whenever it changes.
 * Screen readers get only the final value. With reduced motion turned on, or
 * for text without a number, the value is shown as-is.
 */
export default function CountUp({ value }) {
  const text = String(value ?? '');
  const target = parseValue(text);
  const fromRef = useRef(0);
  // The in-between text, tagged with the value it is counting towards, so a
  // stale frame is never shown for a newer value.
  const [frame, setFrame] = useState(null);

  useEffect(() => {
    const parsed = parseValue(text);
    if (!parsed) return undefined;
    if (!canAnimate()) {
      fromRef.current = parsed.number;
      return undefined;
    }

    const from = fromRef.current;
    const to = parsed.number;
    let handle;
    let start;
    const step = (now) => {
      if (start === undefined) start = now;
      const t = Math.min(1, (now - start) / DURATION_MS);
      const current = from + (to - from) * (1 - (1 - t) ** 3);
      fromRef.current = current;
      setFrame(t < 1 ? { for: text, text: formatLike(parsed, current) } : null);
      if (t < 1) handle = window.requestAnimationFrame(step);
    };
    handle = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(handle);
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
