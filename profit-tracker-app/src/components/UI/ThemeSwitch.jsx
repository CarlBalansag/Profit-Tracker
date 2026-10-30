import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Sun, Moon } from 'lucide-react';
import './ThemeSwitch.css';

// WAVE CONTROLS: how wobbly the reveal edge is.
// WAVE_AMPLITUDE is the bump height as a fraction of the current radius;
// WAVE_LOBES sets how many bumps go around the edge for each wave.
const WAVE_AMPLITUDE = 0.07;
const WAVE_LOBES = [7, 12];
const WAVE_STEPS = 48;
const WAVE_POINTS = 90;

// LIFT CONTROLS: how much each card pops up as the wave reaches it.
const LIFT_HEIGHT = 8;
const LIFT_SCALE = 1.015;
const LIFT_DURATION = 700;
const LIFT_MAX_CARDS = 40;
// How long a card takes to fade to its new colors once the wave reaches it.
const CARD_FADE_DURATION = 260;

// The wave's radius grows as endRadius * 1.15 * easeOutQuart(t).
function waveArrivalTime(distance, endRadius, duration) {
  const eased = Math.min(distance / (endRadius * 1.15), 1);
  return (1 - Math.pow(1 - eased, 1 / 4)) * duration;
}

// Card-like elements: rounded, with a background or shadow, and card-sized.
function isCardLike(el, viewportArea) {
  if (['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A', 'svg'].includes(el.tagName)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width < 80 || rect.height < 40) return false;
  if (rect.width * rect.height > viewportArea * 0.6) return false;
  const style = getComputedStyle(el);
  if (parseFloat(style.borderTopLeftRadius) < 8) return false;
  return style.backgroundColor !== 'rgba(0, 0, 0, 0)' || style.boxShadow !== 'none';
}

// Collects the outermost visible cards on screen (a card's inner cards are skipped).
function findVisibleCards(root, exclude) {
  const viewportArea = window.innerWidth * window.innerHeight;
  const cards = [];
  const visit = (el) => {
    if (cards.length >= LIFT_MAX_CARDS || el === exclude) return;
    const rect = el.getBoundingClientRect();
    const onScreen = rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
    if (onScreen && isCardLike(el, viewportArea)) {
      cards.push(el);
      return;
    }
    for (const child of el.children) visit(child);
  };
  visit(root);
  return cards;
}

// Builds clip-path keyframes for a circle whose edge ripples as it grows.
// The wobble shifts each frame and fades out, so the shape ends fully covering the screen.
function buildRippleKeyframes(x, y, endRadius) {
  const frames = [];
  for (let i = 0; i <= WAVE_STEPS; i++) {
    const t = i / WAVE_STEPS;
    const eased = 1 - Math.pow(1 - t, 4);
    const radius = endRadius * 1.15 * eased;
    const amplitude = radius * WAVE_AMPLITUDE * (1 - t);
    const points = [];
    for (let p = 0; p < WAVE_POINTS; p++) {
      const angle = (p / WAVE_POINTS) * Math.PI * 2;
      const wave =
        0.6 * Math.sin(WAVE_LOBES[0] * angle + t * 10) +
        0.4 * Math.sin(WAVE_LOBES[1] * angle - t * 14);
      const r = radius + amplitude * wave;
      points.push(`${(x + r * Math.cos(angle)).toFixed(1)}px ${(y + r * Math.sin(angle)).toFixed(1)}px`);
    }
    frames.push({ clipPath: `polygon(${points.join(',')})` });
  }
  return frames;
}

function getRevealDuration() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--theme-reveal-duration');
  return parseFloat(value) * 1000 || 1250;
}

// The theme follows the OS setting unless the user picked one with the switch.
// The same rule runs in an inline script in index.html so the page never flashes.
const OVERRIDE_KEY = 'theme-override';
const DARK_QUERY = '(prefers-color-scheme: dark)';

function getDarkQuery() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(DARK_QUERY);
}

function systemPrefersDark() {
  return Boolean(getDarkQuery()?.matches);
}

function readOverride() {
  try {
    const value = localStorage.getItem(OVERRIDE_KEY);
    return value === 'dark' || value === 'light' ? value : null;
  } catch {
    return null;
  }
}

