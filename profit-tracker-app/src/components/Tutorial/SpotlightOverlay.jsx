import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTutorial, TUTORIAL_STEPS } from '../../context/TutorialContext';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const PADDING = 10; // px around the spotlight target

function getRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING,
    left: r.left - PADDING,
    width: r.width + PADDING * 2,
    height: r.height + PADDING * 2,
    bottom: r.bottom + PADDING,
    right: r.right + PADDING,
    centerX: r.left + r.width / 2,
    centerY: r.top + r.height / 2,
  };
}

function TooltipCard({ rect, placement, step, onNext, onBack, onSkip, stepIndex, totalSteps }) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;

  // Compute tooltip position
  let style = {};
  const TIP_W = 340;
  const TIP_H = 300; // approx — generous upper bound; actual height varies with body text length
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!rect || placement === 'center') {
    style = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: TIP_W,
    };
  } else if (placement === 'right') {
    let top = rect.top + rect.height / 2 - TIP_H / 2;
    top = Math.max(16, Math.min(vh - TIP_H - 16, top));
    style = {
      position: 'fixed',
      top,
      left: rect.right + 12,
      width: TIP_W,
    };
    // Flip left if would go off screen
    if (rect.right + 12 + TIP_W > vw - 16) {
      style.left = rect.left - TIP_W - 12;
    }
  } else if (placement === 'bottom') {
    let left = rect.left + rect.width / 2 - TIP_W / 2;
    left = Math.max(16, Math.min(vw - TIP_W - 16, left));
    style = {
      position: 'fixed',
      top: rect.bottom + 12,
      left,
      width: TIP_W,
    };
    // Flip up if would go off screen
    if (rect.bottom + 12 + TIP_H > vh - 16) {
      style.top = rect.top - TIP_H - 12;
    }
  } else if (placement === 'top') {
    let left = rect.left + rect.width / 2 - TIP_W / 2;
    left = Math.max(16, Math.min(vw - TIP_W - 16, left));
    style = {
      position: 'fixed',
      top: rect.top - TIP_H - 12,
      left,
      width: TIP_W,
    };
    if (style.top < 16) style.top = rect.bottom + 12;
  }

  // Safety net: a spotlight target can be taller/wider than the viewport, or
  // sit flush against an edge (e.g. a mobile drawer that fills most of a
  // narrow screen, leaving no room for 'right' placement's left-flip
  // fallback), which makes the flip-if-offscreen checks above insufficient
  // on their own. Always keep the card fully within the viewport as a final step.
  if (placement !== 'center') {
    if (typeof style.top === 'number') {
      style.top = Math.max(16, Math.min(vh - TIP_H - 16, style.top));
    }
    if (typeof style.left === 'number') {
      style.left = Math.max(16, Math.min(vw - TIP_W - 16, style.left));
    }
  }

  const progress = ((stepIndex + 1) / totalSteps) * 100;

  return (
    <div
      style={{ ...style, zIndex: 10001 }}
      className="rounded-xl border border-white/10 bg-[#0f1115] shadow-2xl shadow-black/60 p-5 animate-in fade-in slide-in-from-bottom-2 duration-200"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="text-[10px] font-semibold text-emerald-400 uppercase tracking-widest mb-1">
            Step {stepIndex + 1} of {totalSteps}
          </p>
          <h3 className="text-base font-bold text-white leading-tight">{step.title}</h3>
        </div>
        <button
          onClick={onSkip}
          className="flex-shrink-0 p-1 text-gray-500 hover:text-white hover:bg-white/10 rounded-md transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <p className="text-sm text-gray-400 leading-relaxed mb-4">{step.body}</p>

      {/* Progress bar */}
      <div className="w-full h-1 bg-white/5 rounded-full mb-4 overflow-hidden">
        <div
          className="h-1 bg-emerald-500 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Buttons */}
      <div className="flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Skip tour
        </button>
        <div className="flex items-center gap-2">
          {!isFirst && (
            <button
              onClick={onBack}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back
            </button>
          )}
          <button
            onClick={onNext}
            className="flex items-center gap-1 px-4 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
          >
            {isLast ? 'Finish' : 'Next'} {!isLast && <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

export const SpotlightOverlay = () => {
  const { active, currentStep, stepIndex, totalSteps, next, back, finish, skip } = useTutorial();
  const [rect, setRect] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const rafRef = useRef(null);
  const navigatingRef = useRef(false);
  const navTimerRef = useRef(null);
  const scrolledStepRef = useRef(null);

  // Navigate to the step's page if needed
  useEffect(() => {
    if (!active || !currentStep?.navigate) return;

    const [path, qs] = currentStep.navigate.split('?');
    const targetPath = path + (qs ? `?${qs}` : '');
    const currentPath = location.pathname + (location.search || '');

    if (currentPath === targetPath) return;

    navigatingRef.current = true;
    clearTimeout(navTimerRef.current);
    navigate(targetPath, { replace: false });
    navTimerRef.current = setTimeout(() => {
      navigatingRef.current = false;
    }, 400);

    // Do NOT cancel the timer on cleanup — let it fire after navigation settles
  }, [active, currentStep, navigate, location.pathname, location.search]);

  // Track target element position with rAF. Keeps polling through the
  // navigation window (rather than bailing out without rescheduling) —
  // otherwise the loop never resumes on its own once navigation settles,
  // leaving the tooltip rendered at the *previous* step's stale position
  // until some later, unrelated step change happens to restart it.
  const updateRect = useCallback(() => {
    if (!active || !currentStep) return;
    if (!navigatingRef.current) {
      const el = currentStep.target
        ? document.querySelector(`[data-tutorial-id="${currentStep.target}"]`)
        : null;
      // Scroll the target into view once per step — it may be below the
      // fold on a long mobile page, since nothing else brings it into view there.
      if (el && scrolledStepRef.current !== currentStep.id) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        scrolledStepRef.current = currentStep.id;
      }
      setRect(getRect(el));
    }
    rafRef.current = requestAnimationFrame(updateRect);
  }, [active, currentStep]);

  useEffect(() => {
    if (!active) { setRect(null); return; }
    rafRef.current = requestAnimationFrame(updateRect);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, updateRect]);

  if (!active || !currentStep) return null;

  const hasSpotlight = rect !== null && currentStep.target !== null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const handleNext = () => {
    if (stepIndex >= totalSteps - 1) finish();
    else next();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 10000, pointerEvents: 'auto' }}>
      {/* SVG mask overlay — cuts a hole where the spotlight target is */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        onClick={skip}
      >
        <defs>
          <mask id="spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {hasSpotlight && (
              <rect
                x={rect.left}
                y={rect.top}
                width={rect.width}
                height={rect.height}
                rx="8"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          width="100%"
          height="100%"
          fill="rgba(0,0,0,0.75)"
          mask="url(#spotlight-mask)"
        />
      </svg>

      {/* Spotlight border glow */}
      {hasSpotlight && (
        <div
          style={{
            position: 'fixed',
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
            borderRadius: 8,
            border: '2px solid rgba(16,185,129,0.6)',
            boxShadow: '0 0 0 4px rgba(16,185,129,0.1)',
            pointerEvents: 'none',
            zIndex: 10001,
          }}
        />
      )}

      {/* Tooltip card */}
      <TooltipCard
        rect={rect}
        placement={currentStep.placement}
        step={currentStep}
        onNext={handleNext}
        onBack={back}
        onSkip={skip}
        stepIndex={stepIndex}
        totalSteps={totalSteps}
      />
    </div>
  );
};
