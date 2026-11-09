// The Log Purchase action: commit to the cashout, submit tracking, then
// record the purchase and its sale locally -- in that order, because the
// first two are real calls to a third party and the last two are not.
const prisma = require('../../prisma');
const { requireOwned } = require('../ownership');
const statusTransitions = require('../statusTransitions');
const { getConnection } = require('./service');
const commitsService = require('./commits');

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
 */
async function logPurchase(userId, {
  connectionId, dealId, itemId, dealName, itemName,
  quantity, trackingCodes, insuredValue,
  vendorId, paymentMethodId, unitCost, taxExempt, salesTax,
  cashbackRate, cashbackEarned, purchaseDate,
  unitPayout, saleDate,
}) {
  required(connectionId, 'connectionId');
  required(dealId, 'dealId');
  required(itemId, 'itemId');
  const qty = required(quantity, 'quantity');
  required(vendorId, 'Store');
  required(paymentMethodId, 'Payment method');
  const payout = required(unitPayout, 'unitPayout');
  if (!Array.isArray(trackingCodes) || trackingCodes.length === 0) {
    throw Object.assign(new Error('At least one tracking number is required.'), { status: 400 });
  }

  const conn = await getConnection(userId, connectionId);
  if (!conn.platform_id) {
    throw Object.assign(
      new Error('This cashout has no linked store/platform to sell to yet -- set one in Data Setup > Cashouts before logging a purchase.'),
      { status: 400 },
    );
  }
  await requireOwned('platform', vendorId, userId, 'Store');
  await requireOwned('paymentMethod', paymentMethodId, userId, 'Payment method');

  // Step 1: commit with EB. Left to throw straight through -- a failure here
  // (deal closed, already committed, over the limit) means nothing below runs.
  const commitment = await commitsService.createCommitment(userId, connectionId, {
    dealId, itemId, quantity: qty,
  });

  // Step 2: submit tracking. A failure here is caught, not thrown -- see the
  // doc comment above for why the purchase still gets written either way.
  let trackingSubmitted = false;
  let trackingError = null;
  try {
    await commitsService.submitTracking(userId, connectionId, {
      trackingCodes,
      description: `${dealName || 'Cashout deal'} x${qty}`.slice(0, 200),
      insuredValue,
    });
    trackingSubmitted = true;
  } catch (err) {
    trackingError = err.message;
  }

  // Step 3: our own books. Status starts at the legacy SOLD baseline, then
  // the same trackingAttached advance the rest of the app uses runs on it --
  // the same mechanism inventory.js's own purchase+sale endpoint uses, just
  // applied to the sale instead of the purchase, since a tracking number is
  // already in hand here (that's always true for a cashout -- the sale is
  // never awaiting a tracking number the way a marketplace sale can be).
  const platform = await prisma.platform.findUnique({ where: { id: conn.platform_id } });
  const saleWorkflow = statusTransitions.resolveSaleWorkflow(platform?.workflow_preset);
  let saleLegacyStatus = 'SOLD';
  let saleWorkflowData = {
    workflow_type: saleWorkflow,
    workflow_status: statusTransitions.legacyWorkflowStatus(saleLegacyStatus, saleWorkflow),
  };
  const primaryTracking = trackingCodes[0];
  const advanced = statusTransitions.trackingAttached(
    'sale',
    { status: saleLegacyStatus, ...saleWorkflowData },
    primaryTracking,
  );
  if (advanced.legacy_status) saleLegacyStatus = advanced.legacy_status;
  saleWorkflowData = { ...saleWorkflowData, ...advanced.data };
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
        platform_id: conn.platform_id,
        quantity: qty,
        unit_price: Number(payout),
        sale_date: parseLocalDate(saleDate || purchaseDate) || new Date(),
        status: saleLegacyStatus,
        ...saleWorkflowData,
        tracking_number: primaryTracking,
      },
    });

    const updatedCommitment = await tx.cashoutCommitment.update({
      where: { id: commitment.id },
      data: {
        sale_id: createdSale.id,
        tracking_codes: trackingSubmitted ? trackingCodes : [],
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
  };
}

module.exports = { logPurchase };
