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
const prisma = require('../../prisma');
const { connectionAndAdapter, trackingAlreadySent } = require('./commits');
const { fetchConnectionDeals } = require('./service');

const fail = (status, message) => Object.assign(new Error(message), { status });

async function loadPending(userId, commitmentId) {
  const record = await prisma.cashoutCommitment.findFirst({
    where: { id: commitmentId, user_id: userId },
    include: { connection: true, sale: { include: { inventory: true } } },
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
  const record = await loadPending(userId, commitmentId);
  if (record.status !== 'pending') throw fail(409, 'This purchase has already been committed.');
  const offer = await currentOffer(userId, record);
  return {
    id: record.id,
    cashout: record.connection?.display_name || record.connection?.provider || 'the cashout',
    deal_name: offer.deal?.name || null,
    item_name: record.sale?.inventory?.product_name || offer.item?.name || null,
    quantity: record.quantity,
    tracking_number: record.sale?.tracking_number || null,
    logged_payout: record.sale ? Number(record.sale.unit_price) : null,
    current_payout: offer.available ? offer.payout : null,
    available: offer.available,
    reason: offer.available ? null : offer.reason,
  };
}

async function commitPending(userId, commitmentId, { insuredValue } = {}) {
  const record = await loadPending(userId, commitmentId);
  if (record.status !== 'pending') throw fail(409, 'This purchase has already been committed.');
  if (!record.sale) throw fail(409, 'The sale for this purchase was deleted, so there is nothing to commit.');
  const tracking = String(record.sale.tracking_number || '').trim();
  if (!tracking) throw fail(400, 'Add a tracking number to the sale before committing.');

  const offer = await currentOffer(userId, record);
  if (!offer.available) throw fail(409, `${offer.reason} Nothing was committed; the sale stays marked not committed.`);

  const { adapter, rawKey } = await connectionAndAdapter(userId, record.connection_id);

  // Claim the row first, so a double click or a second tab can't commit twice.
  const claim = await prisma.cashoutCommitment.updateMany({
    where: { id: record.id, user_id: userId, status: 'pending' },
    data: { status: 'committing' },
  });
  if (claim.count !== 1) throw fail(409, 'This purchase is already being committed.');

  let preview;
  try {
    preview = await adapter.createCommit(rawKey, { itemId: Number(record.external_item_id), quantity: record.quantity });
  } catch (err) {
    await prisma.cashoutCommitment.update({ where: { id: record.id }, data: { status: 'pending' } });
    throw err;
  }
  // The commitment is real on the provider's side from here, so it's saved
  // before anything else can fail.
  await prisma.cashoutCommitment.update({
    where: { id: record.id },
    data: { status: 'active', external_commitment_id: preview.id, quantity: preview.quantity ?? record.quantity },
  });

  let trackingSubmitted = false;
  let trackingShared = false;
  let trackingError = null;
  try {
    // Same box as an item already committed: its tracking is already with the
    // cashout, so it isn't sent a second time.
    trackingShared = (await trackingAlreadySent(userId, record.connection_id, [tracking])).length > 0;
    if (!trackingShared) {
      await adapter.submitTracking(rawKey, {
        trackingCodes: [tracking],
        description: `${offer.deal.name || 'Cashout deal'} x${record.quantity}`.slice(0, 200),
        ...(insuredValue !== undefined && insuredValue !== null && insuredValue !== '' ? { insuredValue: Number(insuredValue) } : {}),
      });
    }
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
  };
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
