// The Log Purchase action: commit to the cashout, submit tracking, then
// record the purchase and its sale locally -- in that order, because the
// first two are real calls to a third party and the last two are not.
const { dealEndOf } = require('./dealEnds');
const prisma = require('../../prisma');
const { requireOwned, requireStoreAccount } = require('../ownership');
const statusTransitions = require('../statusTransitions');
const { getConnection } = require('./service');
const commitsService = require('./commits');
const pendingCommit = require('./pendingCommit');
const { getAdapter } = require('./registry');
const activityLog = require('../activityLog');

const parseLocalDate = (str) => {
  if (!str) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T12:00:00.000Z`);
  return new Date(str);
};

// The purchase already logged for this order: the same deal item (EB, read
// through its commitment row) or, for cashouts with no commitment rows, the
// same product sold to the same cashout group. Order numbers compare without
// case. { purchaseId, saleId } or null.
async function findLoggedOrder(client, userId, { connectionId, recordOnly, dealId, itemId, orderNumber, productName, platformId }) {
  const sameOrder = { order_number: { equals: orderNumber, mode: 'insensitive' } };
  if (!recordOnly) {
    const row = await client.cashoutCommitment.findFirst({
      where: {
        user_id: userId, connection_id: connectionId, external_deal_id: String(dealId), external_item_id: String(itemId),
        sale: { inventory: sameOrder },
      },
      select: { sale: { select: { id: true, inventory_id: true } } },
    });
    return row?.sale ? { purchaseId: row.sale.inventory_id, saleId: row.sale.id } : null;
  }
  const purchases = await client.inventory.findMany({ where: { user_id: userId, product_name: productName, ...sameOrder }, select: { id: true } });
  if (!purchases.length) return null;
  const sale = await client.sales.findFirst({ where: { inventory_id: { in: purchases.map((p) => p.id) }, platform_id: platformId }, select: { id: true, inventory_id: true } });
  return sale ? { purchaseId: sale.inventory_id, saleId: sale.id } : null;
}

async function refuseLoggedOrder(client, userId, lookup) {
  const found = await findLoggedOrder(client, userId, lookup);
  if (found) {
    throw Object.assign(new Error(
      `Order ${lookup.orderNumber} is already logged for this item (purchase ${found.purchaseId}, sale ${found.saleId}). Nothing was logged again.`,
    ), { status: 409, duplicate: found });
  }
}

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
 * If the commit succeeds but writing the purchase and sale fails, the error
 * says the commit went through. Logging the same item again with the same
 * quantity then finds that commitment (it has no sale yet) and records the
 * purchase against it, without committing a second time.
 *
 * With no tracking number yet, an EB purchase skips steps 1 and 2 too: the
 * purchase and sale are written, plus a "pending" commitment row holding the
 * deal, item and quantity. Nothing is sent to EB. Adding a tracking number to
 * that sale later offers to commit then (see pendingCommit.js), at EB's payout
 * at that moment.
 *
 * Cashouts we can't commit to yet (LA, Points4Days) skip steps 1 and 2: this
 * only writes the purchase and sale, and the user commits and sends tracking on
 * the cashout's own website. A tracking number is optional; when given it's
 * saved on the sale only, never sent anywhere. No commitment row is made, since
 * nothing was committed here.
 *
 * The sale goes to the connection's linked cashout group, or to `platformId`
 * when the form picks one (a connection with no group linked yet).
 *
 * An order number is saved on the purchase, and the same order for the same
 * deal item (see findLoggedOrder) is refused before anything is sent.
 */
async function logPurchase(userId, {
  connectionId, dealId, itemId, dealName, itemName,
  quantity, trackingCodes, insuredValue,
  vendorId, accountId, paymentMethodId, unitCost, taxExempt, salesTax,
  cashbackRate, cashbackEarned, purchaseDate,
  unitPayout, saleDate, platformId, orderNumber,
  // Set (e.g. 'assistant') to log the purchase, sale and pending commitment as
  // one undoable Activity entry; the result then carries `activity`.
  activitySource,
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
  let codes = Array.isArray(trackingCodes)
    ? trackingCodes.map((code) => String(code || '').trim()).filter(Boolean)
    : [];
  let insured;
  if (!recordOnly) {
    // Everything that would be sent is checked before anything is saved or sent.
    commitsService.cleanItemId(itemId);
    commitsService.cleanQuantity(qty);
    if (codes.length) codes = commitsService.cleanTrackingCodes(codes);
    insured = commitsService.cleanInsuredValue(insuredValue);
  }
  // EB with no tracking number: record now, commit once it ships.
  const deferCommit = !recordOnly && codes.length === 0;
  const order = String(orderNumber ?? '').trim() || null;
  if (order && order.length > 100) throw Object.assign(new Error('Order number is too long.'), { status: 400 });
  const productName = itemName || dealName || 'Cashout deal';

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
  await requireStoreAccount(accountId, vendorId, userId);
  await requireOwned('paymentMethod', paymentMethodId, userId, 'Payment method');

  // The same order logged twice is refused before anything is sent anywhere,
  // and checked again under a lock when the books are written.
  const orderLookup = order && {
    connectionId: conn.id, recordOnly, dealId, itemId, orderNumber: order, productName, platformId: salePlatform.id,
  };
  if (order) await refuseLoggedOrder(prisma, userId, orderLookup);

  // An active commitment for this item with no purchase recorded yet (made
  // through MCP, or an earlier Log Purchase whose save failed after the commit
  // went through) is used as is: nothing is committed a second time.
  let attachTo = null;
  // Buying more of an item that already has purchases logged or committed:
  // this purchase is saved first as its own pending row, then committed the
  // same way adding a tracking number later does (it raises the provider's
  // one commitment for the item, or creates it if none is committed yet).
  let topUp = false;
  // When the deal ends, saved on a pending row so To-Do can warn before it.
  let dealEnd = null;
  if (!recordOnly) {
    // A withdrawn commitment doesn't count -- its open_item_id is null.
    const open = await prisma.cashoutCommitment.findMany({ where: { connection_id: conn.id, open_item_id: String(itemId) } });
    for (const row of open.filter((r) => r.status === 'committing')) await commitsService.recoverStuck(userId, row);
    const settled = open.length
      ? await prisma.cashoutCommitment.findMany({ where: { connection_id: conn.id, open_item_id: String(itemId) } })
      : [];
    // A commitment made without a purchase (through MCP, or an earlier Log
    // Purchase whose save failed after the commit went through) is used as is:
    // nothing is committed a second time.
    const unattached = settled.find((r) => r.status === 'active' && !r.sale_id);
    if (unattached && unattached.quantity === Number(qty)) {
      attachTo = unattached;
    } else if (unattached) {
      throw Object.assign(new Error(`You already have a commitment for this item for ${unattached.quantity}, with no purchase logged. Log Purchase with quantity ${unattached.quantity} to record it, or change the commitment's quantity first.`), { status: 409 });
    } else if (settled.length) {
      topUp = true;
    }
    // The item has to be part of this deal, and the deal still open.
    if (!attachTo) dealEnd = dealEndOf((await commitsService.requireLiveItem(userId, conn.id, dealId, itemId)).deal);
  }

  let commitment = attachTo;
  let trackingSubmitted = false;
  let trackingShared = false;
  let trackingError = null;
  if (!recordOnly && !topUp && (!deferCommit || attachTo)) {
    // Step 1: commit with EB. Left to throw straight through -- a failure here
    // (deal closed, already committed, over the limit) means nothing below runs.
    if (!attachTo) {
      commitment = await commitsService.createCommitment(userId, connectionId, {
        dealId, itemId, quantity: qty,
      });
    }

    // Step 2: submit tracking. A failure here is caught, not thrown -- see the
    // doc comment above for why the purchase still gets written either way.
    // A code already sent with another commitment (two items in one box) is
    // not sent again; only the new ones go.
    if (codes.length) {
      try {
        const ctx = await commitsService.connectionAndAdapter(userId, connectionId);
        const sent = await commitsService.sendNewTracking(userId, ctx, {
          codes, description: `${dealName || 'Cashout deal'} x${qty}`, insuredValue: insured, commitmentId: commitment.id,
        });
        trackingShared = sent.shared.length > 0;
        trackingSubmitted = true;
      } catch (err) {
        trackingError = err.message;
      }
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

  const writeBooks = async (tx) => {
    const createdInventory = await tx.inventory.create({
      data: {
        user_id: userId,
        product_name: productName,
        order_number: order,
        vendor_id: vendorId,
        account_id: accountId || null,
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

    if ((deferCommit || topUp) && !attachTo) {
      const pending = await tx.cashoutCommitment.create({
        data: {
          user_id: userId,
          connection_id: conn.id,
          sale_id: createdSale.id,
          external_deal_id: String(dealId),
          external_item_id: String(itemId),
          open_item_id: String(itemId),
          external_commitment_id: null,
          quantity: Number(qty),
          status: 'pending',
          deal_expires_at: dealEnd,
        },
      });
      return { inventory: createdInventory, sale: createdSale, commitment: pending };
    }

    const updatedCommitment = commitment && await tx.cashoutCommitment.update({
      where: { id: commitment.id },
      data: {
        sale_id: createdSale.id,
        // Attaching with no new number keeps what the commitment already had.
        tracking_codes: trackingSubmitted ? [...new Set([...(attachTo?.tracking_codes || []), ...codes])] : (attachTo?.tracking_codes || []),
        tracking_submitted_at: trackingSubmitted ? new Date() : (attachTo?.tracking_submitted_at || null),
        tracking_error: trackingError,
      },
    });

    return { inventory: createdInventory, sale: createdSale, commitment: updatedCommitment };
  };

  let books;
  try {
  books = await prisma.$transaction(async (tx) => {
    if (order) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashout-order:${userId}:${order.toLowerCase()}`}))`;
      await refuseLoggedOrder(tx, userId, orderLookup);
    }
    if (!activitySource) return { ...(await writeBooks(tx)), activity: null };
    // An add: undo removes the purchase, the sale and a pending commitment. A
    // commitment already made with the provider is only unlinked (it stays
    // committed there).
    const { result, activity } = await activityLog.trackChange(tx, userId, {
      action: 'create',
      recordType: 'purchase',
      source: activitySource,
      recordId: (made) => made.inventory.id,
      refs: async (t, made) => {
        if (!made) return commitment ? { cashoutCommitment: [commitment.id] } : {};
        return {
          inventory: [made.inventory.id],
          sales: [made.sale.id],
          ...(made.commitment ? { cashoutCommitment: [made.commitment.id] } : {}),
        };
      },
    }, () => writeBooks(tx));
    return { ...result, activity };
  });
  } catch (err) {
    if (!commitment) throw err;
    // The commit (and maybe the tracking) already went to the cashout. Keep
    // what was sent on the commitment, and say plainly what happened.
    await prisma.cashoutCommitment.update({
      where: { id: commitment.id },
      data: {
        ...(trackingSubmitted ? { tracking_codes: codes, tracking_submitted_at: new Date() } : {}),
        tracking_error: trackingError,
      },
    }).catch(() => null);
    throw Object.assign(new Error(
      `Committed to ${conn.display_name || 'the cashout'}${trackingSubmitted ? ' and tracking sent' : ''}, but saving the purchase here failed (${err.message}). `
      + 'Log Purchase again for this item with the same quantity: it will record it against that commitment without committing twice.',
    ), { status: 500, committed: true });
  }
  const { inventory, sale, commitment: updatedCommitment, activity } = books;

  // More of an item already committed (or logged), with tracking in hand:
  // commit it now through the same path as adding tracking later. The
  // purchase is already saved, so a refusal leaves it logged and flagged.
  if (topUp && !deferCommit) {
    try {
      // The sale holds one tracking number; any others for this purchase go too.
      const done = await pendingCommit.commitPending(userId, updatedCommitment.id, { insuredValue, extraTrackingCodes: codes.slice(1) });
      return {
        activity,
        inventory,
        sale: done.sale,
        commitment: done.commitment,
        trackingSubmitted: done.trackingSubmitted,
        trackingShared: done.trackingShared,
        trackingError: done.trackingError,
        recordedOnly: false,
        commitPending: false,
        addedTo: done.raisedTo,
      };
    } catch (err) {
      const kept = await prisma.cashoutCommitment.findFirst({ where: { id: updatedCommitment.id } });
      return {
        activity,
        inventory,
        sale,
        commitment: kept,
        trackingSubmitted: false,
        trackingShared: false,
        trackingError: null,
        recordedOnly: false,
        commitPending: kept?.status !== 'active',
        commitError: err.message,
      };
    }
  }

  return {
    activity,
    inventory,
    sale,
    commitment: updatedCommitment,
    trackingSubmitted,
    trackingShared,
    trackingError,
    recordedOnly: recordOnly,
    commitPending: deferCommit || topUp,
    addsToCommitment: topUp,
  };
}

module.exports = { logPurchase, findLoggedOrder };
