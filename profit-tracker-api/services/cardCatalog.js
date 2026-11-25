// Credit card catalog from OpenCard DB (https://github.com/thedavidweng/opencard-db),
// a free, community-maintained dataset (data licensed CC BY 4.0 -- the app
// credits it wherever the catalog is shown).
//
// The whole catalog is one public JSON file, so a refresh is a single
// download, not one call per card. We keep:
//   1. a bundled snapshot (data/opencard-us.json) so the picker always works,
//      even offline or before the first sync;
//   2. a cached copy in the CardCatalog table, refreshed when it is older than
//      REFRESH_AFTER_MS (about a month). The refresh runs lazily the next time
//      someone opens the catalog -- no scheduler needed -- and a failed
//      download leaves the cached/bundled copy in place.
const path = require('node:path');
const fs = require('node:fs');
const { normalizeArt } = require('./cardArt');

const SOURCE_ID = 'opencard-us';
const SOURCE_URL = 'https://cdn.jsdelivr.net/gh/thedavidweng/opencard-db@main/exports/cards-all.json';
const REFRESH_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 6 * 60 * 60 * 1000;
// A download with far fewer cards than this is treated as broken, not as
// "most cards were discontinued", so it can't wipe out the catalog.
const MIN_CARDS = 100;
const BUNDLED_PATH = path.join(__dirname, '..', 'data', 'opencard-us.json');

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// rewards.rate_type from OpenCard DB -> the app's reward_type. Miles cards
// behave exactly like points cards (multiplier x value per mile), so they
// share "points"; rewards_label keeps the word "miles" for display.
function rewardTypeOf(rewards = {}) {
  if (rewards.rate_type === 'cashback_percent') return 'cashback';
  // Some cash back cards are recorded as a multiplier ("Cash back (statement
  // credit)" at 2 per $1); what they pay is still % back.
  if (/cash ?back/i.test(rewards.currency_label || '') && !/membership rewards|points?\b.*redeem/i.test(rewards.currency_label || '')) return 'cashback';
  if (rewards.rate_type === 'points_multiplier' || rewards.rate_type === 'miles_multiplier') return 'points';
  return 'none';
}

// One OpenCard DB record -> the trimmed shape the app uses. Returns null for
// records that aren't usable (not US, discontinued, no name).
function normalizeCard(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.country !== 'us') return null;
  if (raw.status === 'discontinued') return null;
  const id = str(raw.id, 120);
  const name = str(raw.name);
  if (!id || !name) return null;
  const rewards = raw.rewards && typeof raw.rewards === 'object' ? raw.rewards : {};
  const base = num(rewards.base_rate?.points_per_dollar);
  const rawCategories = (Array.isArray(rewards.categories) ? rewards.categories : []);
  // Some records carry a multiplier rate_type but earn nothing ("No rewards
  // program", 0x base, no bonus categories): those are no-rewards cards.
  const earnsNothing = /no rewards/i.test(rewards.currency_label || '')
    || (!(base > 0) && !rawCategories.some(cat => num(cat?.points_per_dollar) > 0));
  const reward_type = earnsNothing ? 'none' : rewardTypeOf(rewards);
  const categories = rawCategories
    .map(cat => {
      const rate = num(cat?.points_per_dollar);
      const label = str(cat?.label);
      if (!label || rate === null || rate < 0) return null;
      const capAmount = num(cat?.cap?.amount);
      return {
        label,
        rate,
        cap: capAmount !== null ? { amount: capAmount, period: str(cat.cap.period, 40) } : null,
      };
    })
    .filter(Boolean);
  // "2x on Eligible Purchases (up to $50,000 a year), 1x after" is stored as
  // a 1x base plus a catch-all category. A catch-all matches no store, so it
  // would never apply: make it the base rate and keep the cap as a note.
  let baseRate = base ?? 0;
  let baseCap = null;
  const CATCH_ALL = /^(?:on\s+)?(?:all\s+|every\s+|everyday\s+)?(?:eligible\s+)?(?:net\s+)?purchases?$/i;
  const kept = [];
  for (const cat of categories) {
    if (CATCH_ALL.test(cat.label) && cat.rate > baseRate) {
      baseCap = cat.cap ? { ...cat.cap, then: baseRate } : null;
      baseRate = cat.rate;
    } else {
      kept.push(cat);
    }
  }
  const benefits = (Array.isArray(raw.benefits) ? raw.benefits : [])
    .map(b => (str(b?.title) ? { title: str(b.title), category: str(b.category, 40), description: str(b.description, 400) } : null))
    .filter(Boolean)
    .slice(0, 12);
  return {
    id,
    name,
    issuer: str(raw.issuer, 80) || 'Other',
    network: str(raw.network, 40),
    network_tier: str(raw.network_tier, 40),
    art: normalizeArt(raw.image),
    segment: str(raw.segment, 40),
    status: str(raw.status, 40),
    annual_fee: num(raw.annual_fee?.amount),
    reward_type,
    rewards_label: str(rewards.currency_label, 80),
    base_rate: reward_type === 'none' ? 0 : baseRate,
    // { amount, period, then }: the base rate drops to `then` after `amount`.
    base_cap: reward_type === 'none' ? null : baseCap,
    categories: reward_type === 'none' ? [] : kept,
    benefits,
    official_url: typeof raw.official_url === 'string' && /^https:\/\//.test(raw.official_url) ? raw.official_url.slice(0, 400) : null,
    last_verified: str(raw.last_verified, 40),
  };
}

