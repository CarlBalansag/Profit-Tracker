// Plain-language descriptions of cards for the AI assistant (routes/mcp.js),
// matching how the website shows them (Payment Methods / Quick Add).

const trim = (n) => {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
};
const rate = (value, rewardType) => (rewardType === 'points' ? `${trim(value)}x` : `${trim(value)}%`);

const parseRates = (value) => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

// "2x Membership Rewards points at 1.5¢ each (≈3% back)" or "1.5% cash back".
function earnsText(method) {
  const pct = Number(method.default_cashback_rate) || 0;
  if (method.reward_type === 'points') {
    const cents = Number(method.point_value_cents) || 1;
    return `${rate(method.points_base_rate ?? 0, 'points')} ${method.rewards_label || 'points'} at ${trim(cents)}¢ each (≈${trim(pct)}% back)`;
  }
  return pct > 0 ? `${trim(pct)}% cash back` : 'no rewards';
}

// Store rates as the user sees them: "4x (≈6%)" or "3%".
function storeRates(method) {
  return parseRates(method.category_rates)
    .filter(r => r && r.store)
    .map(r => ({
      store: r.store,
      earns: method.reward_type === 'points' && r.points != null
        ? `${rate(r.points, 'points')} (≈${trim(r.rate)}%)`
        : `${trim(r.rate)}%`,
      ...(r.expires ? { expires: r.expires } : {}),
    }));
}

// "4x Restaurants worldwide · 4x U.S. supermarkets · 1x everything else".
function catalogSummary(card, max = 3) {
  if (!card || card.reward_type === 'none') return 'No rewards';
  const parts = [...(card.categories || [])]
    .sort((a, b) => b.rate - a.rate)
    .slice(0, max)
    .map(c => `${rate(c.rate, card.reward_type)} ${c.label}`);
  const cap = card.base_cap;
  const capNote = cap && cap.amount
    ? ` (up to $${Number(cap.amount).toLocaleString('en-US')}${cap.period === 'calendar_year' ? ' a year' : ''}, then ${rate(cap.then ?? 0, card.reward_type)})`
    : '';
  parts.push(`${rate(card.base_rate, card.reward_type)} everything else${capNote}`);
  return parts.join(' · ');
}

// Perks that matter for reselling -- same rules as the website's
// profit-tracker-app/src/utils/cardRewards.js isResellingPerk; keep in step.
const TRAVEL_PERK = /trip|travel|baggage|luggage|lounge|club access|airline|flight|boarding|hotel|rental car|auto rental|car rental|roadside|global entry|tsa|precheck|inflight|companion|status|concierge|dining|resy|doordash|dashpass|uber|lyft|rideshare|streaming|entertainment|ticket|splurge|cell(ular)? (tele)?phone|wireless|balance transfer|annual fee/i;
const RESELLING_TITLE = /purchase (protection|security|assurance)|damage (&|and) theft|extended warranty|warranty (protection|extension)|return protection|price protection|employee cards?|intro apr|cash ?back match|payment terms|fedex|\bups\b|usps|shipping|office supply|amazon|walmart|costco|best buy|target|home depot|lowe'?s|staples/i;
const RESELLING_CREDIT = /fedex|\bups\b|usps|shipping|office supply|amazon|walmart|costco|best buy|home depot|lowe'?s|staples/i;

function isResellingPerk(perk) {
  const title = (perk && perk.title) || '';
  if (TRAVEL_PERK.test(title)) return false;
  if (RESELLING_TITLE.test(title)) return true;
  return /credit/i.test(title) && RESELLING_CREDIT.test((perk && perk.description) || '');
}

const resellingPerks = (benefits = []) => benefits.filter(isResellingPerk).map(b => b.title);

module.exports = { earnsText, storeRates, catalogSummary, isResellingPerk, resellingPerks };
