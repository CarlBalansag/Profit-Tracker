// A 3D deck to swipe sideways.
import React, { useEffect, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { CARD_RATIO } from '../../utils/cardArtwork';
import CardFace from './CardFace';
import { OVERLAP, buzz, cardWidth, useCardPage, useSpring, useWidth } from './context';
import { useArtwork } from './useArtwork';
import { fallbackTheme } from '../../utils/cardThemes';
import { cardLabel } from './format';
import { FlipButton } from './parts';

const MotionDiv = motion.div;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function DeckNav({ index, count, go, flip, flipped }) {
  return (
    <div className="cc-deck-nav">
      <button type="button" className="page-btn page-btn-secondary page-btn-icon" aria-label="Previous card" onClick={() => go(index - 1)}><ChevronLeft size={16} /></button>
      <span className="cc-deck-count" aria-live="polite">{index + 1} of {count}</span>
      <button type="button" className="page-btn page-btn-secondary page-btn-icon" aria-label="Next card" onClick={() => go(index + 1)}><ChevronRight size={16} /></button>
      <FlipButton flipped={flipped} onFlip={flip} />
    </div>
  );
}

const arrows = (go, index, count) => (e) => {
  const to = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: count - 1 }[e.key];
  if (to === undefined) return;
  e.preventDefault();
  go(to);
};

// How far card i is from the front, going the short way round when it loops.
const wrap = (v, n) => { const m = ((v % n) + n) % n; return m > n / 2 ? m - n : m; };

function DeckCard({ card, i, count, loop, progress, W, spread, current, flipped, shine, onPick }) {
  const d = useTransform(progress, (p) => (loop ? wrap(i - p, count) : i - p));
  const x = useTransform(d, (v) => Math.sign(v) * (Math.min(1, Math.abs(v)) * W * spread + Math.max(0, Math.abs(v) - 1) * W * 0.2));
  const rotateY = useTransform(d, (v) => clamp(-v * 42, -42, 42));
  const scale = useTransform(d, (v) => 1 - Math.min(0.34, Math.abs(v) * 0.14));
  const opacity = useTransform(d, (v) => clamp(3.4 - Math.abs(v), 0, 1));
  const zIndex = useTransform(d, (v) => 100 - Math.round(Math.abs(v) * 10));
  return (
    <MotionDiv className={`cc-deck-card ${current ? 'current' : ''}`} style={{ x, rotateY, scale, opacity, zIndex, width: W, marginLeft: -W / 2 }} aria-hidden={!current}>
      <CardFace card={card} interactive={current} flipped={current && flipped} shine={shine && current} />
      {!current && <button type="button" tabIndex={-1} className="cc-hit absolute" aria-label={`Go to ${cardLabel(card)}`} onClick={onPick} />}
    </MotionDiv>
  );
}

export default function CardDeck({ cards, activeId, onActivate }) {
  const spring = useSpring();
  const { play } = useCardPage();
  const [ref, space] = useWidth();
  const [flipped, setFlipped] = useState(false);
  const index = Math.max(0, cards.findIndex((c) => c.id === activeId));
  const n = cards.length;
  const { art } = useArtwork(cards[index], true);
  const glow = art ? `rgb(${art.meta.tint.join(' ')})` : fallbackTheme(cards[index]).via;
  // With this many cards the far side is always faded out, so wrapping is unseen.
  const loop = n >= 7;
  const progress = useMotionValue(index);
  // Side cards need room: on a phone the front card leaves them a sliver.
  const W = Math.min(cardWidth(space), space ? space * (space < 560 ? 0.8 : 0.6) : 316);
  const spread = 0.28 + (1 - OVERLAP) / 1.3;

  useEffect(() => {
    const from = progress.get();
    const controls = animate(progress, loop ? from + wrap(index - from, n) : index, spring);
    return () => controls.stop();
    // Runs when the card changes; the spring is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  const go = (to) => {
    const next = loop ? ((to % n) + n) % n : clamp(to, 0, n - 1);
    setFlipped(false);
    if (next !== index) onActivate(cards[next].id);
    else { const from = progress.get(); animate(progress, loop ? from + wrap(index - from, n) : index, spring); }
  };
  const near = cards.map((card, i) => [card, i]).filter(([, i]) => Math.abs(loop ? wrap(i - index, n) : i - index) <= 4);

  return (
    <div className="cc-deck" ref={ref}>
      <MotionDiv
        className="cc-deck-stage"
        role="group"
        aria-roledescription="carousel"
        aria-label="Your cards. Use the left and right arrow keys."
        tabIndex={0}
        style={{ height: W / CARD_RATIO + 24 }}
        onKeyDown={arrows(go, index, cards.length)}
        onPan={(_, info) => { if (play) { const p = index - info.offset.x / (W * 0.7); progress.set(loop ? p : clamp(p, -0.3, n - 0.7)); } }}
        onPanEnd={(_, info) => {
          const moved = -info.offset.x / (W * 0.7) - info.velocity.x / 1800;
          const jump = Math.abs(info.offset.x) < 24 ? 0 : clamp(Math.round(moved) || -Math.sign(info.offset.x) * (Math.abs(info.offset.x) > 50 ? 1 : 0), -3, 3);
          if (jump) buzz();
          go(index + jump);
        }}
      >
        {play && <div className="cc-deck-glow" style={{ '--glow': glow }} aria-hidden="true" />}
        {space > 0 && near.map(([card, i]) => (
          <DeckCard key={card.id} card={card} i={i} count={n} loop={loop} progress={progress} W={W} spread={spread} current={i === index} flipped={flipped} shine={play} onPick={() => go(i)} />
        ))}
      </MotionDiv>
      <DeckNav index={index} count={cards.length} go={go} flipped={flipped} flip={() => setFlipped((v) => !v)} />
    </div>
  );
}
