import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { CARD_RATIO } from '../../utils/cardArtwork';
import CardFace from './CardFace';
import { GAP, OVERLAP, buzz, cardWidth, useCardPage, useLimited, useSpring, useWidth } from './context';
import { cardLabel, money } from './format';
import { CardTab, FlipButton, ShowMore } from './parts';

const MotionDiv = motion.div;
const STEP = 8; // cards shown before "Show more"
const TAB = 38;
const EDGE = 13; // how far each collapsed card peeks out
const EDGES = 3;

// Dragging a card up or down the stack. A mouse drags straight away; a finger
// holds for a moment first, so scrolling the page still works.
function useStackDrag({ count, step, onMove }) {
  const [drag, setDrag] = useState(null); // { from, to, dy }
  const live = useRef(null);
  const suppressClick = useRef(false);
  // Read when the drag ends, so a re-render mid-drag doesn't cancel it.
  const onMoveRef = useRef(onMove);
  useEffect(() => { onMoveRef.current = onMove; });

  const end = useCallback((commit) => {
    const d = live.current;
    live.current = null;
    if (!d) return;
    clearTimeout(d.timer);
    window.removeEventListener('pointermove', d.move);
    window.removeEventListener('pointerup', d.up);
    window.removeEventListener('pointercancel', d.cancel);
    window.removeEventListener('touchmove', d.block);
    if (d.active) {
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 50);
      if (commit && d.to !== d.from) onMoveRef.current(d.from, d.to);
    }
    setDrag(null);
  }, []);

  useEffect(() => () => end(false), [end]);

  const onPointerDown = (index) => (e) => {
    if (e.button !== 0 || live.current) return;
    const startY = e.clientY;
    const startX = e.clientX;
    const touch = e.pointerType !== 'mouse';
    const d = { from: index, to: index, active: false };
    live.current = d;
    const activate = () => { d.active = true; if (touch) buzz(12); setDrag({ from: index, to: index, dy: 0 }); };
    if (touch) d.timer = setTimeout(activate, 350);
    d.move = (ev) => {
      const dy = ev.clientY - startY;
      if (!d.active) {
        if (touch) { if (Math.hypot(ev.clientX - startX, dy) > 10) end(false); return; }
        if (Math.abs(dy) < 6) return;
        activate();
      }
      const to = Math.max(0, Math.min(count - 1, index + Math.round(dy / step)));
      if (to !== d.to && touch) buzz();
      d.to = to;
      setDrag({ from: index, to: d.to, dy });
    };
    d.up = () => end(true);
    d.cancel = () => end(false);
    d.block = (ev) => { if (d.active) ev.preventDefault(); };
    window.addEventListener('pointermove', d.move);
    window.addEventListener('pointerup', d.up);
    window.addEventListener('pointercancel', d.cancel);
    window.addEventListener('touchmove', d.block, { passive: false });
  };
  return { drag, onPointerDown, clickAllowed: () => !suppressClick.current };
}

