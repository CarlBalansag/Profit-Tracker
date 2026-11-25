// One view model per credit card for the Credit Card page, from what the app
// already loads: the month's dashboard (the page's own numbers), Cash Flow
// (today's balances), Payment Methods (rewards and limits), the catalog faces
// and the bills marked paid. A value the app doesn't have stays null and is
// shown as missing, never guessed.
import { daysUntilDue, dueDateLabel, nextDueDate } from './cardDueDates';
import { cleanCardName, formatEarnRate, pointsFromDollars, pointsUnit } from './cardRewards';
import { localToday } from './returnWindow';

const positive = (v) => (Number(v) > 0 ? Number(v) : null);
const round2 = (v) => Math.round(v * 100) / 100;

export const dueTone = (days) => (days === null ? null : days <= 5 ? 'red' : days <= 10 ? 'amber' : 'green');
export const utilTone = (pct) => (pct === null ? null : pct < 40 ? 'accent' : pct < 70 ? 'amber' : 'red');

export function rewardSummary(method) {
  const points = method?.reward_type === 'points';
  const type = points ? 'points' : 'cashback';
  const base = Number(points ? method?.points_base_rate : method?.default_cashback_rate) || 0;
  const rates = (method?.category_rates || [])
    .filter((r) => r?.store)
    .map((r) => ({ store: r.store, value: Number(points ? r.points ?? 0 : r.rate) || 0 }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value);
  const best = rates.find((r) => r.value > base) || null;
  return {
    type, base, best,
    label: method?.rewards_label || (points ? 'Points' : 'Cash back'),
    short: best ? `${formatEarnRate(base, type)} – ${formatEarnRate(best.value, type)}` : formatEarnRate(base, type),
    sortValue: best ? best.value : base,
    unit: points ? pointsUnit(method?.rewards_label) : null,
  };
}

// ─── Best card at a store ─────────────────────────────────────────────────────
// The same rule the server uses for a purchase (decimalFinance.effectiveCashbackRate):
// the first unexpired store rate whose name matches, else the card's base rate.
// `rate` is in dollars for points cards too, so cards compare fairly.
export function rateAtStore(method, store, today = new Date()) {
  const vendor = String(store || '').trim().toLowerCase();
  const match = vendor && (method?.category_rates || []).find((r) => {
    const name = typeof r?.store === 'string' ? r.store.trim().toLowerCase() : '';
    if (!name || !Number.isFinite(Number(r.rate)) || Number(r.rate) < 0) return false;
    if (r.expires && (!Number.isFinite(Date.parse(r.expires)) || new Date(r.expires) < today)) return false;
    return vendor.includes(name) || name.includes(vendor);
  });
  const points = method?.reward_type === 'points';
  const rate = match ? Number(match.rate) : Math.max(0, Number(method?.default_cashback_rate) || 0);
  const earns = points ? Number(match ? match.points : method?.points_base_rate) || 0 : rate;
  return { rate, matched: Boolean(match), label: points ? `${formatEarnRate(earns, 'points')} ≈ ${formatEarnRate(rate, 'cashback')}` : formatEarnRate(rate, 'cashback') };
}

// Cards with their rate at the store, best first; `best` marks the top rate
// (several cards can tie). No `best` at all when every card earns the same.
export function rankForStore(cards, store, today = new Date()) {
  const ranked = cards.map((card) => ({ ...card, atStore: rateAtStore(card.method, store, today) }));
  const top = Math.max(...ranked.map((c) => c.atStore.rate));
  const allSame = ranked.every((c) => c.atStore.rate === top);
  return ranked
    .map((c) => ({ ...c, atStore: { ...c.atStore, best: !allSame && c.atStore.rate === top } }))
    .sort((a, b) => b.atStore.rate - a.atStore.rate);
}

export const storeSuggestions = (methods, platforms) => [...new Set([
  ...(platforms || []).filter((p) => p.type === 'Vendor').map((p) => p.name),
  ...(methods || []).flatMap((m) => (m.category_rates || []).map((r) => r?.store)),
].filter(Boolean))].sort((a, b) => a.localeCompare(b));

// ─── Cards ────────────────────────────────────────────────────────────────────
export const billKey = (cardId, dueDate) => `card-due:${cardId}:${dueDate}`;

export function buildCards({ dashboard, cashflow, methods, catalog, paidBills, now = new Date() }) {
  const byId = (list) => new Map((list || []).map((x) => [x.id, x]));
  const flow = byId(cashflow?.cards);
  const method = byId(methods);
  const catalogById = byId(catalog);
  const paid = new Set((paidBills || []).map((b) => `${b.card_id} ${b.due_date}`));

  const cards = (dashboard?.cards || []).map((d) => {
    const m = method.get(d.id) || null;
    const f = flow.get(d.id);
    const c = catalogById.get(m?.catalog_card_id);
    const limit = positive(d.credit_limit);
    const points = d.rewardType === 'points';
    const asPoints = (dollars) => (points ? pointsFromDollars(dollars, d.pointValueCents) : null);
    const due = nextDueDate(d.due_day, now);
    const dueDate = due ? localToday(due) : null;
    // The bill for the next due date: only when that statement has closed.
    const bill = f?.statementOpen && f.statementDue === dueDate && f.statementBalance > 0 ? f.statementBalance : null;
    const billPaid = Boolean(dueDate && paid.has(`${d.id} ${dueDate}`));
    // A bill marked paid is no longer part of what the card carries.
    const balance = f ? (billPaid && bill !== null ? round2(f.balance - bill) : f.balance) : null;
    const pct = positive(d.min_payment_pct);
    return {
      id: d.id,
      name: cleanCardName(d.name),
      last4: /^\d{4}$/.test(d.last4 || '') ? d.last4 : null,
      issuer: c?.issuer || null,
      network: c?.network || null,
      catalogId: m?.catalog_card_id || null,
      presetId: m?.preset_card_id || null,
      annualFee: c?.annual_fee ?? null,
      method: m,
      reward: rewardSummary(m || { reward_type: d.rewardType, rewards_label: d.rewardsLabel }),
      points,
      // The chosen month
      netToPay: d.amountToPay,
      spend: d.totalSpend,
      earned: d.cashbackEarned,
      earnedPoints: asPoints(d.cashbackEarned),
      redeem: d.cashbackToRedeem,
      keep: d.cashbackToKeep,
      keepPoints: asPoints(d.cashbackToKeep),
      uncoveredLoss: d.uncoveredLoss,
      txnCount: d.txnCount,
      minPayment: pct !== null ? Math.max(0, round2((d.totalSpend * pct) / 100)) : null,
      // Today, whatever month is chosen
      balance,
      limit,
      available: limit !== null && balance !== null ? round2(limit - balance) : null,
      utilization: limit !== null && balance !== null ? Math.max(0, (balance / limit) * 100) : null,
      // Without a close day the app only knows a calendar month, not a statement.
      statementBalance: f && d.statement_close_day ? f.statementBalance : null,
      closeDay: d.statement_close_day || null,
      dueDay: d.due_day || null,
      dueDate,
      dueInDays: d.due_day ? daysUntilDue(d.due_day, now) : null,
      dueLabel: d.due_day ? dueDateLabel(d.due_day, now) : null,
      bill,
      billPaid,
      payNext: false,
      source: d,
    };
  });

  // The unpaid bill that comes due first; the larger one on the same day.
  const next = cards
    .filter((c) => c.bill !== null && !c.billPaid)
    .sort((a, b) => a.dueInDays - b.dueInDays || b.bill - a.bill)[0];
  return next ? cards.map((c) => (c.id === next.id ? { ...c, payNext: true } : c)) : cards;
}

// ─── Sorting ──────────────────────────────────────────────────────────────────
export const SORTS = {
  custom: { label: 'My order' },
  due: { label: 'Payment due first', value: (c) => (c.billPaid ? null : c.dueInDays), dir: 1 },
  netToPay: { label: 'Most to pay', value: (c) => c.netToPay, dir: -1 },
  balance: { label: 'Highest balance', value: (c) => c.balance, dir: -1 },
  utilization: { label: 'Highest utilization', value: (c) => c.utilization, dir: -1 },
  reward: { label: 'Best rewards', value: (c) => c.reward.sortValue, dir: -1 },
  name: { label: 'Name A–Z', value: (c) => c.name.toLowerCase(), dir: 1 },
};

// Cards with no value for the sort go last. "My order" follows the saved order;
// a card that isn't in it yet goes to the end.
export function sortCards(cards, key, order = []) {
  const sort = SORTS[key];
  if (!sort?.value) {
    const rank = new Map(order.map((id, i) => [id, i]));
    return cards
      .map((card, i) => ({ card, at: rank.has(card.id) ? rank.get(card.id) : 1e6 + i }))
      .sort((a, b) => a.at - b.at)
      .map(({ card }) => card);
  }
  return [...cards].sort((a, b) => {
    const x = sort.value(a);
    const y = sort.value(b);
    if (x === null || y === null) return (x === null) - (y === null);
    if (x === y) return a.name.localeCompare(b.name);
    return x < y ? -sort.dir : sort.dir;
  });
}

// ─── What this device remembers ───────────────────────────────────────────────
const STORE_KEY = 'credit_card_page';
export const VIEWS = ['wallet', 'deck', 'rows', 'tiles'];

export function loadCardPage() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { /* unreadable: start fresh */ }
  return {
    view: VIEWS.includes(saved.view) ? saved.view : 'wallet',
    sort: SORTS[saved.sort] ? saved.sort : 'custom',
    order: Array.isArray(saved.order) ? saved.order.filter((id) => typeof id === 'string').slice(0, 500) : [],
  };
}
export function saveCardPage(value) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch { /* storage is off: it just isn't remembered */ }
}
