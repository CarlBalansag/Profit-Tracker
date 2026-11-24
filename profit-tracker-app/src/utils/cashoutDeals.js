import { effectiveCashbackRate, roundCents } from '../../../shared/finance.mjs';
import { formatMoney } from './money';

// What a deal earns if the item is bought at retail. Tax, cashback and coupons
// aren't known here, so this is only an estimate, and without both prices there
// is nothing to estimate.
export function estimateDealProfit(deal) {
  const payout = Number(deal.payout);
  const retail = Number(deal.retail);
  if (!(payout > 0) || !(retail > 0)) return null;
  return {
    amount: roundCents(payout - retail),
    pct: roundCents(((payout - retail) / retail) * 100),
  };
}

// How an estimate reads on screen. A few cents on an expensive item rounds to 0%,
// so it's shown as about nothing rather than as a gain or a loss.
export function formatDealProfit(profit) {
  const sign = profit.amount < 0 ? '-' : profit.amount > 0 ? '+' : '';
  const roundsToNothing = profit.pct === 0;
  return {
    amount: `${sign}$${formatMoney(Math.abs(profit.amount))}`,
    pct: roundsToNothing ? (profit.amount === 0 ? '0%' : '~0%') : `${profit.pct > 0 ? '+' : ''}${profit.pct}%`,
    tone: roundsToNothing ? 'neutral' : profit.amount > 0 ? 'gain' : 'loss',
  };
}

// ROI: the profit as a share of what goes in (retail, no sales tax), labelled
// for the screen: "+9.1% ROI". Nothing when there's no profit to compare.
export function formatDealRoi(profit) {
  if (!profit || !Number.isFinite(Number(profit.pct)) || !Number.isFinite(Number(profit.amount))) return null;
  return `${formatDealProfit({ amount: Number(profit.amount), pct: Number(profit.pct) }).pct} ROI`;
}

// Above Retail pays more than retail and Close to Retail pays retail or less. A
// deal with no retail price only appears under All Categories.
export function matchesRetailCategory(deal, category) {
  if (category === 'all') return true;
  const profit = estimateDealProfit(deal);
  if (!profit) return false;
  return category === 'above_retail' ? profit.amount > 0 : profit.amount <= 0;
}

