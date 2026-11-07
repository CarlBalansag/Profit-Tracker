import { roundCents } from '../../../shared/finance.mjs';
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
  gamestop: 'gamestop.com',
  lenovo: 'lenovo.com',
  microcenter: 'microcenter.com',
  samsclub: 'samsclub.com',
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
  const fromItems = items.flatMap((item) => (item.purchaseLinks || []).map((link) => ({
    ...link,
    label: items.length > 1 ? `Buy ${item.name} at ${link.name}` : `Buy at ${link.name}`,
  })));
  const fromDeal = (deal.productLinks || []).map((link) => ({ ...link, label: `Buy at ${link.name}` }));

  const seen = new Set();
  return [...fromItems, ...fromDeal].filter((link) => {
    if (!isWebLink(link.url) || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
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

// Items in one deal can have different limits, so this can be a range.
export function dealLimitLabel(deal) {
  const limits = (deal.items || []).map((item) => item.vendorLimit).filter((limit) => limit > 0);
  if (limits.length === 0) return null;
  const low = Math.min(...limits);
  const high = Math.max(...limits);
  return low === high ? `Limit ${low}` : `Limit ${low}–${high}`;
}
