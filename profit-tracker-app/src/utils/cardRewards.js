// Card rewards helpers shared by Settings (Payment Methods) and the Credit
// Card page.
//
// A card earns either cashback (% back) or points (points/miles per $1). For
// points cards the server stores the multipliers plus point_value_cents and
// derives the dollar rates every total uses, so the UI only needs to:
//   - turn an OpenCard DB catalog card into a payment-method save body, and
//   - show points cards as "4x" / "400 pts ≈ $4.00" instead of "4%".
import { apiFetch } from '../hooks/useApi';
import { PRESET_CARDS } from '../data/presetCards';

export const DEFAULT_POINT_VALUE_CENTS = 1;

// ─── Catalog fetch ────────────────────────────────────────────────────────────
// The catalog is ~400 cards and the same for every user; fetch it once per
// page load and share the promise.
let catalogPromise = null;
export function loadCardCatalog() {
  if (!catalogPromise) {
    catalogPromise = apiFetch('/api/card-catalog')
      .then(res => {
        if (!res.ok) throw new Error(`Could not load the card list (${res.status})`);
        return res.json();
      })
      .catch(err => { catalogPromise = null; throw err; });
  }
  return catalogPromise;
}
export const _resetCatalogCacheForTests = () => { catalogPromise = null; };

// ─── Saving a catalog card ────────────────────────────────────────────────────
// The server fills the reward fields and store rates from the catalog card
// (profit-tracker-api/services/catalogCardFields.js) and keeps the saved card
// current when the catalog changes. `userRates` are store rates the user is
// keeping; they win over the catalog's for the same store.
export function rewardFieldsFromCatalog(card, { includeStoreRates = true, pointValueCents, userRates = [] } = {}) {
  return {
    catalog_card_id: card.id,
    apply_catalog: true,
    include_store_rates: includeStoreRates,
    category_rates: userRates,
    ...(card.reward_type === 'points' ? { point_value_cents: pointValueCents ?? DEFAULT_POINT_VALUE_CENTS } : {}),
  };
}

// ─── Display ──────────────────────────────────────────────────────────────────
const trimNumber = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
};

// "4x" for points, "1.5%" for cashback.
export const formatEarnRate = (rate, rewardType) => (rewardType === 'points' ? `${trimNumber(rate)}x` : `${trimNumber(rate)}%`);

// Short unit for a points card: "miles" or "pts".
export const pointsUnit = (label) => (/mile/i.test(label || '') ? 'miles' : 'pts');

// Points earned for a dollar value at the card's point value (dollars x 100 / cents).
export function pointsFromDollars(dollars, pointValueCents) {
  const cents = Number(pointValueCents) || DEFAULT_POINT_VALUE_CENTS;
  return Math.round(((Number(dollars) || 0) * 100) / cents);
}

// One-line summary of what a catalog card earns, e.g.
// "4x restaurants · 4x U.S. supermarkets · 1x everything else".
export function catalogEarnSummary(card, max = 3) {
  if (!card || card.reward_type === 'none') return 'No rewards';
  const parts = [...(card.categories || [])]
    .sort((a, b) => b.rate - a.rate)
    .slice(0, max)
    .map(c => `${formatEarnRate(c.rate, card.reward_type)} ${c.label}`);
  parts.push(`${formatEarnRate(card.base_rate, card.reward_type)} everything else`);
  return parts.join(' · ');
}

