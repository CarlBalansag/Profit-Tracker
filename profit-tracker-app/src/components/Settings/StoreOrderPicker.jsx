import React from 'react';

// The store order a purchase was matched to (Settings > Data imports): a
// picker over its candidate order lines, how it was matched, and the tax,
// shipping and card that come with it.
const MATCH_LABELS = {
  tracking: { text: 'Same tracking', tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  name: { text: 'Name + date', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  none: { text: 'No match', tone: 'text-gray-400 border-gray-700 bg-white/5' },
};

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineLabel = (l) => `${l.orderId} · ${l.orderDate || 'no date'} · ${l.qty} × ${money(l.perUnit.cost)} · ${l.name.length > 48 ? `${l.name.slice(0, 47)}…` : l.name}`;
const selectClass = 'w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 h-8 text-xs text-gray-200 focus:outline-none focus:border-[var(--accent)]';

export function MatchPill({ match }) {
  const m = MATCH_LABELS[match] || MATCH_LABELS.none;
  return <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs whitespace-nowrap ${m.tone}`}>{m.text}</span>;
}

// match: { lineIndex, match, candidates, review } from the server; picked: the
// line chosen now (null = don't use one); qty: units on this purchase.
export function OrderPicker({ name, qty, match, picked, lines, cardName, onPick, id, disabled }) {
  if (!match.candidates.length) return <MatchPill match="none" />;
  const line = picked !== null && picked !== undefined ? lines.get(picked) : null;
  // A line the user picked over the server's own pick needs no pill.
  const how = line ? (picked === match.lineIndex ? match.match : 'picked') : 'none';
  return (
    <div className="space-y-1">
      <select id={id} aria-label={`Order for ${name}`} className={selectClass} value={picked ?? ''} onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))} disabled={disabled}>
        <option value="">Don&apos;t use an order</option>
        {match.candidates.map((i) => lines.get(i)).filter(Boolean).map((l) => <option key={l.index} value={l.index}>{lineLabel(l)}</option>)}
      </select>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
        {how !== 'picked' && <MatchPill match={how} />}
        {line && (
          <span>
            Tax {money(line.perUnit.tax * qty)}{line.perUnit.shipping > 0 && ` · shipping ${money(line.perUnit.shipping * qty)}`}
            {' · '}{line.paymentMethodId ? cardName.get(line.paymentMethodId) || 'card' : line.payment || 'card not listed'}
          </span>
        )}
      </div>
      {match.review && picked === match.lineIndex && <p className="text-xs text-amber-300">{match.review}</p>}
    </div>
  );
}
