import React, { useState } from 'react';

const INPUT = 'w-full rounded-lg border border-[color:var(--dp-border)] bg-[var(--dp-card-bg)] px-3 py-2 text-base sm:text-sm text-[var(--dp-text-primary)] placeholder-gray-600 focus:outline-none focus:border-[var(--accent)]';
const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const wordsOf = (text) => text.split(',').map((w) => w.trim()).filter(Boolean);

/**
 * How store orders with no matching purchase are sorted (api
 * services/email/sorting.js): the home state for Amazon's ship-to rule, and
 * words that always mean personal. Saved through the same automation setting.
 */
export default function OrderSorting({ automation, save }) {
  const [words, setWords] = useState((automation?.personalWords || []).join(', '));
  const saveWords = () => {
    const next = wordsOf(words);
    if (next.join('|') !== (automation?.personalWords || []).join('|')) save.mutate({ personalWords: next });
  };
  return (
    <div className="mt-3 space-y-4 border-t border-white/[0.06] pt-3">
      <div>
        <p className="text-sm font-medium text-gray-200">Orders that match no purchase</p>
        <p className="mt-0.5 max-w-prose text-xs text-gray-500">
          Likely resale ones go to your To-Do to add. Personal ones are set aside under Not business, where you can bring them back.
        </p>
      </div>
      <div>
        <label htmlFor="sort-home-state" className="block text-sm text-gray-200">Your home state</label>
        <p className="text-xs text-gray-500">Amazon orders shipped to another state count as resale; shipped home, as personal.</p>
        <select id="sort-home-state" value={automation?.homeState || ''} onChange={(e) => save.mutate({ homeState: e.target.value || null })} className={`${INPUT} mt-1.5 max-w-[12rem]`}>
          <option value="">Not set</option>
          {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="sort-personal-words" className="block text-sm text-gray-200">Always personal</label>
        <p className="text-xs text-gray-500">Words in an item or Amazon category, separated by commas.</p>
        <input
          id="sort-personal-words"
          type="text"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          onBlur={saveWords}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="Purina, Pet Supplies, Skin Care"
          className={`${INPUT} mt-1.5 max-w-md`}
        />
      </div>
    </div>
  );
}