// ─── Cards saved before the catalog ───────────────────────────────────────────
// Old built-in preset ids (data/presetCards.js) -> the matching OpenCard DB
// card, for the one-time "cards were reworked" notice. Presets with no clear
// match are left out and simply never get the notice.
export const LEGACY_PRESET_TO_CATALOG = {
  'chase-ff': 'us-chase-freedom-flex',
  'chase-fu': 'us-chase-freedom-unlimited',
  'chase-sr': 'us-chase-sapphire-reserve',
  'chase-ink-pref': 'us-chase-ink-business-preferred',
  'chase-ink-unl': 'us-chase-ink-business-unlimited',
  'chase-ink-cash': 'us-chase-ink-business-cash',
  'chase-slate': 'us-chase-slate-edge',
  'chase-rise': 'us-chase-freedom-rise',
  'chase-ink-prem': 'us-chase-ink-business-premier',
  'amex-bcp': 'us-amex-blue-cash-preferred',
  'amex-bce': 'us-amex-blue-cash-everyday',
  'amex-gold': 'us-amex-gold',
  'amex-plat': 'us-amex-platinum',
  'amex-biz-gold': 'us-amex-business-gold',
  'amex-biz-plat': 'us-amex-business-platinum',
  'amex-green': 'us-amex-green',
  'amex-everyday': 'us-amex-everyday',
  'amex-everyday-pref': 'us-amex-everyday-preferred',
  'amex-delta-gold': 'us-amex-delta-skymiles-gold',
  'amex-delta-plat': 'us-amex-delta-skymiles-platinum',
  'amex-hilton': 'us-amex-hilton-honors',
  'amex-hilton-surpass': 'us-amex-hilton-honors-surpass',
  'citi-dc': 'us-citi-double-cash',
  'citi-custom': 'us-citi-custom-cash',
  'citi-premier': 'us-citi-strata-premier',
  'citi-simplicity': 'us-citi-simplicity',
  'citi-att': 'us-citi-at-and-t-points-plus',
  'cap1-vx': 'us-capital-one-venture-x',
  'cap1-v': 'us-capital-one-venture',
  'cap1-qs': 'us-capital-one-quicksilver',
  'cap1-spark-plus': 'us-capital-one-spark-2-cash-plus',
  'cap1-savor': 'us-capital-one-savor',
  'cap1-v-one': 'us-capital-one-ventureone',
  'cap1-spark-cash': 'us-capital-one-spark-cash',
  'discover-cashback': 'us-discover-it-cash-back',
  'discover-miles': 'us-discover-it-miles',
  'wf-active': 'us-wells-fargo-active-cash',
  'wf-autograph': 'us-wells-fargo-autograph',
  'wf-reflect': 'us-wells-fargo-reflect',
  'wf-attune': 'us-wells-fargo-attune',
  'boa-custom': 'us-bank-of-america-customized-cash-rewards',
  'boa-unl': 'us-bank-of-america-unlimited-cash-rewards',
  'boa-prem': 'us-bank-of-america-premium-rewards',
  'boa-travel': 'us-bank-of-america-travel-rewards',
  'boa-prem-elite': 'us-bank-of-america-premium-rewards-elite',
  'usbank-cashplus': 'us-us-bank-cash-plus',
  'usbank-alt-go': 'us-us-bank-altitude-go',
  'usbank-alt-conn': 'us-us-bank-altitude-connect',
  'barc-arrival': 'us-barclays-arrival-plus',
  'barc-aviator': 'us-barclays-aadvantage-aviator-red-world-elite',
  'barc-wyndham': 'us-barclays-wyndham-rewards-earner',
  'store-target': 'us-td-target-circle-credit',
  'store-amazon': 'us-synchrony-amazon-prime-store',
  'store-hd': 'us-citi-home-depot-consumer',
  'store-lowes': 'us-synchrony-mylowes-rewards-credit-card',
  'store-bb': 'us-citi-my-best-buy-credit-card',
  'store-costco': 'us-citi-costco-anywhere-visa-card-by-citi',
  'store-sams': 'us-synchrony-sams-club-mastercard',
  'store-apple': 'us-apple-card',
  'store-paypal': 'us-synchrony-paypal-cashback-mastercard',
  'store-venmo': 'us-synchrony-venmo-credit-card',
};

// Store rates the user added themselves on an old preset card: anything that
// isn't one of that preset's built-in rates (same store, same rate). Those
// are kept when the card is switched to catalog data; the old built-in ones
// are replaced by the catalog's.
export function userAddedStoreRates(savedRates = [], presetId) {
  const preset = PRESET_CARDS.find(p => p.id === presetId);
  const builtIn = new Set((preset?.categoryRates || []).map(r => `${r.store.trim().toLowerCase()}|${Number(r.rate)}`));
  return savedRates.filter(r => r?.store && !builtIn.has(`${r.store.trim().toLowerCase()}|${Number(r.rate)}`));
}