function writeOverride(value) {
  try {
    if (value) localStorage.setItem(OVERRIDE_KEY, value);
    else localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
}

function getInitialIsDark() {
  if (typeof window === 'undefined') return false;
  // The old `theme` key stored a permanent choice; drop it so everyone starts on auto.
  try {
    localStorage.removeItem('theme');
  } catch {
    // ignore
  }
  const override = readOverride();
  if (override) return override === 'dark';
  return systemPrefersDark();
}

export default function ThemeSwitch() {
  const [isDark, setIsDark] = useState(getInitialIsDark);

  const [ripple, setRipple] = useState(null);
  const rippleTimeoutRef = useRef(null);
  const rippleRef = useRef(null);

  // Sync initial theme attribute on mount
  useEffect(() => {
    const current = isDark ? 'dark' : 'light';
    document.documentElement.dataset.theme = current;
  }, []);

  // Follow live OS theme changes: they clear any manual override.
  useEffect(() => {
    const query = getDarkQuery();
    if (!query) return undefined;
    const handleChange = (event) => {
      writeOverride(null);
      setIsDark(event.matches);
      document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
    };
    if (query.addEventListener) {
      query.addEventListener('change', handleChange);
      return () => query.removeEventListener('change', handleChange);
    }
    query.addListener?.(handleChange);
    return () => query.removeListener?.(handleChange);
  }, []);

  const handleToggle = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const nextIsDark = !isDark;

    // Capture coordinates from the click, falling back to the center of the switch
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX && e.clientX > 0 ? e.clientX : rect.left + rect.width / 2;
    const y = e.clientY && e.clientY > 0 ? e.clientY : rect.top + rect.height / 2;

    // Radius required to cover the furthest corner of the viewport
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const keyframes = buildRippleKeyframes(x, y, endRadius);
    const duration = getRevealDuration();

    const applyThemeChange = (next) => {
      setIsDark(next);
      document.documentElement.dataset.theme = next ? 'dark' : 'light';
      // Picking the OS theme puts the user back on auto; anything else is an override.
      writeOverride(next === systemPrefersDark() ? null : next ? 'dark' : 'light');
    };

    // 1. Native View Transitions API (Chrome 111+, Edge, Safari 18+)
    if (document.startViewTransition) {
      // Give each visible card its own layer so it can lift as the wave passes it
      const switchWrapper = e.currentTarget.closest('.sticky-theme-switch-wrapper');
      const cards = findVisibleCards(document.body, switchWrapper);
      const lifted = cards.map((el, i) => {
        const name = `theme-lift-${i}`;
        const box = el.getBoundingClientRect();
        el.style.viewTransitionName = name;
        return { el, name, box };
      });

      document.documentElement.classList.add('theme-switching');
      const transition = document.startViewTransition(() => {
        flushSync(() => {
          applyThemeChange(nextIsDark);
        });
      });
      transition.ready.then(() => {
        const root = document.documentElement;
        root.animate(keyframes, {
          duration,
          easing: 'linear',
          pseudoElement: '::view-transition-new(root)',
        });
        lifted.forEach(({ name, box }) => {
          // Cards only animate opacity and transform: the GPU runs those without repainting.
          // (A per-card clip-path has to repaint every frame and flickers on large screens.)
          const distance = Math.hypot(box.left + box.width / 2 - x, box.top + box.height / 2 - y);
          const arrival = waveArrivalTime(distance, endRadius, duration);
          root.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: CARD_FADE_DURATION,
            delay: Math.max(0, arrival - CARD_FADE_DURATION / 2),
            easing: 'ease-out',
            fill: 'backwards',
            pseudoElement: `::view-transition-new(${name})`,
          });
          root.animate(
            [
              { transform: 'translateY(0) scale(1)' },
              { offset: 0.35, transform: `translateY(-${LIFT_HEIGHT}px) scale(${LIFT_SCALE})` },
              { transform: 'translateY(0) scale(1)' },
            ],
            {
              duration: LIFT_DURATION,
              delay: Math.max(0, arrival - 120),
              easing: 'ease-in-out',
              pseudoElement: `::view-transition-image-pair(${name})`,
            }
          );
        });
      });
      transition.finished.finally(() => {
        document.documentElement.classList.remove('theme-switching');
        lifted.forEach(({ el }) => {
          el.style.viewTransitionName = '';
        });
      });
      return;
    }

    // 2. Cross-browser wavy ripple fallback (e.g. Firefox)
    if (rippleTimeoutRef.current) clearTimeout(rippleTimeoutRef.current);
    const targetBg = nextIsDark ? '#0b0b0b' : '#EEF0F3';
    setRipple({ bg: targetBg });

    // Expand the ripple once the overlay has mounted
    requestAnimationFrame(() => {
      rippleRef.current?.animate(keyframes, { duration, easing: 'linear', fill: 'forwards' });
      // Flip the underlying theme part-way so elements match the background
      setTimeout(() => {
        applyThemeChange(nextIsDark);
      }, duration * 0.4);
      // Clear overlay after the animation finishes
      rippleTimeoutRef.current = setTimeout(() => {
        setRipple(null);
      }, duration + 50);
    });
  };

  return (
    <>
      {ripple && (
        <div
          ref={rippleRef}
          className="theme-ripple-fallback"
          style={{ backgroundColor: ripple.bg }}
          aria-hidden="true"
        />
      )}
      <div className="sticky-theme-switch-wrapper" data-testid="sticky-theme-switch">
        <button
          type="button"
          role="switch"
          className="theme-switch"
          aria-checked={isDark}
          aria-label="Toggle light and dark mode"
          title={isDark ? "Switch to Day" : "Switch to Night"}
          onClick={handleToggle}
        >
          <span className="theme-switch__track">
            <span className="theme-switch__knob">
              {isDark ? <Moon size={11} strokeWidth={2.5} /> : <Sun size={11} strokeWidth={2.5} />}
            </span>
          </span>
        </button>
      </div>
    </>
  );
}
