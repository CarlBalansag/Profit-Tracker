import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { catalogEarnSummary } from '../../utils/cardRewards';

// One-time notice for cards saved from the old built-in list: the card data
// was reworked (live OpenCard DB data, points vs cashback), so offer to update
// each card from it -- or keep it exactly as it is. Either answer is saved and
// the card never asks again.
export const CardReworkNotice = ({ items, onSwitch, onKeep }) => {
  const [busyId, setBusyId] = useState(null);
  if (!items?.length) return null;

  const run = async (id, fn) => {
    setBusyId(id);
    try { await fn(); } finally { setBusyId(null); }
  };

  return (
    <section
      aria-labelledby="card-rework-title"
      className="rounded-xl border border-blue-800/50 bg-blue-900/15 p-4 sm:p-5 space-y-3"
    >
      <div className="flex items-start gap-3">
        <Sparkles size={18} className="text-blue-300 mt-0.5 shrink-0" />
        <div>
          <h2 id="card-rework-title" className="text-sm font-bold text-white">Credit cards were reworked</h2>
          <p className="text-xs text-gray-300 mt-1">
            Card rates now come from up-to-date card data, and cards that earn points (like Amex Membership Rewards)
            are tracked as points instead of a cashback %. Want to update {items.length === 1 ? 'this card' : 'these cards'}?
            Points start at 1¢ each. You can change that per card.
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {items.map(({ method, catalogCard }) => {
          const busy = busyId === method.id;
          const isPoints = catalogCard.reward_type === 'points';
          return (
            <li key={method.id} className="flex flex-col md:flex-row md:items-center gap-3 rounded-lg bg-[#0A0A0F] border border-gray-800 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-gray-100 truncate">{method.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {isPoints ? `Earns ${catalogCard.rewards_label || 'points'}` : 'Earns cash back'}
                  {' · '}
                  <span className="text-gray-500">{catalogEarnSummary(catalogCard)}</span>
                </p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => run(method.id, () => onSwitch(method, catalogCard))}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
                >
                  {busy ? 'Updating…' : isPoints ? 'Switch to points' : 'Update rates'}
                </button>
                <button
                  type="button"
                  disabled={busyId !== null}
                  onClick={() => run(method.id, () => onKeep(method))}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-300 border border-gray-700 hover:border-gray-500 disabled:opacity-50"
                >
                  Keep as is
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
};
