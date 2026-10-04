const { updateInventory, updateSale, createSale } = require('../validation/schemas');
const { requireOwned } = require('./ownership');
const statusTransitions = require('./statusTransitions');

const fail = (status, message) => Object.assign(new Error(message), { status });
const dateValue = value => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value) : null;

// Only copies fields the given schema actually declares, so a payload built
// from a wider object (e.g. a sale row that also carries an `id`) can't leak
// extra columns into the write. Money/int fields already arrive coerced by
// zod; dates and the boolish fields still need converting for Prisma.
function writable(data, schema) {
  const result = {};
  for (const key of Object.keys(schema.shape)) {
    if (data[key] === undefined) continue;
    result[key] = key.endsWith('_date') ? dateValue(data[key]) :
      ['tax_exempt', 'taxable', 'customer_tax_exempt'].includes(key) ? data[key] === true || data[key] === 'true' : data[key];
  }
  return result;
}

// Saves a purchase and its sales (plus, optionally, one new sale) in a single
// atomic write so a partial save can never leave quantities inconsistent
// across the batch.
async function editTransaction(prisma, inventoryId, userId, payload) {
  const existing = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!existing || existing.user_id !== userId) throw fail(404, 'Inventory not found or access denied');
  const ids = payload.sales.map(sale => sale.id);
  if (new Set(ids).size !== ids.length) throw fail(400, 'A sale can only appear once');
  await requireOwned('platform', payload.inventory.vendor_id, userId, 'Vendor');
  await requireOwned('paymentMethod', payload.inventory.payment_method_id, userId, 'Payment method');
  let newSalePlatform = null;
  for (const sale of [...payload.sales, ...(payload.newSale ? [payload.newSale] : [])]) {
    const ownedPlatform = await requireOwned('platform', sale.platform_id, userId, 'Sale platform');
    if (sale === payload.newSale) newSalePlatform = ownedPlatform;
    await requireOwned('buyer', sale.buyer_id, userId, 'Buyer');
  }
  return prisma.$transaction(async tx => {
    // Claim the inventory row before touching anything else, using the same
    // lock order as the standalone sale PUT/POST/DELETE routes, so a
    // concurrent edit elsewhere can't interleave with this batch.
    const claim = await tx.inventory.updateMany({
      where: { id: inventoryId, user_id: userId, qty_purchased: existing.qty_purchased, qty_on_hand: existing.qty_on_hand },
      data: { qty_on_hand: { increment: 0 } },
    });
    if (claim.count !== 1) throw fail(409, 'Inventory changed while saving. Reload and retry.');

    const sales = await tx.sales.findMany({ where: { inventory_id: inventoryId } });
    const byId = new Map(sales.map(sale => [sale.id, sale]));
    for (const sale of payload.sales) if (!byId.has(sale.id)) throw fail(404, 'Sale not found in this transaction');
    const changes = new Map(payload.sales.map(sale => [sale.id, sale]));
    const sold = sales.reduce((sum, sale) => sum + (changes.get(sale.id)?.quantity ?? sale.quantity), 0) + (payload.newSale?.quantity ?? 0);
    const purchased = payload.inventory.qty_purchased ?? existing.qty_purchased;
    if (sold > purchased) throw fail(400, 'Quantity purchased cannot be lower than units sold');
    if (payload.inventory.qty_on_hand !== undefined && payload.inventory.qty_on_hand !== purchased - sold) {
      throw fail(400, 'On-hand quantity must equal purchased quantity minus sold quantity');
    }

    const inventoryData = { ...writable(payload.inventory, updateInventory), qty_purchased: purchased, qty_on_hand: purchased - sold };
    if (existing.status?.toUpperCase().includes('PRE') && inventoryData.status === 'On Hand') inventoryData.received_date = new Date();
    await tx.inventory.update({ where: { id: inventoryId }, data: inventoryData });

    for (const sale of payload.sales) {
      const saleClaim = await tx.sales.updateMany({
        where: { id: sale.id, inventory_id: inventoryId, quantity: byId.get(sale.id).quantity },
        data: writable(sale, updateSale),
      });
      if (saleClaim.count !== 1) throw fail(409, 'Sale changed while saving. Reload and retry.');
    }
    if (payload.newSale) {
      // Mirrors routes/sales.js's POST handler: a sale created here (the
      // Transactions page's inline "mark as sold" edit) must get the same
      // workflow_type/workflow_status as one created through the dedicated
      // Record Sale form, or it silently drops out of every Statuses column.
      const workflow_type = statusTransitions.resolveSaleWorkflow(newSalePlatform && newSalePlatform.workflow_preset);
      let resolvedStatus = payload.newSale.status || 'SOLD';
      let workflowData = { workflow_type, workflow_status: statusTransitions.legacyWorkflowStatus(resolvedStatus, workflow_type) };
      if (!payload.newSale.status && payload.newSale.tracking_number) {
        const advanced = statusTransitions.trackingAttached(
          'sale',
          { status: resolvedStatus, quantity: payload.newSale.quantity ?? 1, ...workflowData },
          payload.newSale.tracking_number,
        );
        if (advanced.legacy_status) resolvedStatus = advanced.legacy_status;
        workflowData = { ...workflowData, ...advanced.data };
      }
      await tx.sales.create({
        data: {
          ...writable(payload.newSale, createSale),
          inventory_id: inventoryId,
          sale_date: dateValue(payload.newSale.sale_date) || new Date(),
          status: resolvedStatus,
          ...workflowData,
        },
      });
    }
    return tx.inventory.findUnique({ where: { id: inventoryId }, include: { sales: true, vendor: true, payment_method: true } });
  });
}

module.exports = { editTransaction };
