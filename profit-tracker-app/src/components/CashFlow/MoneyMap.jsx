// Where the money you've put in sits right now: still in stock, sold and
// waiting on payout, or paid back to you. Small dots drift along each path
// (slowly, and only while the map is on screen).
import React, { useEffect, useRef } from 'react';
import { useInView } from 'motion/react';

const W = 520;
const H = 190;
const SOURCE = { x: 0, y: 63, w: 120, h: 64 };
const TARGETS = [
  { key: 'stock', y: 6, color: 'var(--dp-warning-text)' },
  { key: 'unpaid', y: 70, color: 'var(--dp-info-text)' },
  { key: 'back', y: 134, color: 'var(--dp-green-text)' },
];
const TX = 250;
const TW = 150;
const TH = 50;
const DOTS = 10;

const fmt = (n) => `${Math.round(n ?? 0) < 0 ? '−' : ''}$${Math.abs(Math.round(n ?? 0)).toLocaleString('en-US')}`;

const pathFor = (t) => {
  const sx = SOURCE.x + SOURCE.w;
  const sy = SOURCE.y + SOURCE.h / 2;
  const ty = t.y + TH / 2;
  return `M${sx} ${sy} C ${sx + 70} ${sy}, ${TX - 70} ${ty}, ${TX} ${ty}`;
};

export default function MoneyMap({ map }) {
  const svgRef = useRef(null);
  const dotsRef = useRef(null);
  const inView = useInView(svgRef, { amount: 0.3 });
  const total = (map.inStock || 0) + (map.unpaid || 0) + (map.paidBack || 0);
  const share = (v) => (total > 0 ? v / total : 0);
  const values = { stock: map.inStock, unpaid: map.unpaid, back: map.paidBack };
  const notes = {
    stock: `${map.stockUnits} unit${map.stockUnits === 1 ? '' : 's'} at cost`,
    unpaid: `${map.unpaidCount} sale${map.unpaidCount === 1 ? '' : 's'} not paid yet`,
    back: 'payouts received',
  };
  const labels = { stock: 'In stock', unpaid: 'Sold, unpaid', back: 'Paid back to you' };

  useEffect(() => {
    if (!inView || !svgRef.current || !dotsRef.current) return undefined;
    const paths = Array.from(svgRef.current.querySelectorAll('path[data-flow]'));
    const lengths = paths.map((p) => p.getTotalLength?.() ?? 0);
    // More dots on the paths that carry more money.
    const weights = TARGETS.map((t) => Math.max(0.15, share(values[t.key])));
    const sum = weights.reduce((a, b) => a + b, 0);
    const dots = Array.from(dotsRef.current.children);
    const plan = dots.map((el, i) => {
      let acc = 0; let pi = 0;
      const pick = (i + 0.5) / dots.length;
      for (; pi < weights.length; pi += 1) { acc += weights[pi] / sum; if (pick <= acc) break; }
      pi = Math.min(pi, paths.length - 1);
      el.setAttribute('fill', TARGETS[pi].color);
      return { el, pi, t: (i * 0.37) % 1 };
    });
    let frame;
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      plan.forEach((d) => {
        d.t = (d.t + dt * 0.22) % 1;
        const pt = paths[d.pi].getPointAtLength(d.t * lengths[d.pi]);
        d.el.setAttribute('cx', pt.x);
        d.el.setAttribute('cy', pt.y);
        d.el.setAttribute('opacity', Math.sin(d.t * Math.PI).toFixed(2));
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, map.inStock, map.unpaid, map.paidBack]);

  return (
    <div className="w-full overflow-x-auto">
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[440px]" role="img"
        aria-label={`Put in ${fmt(map.putIn)}: ${fmt(map.inStock)} in stock, ${fmt(map.unpaid)} sold and unpaid, ${fmt(map.paidBack)} paid back`}>
        {TARGETS.map((t) => (
          <path key={t.key} data-flow={t.key} d={pathFor(t)} fill="none" stroke={t.color} strokeOpacity={0.3}
            strokeWidth={3 + share(values[t.key]) * 16} strokeLinecap="round" />
        ))}
        <rect x={SOURCE.x} y={SOURCE.y} width={SOURCE.w} height={SOURCE.h} rx={12} fill="var(--dp-card-bg)" stroke="var(--dp-border-hover)" />
        <text x={SOURCE.x + 12} y={SOURCE.y + 22} fontSize={11} fill="var(--dp-text-label)">Put in</text>
        <text x={SOURCE.x + 12} y={SOURCE.y + 44} fontSize={17} fontWeight={700} fill="var(--dp-text-primary)">{fmt(map.putIn)}</text>
        {TARGETS.map((t) => (
          <g key={t.key}>
            <rect x={TX} y={t.y} width={TW} height={TH} rx={10} fill="var(--dp-card-bg)" stroke={t.color} strokeOpacity={0.55} />
            <text x={TX + 12} y={t.y + 19} fontSize={10.5} fill="var(--dp-text-label)">{labels[t.key]}</text>
            <text x={TX + 12} y={t.y + 38} fontSize={15} fontWeight={700} fill="var(--dp-text-primary)">{fmt(values[t.key])}</text>
            <text x={W} y={t.y + 30} fontSize={10.5} fill="var(--dp-text-muted)" textAnchor="end">{notes[t.key]}</text>
          </g>
        ))}
        <g ref={dotsRef} aria-hidden="true">
          {Array.from({ length: DOTS }, (_, i) => <circle key={i} r={2.8} cx={-10} cy={-10} />)}
        </g>
      </svg>
    </div>
  );
}