// The PUT body that switches an old preset card to its catalog card, keeping
// the user's name, billing fields, point value and own store rates.
export function reworkSwitchBody(method, catalogCard) {
  const kept = userAddedStoreRates(method.category_rates || [], method.preset_card_id)
    // A kept rule is a dollar %; drop any stale multiplier so the server
    // re-expresses it as points at the card's value.
    .map(rate => { const rest = { ...rate }; delete rest.points; return rest; });
  return {
    name: method.name,
    type: method.type,
    ...rewardFieldsFromCatalog(catalogCard, { pointValueCents: method.point_value_cents ?? DEFAULT_POINT_VALUE_CENTS, userRates: kept }),
    rework_prompt_state: 'switched',
  };
}

// Saved cards that should see the rework notice: linked to an old preset with
// a catalog match, never answered, and the match is in the loaded catalog.
export function cardsNeedingRework(savedMethods = [], catalogCards = []) {
  const byId = new Map(catalogCards.map(c => [c.id, c]));
  return savedMethods
    .filter(m => !m.rework_prompt_state && !m.catalog_card_id && m.preset_card_id)
    .map(m => ({ method: m, catalogCard: byId.get(LEGACY_PRESET_TO_CATALOG[m.preset_card_id]) }))
    .filter(x => x.catalogCard && x.catalogCard.reward_type !== 'none');
}

// "American Express® Gold Card" -> "American Express Gold Card"
export const cleanCardName = (name = '') => name.replace(/[®™℠]/g, '').replace(/\s+/g, ' ').trim();

// Re-linking a card in the Edit form: rename it to the new card too, unless
// the user gave it a name of their own. "Chase Sapphire Reserve" counts as the
// old card's name for "Chase Sapphire Reserve® Credit Card".
export function renameForRelink(currentName, oldCardName, newCardName) {
  const norm = (s) => cleanCardName(s).toLowerCase().replace(/\b(credit )?card\b/g, '').replace(/\s+/g, ' ').trim();
  const current = norm(currentName);
  const old = norm(oldCardName || '');
  const looksLikeOld = current && old && (old.includes(current) || current.includes(old));
  return looksLikeOld ? cleanCardName(newCardName) : currentName;
}

// ─── Perks that matter for reselling ──────────────────────────────────────────
// The card list carries every perk (lounges, trip insurance, DashPass...).
// Payment Methods only shows the ones that help a reseller: protection on
// inventory, credits on shipping / supplies / stores you buy from, employee
// cards, and ways to finance or boost purchases.
const TRAVEL_PERK = /trip|travel|baggage|luggage|lounge|club access|airline|flight|boarding|hotel|rental car|auto rental|car rental|roadside|global entry|tsa|precheck|inflight|companion|status|concierge|dining|resy|doordash|dashpass|uber|lyft|rideshare|streaming|entertainment|ticket|splurge|cell(ular)? (tele)?phone|wireless|balance transfer|annual fee/i;
// Matched against the perk's title.
const RESELLING_TITLE = /purchase (protection|security|assurance)|damage (&|and) theft|extended warranty|warranty (protection|extension)|return protection|price protection|employee cards?|intro apr|cash ?back match|payment terms|fedex|\bups\b|usps|shipping|office supply|amazon|walmart|costco|best buy|target|home depot|lowe'?s|staples/i;
// A statement credit counts when its description names where it applies.
const RESELLING_CREDIT = /fedex|\bups\b|usps|shipping|office supply|amazon|walmart|costco|best buy|home depot|lowe'?s|staples/i;

export function isResellingPerk(perk) {
  const title = perk?.title || '';
  if (TRAVEL_PERK.test(title)) return false;
  if (RESELLING_TITLE.test(title)) return true;
  return /credit/i.test(title) && RESELLING_CREDIT.test(perk?.description || '');
}

export const resellingPerks = (benefits = []) => benefits.filter(isResellingPerk);
