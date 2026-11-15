import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ExpensesFragment, PayoutsFragment, PurchaseFragment, SaleFragment } from './Fragments';
import { EASE_OUT } from './landingShared';

const MotionDiv = motion.div;

const PILLARS = [
  { id: 'buy', name: 'Buying', title: 'Log what you buy', body: 'Item, price, store and the card you paid with. The cashback is worked out and the item goes into inventory.', Frag: PurchaseFragment },
  { id: 'sell', name: 'Selling', title: 'Know what each sale made', body: 'Pick what sold and where. The marketplace fee, shipping and your cost come off, and you see the real profit.', Frag: SaleFragment },
  { id: 'money', name: 'Money', title: 'Follow the cash', body: "Money out on stock, money back from sales, and which payouts haven't landed in your account yet.", Frag: PayoutsFragment },
  { id: 'taxes', name: 'Taxes', title: 'Be ready at tax time', body: 'Expenses, receipts and repeating costs, grouped into the categories your Schedule C asks for.', Frag: ExpensesFragment },
];

const ROTATE_MS = 6000;

// Four things the app does, around one piece of the app that switches to
// match. It moves on by itself until someone picks one.
export default function FeatureOverview({ items, today }) {
  const [active, setActive] = useState(0);
  const [held, setHeld] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (held || reduce) return undefined;
    const t = setTimeout(() => setActive((a) => (a + 1) % PILLARS.length), ROTATE_MS);
    return () => clearTimeout(t);
  }, [active, held, reduce]);

  const pick = (i) => { setActive(i); setHeld(true); };
  const Current = PILLARS[active].Frag;

  const pillar = (p, i) => {
    const on = i === active;
    return (
      <li key={p.id}>
        <button
          type="button"
          aria-pressed={on}
          aria-controls="lp-pillar-panel"
          onClick={() => pick(i)}
          className={`lp-pillar lp-focus ${on ? 'is-on' : ''}`}
        >
          <span className="lp-pillar-name">{p.name}</span>
          <span className="lp-display block text-[22px] leading-tight mt-1">{p.title}</span>
          <span className="block text-[15px] leading-relaxed text-[var(--lp-text-2)] mt-2">{p.body}</span>
          {on && !held && !reduce && (
            <span className="lp-pillar-timer" aria-hidden="true">
              <MotionDiv
                key={active}
                className="h-full bg-[var(--lp-accent-text)] origin-left"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: ROTATE_MS / 1000, ease: 'linear' }}
              />
            </span>
          )}
        </button>
      </li>
    );
  };

  return (
    <div onMouseEnter={() => setHeld(true)} onFocus={() => setHeld(true)}>
      {/* Phones and tablets: a row of names, then the chosen one explained. */}
      <div className="lg:hidden mb-5">
        <div className="lp-scroll flex gap-2 overflow-x-auto pb-1" role="group" aria-label="What Profit Tracker does">
          {PILLARS.map((p, i) => (
            <button key={p.id} type="button" aria-pressed={i === active} onClick={() => pick(i)}
              className={`lp-focus shrink-0 px-4 py-2 rounded-full text-[14px] font-bold border transition-colors ${i === active ? 'bg-[var(--lp-accent-tint)] border-[rgba(var(--accent-rgb),0.6)] text-[var(--lp-text)]' : 'border-[var(--lp-border-strong)] text-[var(--lp-text-3)]'}`}>
              {p.name}
            </button>
          ))}
        </div>
        <h3 className="lp-display text-[24px] leading-tight mt-5">{PILLARS[active].title}</h3>
        <p className="text-[15.5px] leading-relaxed text-[var(--lp-text-2)] mt-2">{PILLARS[active].body}</p>
      </div>
      <div className="lp-overview">
        <ul className="lp-overview-col" aria-label="What Profit Tracker does">{PILLARS.slice(0, 2).map((p, i) => pillar(p, i))}</ul>
        <div className="lp-overview-stage" id="lp-pillar-panel" role="region" aria-live={held ? 'polite' : 'off'} aria-label={`${PILLARS[active].name}: ${PILLARS[active].title}`}>
          <AnimatePresence mode="wait" initial={false}>
            <MotionDiv
              key={PILLARS[active].id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, y: 18, rotate: -1.5, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -12, rotate: 1, scale: 0.98 }}
              transition={{ duration: 0.45, ease: EASE_OUT }}
              className="w-full"
            >
              <Current items={items} today={today} />
            </MotionDiv>
          </AnimatePresence>
        </div>
        <ul className="lp-overview-col" aria-label="More of what it does">{PILLARS.slice(2).map((p, i) => pillar(p, i + 2))}</ul>
      </div>
    </div>
  );
}
