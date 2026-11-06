import { roundCents } from '../../../shared/finance.mjs';

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

// Above Retail pays more than retail and Close to Retail pays retail or less. A
// deal with no retail price only appears under All Categories.
export function matchesRetailCategory(deal, category) {
  if (category === 'all') return true;
  const profit = estimateDealProfit(deal);
  if (!profit) return false;
  return category === 'above_retail' ? profit.amount > 0 : profit.amount <= 0;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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
