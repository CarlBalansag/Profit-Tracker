import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

// Brand mark: the P and the rising arrow. Hand-traced from the logo PNG, so the
// shapes are close to the original artwork but not pixel-exact.
const MotionSvg = motion.svg;
const MotionG = motion.g;

// The artwork is 336 x 339. The viewBox is a 339 square, centred on it, so the
// SVG is always a whole number of pixels tall. A fractional height puts every
// edge between two pixels and makes the logo look soft.
const VIEW = 339;
const VIEW_X = -(VIEW - 336) / 2;
const LIGHT = '#b21a33';
const DARK = '#691222';

// How far the arrow starts from its resting spot (viewBox units, bottom left).
const ARROW_START = 46;
// Hover nudge in screen pixels, converted to viewBox units per render size.
const HOVER_PX = 4;

// Dark side faces sit behind the light ones. Light and dark faces share their
// corner points exactly, and the dark faces get a thin stroke that stays the
// same width on screen at every size. Together these keep a pale anti-aliasing
// seam from showing where two faces meet, even at sidebar size.
function Face({ d, fill }) {
  if (fill === DARK) {
    return (
      <path
        d={d}
        fill={fill}
        stroke={fill}
        strokeWidth={0.75}
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return <path d={d} fill={fill} />;
}

const P_FACES = [
  { fill: DARK, d: 'M98 87 183 87 201 101 186 118 170 107 119 107 104 155 69 193Z' },
  { fill: DARK, d: 'M239 150 261 123 262 186 212 253 101 253 119 232 200 232 239 179Z' },
  { fill: DARK, d: 'M75 281 57 336 25 336Z' },
  { fill: LIGHT, d: 'M79 65 193 65 217 84 201 101 183 87 98 87 69 193 33 230Z' },
  { fill: LIGHT, d: 'M239 150 239 179 200 232 119 232 137 212 189 212Z' },
];

const ARROW_FACES = [
  { fill: DARK, d: 'M333 2 313 91 291 75 171 204 145 180 145 155 171 177Z' },
  { fill: LIGHT, d: 'M333 2 171 177 145 155 145 180 2 330 21 265 142 128 171 151 264 50 244 32Z' },
];

/**
 * Animated Profit Tracker logo.
 *
 * On mount the P fades and scales in (0.4s), then the arrow slides in from the
 * bottom left with a slight overshoot (0.5s). Hovering nudges the arrow 4px up
 * and to the right. With prefers-reduced-motion the logo renders in its final
 * state and does not move on hover.
 */
export default function AnimatedLogo({ size = 32, label = 'Profit Tracker', className, style }) {
  const reduceMotion = useReducedMotion();
  // After the intro, returning from hover should be quick, not replay the
  // intro's delay and overshoot.
  const [introDone, setIntroDone] = useState(false);
  const unitsPerPx = VIEW / size;
  const hoverShift = HOVER_PX * unitsPerPx;

  const pVariants = {
    hidden: { opacity: 0, scale: 0.88 },
    visible: { opacity: 1, scale: 1, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] } },
  };

  const arrowVariants = {
    hidden: { opacity: 0, x: -ARROW_START, y: ARROW_START },
    visible: {
      opacity: 1,
      x: 0,
      y: 0,
      transition: introDone
        ? { duration: 0.2, ease: 'easeOut' }
        : {
          x: { delay: 0.4, duration: 0.5, ease: [0.34, 1.45, 0.64, 1] },
          y: { delay: 0.4, duration: 0.5, ease: [0.34, 1.45, 0.64, 1] },
          opacity: { delay: 0.4, duration: 0.1 },
        },
    },
    hover: {
      x: hoverShift,
      y: -hoverShift,
      transition: { duration: 0.2, ease: 'easeOut' },
    },
  };

  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

  return (
    <MotionSvg
      viewBox={`${VIEW_X} 0 ${VIEW} ${VIEW}`}
      width={size}
      height={size}
      className={className}
      style={{ overflow: 'visible', ...style }}
      shapeRendering="geometricPrecision"
      initial={reduceMotion ? false : 'hidden'}
      animate="visible"
      whileHover={reduceMotion ? undefined : 'hover'}
      data-testid="animated-logo"
      {...a11y}
    >
      <MotionG id="p" variants={pVariants}>
        {P_FACES.map((f) => <Face key={f.d} {...f} />)}
      </MotionG>
      <MotionG
        id="arrow"
        variants={arrowVariants}
        onAnimationComplete={(name) => { if (name === 'visible') setIntroDone(true); }}
      >
        {ARROW_FACES.map((f) => <Face key={f.d} {...f} />)}
      </MotionG>
    </MotionSvg>
  );
}
