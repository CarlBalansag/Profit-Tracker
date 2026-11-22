// Committing a purchase that Log Purchase saved before it shipped.
//
// Log Purchase with no tracking number writes the purchase and sale plus a
// "pending" CashoutCommitment row, and sends nothing to the provider. Once the
// sale gets a tracking number (Statuses, Shipping, an edit), the app asks
// whether to commit now. That confirm is the only thing that calls the
// provider: adding tracking never commits on its own.
//
// The commit uses the provider's payout at that moment, not the one from when
// the purchase was logged, and the sale's price follows it. If the deal has
// closed, nothing is committed and the row stays pending.
//
// Buying more of an item already committed: the provider keeps one commitment
// per item, so the first purchase to be committed creates it and each later
// one raises it by its own quantity. If the provider refuses (limit reached,
// deal closed), the purchase stays logged and pending, with a note saying so
// (commit_error) -- it can be tried again later.
const prisma = require('../../prisma');
const {
  connectionAndAdapter, commitWithProvider, recoverStuck, sendNewTracking,
  cleanTrackingCode, cleanInsuredValue, cleanQuantity,
  activeGroupFor, withItemLock, setProviderQuantity, refusedNote, isRefusal,
} = require('./commits');
const { fetchConnectionDeals } = require('./service');

const fail = (status, message) => Object.assign(new Error(message), { status });

async function loadPending(userId, commitmentId) {
  const record = await prisma.cashoutCommitment.findFirst({
    where: { id: commitmentId, user_id: userId },
    // The store account the purchase was bought on, for the commit prompt.
    include: { connection: true, sale: { include: { inventory: { include: { account: { select: { name: true } } } } } } },
  });
  if (!record) throw fail(404, 'Commitment not found or access denied');
  return record;
}

// The deal and item as the provider lists them now, or why they can't be used.
async function currentOffer(userId, record) {
  let deals;
  try {
    ({ deals } = await fetchConnectionDeals(userId, record.connection_id));
  } catch (err) {
    return { available: false, reason: `Couldn't load today's deals: ${err.message}` };
  }
  const deal = (deals || []).find((d) => String(d.id) === record.external_deal_id);
  const item = deal?.items?.find((i) => String(i.id) === record.external_item_id);
  if (!deal || !item) return { available: false, reason: 'This deal is no longer listed.' };
  const expired = deal.expiresAt && new Date(deal.expiresAt).getTime() <= Date.now();
  if (deal.status !== 'active' || expired) return { available: false, reason: 'This deal has closed.', deal, item };
  return { available: true, deal, item, payout: Number(deal.payout) || null };
}

// For the confirm screen: what would be committed, at what payout.
async function previewPending(userId, commitmentId) {
  let record = await loadPending(userId, commitmentId);
  if (record.status === 'committing') {
    await recoverStuck(userId, record);
    record = await loadPending(userId, commitmentId);
  }
  if (record.status !== 'pending') throw fail(409, 'This purchase has already been committed.');
  const offer = await currentOffer(userId, record);
  const group = await activeGroupFor(record.connection_id, record.external_item_id, { exceptId: record.id });
  return {
    id: record.id,
    // Already committed for this item: this purchase raises that commitment.
    adds_to: group ? { committed: group.total, new_total: group.total + record.quantity } : null,
    commit_error: record.commit_error || null,
    cashout: record.connection?.display_name || record.connection?.provider || 'the cashout',
    deal_name: offer.deal?.name || null,
    // EB's own name for the item it will commit to (it names the color), not
    // the purchase's product name, which can be edited.
    item_name: offer.item?.name || record.sale?.inventory?.product_name || null,
    quantity: record.quantity,
    account: record.sale?.inventory?.account?.name || null,
    tracking_number: record.sale?.tracking_number || null,
    logged_payout: record.sale ? Number(record.sale.unit_price) : null,
    current_payout: offer.available ? offer.payout : null,
    available: offer.available,
    reason: offer.available ? null : offer.reason,
  };
}

