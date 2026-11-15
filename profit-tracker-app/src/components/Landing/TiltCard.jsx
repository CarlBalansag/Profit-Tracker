import React, { useRef } from 'react';
import { motion, useMotionTemplate, useMotionValue, useSpring } from 'motion/react';

const MotionDiv = motion.div;

// Leans a little toward the mouse and lifts while hovered, with a soft light
// that follows the pointer. Mouse only: touch and pen leave it flat.
export default function TiltCard({ children, className = '', max = 6 }) {
  const ref = useRef(null);
  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const lift = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);
  const spring = { stiffness: 220, damping: 22, mass: 0.6 };
  const rotateX = useSpring(rx, spring);
  const rotateY = useSpring(ry, spring);
  const y = useSpring(lift, spring);
  const glow = useMotionTemplate`radial-gradient(420px circle at ${gx}% ${gy}%, rgba(255,255,255,0.07), transparent 55%)`;

  const move = (e) => {
    if (e.pointerType !== 'mouse' || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width;
    const py = (e.clientY - r.top) / r.height;
    ry.set((px - 0.5) * 2 * max);
    rx.set(-(py - 0.5) * 2 * max);
    gx.set(px * 100);
    gy.set(py * 100);
    lift.set(-6);
  };
  const leave = () => { rx.set(0); ry.set(0); lift.set(0); };

  return (
    <div className={`lp-tilt ${className}`} onPointerMove={move} onPointerLeave={leave}>
      <MotionDiv ref={ref} style={{ rotateX, rotateY, y }} className="relative">
        {children}
        <MotionDiv className="lp-tilt-glow" style={{ background: glow }} aria-hidden="true" />
      </MotionDiv>
    </div>
  );
}
