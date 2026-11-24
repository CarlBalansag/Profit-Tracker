// The store account (e.g. which Amazon login) a purchase was made on.
// Writes already require account_id to be the caller's own account, but reads
// re-check it so another user's account name can never reach the client. Only
// id and name are ever handed out: never the login's email or username.

// For a Prisma select/include. user_id is read only for the check below.
const ACCOUNT_SELECT = { select: { id: true, name: true, user_id: true } };

function ownAccount(account, userId) {
  if (!account || account.user_id !== userId) return null;
  return { id: account.id, name: account.name };
}

// Rounds exact Decimal parts to cents so they add up to the already-rounded
// total: the leftover cents go to the parts that rounding moved the most.
function splitToCents(parts, total) {
  const cents = parts.map((p) => p.times(100).toDecimalPlaces(0).toNumber());
  const left = Math.round(total * 100) - cents.reduce((sum, c) => sum + c, 0);
  const step = Math.sign(left);
  parts
    .map((p, i) => ({ i, gap: p.times(100).minus(cents[i]).toNumber() * step }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, Math.abs(left))
    .forEach(({ i }) => { cents[i] += step; });
  return cents.map((c) => c / 100);
}

module.exports = { ACCOUNT_SELECT, ownAccount, splitToCents };
