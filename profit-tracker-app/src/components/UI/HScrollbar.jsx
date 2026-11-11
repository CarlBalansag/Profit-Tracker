import React, { useCallback, useEffect, useRef, useState } from 'react';

// A drawn horizontal scrollbar for a sideways-scrolling row. Native scrollbar
// hover colors are unreliable in Chromium, and a 6px native bar is hard to
// grab, so the row hides its own bar (`dp-no-native-scrollbar`) and this one
// mirrors it: drag the thumb, or click the track to jump there.
// Colors: --dp-scroll-thumb / -hover / -active, with accent-based fallbacks.
export default function HScrollbar({ targetRef, className = '' }) {
  const trackRef = useRef(null);
  const dragRef = useRef(null);
  const [state, setState] = useState({ visible: false, thumbW: 0, thumbX: 0 });

  const measure = useCallback(() => {
    const el = targetRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const max = el.scrollWidth - el.clientWidth;
    const trackW = track.clientWidth;
    if (max <= 1 || trackW === 0) {
      setState(prev => (prev.visible ? { visible: false, thumbW: 0, thumbX: 0 } : prev));
      return;
    }
    const thumbW = Math.max(48, Math.round((el.clientWidth / el.scrollWidth) * trackW));
    const thumbX = Math.round((el.scrollLeft / max) * (trackW - thumbW));
    setState(prev => (prev.visible && prev.thumbW === thumbW && prev.thumbX === thumbX
      ? prev
      : { visible: true, thumbW, thumbX }));
  }, [targetRef]);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return undefined;
    // Measure once layout has settled. The timer is a backup: animation frames
    // (and ResizeObserver) pause while the page isn't being drawn.
    const firstFrame = requestAnimationFrame(measure);
    const firstTick = setTimeout(measure, 0);
    el.addEventListener('scroll', measure, { passive: true });
    const ro = 'ResizeObserver' in window ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    if (trackRef.current) ro?.observe(trackRef.current);
    // Children (cards) can change size without the row resizing.
    [...el.children].forEach(child => ro?.observe(child));
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(firstFrame);
      clearTimeout(firstTick);
      el.removeEventListener('scroll', measure);
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [targetRef, measure]);

  const scrollRatio = () => {
    const el = targetRef.current;
    const trackW = trackRef.current?.clientWidth || 1;
    const max = el.scrollWidth - el.clientWidth;
    return max / Math.max(1, trackW - state.thumbW);
  };

  const onThumbDown = (event) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { startX: event.clientX, startScroll: targetRef.current.scrollLeft, ratio: scrollRatio() };
  };

  const onThumbMove = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    targetRef.current.scrollLeft = drag.startScroll + (event.clientX - drag.startX) * drag.ratio;
  };

  const onThumbUp = (event) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onTrackDown = (event) => {
    const el = targetRef.current;
    const rect = trackRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left - state.thumbW / 2;
    el.scrollTo({ left: x * scrollRatio(), behavior: 'smooth' });
  };

  return (
    <div
      ref={trackRef}
      className={`dp-hscrollbar ${state.visible ? '' : 'dp-hscrollbar--hidden'} ${className}`}
      onPointerDown={onTrackDown}
      aria-hidden="true"
    >
      <div
        className="dp-hscrollbar__thumb"
        style={{ width: state.thumbW, transform: `translateX(${state.thumbX}px)` }}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
      />
    </div>
  );
}