function normalizeCatalog(rawList) {
  if (!Array.isArray(rawList)) throw new Error('Card catalog export is not a list');
  const seen = new Set();
  const cards = [];
  for (const raw of rawList) {
    const card = normalizeCard(raw);
    if (!card || seen.has(card.id)) continue;
    seen.add(card.id);
    cards.push(card);
  }
  cards.sort((a, b) => a.issuer.localeCompare(b.issuer) || a.name.localeCompare(b.name));
  return cards;
}

const newestVerified = (cards) => cards.reduce((max, c) => (c.last_verified && c.last_verified > max ? c.last_verified : max), '') || null;

let bundledCache = null;
function loadBundled() {
  if (!bundledCache) {
    const parsed = JSON.parse(fs.readFileSync(BUNDLED_PATH, 'utf8'));
    bundledCache = { cards: parsed.cards, synced_at: parsed.synced_at, last_verified: parsed.last_verified };
  }
  return bundledCache;
}

// Downloads and normalizes the latest export. Throws on any failure; never
// writes anything.
async function downloadCatalog(fetchImpl = globalThis.fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetchImpl(SOURCE_URL, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'X-Client-Name': 'profit-tracker' },
    });
    if (!res.ok) throw new Error(`Card catalog download failed (${res.status})`);
    const cards = normalizeCatalog(await res.json());
    if (cards.length < MIN_CARDS) throw new Error(`Card catalog download had only ${cards.length} usable cards`);
    return cards;
  } finally {
    clearTimeout(timer);
  }
}

// Replaces the cached catalog with a fresh download. One upsert, so readers
// see either the old list or the new one, never a mix.
async function syncCatalog(prisma, { fetchImpl, now = new Date() } = {}) {
  const cards = await downloadCatalog(fetchImpl);
  const row = {
    data: JSON.stringify(cards),
    card_count: cards.length,
    source_url: SOURCE_URL,
    synced_at: now,
    last_verified: newestVerified(cards),
  };
  await prisma.cardCatalog.upsert({ where: { id: SOURCE_ID }, create: { id: SOURCE_ID, ...row }, update: row });
  return { card_count: cards.length, synced_at: now, last_verified: row.last_verified };
}

// Only one refresh at a time per process, and back off after a failure so a
// broken CDN doesn't get hit on every page load.
let inFlight = null;
let lastFailureAt = 0;
function refreshInBackground(prisma, opts = {}) {
  const now = opts.now ?? new Date();
  if (inFlight || now.getTime() - lastFailureAt < RETRY_AFTER_FAILURE_MS) return inFlight;
  inFlight = syncCatalog(prisma, opts)
    .catch(err => { lastFailureAt = Date.now(); console.warn('[cardCatalog] refresh failed:', err.message); return null; })
    .finally(() => { inFlight = null; });
  return inFlight;
}

// The catalog to serve: the cached copy if there is one, else the bundled
// snapshot. Kicks off a background refresh when the copy is a month old.
async function getCatalog(prisma, opts = {}) {
  const now = opts.now ?? new Date();
  let row = null;
  try {
    row = await prisma.cardCatalog.findUnique({ where: { id: SOURCE_ID } });
  } catch (err) {
    console.warn('[cardCatalog] read failed, using bundled copy:', err.message);
  }
  let catalog;
  if (row) {
    try {
      catalog = { cards: JSON.parse(row.data), synced_at: new Date(row.synced_at).toISOString(), last_verified: row.last_verified, source: 'synced' };
    } catch {
      catalog = null;
    }
  }
  if (!catalog) catalog = { ...loadBundled(), source: 'bundled' };
  const age = now.getTime() - new Date(catalog.synced_at).getTime();
  const syncDisabled = process.env.CARD_CATALOG_SYNC === 'off';
  if (!(age < REFRESH_AFTER_MS) && opts.refresh !== false && !syncDisabled) refreshInBackground(prisma, opts);
  return { ...catalog, cards: applyCorrections(withArtwork(catalog.cards), opts.corrections) };
}

