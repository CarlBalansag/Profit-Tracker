// Text shared by every layout: money, labels, due dates.
import { formatDollars } from '../../utils/money';

export const money = (v) => (v === null || v === undefined ? null : formatDollars(v));

export const NONE = '—';

export const cardLabel = (card) => [card.name, card.last4 && `ending in ${card.last4}`].filter(Boolean).join(', ');

export const subtitle = (card) => [card.last4 && `•••• ${card.last4}`, card.issuer].filter(Boolean).join(' · ') || 'Issuer unknown';

// "$956.48 left", or how far past the limit the card is.
export const availableText = (card, word = 'left') => {
  if (card.available === null) return 'No limit set';
  return card.available < 0 ? `${money(-card.available)} over limit` : `${money(card.available)} ${word}`;
};

export const utilText = (pct) => (pct === null ? null : pct > 999 ? 'Over 999%' : `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`);

export const dueText = (card) => {
  if (card.dueInDays === null) return null;
  if (card.billPaid) return `Paid · due ${card.dueLabel}`;
  if (card.dueInDays === 0) return 'Due today';
  return card.dueInDays === 1 ? 'Due tomorrow' : `Due in ${card.dueInDays} days`;
};
