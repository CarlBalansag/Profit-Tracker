// Points vs cashback for a payment method.
//
// Every profit total in the app reads a plain dollar rate: default_cashback_rate
// and category_rates[].rate are "% of the purchase you get back in dollars".
// A cashback card stores those directly. A points card stores what the card
// actually earns -- points_base_rate and category_rates[].points, as points
// per $1 -- plus point_value_cents, and this module derives the dollar rates
// from them (4x at 1.5 cents = 6%). Doing it here, on every save, keeps the
// math in one place: nothing downstream needs to know a card earns points.
const REWARD_TYPES = ['cashback', 'points'];
const DEFAULT_POINT_VALUE_CENTS = 1;

const finiteOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const round6 = (n) => Math.round(n * 1e6) / 1e6;

const parseRates = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
};

// Builds the reward-related columns for a create (existing = null) or an
// update (existing = the stored row). Fields left out of `input` keep their
// stored value, and a points card's dollar rates are always re-derived, so
// changing only the point value updates every rate.
function resolveRewardFields(input = {}, existing = null) {
  const rewardType = input.reward_type ?? existing?.reward_type ?? 'cashback';
  if (!REWARD_TYPES.includes(rewardType)) {
    const err = new Error('reward_type must be "cashback" or "points"');
    err.status = 400;
    throw err;
  }

  const rates = input.category_rates !== undefined
    ? parseRates(input.category_rates)
    : parseRates(existing?.category_rates);

  if (rewardType === 'cashback') {
    return {
      reward_type: 'cashback',
      points_base_rate: null,
      point_value_cents: null,
      default_cashback_rate: input.default_cashback_rate !== undefined
        ? Math.max(0, finiteOrNull(input.default_cashback_rate) ?? 0)
        : Math.max(0, finiteOrNull(existing?.default_cashback_rate) ?? 0),
      // A card switched back to cashback keeps each store's current dollar
      // rate and drops the multiplier.
      category_rates: rates.map(({ points, ...rest }) => rest),
    };
  }

  const pointValue = finiteOrNull(input.point_value_cents)
    ?? finiteOrNull(existing?.point_value_cents)
    ?? DEFAULT_POINT_VALUE_CENTS;
  if (!(pointValue > 0) || pointValue > 100) {
    const err = new Error('point_value_cents must be more than 0 and at most 100');
    err.status = 400;
    throw err;
  }
  const baseInput = input.points_base_rate !== undefined ? finiteOrNull(input.points_base_rate) : undefined;
  const base = baseInput !== undefined
    ? baseInput
    : (finiteOrNull(existing?.points_base_rate)
      // A cashback card being switched to points with no multiplier given:
      // read its current % as points at the chosen value, so totals don't jump.
      ?? round6((finiteOrNull(existing?.default_cashback_rate) ?? 0) / pointValue));
  if (base === null || base < 0) {
    const err = new Error('points_base_rate must be 0 or more');
    err.status = 400;
    throw err;
  }

  return {
    reward_type: 'points',
    points_base_rate: base,
    point_value_cents: pointValue,
    default_cashback_rate: round6(base * pointValue),
    category_rates: rates.map(rate => {
      const points = finiteOrNull(rate.points);
      if (points === null || points < 0) {
        // A store rule saved before the card became a points card is a
        // dollar %; express it as points at the current value.
        const dollarRate = Math.max(0, finiteOrNull(rate.rate) ?? 0);
        return { ...rate, points: round6(dollarRate / pointValue), rate: dollarRate };
      }
      return { ...rate, points, rate: round6(points * pointValue) };
    }),
  };
}

module.exports = { REWARD_TYPES, DEFAULT_POINT_VALUE_CENTS, resolveRewardFields };
