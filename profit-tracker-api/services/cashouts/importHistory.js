// Past cashout imports (Settings > Data > Import from cashouts > Past imports).
// Each import (services/cashouts/importSold.js commit) writes one ImportBatch,
// and every purchase it created points back to it. Here: list them, show what
// one added (what's still there, counted live), and undo one, which deletes
// every purchase it added that's still there, with its sales, in one
// transaction and one Activity entry, so Activity's Undo puts it all back.
const prisma = require('../../prisma');
const activityLog = require('../activityLog');
const { SOURCES, COST_NEEDED_NOTE } = require('./importSold');

const LIST_LIMIT = 50;
const notFound = () => Object.assign(new Error('Import not found'), { status: 404 });
const num = (v) => (v === null || v === undefined ? null : Number(v));

function batchJson(b, remaining) {
  return {
    id: b.id,
    source: b.source,
    sourceName: SOURCES[b.source] || b.source,
    cashoutId: b.platform_id,
    cashoutName: b.platform?.name || null,
    fileName: b.file_name,
    createdAt: b.created_at.toISOString(),
    purchases: b.purchases,
    units: b.units,
    payout: num(b.payout),
    costNeeded: b.cost_needed,
    remaining,
  };
}

async function list(userId) {
  const batches = await prisma.importBatch.findMany({
    where: { user_id: userId },
    orderBy: { created_at: 'desc' },
    take: LIST_LIMIT,
    include: { platform: { select: { name: true } } },
  });
  const counts = batches.length
    ? await prisma.inventory.groupBy({
      by: ['import_batch_id'],
      where: { user_id: userId, import_batch_id: { in: batches.map((b) => b.id) } },
      _count: { _all: true },
    })
    : [];
  const left = new Map(counts.map((c) => [c.import_batch_id, c._count._all]));
  return batches.map((b) => batchJson(b, left.get(b.id) || 0));
}

async function ownedBatch(userId, id, client = prisma) {
  if (typeof id !== 'string' || !id) throw notFound();
  const batch = await client.importBatch.findFirst({
    where: { id, user_id: userId },
    include: { platform: { select: { name: true } } },
  });
  if (!batch) throw notFound();
  return batch;
}

async function detail(userId, id) {
  const batch = await ownedBatch(userId, id);
  const rows = await prisma.inventory.findMany({
    where: { user_id: userId, import_batch_id: batch.id },
    orderBy: [{ purchase_date: 'desc' }, { product_name: 'asc' }],
    include: {
      vendor: { select: { name: true } },
      account: { select: { name: true } },
      payment_method: { select: { name: true } },
      sales: { orderBy: { sale_date: 'asc' }, include: { platform: { select: { name: true } } } },
    },
  });
  const purchases = rows.map((r) => ({
    id: r.id,
    name: r.product_name,
    purchaseDate: r.purchase_date.toISOString(),
    qty: r.qty_purchased,
    unitCost: num(r.unit_purchase_cost),
    salesTax: num(r.sales_tax) || 0,
    shipping: num(r.shipping_cost_inbound) || 0,
    // Still waiting for its price: the import's note, and a cost nobody has filled in.
    costNeeded: (r.notes || '').includes(COST_NEEDED_NOTE) && !Number(r.unit_purchase_cost),
    orderNumber: r.order_number,
    store: r.vendor?.name || null,
    account: r.account?.name || null,
    card: r.payment_method?.name || null,
    sales: r.sales.map((s) => ({
      id: s.id,
      qty: s.quantity,
      unitPrice: num(s.unit_price),
      fee: num(s.commission_fee) || 0,
      date: s.sale_date.toISOString(),
      status: s.workflow_status || s.status,
      cashout: s.platform?.name || null,
    })),
  }));
  return { ...batchJson(batch, purchases.length), purchases };
}

// Deletes everything the import added that's still there. Rows edited since
// go too: the import is being thrown away. Activity can put it all back.
async function undo(userId, id, { source = 'web' } = {}) {
  return prisma.$transaction(async (tx) => {
    // The same lock the import takes, so an undo never races an import.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashout-import:${userId}`}))`;
    const batch = await ownedBatch(userId, id, tx);
    await tx.$queryRaw`SELECT id FROM "Inventory" WHERE import_batch_id = ${batch.id} AND user_id = ${userId} FOR UPDATE`;
    const ids = (await tx.inventory.findMany({ where: { user_id: userId, import_batch_id: batch.id }, select: { id: true } })).map((r) => r.id);
    if (!ids.length) throw Object.assign(new Error('Everything from this import is already gone.'), { status: 409 });
    const idsOf = async (model, where) => (await tx[model].findMany({ where, select: { id: true } })).map((r) => r.id);
    const saleIds = await idsOf('sales', { inventory_id: { in: ids } });
    const refundIds = await idsOf('refund', { OR: [{ inventory_id: { in: ids } }, { sale_id: { in: saleIds } }] });
    const commitmentIds = await idsOf('cashoutCommitment', { sale_id: { in: saleIds } });

    const label = SOURCES[batch.source] || batch.source;
    // Sales and refunds go with their purchase (ON DELETE CASCADE); a cashout
    // commitment stays and loses its sale link (SET NULL), as a single delete
    // does. trackChange logs each as what happened to it.
    const { activity } = await activityLog.trackChange(tx, userId, {
      action: 'delete',
      recordType: 'purchase',
      recordId: ids[0],
      productName: `${label} import (${ids.length} purchase${ids.length === 1 ? '' : 's'})`,
      source,
      refs: () => ({ inventory: ids, sales: saleIds, refund: refundIds, cashoutCommitment: commitmentIds }),
    }, () => tx.inventory.deleteMany({ where: { id: { in: ids }, user_id: userId } }));
    return { removed: ids.length, sales: saleIds.length, activity_id: activity?.id ?? null };
  }, { timeout: 120000, maxWait: 10000 });
}

module.exports = { list, detail, undo, LIST_LIMIT };
