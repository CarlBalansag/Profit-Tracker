import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { loadCardCatalog, catalogEarnSummary } from '../../utils/cardRewards';

const MAX_RESULTS = 8;

// "Card from the list" section of the Edit card form: shows which catalog card
// a saved card follows and lets the user re-link it (e.g. it was saved as the
// Sapphire Reserve but they actually have the Preferred) or link a custom card.
// The pick is only applied when the form is saved.
export const CatalogLinkPicker = ({ linkedId, pending, onPick, onClear }) => {
  const [cards, setCards] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    loadCardCatalog()
      .then(data => { if (!cancelled) setCards(data.cards || []); })
      .catch(err => { if (!cancelled) setLoadError(err.message || 'Could not load the card list'); });
    return () => { cancelled = true; };
  }, []);

  const linked = cards?.find(c => c.id === linkedId) || null;
  const shown = pending || linked;
  const q = query.trim().toLowerCase();
  const results = q && cards
    ? cards.filter(c => c.name.toLowerCase().includes(q) || c.issuer.toLowerCase().includes(q)).slice(0, MAX_RESULTS)
    : [];

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Card from the list</p>
        <p className="text-[11px] text-gray-600 mt-0.5">
          Linked cards take their rates from the card list and stay current automatically.
        </p>
      </div>

      {loadError ? (
        <p className="text-xs text-red-400">{loadError}</p>
      ) : (
        <div className="rounded-lg border border-gray-800 bg-[#0A0A0F] p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-gray-200 break-words">
                {shown ? shown.name : linkedId && !cards ? 'Loading…' : 'Not linked'}
              </p>
              {shown && <p className="text-[11px] text-gray-500 mt-0.5">{catalogEarnSummary(shown)}</p>}
              {pending && (
                <p className="text-[11px] text-amber-300 mt-1">
                  Saving switches this card's rates to {pending.name}. Your point value, billing details and your own store rates stay.
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              {pending && (
                <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-white">Undo</button>
              )}
              {!searching && (
                <button
                  type="button"
                  onClick={() => { setSearching(true); setQuery(''); }}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium border border-gray-700 text-gray-200 hover:border-gray-500"
                >
                  {shown ? 'Change' : 'Link a card'}
                </button>
              )}
            </div>
          </div>

          {searching && (
            <div className="space-y-1.5">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  autoFocus
                  aria-label="Search the card list"
                  placeholder="Search the card list…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full bg-[var(--dp-card-bg)] border border-[color:var(--dp-border)] rounded-lg pl-8 pr-3 py-2 text-sm text-[var(--dp-text-primary)] focus:outline-none focus:border-[var(--dp-accent)]"
                />
              </div>
              {q && results.length === 0 && <p className="text-xs text-gray-500 px-1">No cards match.</p>}
              {results.map(card => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => { onPick(card, linked); setSearching(false); setQuery(""); }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-white/5"
                >
                  <span className="block text-sm text-gray-200">{card.name}</span>
                  <span className="block text-[11px] text-gray-500 truncate">{card.issuer} · {catalogEarnSummary(card, 2)}</span>
                </button>
              ))}
              <button type="button" onClick={() => setSearching(false)} className="text-xs text-gray-400 hover:text-white px-1">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
