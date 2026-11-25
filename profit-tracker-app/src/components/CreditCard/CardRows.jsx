import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown } from 'lucide-react';
import { formatEarnRate } from '../../utils/cardRewards';
import CardDetails from './CardDetails';
import CardFace, { CardThumb } from './CardFace';
import { useCardPage, useLimited, useSpring, useWidth } from './context';
import { dueText, money, subtitle, utilText } from './format';
import { CardChip, FlipButton, ShowMore, UtilBar } from './parts';

const MotionDiv = motion.div;

// Dense rows; opening one shows the card and its details in place.
export default function CardRows({ cards, openId, onOpen, onActivate, monthLabel }) {
  const { play } = useCardPage();
  const spring = useSpring();
  const [ref, width] = useWidth();
  const [flipped, setFlipped] = useState(false);
  const limited = useLimited(cards, 15);
  const narrow = width < 620;
  return (
    <div ref={ref}>
      <div className="cc-rows cc-panel">
        {limited.visible.map((card) => {
          const open = card.id === openId;
          const tagged = card.atStore || card.payNext;
          return (
            <div key={card.id} className={`cc-row-item ${open ? 'open' : ''}`}>
              <button type="button" className="cc-row-head" aria-expanded={open} aria-controls={`row-${card.id}`} onClick={() => { setFlipped(false); onActivate(card.id); onOpen(open ? null : card.id); }}>
                <CardThumb card={card} width={narrow ? 48 : 56} />
                <span className="cc-list-main">
                  <b>{card.name}</b>
                  <small>{narrow ? [card.last4 && `•••• ${card.last4}`, dueText(card)].filter(Boolean).join(' · ') || card.issuer : subtitle(card)}</small>
                  {narrow && tagged && <span className="cc-row-tag"><CardChip card={card} /></span>}
                </span>
                {!narrow && <span className="cc-row-util"><UtilBar card={card} /><small>{utilText(card.utilization) ?? 'No limit set'}</small></span>}
                {!narrow && <span className="cc-row-reward">{card.reward.best ? `up to ${formatEarnRate(card.reward.best.value, card.reward.type)}` : card.reward.short}</span>}
                {!narrow && <span className="cc-row-chip"><CardChip card={card} short /></span>}
                <span className="cc-list-money"><b>{money(card.netToPay)}</b></span>
                <ChevronDown size={16} className="cc-chev" aria-hidden="true" />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <MotionDiv id={`row-${card.id}`} className="cc-row-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring}>
                    <div className="cc-row-inner">
                      <div className="cc-row-face">
                        <CardFace card={card} interactive flipped={flipped} shine={play} />
                        <FlipButton flipped={flipped} onFlip={() => setFlipped((v) => !v)} />
                      </div>
                      <CardDetails card={card} bare monthLabel={monthLabel} />
                    </div>
                  </MotionDiv>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      <ShowMore limited={limited} />
    </div>
  );
}
