import React, { useEffect, useRef } from 'react';
import { placeArtwork } from '../../utils/cardArtwork';
import { fallbackTheme, productName } from '../../utils/cardThemes';
import { TILT, useCardPage } from './context';
import { useArtwork } from './useArtwork';

const MASK = '••••';

// ─── Payment network marks, drawn for fallback cards only ─────────────────────
export function NetworkMark({ network }) {
  if (network === 'visa') return <span className="cf-visa">VISA</span>;
  if (network === 'mastercard') return <span className="cf-mc" aria-label="Mastercard"><i /><i /></span>;
  if (network === 'amex') return <span className="cf-amex">AMEX</span>;
  if (network === 'discover') return <span className="cf-discover">DISC<i />VER</span>;
  return network && network !== 'other' ? <span className="cf-visa">{network.toUpperCase()}</span> : null;
}

function Chip() {
  return (
    <svg className="cf-chip" viewBox="0 0 44 34" aria-hidden="true">
      <defs><linearGradient id="cf-chip-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f0e6cf" /><stop offset=".5" stopColor="#c9b68c" /><stop offset="1" stopColor="#efe4c8" /></linearGradient></defs>
      <rect x=".5" y=".5" width="43" height="33" rx="6" fill="url(#cf-chip-g)" stroke="rgba(60,45,10,.35)" />
      <path d="M0 11h14v12H0M44 11H30v12h14M14 0v34M30 0v34M14 17h16" fill="none" stroke="rgba(60,45,10,.4)" />
    </svg>
  );
}

// ─── Custom faces ─────────────────────────────────────────────────────────────
function DrawnFace({ card }) {
  const theme = fallbackTheme(card);
  const style = { '--from': theme.from, '--via': theme.via, '--to': theme.to, '--ink': theme.ink };
  return (
    <div className="cf-drawn" style={style}>
      <div className="cf-row">
        <span className="cf-issuer">{theme.name || 'Credit card'}</span>
        <span className="cf-contactless" aria-hidden="true">)))</span>
      </div>
      <Chip />
      <div className="cf-product">{productName(card)}</div>
      <div className="cf-row cf-foot">
        <span className="cf-number">{card.last4 ? `${MASK} ${card.last4}` : ''}</span>
        <NetworkMark network={card.network} />
      </div>
    </div>
  );
}

function ArtFace({ art }) {
  const { meta } = art;
  const place = placeArtwork(meta, art.imageRatio);
  const tint = `rgb(${meta.tint.join(' ')})`;
  return (
    <div className={`cf-art cf-art-${meta.kind} ${place.fills ? 'fills' : ''}`} style={{ '--tint': tint }}>
      <img src={art.src} alt="" draggable="false" decoding="async" style={{ width: place.width, left: place.left, top: place.top, clipPath: place.fills ? undefined : place.clip }} />
    </div>
  );
}

// ─── The back: only what the app stores about the card ────────────────────────
function CardBack({ card, theme, art }) {
  const tint = art ? `rgb(${art.meta.tint.join(' ')})` : theme.via;
  const lines = [
    ['Rewards', card.reward.short],
    card.reward.best && ['Best at', `${card.reward.best.store}`],
    ['Statement closes', card.closeDay ? `Day ${card.closeDay}` : 'Not set'],
    ['Payment due', card.dueDay ? `Day ${card.dueDay}` : 'Not set'],
    ['Annual fee', card.annualFee === null ? 'Unknown' : card.annualFee === 0 ? 'None' : `$${card.annualFee}`],
  ].filter(Boolean);
  return (
    <div className="cf-backface" style={{ '--tint': tint }}>
      <div className="cf-stripe" />
      <div className="cf-backbody">
        <div className="cf-row"><strong>{productName(card)}</strong><span className="cf-number">{card.last4 ? `${MASK} ${card.last4}` : 'No last four'}</span></div>
        <dl>{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      </div>
    </div>
  );
}

const FLAT = { '--rx': '0deg', '--ry': '0deg', '--mx': '50%', '--my': '0%', '--on': 0 };

/**
 * One credit card at the real card shape, filling its container's width.
 * `interactive` adds tilt and glare that follow the mouse; touch stays flat.
 */
export default function CardFace({ card, interactive = false, flipped = false, flat = false, eager = false, shine = false, className = '' }) {
  const { play } = useCardPage();
  const { ref, status, art } = useArtwork(card, eager);
  const tiltRef = useRef(null);
  const theme = fallbackTheme(card);
  const tier = status === 'art' ? art.tier : status === 'fallback' ? theme.tier : 'loading';

  // Listens on the parent: a layout may lay a button over the whole card.
  const on = interactive && play;
  useEffect(() => {
    const el = tiltRef.current;
    const host = ref.current?.parentElement;
    if (!on || !el || !host) return undefined;
    const set = (vars) => { for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v); };
    const move = (e) => {
      if (e.pointerType !== 'mouse') return;
      const r = ref.current.getBoundingClientRect();
      const px = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const py = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      set({ '--ry': `${(px - 0.5) * 2 * TILT}deg`, '--rx': `${-(py - 0.5) * 2 * TILT}deg`, '--mx': `${px * 100}%`, '--my': `${py * 100}%`, '--on': 1 });
    };
    const leave = () => set(FLAT);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => { host.removeEventListener('pointermove', move); host.removeEventListener('pointerleave', leave); leave(); };
  }, [on, ref]);

  let face;
  if (status === 'art') face = <ArtFace art={art} />;
  else if (status === 'fallback') face = <DrawnFace card={card} />;
  else face = <div className="cf-loading" />;

  return (
    <div
      ref={ref}
      className={`cf ${flat ? 'cf-flat' : 'cf-raised'} ${className}`}
      data-tier={tier}
      data-card={card.id}
    >
      <div className="cf-tilt" ref={tiltRef} style={FLAT}>
        <div className="cf-inner" data-flipped={flipped || undefined}>
          <div className="cf-side cf-front">
            {face}
            {!flat && <div className="cf-glare" aria-hidden="true" />}
            {shine && <div className="cf-shine" aria-hidden="true" />}
            <div className="cf-edge" aria-hidden="true" />
          </div>
          {!flat && (
            <div className="cf-side cf-back" aria-hidden={!flipped}>
              {flipped && <CardBack card={card} theme={theme} art={art} />}
              <div className="cf-edge" aria-hidden="true" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small picture of the card for rows and rails. */
export function CardThumb({ card, width = 64 }) {
  return <span className="cc-thumb" style={{ width }}><CardFace card={card} flat /></span>;
}
