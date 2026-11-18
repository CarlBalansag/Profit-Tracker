// Turning an OpenCard DB catalog card into a saved card's reward fields, and
// keeping saved cards current when the catalog changes.
//
// A saved card linked to the catalog (catalog_card_id) remembers what was
// last copied from the catalog in `catalog_applied`:
//   { reward_type, base, rewards_label, include_store_rates, rates: [{ store, value }] }
// (`value` is in the card's own unit: points per $1, or % back.)
//
// When the catalog's version of the card no longer matches `catalog_applied`,
// the saved card is updated automatically -- but only the parts the user
// hasn't changed themselves: their point value, store rates they added, and
// any rate they edited by hand are always kept.
const { resolveRewardFields } = require('./cardRewards');

// Issuer category labels ("U.S. supermarkets", "Restaurants worldwide") ->
// store names a purchase is matched against (category_rates[].store).
// Categories that match nothing stay on the card's info list only.
const CATEGORY_STORES = [
  [/amazon/i, ['Amazon']],
  [/whole foods/i, ['Whole Foods']],
  [/walmart/i, ['Walmart']],
  [/target/i, ['Target']],
  [/costco/i, ['Costco']],
  [/best buy/i, ['Best Buy']],
  [/home depot/i, ['Home Depot']],
  [/lowe'?s/i, ["Lowe's"]],
  [/supermarket|grocer/i, ['Grocery', 'Supermarket']],
  [/restaurant|dining/i, ['Dining', 'Restaurant']],
  [/gas station|\bgas\b|fuel/i, ['Gas']],
  [/drug ?stores?|pharmac/i, ['Drugstore', 'Walgreens', 'CVS']],
  [/streaming/i, ['Streaming']],
  [/office supply/i, ['Office Supply', 'Staples', 'Office Depot']],
  [/shipping/i, ['Shipping', 'USPS', 'UPS', 'FedEx']],
  [/online retail|online shopping/i, ['Online Shopping']],
];

// Categories whose stores depend on the user's choice or monthly spend
// ("Choice category (gas, dining, ...)", "Top two categories each month") --
// not a fixed rate at any one store, so they don't become store rates.
const PICK_YOUR_OWN = /choice category|top (?:two|three|\d+)\b|where you spend the most|categor(?:y|ies) (?:you|of your) choos/i;

// The part of a label that says where the rate applies, without the issuer's
// exclusions: "Grocery stores (excluding Walmart and Target)" must not match
// Walmart or Target.
function applicableText(label = '') {
  if (PICK_YOUR_OWN.test(label)) return '';
  return label
    .replace(/\([^)]*\bexclud(?:e|es|ing)\b[^)]*\)/gi, ' ')
    .replace(/\bexclud(?:e|es|ing)\b[^;)]*/gi, ' ');
}

function storesForCategory(label = '') {
  const text = applicableText(label);
  // "Online grocery purchases" earns only online, not at grocery stores.
  const onlineGroceryOnly = /online grocer/i.test(text) && !/in-store|in store/i.test(text);
  const stores = [];
  for (const [pattern, names] of CATEGORY_STORES) {
    if (onlineGroceryOnly && names.includes('Grocery')) continue;
    if (pattern.test(text)) for (const name of names) if (!stores.includes(name)) stores.push(name);
  }
  return stores;
}

// What the catalog says this card earns, in the shape kept in catalog_applied.
// If two categories map to the same store, the better rate wins.
function catalogFields(card, { includeStoreRates = true } = {}) {
  const earns = card && card.reward_type !== 'none';
  const rewardType = card?.reward_type === 'points' ? 'points' : 'cashback';
  const byStore = new Map();
  if (earns && includeStoreRates) {
    for (const category of card.categories || []) {
      for (const store of storesForCategory(category.label)) {
        const prior = byStore.get(store);
        if (prior === undefined || category.rate > prior) byStore.set(store, category.rate);
      }
    }
  }
  return {
    reward_type: rewardType,
    base: earns ? Number(card.base_rate) || 0 : 0,
    rewards_label: earns ? (card.rewards_label || null) : null,
    include_store_rates: includeStoreRates,
    rates: [...byStore.entries()].map(([store, value]) => ({ store, value })),
  };
}