// Copies saved before artwork was kept have no `art` at all: they borrow it
// from the bundled snapshot until their next monthly refresh.
function withArtwork(cards) {
  if (!cards.some((card) => card.art === undefined)) return cards;
  const bundled = new Map(loadBundled().cards.map((card) => [card.id, card]));
  return cards.map((card) => (card.art === undefined
    ? { ...card, art: bundled.get(card.id)?.art ?? null, network_tier: card.network_tier ?? bundled.get(card.id)?.network_tier ?? null }
    : card));
}

// ─── Our own corrections ──────────────────────────────────────────────────────
// data/card-corrections.json patches cards the community list hasn't caught
// up with (e.g. an issuer added a category). Applied to whichever copy is
// served, so they reach the picker and -- through the auto-update -- saved
// cards. Additions are skipped when the card already has them, so an entry
// becomes a no-op once OpenCard DB catches up and can then be deleted.
const CORRECTIONS_PATH = path.join(__dirname, '..', 'data', 'card-corrections.json');
const SETTABLE = ['reward_type', 'rewards_label', 'base_rate', 'base_cap', 'annual_fee'];
let correctionsCache = null;
function loadCorrections() {
  if (!correctionsCache) {
    try {
      correctionsCache = JSON.parse(fs.readFileSync(CORRECTIONS_PATH, 'utf8')).corrections || [];
    } catch (err) {
      console.warn('[cardCatalog] corrections not loaded:', err.message);
      correctionsCache = [];
    }
  }
  return correctionsCache;
}

const sameText = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Returns a new list; cards without a correction are passed through as-is.
function applyCorrections(cards, corrections = loadCorrections()) {
  if (!corrections.length) return cards;
  const byId = new Map(corrections.map(c => [c.id, c]));
  return cards.map(card => {
    const fix = byId.get(card.id);
    if (!fix) return card;
    const out = { ...card, categories: [...(card.categories || [])], benefits: [...(card.benefits || [])] };
    for (const key of SETTABLE) if (fix.set && key in fix.set) out[key] = fix.set[key];
    for (const cat of fix.add_categories || []) {
      if (cat?.label && Number.isFinite(Number(cat.rate)) && !out.categories.some(c => sameText(c.label, cat.label))) {
        out.categories.push({ label: cat.label, rate: Number(cat.rate), cap: cat.cap ?? null });
      }
    }
    for (const benefit of fix.add_benefits || []) {
      if (benefit?.title && !out.benefits.some(b => sameText(b.title, benefit.title))) {
        out.benefits.push({ title: benefit.title, category: benefit.category ?? null, description: benefit.description ?? null });
      }
    }
    out.corrected = { source: fix.source || null, checked: fix.checked || null };
    return out;
  });
}

// id -> card lookup for the catalog currently being served, for linking and
// auto-updating saved cards. The parsed list is cached per synced_at, so a
// request only reads the small timestamp column unless the catalog changed.
let indexCache = null; // { key, byId }
async function getCatalogIndex(prisma, opts = {}) {
  let key = 'bundled';
  try {
    const row = await prisma.cardCatalog.findUnique({ where: { id: SOURCE_ID }, select: { synced_at: true } });
    if (row) key = `synced:${new Date(row.synced_at).toISOString()}`;
  } catch {
    // fall through to whatever getCatalog serves
  }
  if (indexCache && indexCache.key === key) return indexCache.byId;
  const catalog = await getCatalog(prisma, opts);
  const byId = new Map(catalog.cards.map(card => [card.id, card]));
  indexCache = { key: catalog.source === 'synced' ? `synced:${catalog.synced_at}` : 'bundled', byId };
  return byId;
}

const _resetForTests = () => { inFlight = null; lastFailureAt = 0; bundledCache = null; indexCache = null; };

module.exports = {
  SOURCE_ID, SOURCE_URL, REFRESH_AFTER_MS, MIN_CARDS,
  normalizeCard, normalizeCatalog, downloadCatalog, syncCatalog, getCatalog, getCatalogIndex, refreshInBackground, loadBundled, applyCorrections,
  _resetForTests,
};
