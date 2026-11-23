import React from 'react';
import { FileText, X } from 'lucide-react';

// The store order a purchase was matched to (Settings > Data imports): a
// picker over its candidate order lines, how it was matched, and the tax,
// shipping and card that come with it.
const MATCH_LABELS = {
  tracking: { text: 'Same tracking', tone: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10' },
  name: { text: 'Name + date', tone: 'text-amber-300 border-amber-500/30 bg-amber-500/10' },
  none: { text: 'No match', tone: 'text-gray-400 border-gray-700 bg-white/5' },
};

const money = (n) => `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const lineLabel = (l) => `${l.orderId}${l.accountName ? ` · ${l.accountName}` : ''} · ${l.orderDate || 'no date'} · ${l.qty} × ${money(l.perUnit.cost)} · ${l.name.length > 48 ? `${l.name.slice(0, 47)}…` : l.name}`;
const selectClass = 'w-full bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 h-8 text-xs text-gray-200 focus:outline-none focus:border-[var(--accent)]';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// The order files added so far: each with what was read from it, which store
// account it came from (when the user has accounts saved for the store), and
// a remove button. info: the server's summary.files ({ id, lines, problems,
// duplicates }) from the last read; a file added since shows "Not read yet".
export function OrderFileList({ files, info, accounts, onAccount, onRemove, disabled }) {
  if (!files.length) return null;
  return (
    <ul className="space-y-2" aria-label="Order files">
      {files.map((f) => {
        const read = info?.find((x) => x.id === f.id);
        const notes = read ? [
          plural(read.lines - read.problems - read.duplicates, 'order line'),
          read.problems ? `${read.problems} skipped` : null,
          read.duplicates ? `${read.duplicates} already in another file` : null,
        ].filter(Boolean).join(' · ') : 'Not read yet';
        return (
          <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-800 bg-[#16161E] p-2">
            <FileText size={14} className="shrink-0 text-gray-500" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-gray-200" title={f.name}>{f.name}</div>
              <div className="text-xs text-gray-500">{notes}</div>
            </div>
            {accounts.length > 0 && (
              <select
                aria-label={`Amazon account for ${f.name}`}
                className="order-last w-full sm:order-none sm:w-56 bg-[#0A0A0F] border border-gray-800 rounded-lg px-3 h-9 text-sm text-gray-200 focus:outline-none focus:border-[var(--accent)]"
                value={f.accountId}
                onChange={(e) => onAccount(f.id, e.target.value)}
                disabled={disabled}
              >
                <option value="">Account not set</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            )}
            <button
              type="button"
              aria-label={`Remove ${f.name}`}
              onClick={() => onRemove(f.id)}
              disabled={disabled}
              className="flex h-[44px] w-[44px] sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-50"
            >
              <X size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

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