const sameStore = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// A catalog store rate as a category_rates entry for a card of `rewardType`.
const toRateEntry = ({ store, value }, rewardType) => (rewardType === 'points'
  ? { store, rate: 0, points: value, source: 'catalog' }
  : { store, rate: value, source: 'catalog' });

const valueOf = (entry, rewardType) => Number(rewardType === 'points' ? entry.points : entry.rate);

// Request fields for adding (or switching) a card to catalog data. `userRates`
// are store rates the user is keeping; catalog rates for the same store are
// skipped so the user's wins.
function fieldsFromCatalog(card, { includeStoreRates = true, userRates = [], now = new Date() } = {}) {
  const applied = catalogFields(card, { includeStoreRates });
  const kept = (userRates || []).filter(r => r?.store).map(r => {
    const copy = { ...r };
    delete copy.source;
    return copy;
  });
  const catalogRates = applied.rates
    .filter(r => !kept.some(k => sameStore(k.store, r.store)))
    .map(r => toRateEntry(r, applied.reward_type));
  return {
    catalog_card_id: card.id,
    reward_type: applied.reward_type,
    rewards_label: applied.rewards_label,
    ...(applied.reward_type === 'points'
      ? { points_base_rate: applied.base }
      : { default_cashback_rate: applied.base }),
    category_rates: [...catalogRates, ...kept],
    catalog_applied: JSON.stringify(applied),
    catalog_synced_at: now,
  };
}

const parseJson = (value, fallback) => {
  if (!value) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};

const sameApplied = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The update to bring a saved, catalog-linked card in line with the catalog's
// current version of it, or null when nothing needs to change.
function refreshFromCatalog(method, card, { now = new Date() } = {}) {
  if (!method?.catalog_card_id || !card) return null;
  const applied = parseJson(method.catalog_applied, null);
  const fresh = catalogFields(card, { includeStoreRates: applied?.include_store_rates !== false });
  if (!applied) {
    // Linked before we tracked what was applied: start tracking from here
    // without touching the card.
    return { catalog_applied: JSON.stringify(fresh), catalog_synced_at: now };
  }
  if (sameApplied(fresh, applied)) return null;

  const savedRates = parseJson(method.category_rates, []);
  const currentBase = Number(method.reward_type === 'points' ? method.points_base_rate : method.default_cashback_rate) || 0;
  // The user changed how the card earns (type or base rate) by hand: leave
  // those, and leave store rates too since they'd be in the user's units.
  const customized = method.reward_type !== applied.reward_type || currentBase !== Number(applied.base);

  const input = {};
  if (!customized) {
    input.reward_type = fresh.reward_type;
    if (fresh.reward_type === 'points') input.points_base_rate = fresh.base;
    else input.default_cashback_rate = fresh.base;

    const typeChanged = fresh.reward_type !== applied.reward_type;
    const kept = savedRates.filter(entry => {
      if (entry?.source !== 'catalog') return true; // the user's own rate
      const was = applied.rates.find(r => sameStore(r.store, entry.store));
      // A catalog rate the user edited by hand is now theirs.
      return was ? valueOf(entry, applied.reward_type) !== Number(was.value) : false;
    }).map(entry => {
      if (entry?.source !== 'catalog') return entry;
      const copy = { ...entry };
      delete copy.source;
      return copy;
    });
    const added = fresh.rates
      .filter(r => !kept.some(k => sameStore(k.store, r.store)))
      .map(r => toRateEntry(r, fresh.reward_type));
    // If the card switched between points and cashback, the user's own
    // entries are re-expressed by resolveRewardFields from their dollar rate.
    input.category_rates = [...added, ...kept.map(k => {
      if (!typeChanged) return k;
      const copy = { ...k };
      delete copy.points;
      return copy;
    })];
  }
  const labelUnchanged = (method.rewards_label ?? null) === (applied.rewards_label ?? null);
  const rewards = resolveRewardFields(input, method);
  return {
    reward_type: rewards.reward_type,
    points_base_rate: rewards.points_base_rate,
    point_value_cents: rewards.point_value_cents,
    default_cashback_rate: rewards.default_cashback_rate,
    category_rates: JSON.stringify(rewards.category_rates),
    ...(labelUnchanged ? { rewards_label: fresh.rewards_label } : {}),
    catalog_applied: JSON.stringify(fresh),
    catalog_synced_at: now,
  };
}

module.exports = { CATEGORY_STORES, storesForCategory, catalogFields, fieldsFromCatalog, refreshFromCatalog };
