import React, { useId, useState } from 'react';
import { motion } from 'motion/react';

// Brand mark: the P and the rising arrow. Hand-traced from the logo PNG, so the
// shapes are close to the original artwork but not pixel-exact.
const MotionSvg = motion.svg;
const MotionG = motion.g;
const MotionRect = motion.rect;
const MotionPath = motion.path;

// The artwork is 336 x 339. The viewBox is a 339 square, centred on it, so the
// SVG is always a whole number of pixels tall. A fractional height puts every
// edge between two pixels and makes the logo look soft.
const VIEW = 339;
const VIEW_X = -(VIEW - 336) / 2;
const LIGHT = '#b21a33';
const DARK = '#691222';

// The pen path that draws the P: up the stem from the bottom-left foot (the
// "I"), along the top bar, round the right side of the bowl and back along the
// bottom. The stroke is wide enough to cover the faces on either side of it.
// It runs a little past both ends of the P so its flat ends cover the corners.
const P_PEN = 'M38 385 L92 76 L205 86 L252 140 L250 190 L212 240 L70 243';
const P_PEN_WIDTH = 84;

// The trend line runs from the arrow's tail (bottom left) to its tip (top
// right). The draw-on reveal grows along this direction.
const ARROW_TAIL = [2, 330];
const ARROW_ANGLE = (Math.atan2(2 - 330, 333 - 2) * 180) / Math.PI;
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
 * On mount the P is drawn like a pen stroke (0.9s): from the bottom-left foot
 * straight up the stem, then along the top and around the bowl. Just before it
 * finishes, the arrow draws itself along the trend line from its tail to its
 * tip (0.9s), so the whole intro takes 1.7s. Hovering nudges the arrow 4px up
 * and to the right.
 *
 * The logo animates even when the device asks for reduced motion. That's a
 * deliberate product choice: the intro is short and plays only when the logo
 * appears or the sidebar changes.
 */
export default function AnimatedLogo({ size = 32, label = 'Profit Tracker', className, style }) {
  const clipId = useId().replace(/:/g, '');
  const hoverShift = HOVER_PX * (VIEW / size);
  // Once the P is fully drawn the mask comes off, so its edges render exactly
  // as they would without one (a mask lightens anti-aliased edge pixels a bit).
  const [pDrawn, setPDrawn] = useState(false);
  const maskP = !pDrawn;

  // The P is revealed through a mask: a wide stroke along the P's centerline
  // that draws itself like a pen. The arrow is revealed by a clip rectangle
  // that lies along the trend line and grows from the tail toward the tip.
  const pRevealVariants = {
    hidden: { pathLength: 0 },
    visible: { pathLength: 1, transition: { duration: 0.9, ease: [0.4, 0, 0.3, 1] } },
  };

  const arrowRevealVariants = {
    hidden: { scaleX: 0 },
    visible: { scaleX: 1, transition: { delay: 0.8, duration: 0.9, ease: [0.45, 0, 0.25, 1] } },
  };

  const arrowVariants = {
    visible: { x: 0, y: 0, transition: { duration: 0.2, ease: 'easeOut' } },
    hover: { x: hoverShift, y: -hoverShift, transition: { duration: 0.2, ease: 'easeOut' } },
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
      initial="hidden"
      animate="visible"
      whileHover="hover"
      data-testid="animated-logo"
      {...a11y}
    >
      <defs>
        <mask id={`${clipId}-p`} maskUnits="userSpaceOnUse" x={-40} y={-40} width={420} height={440}>
          <MotionPath
            data-reveal="p"
            d={P_PEN}
            fill="none"
            stroke="#fff"
            strokeWidth={P_PEN_WIDTH}
            // Flat ends: a round end on a zero-length stroke still draws a dot,
            // which would show the P's foot before the drawing starts.
            strokeLinecap="butt"
            strokeLinejoin="round"
            variants={pRevealVariants}
            onAnimationComplete={(name) => { if (name === 'visible') setPDrawn(true); }}
          />
        </mask>
        {/* A clipPath can't hold a <g>, so the rotation sits on the clipPath. */}
        <clipPath
          id={`${clipId}-arrow`}
          transform={`rotate(${ARROW_ANGLE} ${ARROW_TAIL[0]} ${ARROW_TAIL[1]})`}
        >
          <MotionRect
            data-reveal="arrow"
            x={ARROW_TAIL[0] - 10}
            y={ARROW_TAIL[1] - 100}
            width={490}
            height={200}
            style={{ originX: 0 }}
            variants={arrowRevealVariants}
          />
        </clipPath>
      </defs>
      <g id="p" mask={maskP ? `url(#${clipId}-p)` : undefined}>
        {P_FACES.map((f) => <Face key={f.d} {...f} />)}
      </g>
      <MotionG id="arrow" variants={arrowVariants}>
        <g clipPath={`url(#${clipId}-arrow)`}>
          {ARROW_FACES.map((f) => <Face key={f.d} {...f} />)}
        </g>
      </MotionG>
    </MotionSvg>
  );
}
