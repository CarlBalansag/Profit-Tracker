import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';
import CardDetails from './CardDetails';
import CardFace from './CardFace';
import { useCardPage } from './context';
import { subtitle } from './format';
import { CardChip } from './parts';

// A card's details over the page (the tiles view). A sheet from the bottom on
// phones, a dialog on wider screens.
export default function CardSheet({ card, onClose, monthLabel, onPurchases }) {
  const { play } = useCardPage();
  const ref = useModalKeyboard(Boolean(card), onClose);
  const [flipped, setFlipped] = useState(false);
  if (!card) return null;
  // Outside the page, whose opening animation would otherwise hold it.
  const host = document.querySelector('.carbon-workspace, .glass-workspace') || document.body;
  return createPortal(
    <div className="cc-sheet-back" data-play={play || undefined} onClick={onClose}>
      <div className="cc-sheet" ref={ref} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <header className="cc-sheet-head">
          <div><h2>{card.name}</h2><p>{subtitle(card)}</p></div>
          <button type="button" className="page-btn page-btn-secondary page-btn-icon" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <button type="button" className="cc-sheet-face" aria-label={flipped ? 'Show the front of the card' : 'Show the back of the card'} onClick={() => setFlipped((v) => !v)}><CardFace card={card} flipped={flipped} eager /></button>
        <div className="cc-sheet-due"><CardChip card={card} /></div>
        <CardDetails card={card} bare monthLabel={monthLabel} onPurchases={onPurchases} />
      </div>
    </div>,
    host,
  );
}