export default function CardWallet({ cards, activeId, marked, onActivate, openId, onOpen, onReorder }) {
  const spring = useSpring();
  const { play } = useCardPage();
  const [ref, space] = useWidth();
  const [flippedId, setFlippedId] = useState(null);
  const limited = useLimited(cards, STEP);
  const openCard = cards.find((c) => c.id === openId);
  // The open card stays in the stack even when it is past the visible limit.
  const visible = openCard && !limited.visible.includes(openCard) ? [openCard, ...limited.visible] : limited.visible;

  const W = cardWidth(space);
  const H = W / CARD_RATIO;
  const peek = TAB + H * (1 - OVERLAP);
  const { drag, onPointerDown, clickAllowed } = useStackDrag({ count: visible.length, step: peek, onMove: (from, to) => onReorder(visible[from].id, visible[to].id) });

  const buttons = useRef({});
  const root = useRef(null);
  const openIndex = openCard ? visible.indexOf(openCard) : -1;
  const isOpen = openIndex >= 0;
  const behind = isOpen ? visible.length - 1 : 0;
  const pileHeight = behind ? Math.min(behind, EDGES) * EDGE + 3 : 0;
  const height = isOpen ? H + GAP + pileHeight : (visible.length - 1) * peek + TAB + H;

  const close = () => { setFlippedId(null); onOpen(null); };
  const open = (card) => {
    setFlippedId(null);
    onActivate(card.id);
    onOpen(card.id);
    // The opened card goes to the top of the stack, which may be off screen.
    const top = root.current?.getBoundingClientRect().top;
    if (top < 60) root.current.scrollIntoView?.({ block: 'start', behavior: play ? 'smooth' : 'auto' });
  };
  const step = (delta) => {
    const all = cards;
    const i = all.findIndex((c) => c.id === openId);
    const next = all[(i + delta + all.length) % all.length];
    if (next) open(next);
  };

  // Where a card sits while another is being dragged past it.
  const slot = (i) => {
    if (!drag) return i;
    if (i === drag.from) return i;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return i - 1;
    if (drag.from > drag.to && i < drag.from && i >= drag.to) return i + 1;
    return i;
  };
  const place = (i) => {
    if (!isOpen) {
      if (drag && i === drag.from) return { y: i * peek + drag.dy, scale: 1.03, z: 60 };
      return { y: slot(i) * peek, scale: 1, z: i };
    }
    if (i === openIndex) return { y: 0, scale: 1, z: 50 };
    const k = i < openIndex ? i : i - 1; // position in the pile, front first
    const depth = Math.min(k, EDGES - 1);
    return { y: H + GAP + (EDGES - 1 - depth) * EDGE * (behind > 1 ? 1 : 0), scale: 1 - depth * 0.03, z: 40 - k, hidden: k >= EDGES };
  };

  const onKeyDown = (e, i) => {
    const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: visible.length - 1 }[e.key];
    if (e.key === 'Escape' && isOpen) { e.preventDefault(); close(); return; }
    if (isOpen && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); step(e.key === 'ArrowRight' ? 1 : -1); return; }
    if (to === undefined || isOpen) return;
    e.preventDefault();
    const target = visible[Math.max(0, Math.min(visible.length - 1, to))];
    if (e.altKey) onReorder(visible[i].id, target.id);
    else buttons.current[target.id]?.focus();
  };

  return (
    <div className={`cc-wallet ${isOpen ? 'is-open' : ''}`} ref={ref}>
      <MotionDiv
        ref={root}
        className="cc-wallet-stack"
        role="list"
        aria-label="Your cards"
        initial={false}
        animate={{ height }}
        transition={spring}
        style={{ width: W, clipPath: isOpen ? 'inset(-60px -60px 0 -60px)' : 'inset(-60px)' }}
      >
        {visible.map((card, i) => {
          const p = place(i);
          const opened = i === openIndex;
          const dragging = drag?.from === i;
          return (
            <MotionDiv
              key={card.id}
              role="listitem"
              className={`cc-wallet-card ${opened ? 'open' : ''} ${marked && card.id === activeId && !isOpen ? 'active' : ''} ${dragging ? 'dragging' : ''}`}
              initial={false}
              animate={{ y: p.y, scale: p.scale, opacity: p.hidden ? 0 : 1 }}
              transition={dragging ? { duration: 0 } : spring}
              style={{ zIndex: p.z, width: W }}
              drag={opened && cards.length > 1 ? 'x' : false}
              dragSnapToOrigin
              dragElastic={0.5}
              dragConstraints={{ left: 0, right: 0 }}
              onDragEnd={(_, info) => { if (Math.abs(info.offset.x) > 70 || Math.abs(info.velocity.x) > 500) step(info.offset.x < 0 ? 1 : -1); }}
            >
              <MotionDiv className="cc-wallet-tab" initial={false} animate={{ height: isOpen ? 0 : TAB, opacity: isOpen ? 0 : 1 }} transition={spring}>
                <CardTab card={card} height={TAB} />
              </MotionDiv>
              <CardFace card={card} interactive={opened || (!isOpen && i === visible.length - 1)} flipped={flippedId === card.id} shine={play && opened} />
              <button
                ref={(el) => { buttons.current[card.id] = el; }}
                type="button"
                className="cc-hit absolute"
                style={!isOpen && i < visible.length - 1 && !dragging ? { height: peek } : undefined}
                aria-expanded={opened}
                aria-label={opened ? `${cardLabel(card)}. Put back in the stack` : `${cardLabel(card)}, net to pay ${money(card.netToPay)}. Open`}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                tabIndex={p.hidden ? -1 : 0}
                onPointerDown={isOpen ? undefined : onPointerDown(i)}
                onClick={() => { if (clickAllowed()) { if (isOpen) close(); else open(card); } }}
                onKeyDown={(e) => onKeyDown(e, i)}
              />
            </MotionDiv>
          );
        })}
      </MotionDiv>
      {isOpen && (
        <div className="cc-wallet-foot" style={{ width: W }}>
          <button type="button" className="cc-wallet-back" onClick={close}><ChevronDown size={14} aria-hidden="true" /> {behind > 0 ? `${cards.length - 1} more card${cards.length === 2 ? '' : 's'}` : 'Close'}</button>
          <FlipButton flipped={flippedId === openId} onFlip={() => setFlippedId((id) => (id === openId ? null : openId))} />
        </div>
      )}
      {!isOpen && <ShowMore limited={limited} />}
    </div>
  );
}
