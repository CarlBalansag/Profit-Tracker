const { updateInventory, updateSale } = require('../validation/schemas');
const { currencyWrite } = require('./currencyWrite');
const { requireOwned } = require('./ownership');

const fail = (status, message) => Object.assign(new Error(message), { status });
const dateValue = value => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00.000Z` : value) : null;
function writable(data, schema) {
  const result = {};
  for (const key of Object.keys(schema.shape)) {
    if (data[key] === undefined) continue;
    result[key] = key.endsWith('_date') ? dateValue(data[key]) :
      ['tax_exempt', 'taxable', 'customer_tax_exempt'].includes(key) ? data[key] === true || data[key] === 'true' : data[key];
  }
  return result;
}

async function editTransaction(prisma, inventoryId, userId, payload) {
  const existing = await prisma.inventory.findUnique({ where: { id: inventoryId } });
  if (!existing || existing.user_id !== userId) throw fail(404, 'Inventory not found or access denied');
  const ids = payload.sales.map(sale => sale.id);
  if (new Set(ids).size !== ids.length) throw fail(400, 'A sale can only appear once');
  await requireOwned('platform', payload.inventory.vendor_id, userId, 'Vendor');
  await requireOwned('paymentMethod', payload.inventory.payment_method_id, userId, 'Payment method');
  for (const sale of payload.sales) {
    await requireOwned('platform', sale.platform_id, userId, 'Sale platform');
    await requireOwned('buyer', sale.buyer_id, userId, 'Buyer');
  }
  return prisma.$transaction(async tx => {
    const claim = await tx.inventory.updateMany({
      where: { id: inventoryId, user_id: userId, qty_purchased: existing.qty_purchased, qty_on_hand: existing.qty_on_hand },
      data: { qty_on_hand: { increment: 0 } },
    });
    if (claim.count !== 1) throw fail(409, 'Inventory changed while saving. Reload and retry.');
    const sales = await tx.sales.findMany({ where: { inventory_id: inventoryId } });
    const byId = new Map(sales.map(sale => [sale.id, sale]));
    for (const sale of payload.sales) if (!byId.has(sale.id)) throw fail(404, 'Sale not found in this transaction');
    const changes = new Map(payload.sales.map(sale => [sale.id, sale]));
    const sold = sales.reduce((sum, sale) => sum + (changes.get(sale.id)?.quantity ?? sale.quantity), 0);
    const purchased = payload.inventory.qty_purchased ?? existing.qty_purchased;
    if (sold > purchased) throw fail(400, 'Quantity purchased cannot be lower than units sold');
    if (payload.inventory.qty_on_hand !== undefined && payload.inventory.qty_on_hand !== purchased - sold) {
      throw fail(400, 'On-hand quantity must equal purchased quantity minus sold quantity');
    }
    const inventoryData = { ...writable(payload.inventory, updateInventory), qty_purchased: purchased, qty_on_hand: purchased - sold };
    if (existing.status?.toUpperCase().includes('PRE') && inventoryData.status === 'On Hand') inventoryData.received_date = new Date();
    await tx.inventory.update({ where: { id: inventoryId }, data: currencyWrite('Inventory', inventoryData) });
    for (const sale of payload.sales) {
      const claim = await tx.sales.updateMany({ where: { id: sale.id, inventory_id: inventoryId, quantity: byId.get(sale.id).quantity },
        data: currencyWrite('Sales', writable(sale, updateSale)) });
      if (claim.count !== 1) throw fail(409, 'Sale changed while saving. Reload and retry.');
    }
    return tx.inventory.findUnique({ where: { id: inventoryId }, include: { sales: true, vendor: true, payment_method: true } });
  });
}
module.exports = { editTransaction };
