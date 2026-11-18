// The Log Purchase action: commit to the cashout, submit tracking, then
// record the purchase and its sale locally -- in that order, because the
// first two are real calls to a third party and the last two are not.
const prisma = require('../../prisma');
const { requireOwned } = require('../ownership');
const statusTransitions = require('../statusTransitions');
const { getConnection } = require('./service');
const commitsService = require('./commits');
const { getAdapter } = require('./registry');

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T12:00:00.000Z`);
  return new Date(str);
};

const required = (value, label) => {
  if (value === undefined || value === null || value === '') {
    throw Object.assign(new Error(`${label} is required.`), { status: 400 });
  }
  return value;
};

/**
 * Commits to the deal item, submits tracking, then writes the purchase and
 * its sale -- the same combined write Add Transaction already does, just
 * triggered from here instead of from that page.
 *
 * If the EB commit fails, nothing is written at all, not even the purchase:
 * "you own this" was never true from EB's side, so neither are our records.
 *
 * If the commit succeeds but tracking submission fails, the purchase, sale
 * and commitment are still saved -- the commitment is already real on EB's
 * side regardless of whether tracking went through -- with the tracking
 * failure recorded on the commitment row so the UI can show it and let the
 * item be resubmitted later.
 *
 * With no tracking number yet, an EB purchase skips steps 1 and 2 too: the
 * purchase and sale are written, plus a "pending" commitment row holding the
 * deal, item and quantity. Nothing is sent to EB. Adding a tracking number to
 * that sale later offers to commit then (see pendingCommit.js), at EB's payout
 * at that moment.
 *
 * Cashouts we can't commit to yet (Points4Days) skip steps 1 and 2: this only
 * writes the purchase and sale, and the user commits and sends tracking on the
 * cashout's own website. A tracking number is still required, as it is for EB:
 * Log Purchase is only for items that have shipped. It's saved on the sale only,
 * never sent anywhere. No commitment row is made, since nothing was committed here.
 *
 * The sale goes to the connection's linked cashout group, or to `platformId`
 * when the form picks one (a connection with no group linked yet).
 */
async function logPurchase(userId, {
  connectionId, dealId, itemId, dealName, itemName,
  quantity, trackingCodes, insuredValue,
  vendorId, paymentMethodId, unitCost, taxExempt, salesTax,
  cashbackRate, cashbackEarned, purchaseDate,
  unitPayout, saleDate, platformId,
}) {
  required(connectionId, 'connectionId');
  required(dealId, 'dealId');
  required(itemId, 'itemId');
  const qty = required(quantity, 'quantity');
  required(vendorId, 'Store');
  required(paymentMethodId, 'Payment method');
  const payout = required(unitPayout, 'unitPayout');
  if (!Number.isInteger(Number(qty)) || Number(qty) < 1) {
    throw Object.assign(new Error('Quantity must be a whole number of at least 1.'), { status: 400 });
  }
  if (!(Number(payout) > 0)) {
    throw Object.assign(new Error('unitPayout must be more than 0.'), { status: 400 });
  }

  const conn = await getConnection(userId, connectionId);
  const recordOnly = typeof getAdapter(conn.provider).createCommit !== 'function';
  const codes = Array.isArray(trackingCodes)
    ? trackingCodes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  if (codes.length === 0 && recordOnly) {
    throw Object.assign(new Error('At least one tracking number is required.'), { status: 400 });
  }
  // EB with no tracking number: record now, commit once it ships.
  const deferCommit = !recordOnly && codes.length === 0;

  const saleTo = platformId || conn.platform_id;
  if (!saleTo) {
    throw Object.assign(
      new Error('Pick which cashout group this sale goes to.'),
      { status: 400 },
    );
  }
  const salePlatform = await requireOwned('platform', saleTo, userId, 'Cashout group');
  if (salePlatform.type !== 'Cashout') {
    throw Object.assign(new Error('The sale has to go to one of your cashout groups.'), { status: 400 });
  }
  await requireOwned('platform', vendorId, userId, 'Store');
  await requireOwned('paymentMethod', paymentMethodId, userId, 'Payment method');

  if (deferCommit) {
    // EB takes one commitment per item, and so does our table: say so now
    // rather than failing on the unique index mid-write.
    const existing = await prisma.cashoutCommitment.findFirst({
      where: { connection_id: conn.id, external_item_id: String(itemId) },
    });
    if (existing) {
      throw Object.assign(
        new Error(existing.status === 'pending'
          ? 'This item is already logged and waiting to be committed. Add its tracking number to commit it.'
          : 'You already have a commitment for this item. Change its quantity from Commitments instead.'),
        { status: 409 },
      );
    }
  }

  let commitment = null;
  let trackingSubmitted = false;
  let trackingError = null;
  if (!recordOnly && !deferCommit) {
    // Step 1: commit with EB. Left to throw straight through -- a failure here
    // (deal closed, already committed, over the limit) means nothing below runs.
    commitment = await commitsService.createCommitment(userId, connectionId, {
      dealId, itemId, quantity: qty,
    });

    // Step 2: submit tracking. A failure here is caught, not thrown -- see the
    // doc comment above for why the purchase still gets written either way.
    try {
      await commitsService.submitTracking(userId, connectionId, {
        trackingCodes: codes,
        description: `${dealName || 'Cashout deal'} x${qty}`.slice(0, 200),
        insuredValue,
      });
      trackingSubmitted = true;
    } catch (err) {
      trackingError = err.message;
    }
  }

  // Step 3: our own books. Status starts at the legacy SOLD baseline, then
  // the same trackingAttached advance the rest of the app uses runs on it --
  // the same mechanism inventory.js's own purchase+sale endpoint uses, just
  // applied to the sale instead of the purchase, since a tracking number is
  // already in hand here (that's always true for a cashout -- the sale is
  // never awaiting a tracking number the way a marketplace sale can be).
  const saleWorkflow = statusTransitions.resolveSaleWorkflow(salePlatform.workflow_preset);
  let saleLegacyStatus = 'SOLD';
  let saleWorkflowData = {
    workflow_type: saleWorkflow,
    workflow_status: statusTransitions.legacyWorkflowStatus(saleLegacyStatus, saleWorkflow),
  };
  const primaryTracking = codes[0] || null;
  if (primaryTracking) {
    const advanced = statusTransitions.trackingAttached(
      'sale',
      { status: saleLegacyStatus, ...saleWorkflowData },
      primaryTracking,
    );
    if (advanced.legacy_status) saleLegacyStatus = advanced.legacy_status;
    saleWorkflowData = { ...saleWorkflowData, ...advanced.data };
  }
  const statusChangedAt = new Date();
  if (saleWorkflowData.workflow_status) saleWorkflowData.workflow_status_changed_at = statusChangedAt;

  const { inventory, sale, commitment: updatedCommitment } = await prisma.$transaction(async (tx) => {
    const createdInventory = await tx.inventory.create({
      data: {
        user_id: userId,
        product_name: itemName || dealName || 'Cashout deal',
        vendor_id: vendorId,
        payment_method_id: paymentMethodId,
        purchase_date: parseLocalDate(purchaseDate) || new Date(),
        unit_purchase_cost: Number(unitCost) || 0,
        qty_purchased: qty,
        qty_on_hand: 0, // the full quantity was sold straight to the cashout
        sales_tax: Number(salesTax) || 0,
        cashback_rate: cashbackRate !== undefined && cashbackRate !== null ? Number(cashbackRate) : null,
        cashback_earned: cashbackEarned !== undefined && cashbackEarned !== null ? Number(cashbackEarned) : 0,
        tax_exempt: Boolean(taxExempt),
        status: 'PURCHASED',
        ...statusTransitions.legacyReceivingPatch('PURCHASED'),
      },
    });

    const createdSale = await tx.sales.create({
      data: {
        inventory_id: createdInventory.id,
        platform_id: salePlatform.id,
        quantity: qty,
        unit_price: Number(payout),
        sale_date: parseLocalDate(saleDate || purchaseDate) || new Date(),
        status: saleLegacyStatus,
        ...saleWorkflowData,
        tracking_number: primaryTracking,
      },
    });

    if (deferCommit) {
      const pending = await tx.cashoutCommitment.create({
        data: {
          user_id: userId,
          connection_id: conn.id,
          sale_id: createdSale.id,
          external_deal_id: String(dealId),
          external_item_id: String(itemId),
          external_commitment_id: null,
          quantity: Number(qty),
          status: 'pending',
        },
      });
      return { inventory: createdInventory, sale: createdSale, commitment: pending };
    }

    const updatedCommitment = commitment && await tx.cashoutCommitment.update({
      where: { id: commitment.id },
      data: {
        sale_id: createdSale.id,
        tracking_codes: trackingSubmitted ? codes : [],
        tracking_submitted_at: trackingSubmitted ? new Date() : null,
        tracking_error: trackingError,
      },
    });

    return { inventory: createdInventory, sale: createdSale, commitment: updatedCommitment };
  });

  return {
    inventory,
    sale,
    commitment: updatedCommitment,
    trackingSubmitted,
    trackingError,
    recordedOnly: recordOnly,
    commitPending: deferCommit,
  };
}

module.exports = { logPurchase };
