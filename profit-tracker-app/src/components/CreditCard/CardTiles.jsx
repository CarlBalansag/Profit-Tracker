import React, { useState } from 'react';
import { fallbackTheme } from '../../utils/cardThemes';
import CardFace from './CardFace';
import { CARD_WIDTH, GAP, useLimited } from './context';
import { NONE, balanceText, cardLabel, money, subtitle } from './format';
import { CardChip, FlipButton, ShowMore, UtilRing } from './parts';
import { useArtwork } from './useArtwork';

// Each tile is lit by its card: the artwork's own average colour.
function Tile({ card, active, onSelect }) {
  const [flipped, setFlipped] = useState(false);
  const { ref, art } = useArtwork(card);
  const tint = art ? `rgb(${art.meta.tint.join(' ')})` : fallbackTheme(card).via;
  return (
    <li ref={ref} className={`cc-tile ${active ? 'active' : ''}`} style={{ '--tint': tint }}>
      <div className="cc-tile-stage"><div className="cc-facewrap"><CardFace card={card} interactive flipped={flipped} /></div></div>
      <div className="cc-tile-body">
        <div className="cc-tile-head">
          <span className="cc-list-main"><b>{card.name}</b><small>{subtitle(card)}</small></span>
          <CardChip card={card} short />
        </div>
        <div className="cc-tile-main">
          <span>
            <small>Net to pay</small>
            <strong>{money(card.netToPay)}</strong>
            <small>{card.txnCount} item{card.txnCount === 1 ? '' : 's'} this month</small>
          </span>
          <UtilRing card={card} />
        </div>
        <dl className="cc-tile-facts">
          <div><dt>Balance today</dt><dd>{balanceText(card.balance) ?? NONE}</dd></div>
          <div><dt>Available</dt><dd className={card.available < 0 ? 'cc-red' : ''}>{money(card.available) ?? NONE}</dd></div>
          <div><dt>Rewards</dt><dd>{card.reward.short}</dd></div>
        </dl>
        <div className="cc-tile-actions">
          <button type="button" className="page-btn page-btn-secondary cc-wide-btn" onClick={onSelect}>View details<span className="sr-only">: {cardLabel(card)}</span></button>
          <FlipButton iconOnly flipped={flipped} onFlip={() => setFlipped((v) => !v)} />
        </div>
      </div>
    </li>
  );
}

export default function CardTiles({ cards, activeId, onSelect }) {
  const limited = useLimited(cards, 9);
  return (
    <>
      <ul className="cc-grid" style={{ '--min': `${CARD_WIDTH + 12}px`, '--gap': `${GAP + 4}px` }}>
        {limited.visible.map((card) => <Tile key={card.id} card={card} active={card.id === activeId} onSelect={() => onSelect(card.id)} />)}
      </ul>
      <ShowMore limited={limited} />
    </>
  );
}