async function commitPending(userId, commitmentId, { insuredValue } = {}) {
  let record = await loadPending(userId, commitmentId);
  if (record.status === 'committing') {
    await recoverStuck(userId, record);
    record = await loadPending(userId, commitmentId);
  }
  if (record.status === 'committing') throw fail(409, 'This purchase is already being committed.');
  if (record.status !== 'pending') throw fail(409, 'This purchase has already been committed.');
  if (!record.sale) throw fail(409, 'The sale for this purchase was deleted, so there is nothing to commit.');
  if (!String(record.sale.tracking_number || '').trim()) throw fail(400, 'Add a tracking number to the sale before committing.');
  // Checked before anything is sent.
  const tracking = cleanTrackingCode(record.sale.tracking_number);
  const insured = cleanInsuredValue(insuredValue);
  const quantity = cleanQuantity(record.quantity);
  const cashout = record.connection?.display_name || record.connection?.provider || 'The cashout';

  const offer = await currentOffer(userId, record);
  if (!offer.available) {
    // A closed or delisted deal is kept on the purchase as its reason; a
    // failed lookup isn't (it may just be a blip).
    if (offer.deal || /no longer listed/.test(offer.reason)) {
      await prisma.cashoutCommitment.update({
        where: { id: record.id },
        data: { commit_error: `${offer.reason} This purchase is logged but not committed. Contact ${cashout} about these units, or move the sale to another cashout.` },
      });
    }
    throw fail(409, `${offer.reason} Nothing was committed; the sale stays marked not committed.`);
  }

  const ctx = await connectionAndAdapter(userId, record.connection_id);

  return withItemLock(record.connection_id, record.external_item_id, async () => {
    // Claim the row first, so a double click or a second tab can't commit twice.
    // updated_at is set so a crash mid-way can be told apart from a slow commit.
    const claim = await prisma.cashoutCommitment.updateMany({
      where: { id: record.id, user_id: userId, status: 'pending' },
      data: { status: 'committing', updated_at: new Date() },
    });
    if (claim.count !== 1) throw fail(409, 'This purchase is already being committed.');

    const group = await activeGroupFor(record.connection_id, record.external_item_id, { exceptId: record.id });
    let externalId;
    let ownQuantity = quantity;
    try {
      if (group) {
        // Raise the item's commitment by this purchase's units.
        await setProviderQuantity(userId, ctx, {
          externalId: group.externalId, total: group.total + quantity, commitmentId: record.id, action: 'raise',
        });
        externalId = group.externalId;
      } else {
        const { preview } = await commitWithProvider(userId, ctx, {
          dealId: record.external_deal_id, itemId: record.external_item_id, quantity, commitmentId: record.id,
        });
        externalId = preview.id;
        ownQuantity = preview.quantity ?? quantity;
      }
    } catch (err) {
      // No answer from the provider: the row stays "committing" (so nothing can
      // send it twice) until the provider is asked again and the row follows it.
      if (err.ambiguous) throw err;
      // The provider said no: kept as a pending purchase with the reason.
      const refused = err.refused || isRefusal(err);
      const note = refused ? refusedNote(cashout, quantity, err.message, { raise: Boolean(group) }) : null;
      await prisma.cashoutCommitment.update({
        where: { id: record.id },
        data: { status: 'pending', ...(note ? { commit_error: note } : {}) },
      });
      throw note ? Object.assign(fail(err.status || 409, note), { refused: true }) : err;
    }
    // The commitment is real on the provider's side from here, so it's saved
    // before anything else can fail. If this save fails, the row stays
    // "committing" and is settled from the provider's own record later.
    try {
      await prisma.cashoutCommitment.update({
        where: { id: record.id },
        data: { status: 'active', external_commitment_id: externalId, quantity: ownQuantity, commit_error: null },
      });
    } catch (err) {
      throw fail(500, `${ctx.conn.display_name || 'The cashout'} accepted the commit, but saving it here failed (${err.message}). It will show as committed once the app checks with ${ctx.conn.display_name || 'the cashout'} again; don't commit it a second time.`);
    }

    let trackingSubmitted = false;
    let trackingShared = false;
    let trackingError = null;
    try {
      // Same box as an item already committed: its tracking is already with the
      // cashout, so it isn't sent a second time.
      const sent = await sendNewTracking(userId, ctx, {
        codes: [tracking],
        description: `${offer.deal.name || 'Cashout deal'} x${quantity}`,
        insuredValue: insured,
        commitmentId: record.id,
      });
      trackingShared = sent.shared.length > 0;
      trackingSubmitted = true;
    } catch (err) {
      trackingError = err.message;
    }

    const payoutChanged = Boolean(offer.payout) && Number(record.sale.unit_price) !== offer.payout;
    const { commitment, sale } = await prisma.$transaction(async (tx) => ({
      commitment: await tx.cashoutCommitment.update({
        where: { id: record.id },
        data: {
          tracking_codes: trackingSubmitted ? [tracking] : [],
          tracking_submitted_at: trackingSubmitted ? new Date() : null,
          tracking_error: trackingError,
        },
      }),
      sale: payoutChanged
        ? await tx.sales.update({ where: { id: record.sale.id }, data: { unit_price: offer.payout } })
        : await tx.sales.findUnique({ where: { id: record.sale.id } }),
    }));

    return {
      commitment,
      sale,
      trackingSubmitted,
      trackingShared,
      trackingError,
      payout: offer.payout,
      previousPayout: payoutChanged ? Number(record.sale.unit_price) : null,
      // Added to a commitment the item already had: its new total.
      raisedTo: group ? group.total + quantity : null,
    };
  });
}

// For the sale routes: the pending commitment to offer, when a sale has just
// been given a tracking number and is still waiting to be committed.
async function pendingForSale(saleId) {
  const record = await prisma.cashoutCommitment.findFirst({ where: { sale_id: saleId, status: 'pending' } });
  return record ? { commitment_id: record.id } : null;
}

// For the purchase routes: a purchase that just got a tracking number, whose
// sale is still waiting to be committed and has no tracking of its own. The
// package may be shipping straight from the store to the cashout, or to the
// user first, so the client asks which before anything is copied or committed.
async function pendingForPurchase(inventoryId, trackingNumber) {
  const sales = await prisma.sales.findMany({ where: { inventory_id: inventoryId } });
  const untracked = sales.filter((s) => !s.tracking_number).map((s) => s.id);
  if (!untracked.length) return null;
  const record = await prisma.cashoutCommitment.findFirst({
    where: { sale_id: { in: untracked }, status: 'pending' },
    include: { connection: true },
  });
  if (!record) return null;
  return {
    commitment_id: record.id,
    ask_direct: {
      sale_id: record.sale_id,
      tracking_number: trackingNumber,
      cashout: record.connection?.display_name || record.connection?.provider || 'the cashout',
    },
  };
}

// A tracking number that is new or changed, or null.
const newTracking = (next, previous) => {
  const value = String(next || '').trim();
  return value && value !== String(previous || '').trim() ? value : null;
};

module.exports = { previewPending, commitPending, pendingForSale, pendingForPurchase, newTracking };
