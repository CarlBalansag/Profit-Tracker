import React, { useId } from 'react';
import { Search, X } from 'lucide-react';

// "Which card should I use here?" Typing a store puts the best-earning card first.
export default function BestCard({ store, onStore, suggestions }) {
  const listId = useId();
  return (
    <div className="cc-best">
      <Search size={15} aria-hidden="true" />
      <input type="text" list={listId} value={store} maxLength={80} autoComplete="off" placeholder="Best card at…" aria-label="Best card for a store" onChange={(e) => onStore(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onStore(''); }} />
      <datalist id={listId}>{suggestions.map((name) => <option key={name} value={name} />)}</datalist>
      {store && <button type="button" aria-label="Clear the store" className="absolute" onClick={() => onStore('')}><X size={15} /></button>}
    </div>
  );
}

export function BestCardAnswer({ store, cards }) {
  const place = store.trim();
  const best = cards.filter((c) => c.atStore?.best);
  const names = best.map((c) => c.name);
  let answer = cards.length ? `Every card earns the same at ${place}: ${cards[0].atStore?.label}` : '';
  if (best.length === 1) answer = `${names[0]} earns the most at ${place}: ${best[0].atStore.label}`;
  if (best.length > 1) answer = `${names.slice(0, -1).join(', ')} and ${names.at(-1)} tie at ${place}: ${best[0].atStore.label}`;
  return <p className="cc-best-answer" role="status">{answer}</p>;
}
