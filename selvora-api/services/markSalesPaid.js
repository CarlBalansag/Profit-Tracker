// Bulk "mark paid from one deposit" for sales. Shared by the session-authed
// POST /api/sales/mark-paid-batch route and the MCP mark_sale_paid tool, so
// there is exactly one place that owns: ownership checks, eligibility checks,
// and how a deposit smaller than the sales it covers gets split across them.
const prisma = require('../prisma');
const { Decimal, decimal } = require('./money');
const { saleEconomics } = require('./decimalFinance');
const statusTransitions = require('./statusTransitions');
const { findOrCreateBuyer } = require('./buyers');

const requestError = (status, message) => Object.assign(new Error(message), { status });

// Proportional, cumulative-boundary allocation (same technique as
// services/money.js's allocate(), generalized from unit counts to arbitrary
// weights): rounding each sale's share independently can make the parts miss
// the total by a cent. Rounding the running total at each boundary and taking
// the difference guarantees the parts always sum to exactly `total`.
function allocateByWeight(total, weights) {
  const sumWeights = weights.reduce((sum, w) => sum.plus(w), decimal(0));
  if (sumWeights.isZero()) return weights.map(() => decimal(0));
  let cumulativeRounded = decimal(0);
  let cumulativeWeight = decimal(0);
  return weights.map((weight) => {
    cumulativeWeight = cumulativeWeight.plus(weight);
    const cumulativeShare = total.times(cumulativeWeight).div(sumWeights).toDecimalPlaces(2);
    const share = cumulativeShare.minus(cumulativeRounded);
    cumulativeRounded = cumulativeShare;
    return share;
  });
}

// payoutDate: Date. payoutAmount: string|number. payoutAccount/payoutReference: string|null.
// buyerName (optional): attributes every sale in the batch to this buyer (created
// if new) in the same transaction -- the common case is "I got paid by X", which
// tells you who paid in the same breath as the deposit itself.
async function markSalesPaid({ userId, saleIds, payoutDate, payoutAmount, payoutAccount, payoutReference, buyerName }) {
  if (!Array.isArray(saleIds) || saleIds.length === 0) throw requestError(400, 'sale_ids must be a non-empty array');
  const uniqueIds = [...new Set(saleIds)];
  const deposit = decimal(payoutAmount);
  if (deposit.isNegative()) throw requestError(400, 'payout_amount cannot be negative');

  return prisma.$transaction(async (tx) => {
    const buyer = buyerName ? await findOrCreateBuyer(userId, buyerName, tx) : null;
    const sales = await tx.sales.findMany({
      where: { id: { in: uniqueIds } },
      include: { inventory: true },
    });
    const foundIds = new Set(sales.map((s) => s.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    if (missing.length) throw requestError(404, `Sale(s) not found: ${missing.join(', ')}`);

    const foreign = sales.filter((s) => s.inventory.user_id !== userId);
    if (foreign.length) throw requestError(404, `Sale(s) not found or access denied: ${foreign.map((s) => s.id).join(', ')}`);

    const notPayable = sales.filter((s) => !statusTransitions.isActionAllowed(s, 'sale', 'mark_paid'));
    if (notPayable.length) {
      throw requestError(409, `Sale(s) not eligible for mark_paid in their current status: ${notPayable.map((s) => s.id).join(', ')}`);
    }

    // Preserve the order the caller asked for, not the DB's return order, so
    // the response lines up with sale_ids and rounding remainders always land
    // on the same (last) sale for a given request.
    const orderedSales = uniqueIds.map((id) => sales.find((s) => s.id === id));
    const expected = orderedSales.map((sale) => saleEconomics({}, sale).revenue);
    const expectedTotal = expected.reduce((sum, v) => sum.plus(v), decimal(0));
    const shortfallTotal = Decimal.max(0, expectedTotal.minus(deposit));
    const shortfalls = allocateByWeight(shortfallTotal, expected);

    const now = new Date();
    const updated = [];
    for (let i = 0; i < orderedSales.length; i++) {
      const sale = orderedSales[i];
      const shortfall = shortfalls[i];
      const paidAmount = expected[i].minus(shortfall);
      const data = {
        paid_at: payoutDate || now,
        paid_amount: paidAmount.toNumber(),
        paid_reference: payoutReference || null,
        payout_account: payoutAccount || null,
        payout_short_amount: shortfall.gt(0) ? shortfall.toNumber() : null,
      };
      if (buyer) data.buyer_id = buyer.id;
      // Mirrors statusTransitions.SALE_TRANSITIONS.mark_paid: payment before
      // handoff is recorded but a DIRECT_LOCAL sale stays actionable until the
      // item actually changes hands.
      if (sale.workflow_status !== 'AWAITING_HANDOFF') data.workflow_status = 'PAID';
      updated.push(await tx.sales.update({ where: { id: sale.id }, data }));
    }
    return updated;
  });
}

module.exports = { markSalesPaid, allocateByWeight };
