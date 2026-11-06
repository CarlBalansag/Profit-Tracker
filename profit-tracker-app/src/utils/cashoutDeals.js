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