// When the deals on screen were last fetched, newest across all connections. A
// failed refresh keeps its old time, so this never overstates how fresh they are.
// Shown in the device's time zone unless one is passed in.
export function formatLastSynced(results, timeZone) {
  const times = (results || [])
    .map((result) => new Date(result.lastUpdated || NaN).getTime())
    .filter(Number.isFinite);
  if (times.length === 0) return null;

  return new Date(Math.max(...times)).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isDealExpired(deal, now = Date.now()) {
  const expires = deal.expiresAt ? new Date(deal.expiresAt).getTime() : NaN;
  return Number.isFinite(expires) && expires <= now;
}

export function formatDealExpiry(expiresAt, now = new Date()) {
  const expires = expiresAt ? new Date(expiresAt) : null;
  if (!expires || Number.isNaN(expires.getTime())) return null;

  const date = expires.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const remaining = expires.getTime() - now.getTime();
  if (remaining <= 0) return { date, note: 'Expired', expired: true, urgent: false };

  const days = Math.ceil(remaining / DAY_MS);
  return { date, note: `${days} ${days === 1 ? 'day' : 'days'} left`, expired: false, urgent: days <= 3 };
}

// Keyed by the store name the provider sends, not the link's address: many links
// are redirect or affiliate addresses that say nothing about the store.
const STORE_DOMAINS = {
  amazon: 'amazon.com',
  bestbuy: 'bestbuy.com',
  costco: 'costco.com',
  dell: 'dell.com',
  gamestop: 'gamestop.com',
  google: 'store.google.com',
  homedepot: 'homedepot.com',
  kohls: 'kohls.com',
  lenovo: 'lenovo.com',
  lowes: 'lowes.com',
  microsoft: 'microsoft.com',
  microcenter: 'microcenter.com',
  playstationdirect: 'playstation.com',
  samsclub: 'samsclub.com',
  staples: 'staples.com',
  sony: 'playstation.com',
  target: 'target.com',
  walmart: 'walmart.com',
  woot: 'woot.com',
};

export function storeLogoUrl(storeName) {
  const key = String(storeName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const domain = STORE_DOMAINS[key];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

function isWebLink(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// One entry per purchase link. A deal with several items can list one store once
// per item, such as a laptop's colors, so each link says which item it buys.
export function dealStoreLinks(deal) {
  const items = Array.isArray(deal.items) ? deal.items : [];
  const fromItems = items.flatMap((item, index) => (item.purchaseLinks || []).map((link) => ({
    ...link,
    label: items.length > 1 ? `Buy ${item.name} at ${link.name}` : `Buy at ${link.name}`,
    scope: items.length > 1 ? `item-${index}` : 'deal',
  })));
  const fromDeal = (deal.productLinks || []).map((link) => ({ ...link, label: `Buy at ${link.name}`, scope: 'deal' }));

  // One link per store: the same address twice, or two links to one store for
  // the same item (an Amazon short link and an amazon.com one), show once.
  const seen = new Set();
  return [...fromItems, ...fromDeal].filter((link) => {
    if (!isWebLink(link.url)) return false;
    const sameStore = link.name ? `${link.scope}:${storeKey(link.name)}` : null;
    if (seen.has(link.url) || (sameStore && seen.has(sameStore))) return false;
    seen.add(link.url);
    if (sameStore) seen.add(sameStore);
    return true;
  }).map((link) => {
    const { scope, ...rest } = link;
    void scope;
    return rest;
  });
}

// Store names compared loosely, so "BestBuy" and "Best Buy" are one store.
function storeKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// The UPCs of a single-product deal. Deals with several items (bundles, "pick a
// color") return none, so they're never merged with another cashout's deal.
function singleProductUpcs(deal) {
  const items = Array.isArray(deal.items) ? deal.items : [];
  if (items.length !== 1) return [];
  return [...new Set((items[0].upcs || []).map((upc) => String(upc).trim()).filter(Boolean))];
}

// One entry per product. When different cashouts list the same product (a
// shared UPC), they become one entry with every cashout's deal in `offers`,
// highest payout first. The entry itself is the best-paying deal, so payout,
// profit and sorting use it. Its retail price comes from another offer when the
// best one has none. Deals from the same cashout are never merged.
export function groupDealsByProduct(deals) {
  const groups = [];
  const byUpc = new Map();

  for (const deal of deals) {
    const upcs = singleProductUpcs(deal);
    const group = upcs
      .map((upc) => byUpc.get(upc))
      .find((candidate) => candidate && !candidate.some((offer) => offer.connectionId === deal.connectionId));
    if (group) {
      group.push(deal);
    } else {
      groups.push([deal]);
    }
    const target = group || groups[groups.length - 1];
    for (const upc of upcs) if (!byUpc.has(upc)) byUpc.set(upc, target);
  }

  return groups.map((offers) => {
    if (offers.length === 1) return { ...offers[0], offers };
    const sorted = [...offers].sort((a, b) => (Number(b.payout) || 0) - (Number(a.payout) || 0));
    const best = sorted[0];
    const retail = Number(best.retail) > 0 ? best.retail : sorted.find((offer) => Number(offer.retail) > 0)?.retail ?? best.retail;
    const merged = { ...best, retail, offers: sorted };
    return { ...merged, estimatedProfit: estimateDealProfit(merged) };
  });
}

// The buy links for a product entry: every offer's links, one per store, so the
// same store isn't shown twice when two cashouts both link to it.
export function groupStoreLinks(group) {
  const offers = group.offers || [group];
  if (offers.length === 1) return dealStoreLinks(offers[0]);
  const seen = new Set();
  return offers.flatMap(dealStoreLinks).filter((link) => {
    const key = link.name ? storeKey(link.name) : link.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The saved card that earns the most on a deal, at whichever of the deal's
// stores it earns the most. Rates come from the same lookup a logged purchase
// uses (shared/finance.mjs): a store rate whose store matches the store's name
// wins over the card's base rate, and an expired store rate doesn't count. A
// points card's rates are already in dollars (multiplier x point value). The
// cashback is on retail, and the profit is the deal's estimate plus it.
// Returns null with no saved cards, and { card: null } when none earns anything.
export function bestCardForDeal(deal, cards, today = new Date()) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  const stores = [];
  for (const link of groupStoreLinks(deal)) {
    if (link.name && !stores.some((name) => storeKey(name) === storeKey(link.name))) stores.push(link.name);
  }
  // A deal with no store links still gets each card's base rate.
  const candidates = stores.length ? stores : [null];

  let best = null;
  for (const card of cards) {
    for (const store of candidates) {
      const rate = effectiveCashbackRate({ payment_method: card, vendor: store ? { name: store } : null }, today);
      if (!best || rate > best.rate) best = { card, store, rate };
    }
  }
  if (!(best.rate > 0)) return { card: null, store: null, rate: 0, cashback: null, profit: null };

  const retail = Number(deal.retail);
  const cashback = retail > 0 ? roundCents((retail * best.rate) / 100) : null;
  const estimate = deal.estimatedProfit === undefined ? estimateDealProfit(deal) : deal.estimatedProfit;
  const profitAmount = estimate && cashback !== null ? roundCents(estimate.amount + cashback) : null;
  return {
    ...best,
    cashback,
    profit: profitAmount === null ? null : { amount: profitAmount, pct: roundCents((profitAmount / retail) * 100) },
  };
}

// A deal's ROI as a number, for sorting and the minimum-ROI filter: with the
// best saved card's rewards when one earns, otherwise the plain estimate. Null
// when there's no retail price to compare against.
export function dealRoi(deal, cards, today = new Date()) {
  const withCard = bestCardForDeal(deal, cards, today)?.profit;
  if (withCard) return withCard.pct;
  const estimate = deal.estimatedProfit === undefined ? estimateDealProfit(deal) : deal.estimatedProfit;
  return estimate ? estimate.pct : null;
}

// Every store a deal can be bought at, once each, for the store filter.
export function dealStoreNames(deal) {
  return [...new Set(dealStoreLinks(deal).map((link) => link.name).filter(Boolean))];
}

// Providers put everything in one free-text note. This pulls out the coupon code,
// ship-to address and delivery rule so they don't have to be read on every row.
// The expected format is "Use Code: X", "Deliver To: X" and a "Dropship To:" line
// with the address on the lines below it; anything else stays in the note,
// untouched. Anything a coupon line says after the code, such as the price it
// gets, stays in the note.
export function parseDealNotes(notes) {
  const lines = String(notes || '').split('\n').map((line) => line.trim());
  const kept = [];
  const addressLines = [];
  let deliverTo = null;
  let coupon = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const delivery = line.match(/^deliver to:\s*(.+)$/i);
    const dropship = line.match(/dropship to:\s*(.*)$/i);
    const code = line.match(/^use code:\s*([a-z0-9_-]+)(.*)$/i);

    if (delivery) {
      deliverTo = delivery[1];
    } else if (dropship) {
      if (dropship[1]) addressLines.push(dropship[1]);
      while (lines[i + 1]) {
        i += 1;
        addressLines.push(lines[i]);
      }
    } else if (code) {
      coupon = code[1];
      const detail = code[2].trim();
      if (detail) kept.push(detail.charAt(0).toUpperCase() + detail.slice(1));
    } else if (line) {
      kept.push(line);
    }
  }

  return { note: kept.join(' '), address: addressLines.join('\n') || null, deliverTo, coupon };
}

const CONDITION_LABELS = { DMG_BOX: 'Damaged Box' };

// Only worth pointing out when it isn't new.
export function dealConditionLabels(deal) {
  const conditions = (deal.items || []).map((item) => item.condition).filter(Boolean);
  return [...new Set(conditions)]
    .filter((condition) => condition.toLowerCase() !== 'new')
    .map((condition) => CONDITION_LABELS[condition] || condition.replace(/_/g, ' '));
}

// How many units of a deal you've already bought through Log Purchase: every
// commitment on it that isn't withdrawn (committed or still waiting on
// tracking). Purchases logged any other way aren't linked to a deal, so they
// don't count.
export function dealBoughtCount(deal, commitments) {
  if (!Array.isArray(commitments) || deal?.id === undefined || deal?.id === null) return 0;
  return commitments
    .filter((c) => c.status !== 'withdrawn' && String(c.external_deal_id) === String(deal.id) && (!c.connection_id || c.connection_id === deal.connectionId))
    .reduce((total, c) => total + (Number(c.quantity) || 0), 0);
}

// "2 of 3 bought" against a deal's limit. With no purchases it's null (the
// plain limit label shows). A deal whose items have different limits, or no
// limit, just says how many were bought.
export function dealBoughtLabel(deal, bought) {
  if (!(bought > 0)) return null;
  const limits = (deal.items || []).map((item) => item.vendorLimit).filter((limit) => limit > 0);
  const limit = limits.length && Math.min(...limits) === Math.max(...limits) ? limits[0] : null;
  if (limit === null) return { text: `${bought} bought`, reached: false };
  return { text: `${bought} of ${limit} bought`, reached: bought >= limit };
}

// Items in one deal can have different limits, so this can be a range.
export function dealLimitLabel(deal) {
  const limits = (deal.items || []).map((item) => item.vendorLimit).filter((limit) => limit > 0);
  if (limits.length === 0) return null;
  const low = Math.min(...limits);
  const high = Math.max(...limits);
  return low === high ? `Limit ${low}` : `Limit ${low}–${high}`;
}
