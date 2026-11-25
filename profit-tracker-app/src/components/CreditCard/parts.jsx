// Small pieces every view shares.
import React from 'react';
import { RotateCw, Star } from 'lucide-react';
import { fallbackTheme } from '../../utils/cardThemes';
import { dueTone, utilTone } from '../../utils/cardWallet';
import { NONE, dueText, money, utilText } from './format';
import { useArtwork } from './useArtwork';

export function DueChip({ card, short = false }) {
  if (card.dueInDays === null) return <span className="cc-chip cc-chip-none">No due date</span>;
  if (card.billPaid) return <span className="cc-chip cc-tone-green">Paid</span>;
  return (
    <span className={`cc-chip cc-tone-${dueTone(card.dueInDays)}`} title={card.dueLabel}>
      {short ? (card.dueInDays === 0 ? 'Today' : card.dueLabel) : dueText(card)}
    </span>
  );
}

// What matters most about the card right now: its rate at the searched store,
// that it's the next bill to pay, or when it's due.
export function CardChip({ card, short }) {
  if (card.atStore) {
    return <span className={`cc-chip ${card.atStore.best ? 'cc-chip-best' : 'cc-chip-none'}`}>{card.atStore.best && <Star size={11} aria-hidden="true" />}{card.atStore.label}<span className="sr-only">{card.atStore.best ? ', best card here' : ' here'}</span></span>;
  }
  if (card.payNext) return <span className="cc-chip cc-chip-next" title={dueText(card)}>Pay next · {card.dueLabel}</span>;
  return <DueChip card={card} short={short} />;
}

export function UtilBar({ card, label = false }) {
  const pct = card.utilization;
  if (pct === null) return null;
  return (
    <div className={`cc-util cc-util-${utilTone(pct)}`}>
      {label && (
        <div className="cc-util-top">
          <span>Utilization</span>
          <span><b>{utilText(pct)}</b>{pct > 100 ? ' · over limit' : ''}</span>
        </div>
      )}
      <div className="cc-util-track" role="img" aria-label={`Utilization ${utilText(pct)}`}><span style={{ width: `${Math.min(100, pct)}%` }} /></div>
    </div>
  );
}

export function UtilRing({ card, size = 58 }) {
  const pct = card.utilization;
  const r = 24;
  const length = 2 * Math.PI * r;
  return (
    <span className={`cc-ring cc-util-${utilTone(pct) || 'none'}`} style={{ width: size, height: size }} role="img" aria-label={pct === null ? 'No credit limit set' : `Utilization ${utilText(pct)}`}>
      <svg viewBox="0 0 58 58" aria-hidden="true">
        <circle cx="29" cy="29" r={r} className="cc-ring-track" />
        {pct > 0 && <circle cx="29" cy="29" r={r} className="cc-ring-fill" strokeDasharray={`${(Math.min(100, pct) / 100) * length} ${length}`} transform="rotate(-90 29 29)" />}
      </svg>
      <span aria-hidden="true">{pct === null ? NONE : pct > 999 ? '999+' : `${Math.round(pct)}%`}</span>
    </span>
  );
}

// A card's name and net to pay on a tab above its face, in the card's own
// colour, so nothing is ever printed over the artwork.
export function CardTab({ card, height }) {
  const { ref, art } = useArtwork(card);
  const tint = art ? `rgb(${art.meta.tint.join(' ')})` : fallbackTheme(card).via;
  return (
    <div ref={ref} className="cc-tab" aria-hidden="true" style={{ '--tint': tint, height }}>
      <span className="cc-tab-name">{card.name}</span>
      {card.last4 && <span className="cc-tab-last4">{card.last4}</span>}
      {card.payNext && !card.atStore && <span className="cc-tab-next">Pay next</span>}
      <span className={`cc-tab-money ${card.atStore?.best ? 'best' : ''}`}>
        {card.atStore ? <>{card.atStore.best && <Star size={12} aria-hidden="true" />}{card.atStore.label}</> : money(card.netToPay)}
      </span>
    </div>
  );
}

// Sits next to the card, never on it: a corner button would hide the network logo.
export function FlipButton({ flipped, onFlip, iconOnly = false }) {
  const label = flipped ? 'Show the front' : 'Show the back';
  return (
    <button type="button" className={`page-btn page-btn-secondary cc-flipbtn ${iconOnly ? 'page-btn-icon' : ''}`} aria-pressed={flipped} aria-label={label} title={label} onClick={onFlip}>
      <RotateCw size={14} aria-hidden="true" />{!iconOnly && (flipped ? 'Front' : 'Back')}
    </button>
  );
}

export function ShowMore({ limited }) {
  if (!limited.hidden && !limited.less) return null;
  return (
    <div className="cc-more">
      {limited.hidden > 0 && <button type="button" className="page-btn page-btn-secondary" onClick={limited.more}>Show more cards ({limited.hidden} hidden)</button>}
      {limited.less && <button type="button" className="page-btn page-btn-secondary" onClick={limited.less}>Show fewer</button>}
    </div>
  );
}
