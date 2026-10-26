// MCP server for the reselling profit tracker. Stateless Streamable HTTP: a
// fresh McpServer + transport per request (no server-held session), which is
// what makes this safe to run on an instance that can restart/scale without
// losing in-flight session state. Auth is middleware/apiKeyAuth.js, mounted
// ahead of this router in index.js -- req.user/req.apiKeyId are already set
// by the time any of this runs.
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const prisma = require('../prisma');
const { decimal } = require('../services/money');
const { saleEconomics, allocatedCost, batchCost, isRealizedSale } = require('../services/decimalFinance');
const { payoutStatus } = require('../services/payoutStatus');
const { markSalesPaid } = require('../services/markSalesPaid');
const statusTransitions = require('../services/statusTransitions');
const { detectCarrier } = require('../services/tracking');
const { computeCardDashboard, nextDueDate } = require('../services/cardNetToPay');

const toDateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toNum = (d) => (d === null || d === undefined ? 0 : (typeof d.toNumber === 'function' ? d.toNumber() : Number(d)));
const localNoon = (dateStr) => new Date(`${dateStr}T12:00:00.000Z`);

// Resolution order for a shipment's carrier: a manual/MCP-set override wins,
// then the carrier the last live tracking check actually confirmed, then a
// best-effort guess from the tracking number's format. Shared by list_sales,
// list_inventory, and list_shipments so all three agree.
function resolveCarrier(storedCarrier, trackingNumber, trackingInfo) {
  if (storedCarrier) return storedCarrier;
  if (trackingInfo && trackingInfo.carrier) return trackingInfo.carrier;
  return detectCarrier(trackingNumber) || null;
}

// Mirrors the "adding a tracking number for the first time is the
// add_tracking/add_outbound_tracking business action" gate + auto-advance
// that routes/inventory.js and routes/sales.js apply on their own PUT routes
// (see the comments there), so an edit made through the MCP server enforces
// the exact same invariant: a purchase/sale already past the shipping stage
// cannot silently be set back to "awaiting a tracking number" by clearing and
// re-adding one through a different endpoint. `explicitStatusProvided` skips
// the auto-advance (never overrides a status the caller set in the same
// call) but never skips the gate itself.
function trackingGateAndAdvance(kind, existing, trackingNumber, explicitStatusProvided) {
  const data = {};
  if (trackingNumber === undefined) return data;
  const trimmed = trackingNumber === null ? '' : String(trackingNumber).trim();
  const currentStatus = kind === 'inventory' ? existing.receiving_status : existing.workflow_status;
  const action = kind === 'inventory' ? 'add_tracking' : 'add_outbound_tracking';
  if (trimmed && !existing.tracking_number && currentStatus && !statusTransitions.isActionAllowed(existing, kind, action)) {
    throw Object.assign(new Error(
      kind === 'inventory'
        ? 'A tracking number cannot be added to a purchase that has already been received'
        : 'A tracking number cannot be added to a sale that is not awaiting shipment'
    ), { toolError: true });
  }
  if (!explicitStatusProvided && trimmed && !existing.tracking_number) {
    const advanced = statusTransitions.trackingAttached(kind, existing, trimmed);
    Object.assign(data, advanced.data);
    const statusField = kind === 'inventory' ? 'receiving_status' : 'workflow_status';
    if (advanced.data[statusField]) data[`${statusField}_changed_at`] = new Date();
  }
  return data;
}

// Rejects a syntactically-plausible but non-existent date (e.g. 2026-02-30),
// not just the YYYY-MM-DD shape -- same check validation/schemas.js's
// calendarDate uses, reimplemented here since that one isn't exported.
const strictDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}, 'date must be a real calendar date');

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
// Validation/ownership/not-found failures surface as a normal (non-protocol)
// tool error, so the assistant sees the message and can react to it instead
// of the call just failing outright.
function errorResult(message) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

async function logWrite(userId, apiKeyId, tool, payload) {
  try {
    await prisma.mcpWriteLog.create({ data: { user_id: userId, api_key_id: apiKeyId || null, tool, payload } });
  } catch (err) {
    // A logging failure must never take down an otherwise-successful write.
    console.error('[mcp-write-log] failed to record write:', err.message);
  }
}

async function findOrCreateVendor(userId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw Object.assign(new Error('store is required'), { toolError: true });
  const existing = await prisma.platform.findFirst({
    where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  return prisma.platform.create({ data: { user_id: userId, name: trimmed, type: 'Vendor', fee_pct: 0 } });
}

// Payment methods are never auto-created -- their cashback rate/credit limit
// configuration shouldn't be guessed on the AI's behalf.
async function findPaymentMethod(userId, name) {
  const trimmed = String(name || '').trim();
  const existing = await prisma.paymentMethod.findFirst({
    where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  const all = await prisma.paymentMethod.findMany({ where: { user_id: userId }, select: { name: true } });
  const names = all.map((m) => m.name).join(', ') || '(none set up yet)';
  throw Object.assign(new Error(`No payment method named "${trimmed}". Existing methods: ${names}`), { toolError: true });
}

// Platforms (a sale's buyer) are never auto-created by update_sale/add_sale --
// unlike a purchase's vendor, picking the wrong existing marketplace/cashout
// by typo would misattribute a sale's payout, so the caller must name one
// that already exists. `client` lets this run inside a transaction.
async function findPlatformByName(userId, name, client = prisma) {
  const trimmed = String(name || '').trim();
  if (!trimmed) throw Object.assign(new Error('platform is required'), { toolError: true });
  const existing = await client.platform.findFirst({
    where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } },
  });
  if (existing) return existing;
  const all = await client.platform.findMany({ where: { user_id: userId }, select: { name: true, type: true } });
  const names = all.map((p) => `${p.name} (${p.type})`).join(', ') || '(none set up yet)';
  throw Object.assign(new Error(`No platform named "${trimmed}". Existing: ${names}`), { toolError: true });
}

// Records one ChangeLog row per changed field. `client` is the transaction
// client the caller is already inside, so this commits/rolls back with it.
async function recordChanges(client, userId, tableName, recordId, changes) {
  if (!changes.length) return;
  const now = new Date();
  await client.changeLog.createMany({
    data: changes.map(({ field, oldValue, newValue }) => ({
      user_id: userId,
      table_name: tableName,
      record_id: recordId,
      field,
      old_value: oldValue === null || oldValue === undefined ? null : String(oldValue),
      new_value: newValue === null || newValue === undefined ? null : String(newValue),
      source: 'mcp',
      created_at: now,
    })),
  });
}

// Shared response shape for update_shipment, for both kinds.
function shipmentResult(direction, record, itemName) {
  const status = direction === 'inbound' ? (record.receiving_status || record.status) : (record.workflow_status || record.status);
  const statusChangedAt = direction === 'inbound' ? record.receiving_status_changed_at : record.workflow_status_changed_at;
  return {
    id: record.id,
    direction,
    item: itemName,
    tracking_number: record.tracking_number || null,
    carrier: resolveCarrier(record.carrier, record.tracking_number, record.tracking_info),
    status,
    last_updated: toDateOnly(record.tracking_info?.checkedAt || statusChangedAt),
  };
}

// update_shipment's inbound (Inventory) branch: same tracking gate/auto-advance
// as update_purchase, plus an optional direct receiving-status correction
// (validated the same way statusTransitions' correct_status action validates
// one, but written here as a plain guarded update rather than going through
// applyTransition, since this tool is a direct field correction, not a
// one-click business action with side effects like restoring quantity).
async function updateInventoryShipment(tx, userId, existing, { tracking_number, carrier, status }) {
  const data = {};
  const changes = [];

  if (tracking_number !== undefined) {
    const newTracking = tracking_number || null;
    const advance = trackingGateAndAdvance('inventory', existing, tracking_number, status !== undefined);
    Object.assign(data, advance);
    if (advance.receiving_status) changes.push({ field: 'receiving_status', oldValue: existing.receiving_status, newValue: advance.receiving_status });
    if (newTracking !== existing.tracking_number) { data.tracking_number = newTracking; changes.push({ field: 'tracking_number', oldValue: existing.tracking_number, newValue: newTracking }); }
  }
  if (carrier !== undefined) {
    const newCarrier = carrier || null;
    if (newCarrier !== existing.carrier) { data.carrier = newCarrier; changes.push({ field: 'carrier', oldValue: existing.carrier, newValue: newCarrier }); }
  }
  if (status !== undefined) {
    const normalized = String(status).trim().toUpperCase();
    if (!statusTransitions.INVENTORY_RECEIVING_STATUSES.includes(normalized)) {
      throw Object.assign(new Error(`Invalid receiving status. Must be one of: ${statusTransitions.INVENTORY_RECEIVING_STATUSES.join(', ')}`), { toolError: true });
    }
    if (normalized !== existing.receiving_status) {
      data.receiving_status = normalized;
      data.receiving_status_changed_at = new Date();
      changes.push({ field: 'receiving_status', oldValue: existing.receiving_status, newValue: normalized });
    }
  }

  if (Object.keys(data).length === 0) return shipmentResult('inbound', existing, existing.product_name);

  const claim = await tx.inventory.updateMany({
    where: { id: existing.id, user_id: userId, receiving_status: existing.receiving_status ?? null },
    data,
  });
  if (claim.count !== 1) throw Object.assign(new Error('Purchase changed while saving. Reload and retry.'), { status: 409 });

  await recordChanges(tx, userId, 'Inventory', existing.id, changes);
  const updated = await tx.inventory.findUnique({ where: { id: existing.id } });
  return shipmentResult('inbound', updated, updated.product_name);
}

// update_shipment's outbound (Sales) branch, same reasoning as the inventory
// branch above. A valid status is validated against this sale's own workflow
// path plus the shared exception statuses -- same set correct_status checks --
// and the legacy status column is dual-written for the three exception
// statuses so isRealizedSale (which also checks the legacy column) and any
// legacy-reading screen agree immediately, same as applyTransition's
// correct_status does.
async function updateSaleShipment(tx, userId, existing, { tracking_number, carrier, status }) {
  const data = {};
  const changes = [];

  if (tracking_number !== undefined) {
    const newTracking = tracking_number || null;
    const advance = trackingGateAndAdvance('sale', existing, tracking_number, status !== undefined);
    Object.assign(data, advance);
    if (advance.workflow_status) changes.push({ field: 'workflow_status', oldValue: existing.workflow_status, newValue: advance.workflow_status });
    if (newTracking !== existing.tracking_number) { data.tracking_number = newTracking; changes.push({ field: 'tracking_number', oldValue: existing.tracking_number, newValue: newTracking }); }
  }
  if (carrier !== undefined) {
    const newCarrier = carrier || null;
    if (newCarrier !== existing.carrier) { data.carrier = newCarrier; changes.push({ field: 'carrier', oldValue: existing.carrier, newValue: newCarrier }); }
  }
  if (status !== undefined) {
    const normalized = String(status).trim().toUpperCase();
    const workflow = statusTransitions.resolveSaleWorkflow(existing.workflow_type);
    const valid = [...statusTransitions.SALE_STATUSES_BY_WORKFLOW[workflow], ...statusTransitions.SALE_EXCEPTION_STATUSES];
    if (!valid.includes(normalized)) {
      throw Object.assign(new Error(`Invalid status for this sale's workflow. Must be one of: ${valid.join(', ')}`), { toolError: true });
    }
    if (normalized !== existing.workflow_status) {
      data.workflow_status = normalized;
      data.workflow_status_changed_at = new Date();
      Object.assign(data, statusTransitions.legacySaleStatusPatch(normalized));
      changes.push({ field: 'workflow_status', oldValue: existing.workflow_status, newValue: normalized });
    }
  }

  if (Object.keys(data).length === 0) return shipmentResult('outbound', existing, existing.inventory.product_name);

  const claim = await tx.sales.updateMany({
    where: { id: existing.id, workflow_status: existing.workflow_status ?? null, inventory: { user_id: userId } },
    data,
  });
  if (claim.count !== 1) throw Object.assign(new Error('Sale changed while saving. Reload and retry.'), { status: 409 });

  await recordChanges(tx, userId, 'Sales', existing.id, changes);
  const updated = await tx.sales.findUnique({ where: { id: existing.id } });
  return shipmentResult('outbound', updated, existing.inventory.product_name);
}

function buildServer(userId, apiKeyId) {
  const server = new McpServer({ name: 'profit-tracker', version: '1.0.0' }, { capabilities: {} });

  // ------------------------------------------------------------------ reads

  server.registerTool('list_sales', {
    description: 'List sales with optional filters. Dates are YYYY-MM-DD. "buyer" is the marketplace/cashout the sale went through (e.g. eBay, Windy City) -- the same platform picked when the sale was recorded, not a separate contact.',
    inputSchema: {
      start_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
      end_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
      buyer: z.string().optional().describe('Filter by the sale\'s marketplace/cashout name (case-insensitive, partial match)'),
      payout_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
      limit: z.number().int().min(1).max(500).optional().describe('Omit to return every matching sale.'),
    },
  }, async ({ start_date, end_date, buyer, payout_status: payoutFilter, limit }) => {
    const where = { inventory: { user_id: userId } };
    if (start_date || end_date) {
      where.sale_date = {};
      if (start_date) where.sale_date.gte = localNoon(start_date);
      if (end_date) where.sale_date.lte = localNoon(end_date);
    }
    const sales = await prisma.sales.findMany({
      where,
      include: { inventory: { include: { vendor: true } }, platform: true },
      orderBy: { sale_date: 'desc' },
      ...(limit ? { take: limit } : {}),
    });
    const filtered = sales.filter((s) => {
      if (buyer && !(s.platform?.name || '').toLowerCase().includes(buyer.toLowerCase())) return false;
      if (payoutFilter && payoutStatus(s) !== payoutFilter) return false;
      return true;
    });
    return jsonResult(filtered.map((s) => {
      const { revenue, cost } = saleEconomics(s.inventory, s);
      return {
        id: s.id,
        item: s.inventory.product_name,
        qty: s.quantity,
        sale_date: toDateOnly(s.sale_date),
        buyer: s.platform?.name || null,
        buyer_type: s.platform?.type || null,
        store_bought: s.inventory.vendor?.name || null,
        cost: toNum(cost.toDecimalPlaces(2)),
        sale_amount: toNum(decimal(s.unit_price).times(s.quantity).toDecimalPlaces(2)),
        fees: toNum(decimal(s.commission_fee).plus(s.sale_shipping).toDecimalPlaces(2)),
        net: toNum(revenue.toDecimalPlaces(2)),
        status: s.workflow_status || s.status,
        payout_status: payoutStatus(s),
        payout_date: toDateOnly(s.paid_at),
        payout_amount: s.paid_amount !== null ? toNum(s.paid_amount) : null,
        payout_account: s.payout_account || null,
        payout_reference: s.paid_reference || null,
        payout_short_amount: s.payout_short_amount !== null ? toNum(s.payout_short_amount) : 0,
        tracking_number: s.tracking_number || null,
        carrier: resolveCarrier(s.carrier, s.tracking_number, s.tracking_info),
        notes: s.notes || null,
      };
    }));
  });

  server.registerTool('list_inventory', {
    description: 'List inventory purchases, optionally filtered by status.',
    inputSchema: { status: z.string().optional() },
  }, async ({ status }) => {
    const inventories = await prisma.inventory.findMany({
      where: { user_id: userId },
      include: { vendor: true },
      orderBy: { purchase_date: 'desc' },
    });
    const now = Date.now();
    const filtered = status
      ? inventories.filter((inv) => String(inv.receiving_status || inv.status || '').toUpperCase() === status.toUpperCase())
      : inventories;
    return jsonResult(filtered.map((inv) => ({
      id: inv.id,
      item: inv.product_name,
      qty: inv.qty_purchased,
      qty_on_hand: inv.qty_on_hand,
      unit_cost: toNum(decimal(inv.unit_purchase_cost)),
      total_cost: toNum(batchCost(inv).toDecimalPlaces(2)),
      purchase_date: toDateOnly(inv.purchase_date),
      store: inv.vendor?.name || null,
      status: inv.receiving_status || inv.status,
      days_held: Math.max(0, Math.floor((now - new Date(inv.purchase_date).getTime()) / 86400000)),
      order_number: inv.order_number || null,
      tracking_number: inv.tracking_number || null,
      carrier: resolveCarrier(inv.carrier, inv.tracking_number, inv.tracking_info),
      tax_exempt: inv.tax_exempt,
      notes: inv.notes || null,
    })));
  });

  server.registerTool('list_expenses', {
    description: 'List business expenses with optional filters. Dates are YYYY-MM-DD.',
    inputSchema: {
      start_date: z.string().optional(),
      end_date: z.string().optional(),
      category: z.string().optional(),
    },
  }, async ({ start_date, end_date, category }) => {
    const where = { user_id: userId };
    if (start_date || end_date) {
      where.date = {};
      if (start_date) where.date.gte = localNoon(start_date);
      if (end_date) where.date.lte = localNoon(end_date);
    }
    if (category) where.category = { equals: category, mode: 'insensitive' };
    const expenses = await prisma.expense.findMany({ where, include: { payment_method: true }, orderBy: { date: 'desc' } });
    return jsonResult(expenses.map((e) => ({
      id: e.id,
      description: e.name,
      amount: toNum(decimal(e.amount)),
      date: toDateOnly(e.date),
      category: e.category,
      paid_from_account: e.payment_method?.name || null,
    })));
  });

  server.registerTool('get_cashflow_summary', {
    description: 'Overall cash-flow snapshot: owed to you (sold but unpaid/short-paid), spend, and on-hand inventory value, broken down by buyer (the sale\'s marketplace/cashout).',
    inputSchema: {},
  }, async () => {
    const [inventories, sales] = await Promise.all([
      prisma.inventory.findMany({ where: { user_id: userId } }),
      prisma.sales.findMany({ where: { inventory: { user_id: userId } }, include: { inventory: true, platform: true } }),
    ]);
    const spent = inventories.reduce((sum, inv) => sum.plus(batchCost(inv)), decimal(0));
    const onHand = inventories.reduce((sum, inv) => sum.plus(allocatedCost(inv, inv.qty_on_hand)), decimal(0));

    const byBuyer = new Map();
    let owed = decimal(0);
    let comingBack = decimal(0);
    for (const sale of sales.filter(isRealizedSale)) {
      const { revenue } = saleEconomics(sale.inventory, sale);
      comingBack = comingBack.plus(revenue);
      const status = payoutStatus(sale);
      const owedForThis = status === 'unpaid' ? revenue : status === 'partial' ? decimal(sale.payout_short_amount || 0) : decimal(0);
      owed = owed.plus(owedForThis);
      const name = sale.platform?.name || 'Unknown';
      const entry = byBuyer.get(name) || { buyer: name, revenue: decimal(0), owed: decimal(0) };
      entry.revenue = entry.revenue.plus(revenue);
      entry.owed = entry.owed.plus(owedForThis);
      byBuyer.set(name, entry);
    }

    return jsonResult({
      owed_to_me: toNum(owed.toDecimalPlaces(2)),
      coming_back: toNum(comingBack.toDecimalPlaces(2)),
      spent: toNum(spent.toDecimalPlaces(2)),
      on_hand_value: toNum(onHand.toDecimalPlaces(2)),
      by_buyer: [...byBuyer.values()].map((b) => ({
        buyer: b.buyer,
        revenue: toNum(b.revenue.toDecimalPlaces(2)),
        owed: toNum(b.owed.toDecimalPlaces(2)),
      })),
    });
  });

  server.registerTool('get_unpaid_by_buyer', {
    description: 'Totals of sold-but-unpaid (and short-paid) sales, grouped by buyer (the sale\'s marketplace/cashout).',
    inputSchema: {},
  }, async () => {
    const sales = await prisma.sales.findMany({ where: { inventory: { user_id: userId } }, include: { inventory: true, platform: true } });
    const byBuyer = new Map();
    for (const sale of sales.filter(isRealizedSale)) {
      const status = payoutStatus(sale);
      if (status === 'paid') continue;
      const { revenue } = saleEconomics(sale.inventory, sale);
      const owedForThis = status === 'unpaid' ? revenue : decimal(sale.payout_short_amount || 0);
      const name = sale.platform?.name || 'Unknown';
      const entry = byBuyer.get(name) || { buyer: name, owed: decimal(0), sale_count: 0 };
      entry.owed = entry.owed.plus(owedForThis);
      entry.sale_count += 1;
      byBuyer.set(name, entry);
    }
    return jsonResult([...byBuyer.values()]
      .map((b) => ({ buyer: b.buyer, owed: toNum(b.owed.toDecimalPlaces(2)), sale_count: b.sale_count }))
      .sort((a, b) => b.owed - a.owed));
  });

  // ----------------------------------------------------------------- writes

  server.registerTool('mark_sale_paid', {
    description: 'Mark one or more sales as paid from a single deposit. If payout_amount is less than the combined expected revenue of the given sales, the shortfall is split across them proportionally and recorded, rather than silently absorbed.',
    inputSchema: {
      sale_ids: z.array(z.string().uuid()).min(1),
      payout_date: z.string().describe('YYYY-MM-DD'),
      payout_amount: z.number().nonnegative(),
      payout_account: z.string().optional().describe('e.g. "Chase College", "PayPal", "eBay"'),
      payout_reference: z.string().optional(),
    },
  }, async ({ sale_ids, payout_date, payout_amount, payout_account, payout_reference }) => {
    try {
      const updated = await markSalesPaid({
        userId,
        saleIds: sale_ids,
        payoutDate: localNoon(payout_date),
        payoutAmount: payout_amount,
        payoutAccount: payout_account || null,
        payoutReference: payout_reference || null,
      });
      await logWrite(userId, apiKeyId, 'mark_sale_paid', { sale_ids, payout_date, payout_amount, payout_account, payout_reference });
      return jsonResult(updated.map((s) => ({
        id: s.id,
        payout_status: payoutStatus(s),
        payout_amount: toNum(s.paid_amount),
        payout_short_amount: s.payout_short_amount !== null ? toNum(s.payout_short_amount) : 0,
        payout_account: s.payout_account,
        payout_date: toDateOnly(s.paid_at),
        payout_reference: s.paid_reference,
      })));
    } catch (err) {
      return errorResult(err.message || 'Failed to mark sales paid');
    }
  });

  server.registerTool('add_purchase', {
    description: 'Log a reselling inventory purchase. The store is created automatically if it is new; the card/account must already exist.',
    inputSchema: {
      item: z.string().min(1),
      qty: z.number().int().min(1),
      unit_cost: z.number().nonnegative(),
      store: z.string().min(1).describe('Vendor name, e.g. "POINTS4DAYS". Created automatically if new.'),
      card_used: z.string().min(1).describe('Existing payment method name, e.g. "Chase College".'),
      purchase_date: z.string().describe('YYYY-MM-DD'),
      tax_exempt: z.boolean().optional(),
      order_number: z.string().optional(),
      tracking_number: z.string().optional(),
      carrier: z.string().optional().describe('Set explicitly if known; otherwise auto-detected from the tracking number.'),
    },
  }, async ({ item, qty, unit_cost, store, card_used, purchase_date, tax_exempt, order_number, tracking_number, carrier }) => {
    try {
      const vendor = await findOrCreateVendor(userId, store);
      const paymentMethod = await findPaymentMethod(userId, card_used);
      const created = await prisma.inventory.create({
        data: {
          user_id: userId,
          product_name: item.trim(),
          vendor_id: vendor.id,
          payment_method_id: paymentMethod.id,
          purchase_date: localNoon(purchase_date),
          unit_purchase_cost: unit_cost,
          qty_purchased: qty,
          qty_on_hand: qty,
          tax_exempt: Boolean(tax_exempt),
          order_number: order_number || null,
          tracking_number: tracking_number || null,
          carrier: carrier || null,
        },
      });
      await logWrite(userId, apiKeyId, 'add_purchase', { item, qty, unit_cost, store, card_used, purchase_date, tax_exempt, order_number, tracking_number, carrier });
      return jsonResult({
        id: created.id,
        item: created.product_name,
        qty: created.qty_purchased,
        unit_cost: toNum(decimal(created.unit_purchase_cost)),
        store: vendor.name,
        card_used: paymentMethod.name,
        purchase_date: toDateOnly(created.purchase_date),
        tax_exempt: created.tax_exempt,
        order_number: created.order_number,
        tracking_number: created.tracking_number,
        carrier: resolveCarrier(created.carrier, created.tracking_number, created.tracking_info),
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to add purchase');
    }
  });

  server.registerTool('add_expense', {
    description: 'Log a reselling business expense (shipping labels, tools, subscriptions, etc.). The account must already exist.',
    inputSchema: {
      description: z.string().min(1),
      amount: z.number().nonnegative(),
      date: z.string().describe('YYYY-MM-DD'),
      category: z.string().optional(),
      paid_from_account: z.string().min(1).describe('Existing payment method name.'),
    },
  }, async ({ description, amount, date, category, paid_from_account }) => {
    try {
      const paymentMethod = await findPaymentMethod(userId, paid_from_account);
      const created = await prisma.expense.create({
        data: {
          user_id: userId,
          name: description.trim(),
          amount,
          category: category || null,
          date: localNoon(date),
          payment_method_id: paymentMethod.id,
        },
      });
      await logWrite(userId, apiKeyId, 'add_expense', { description, amount, date, category, paid_from_account });
      return jsonResult({
        id: created.id,
        description: created.name,
        amount: toNum(decimal(created.amount)),
        date: toDateOnly(created.date),
        category: created.category,
        paid_from_account: paymentMethod.name,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to add expense');
    }
  });

  server.registerTool('update_sale', {
    description: 'Edit an existing sale\'s price, fees, shipping, quantity, sale date, platform (buyer), outbound tracking/carrier, or notes. Never touches payout fields (paid_at, paid_amount, payout_account, payout_reference, payout_short_amount) -- use mark_sale_paid for those. Every changed field is recorded and reviewable via list_changes.',
    inputSchema: z.object({
      sale_id: z.string().uuid(),
      price: z.number().nonnegative().optional().describe('Per-unit sale price.'),
      fees: z.number().nonnegative().optional().describe('Marketplace/cashout commission.'),
      shipping: z.number().nonnegative().optional().describe('Outbound shipping cost.'),
      qty: z.number().int().min(1).optional(),
      sale_date: strictDate.optional(),
      platform: z.string().min(1).optional().describe('Existing marketplace/cashout name -- the sale\'s buyer. Must already exist (see list_sales for names in use).'),
      tracking_number: z.string().optional().describe('Outbound tracking number. Empty string clears it.'),
      carrier: z.string().optional().describe('Empty string clears it. Auto-detected from the tracking number when not set.'),
      notes: z.string().max(2000).optional(),
    }).strict(),
  }, async ({ sale_id, price, fees, shipping, qty, sale_date, platform, tracking_number, carrier, notes }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.sales.findUnique({ where: { id: sale_id }, include: { inventory: true } });
        if (!existing || existing.inventory.user_id !== userId) {
          throw Object.assign(new Error('Sale not found or access denied'), { toolError: true });
        }

        let platformId = existing.platform_id;
        if (platform !== undefined) platformId = (await findPlatformByName(userId, platform, tx)).id;

        const newQty = qty !== undefined ? qty : existing.quantity;
        const qtyDiff = existing.quantity - newQty;
        if (qtyDiff < 0) {
          const claim = await tx.inventory.updateMany({
            where: { id: existing.inventory_id, qty_on_hand: { gte: -qtyDiff } },
            data: { qty_on_hand: { decrement: -qtyDiff } },
          });
          if (claim.count !== 1) throw Object.assign(new Error('Insufficient quantity on hand for this update'), { toolError: true });
        } else if (qtyDiff > 0) {
          await tx.inventory.update({ where: { id: existing.inventory_id }, data: { qty_on_hand: { increment: qtyDiff } } });
        }

        const data = {};
        const changes = [];
        if (price !== undefined && price !== existing.unit_price) { data.unit_price = price; changes.push({ field: 'unit_price', oldValue: existing.unit_price, newValue: price }); }
        if (fees !== undefined && fees !== existing.commission_fee) { data.commission_fee = fees; changes.push({ field: 'commission_fee', oldValue: existing.commission_fee, newValue: fees }); }
        if (shipping !== undefined && shipping !== existing.sale_shipping) { data.sale_shipping = shipping; changes.push({ field: 'sale_shipping', oldValue: existing.sale_shipping, newValue: shipping }); }
        if (qty !== undefined && newQty !== existing.quantity) { data.quantity = newQty; changes.push({ field: 'quantity', oldValue: existing.quantity, newValue: newQty }); }
        if (sale_date !== undefined) {
          const oldDate = toDateOnly(existing.sale_date);
          if (sale_date !== oldDate) { data.sale_date = localNoon(sale_date); changes.push({ field: 'sale_date', oldValue: oldDate, newValue: sale_date }); }
        }
        if (platform !== undefined && platformId !== existing.platform_id) { data.platform_id = platformId; changes.push({ field: 'platform_id', oldValue: existing.platform_id, newValue: platformId }); }
        if (tracking_number !== undefined) {
          const newTracking = tracking_number || null;
          const advance = trackingGateAndAdvance('sale', existing, tracking_number, false);
          Object.assign(data, advance);
          if (advance.workflow_status) changes.push({ field: 'workflow_status', oldValue: existing.workflow_status, newValue: advance.workflow_status });
          if (newTracking !== existing.tracking_number) { data.tracking_number = newTracking; changes.push({ field: 'tracking_number', oldValue: existing.tracking_number, newValue: newTracking }); }
        }
        if (carrier !== undefined) {
          const newCarrier = carrier || null;
          if (newCarrier !== existing.carrier) { data.carrier = newCarrier; changes.push({ field: 'carrier', oldValue: existing.carrier, newValue: newCarrier }); }
        }
        if (notes !== undefined && notes !== (existing.notes || '')) { data.notes = notes; changes.push({ field: 'notes', oldValue: existing.notes, newValue: notes }); }

        if (Object.keys(data).length === 0) return existing;

        const claim = await tx.sales.updateMany({ where: { id: sale_id, quantity: existing.quantity }, data });
        if (claim.count !== 1) throw Object.assign(new Error('Sale changed while saving. Reload and retry.'), { status: 409 });

        await recordChanges(tx, userId, 'Sales', sale_id, changes);
        return tx.sales.findUnique({ where: { id: sale_id } });
      });
      await logWrite(userId, apiKeyId, 'update_sale', { sale_id, price, fees, shipping, qty, sale_date, platform, tracking_number, carrier, notes });
      return jsonResult({
        id: result.id,
        qty: result.quantity,
        price: toNum(result.unit_price),
        fees: toNum(result.commission_fee),
        shipping: toNum(result.sale_shipping),
        sale_date: toDateOnly(result.sale_date),
        platform_id: result.platform_id,
        tracking_number: result.tracking_number,
        carrier: resolveCarrier(result.carrier, result.tracking_number, result.tracking_info),
        status: result.workflow_status || result.status,
        notes: result.notes,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to update sale');
    }
  });

  server.registerTool('update_purchase', {
    description: 'Edit an existing purchase\'s quantity, unit cost, purchase date, store, notes, tracking, order number, or tax-exempt flag. Total cost is derived (unit_cost x qty plus any tax/shipping/fees already on the purchase), not a separate field -- adjust unit_cost or qty to change it. Adding a tracking number for the first time behaves the same as on the website: it is rejected once the purchase has already been received, and otherwise auto-advances receiving status unless a status change happens through update_shipment in the same beat.',
    inputSchema: z.object({
      purchase_id: z.string().uuid(),
      qty: z.number().int().min(1).optional().describe('Quantity purchased. Cannot be set below the amount already sold from this purchase.'),
      unit_cost: z.number().nonnegative().optional(),
      purchase_date: strictDate.optional(),
      store: z.string().min(1).optional().describe('Vendor name -- created automatically if new, same as add_purchase.'),
      order_number: z.string().optional().describe('Empty string clears it.'),
      tracking_number: z.string().optional().describe('Empty string clears it.'),
      carrier: z.string().optional().describe('Empty string clears it. Auto-detected from the tracking number when not set.'),
      tax_exempt: z.boolean().optional(),
      notes: z.string().max(2000).optional(),
    }).strict(),
  }, async ({ purchase_id, qty, unit_cost, purchase_date, store, order_number, tracking_number, carrier, tax_exempt, notes }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.inventory.findUnique({ where: { id: purchase_id } });
        if (!existing || existing.user_id !== userId) {
          throw Object.assign(new Error('Purchase not found or access denied'), { toolError: true });
        }

        let vendorId = existing.vendor_id;
        if (store !== undefined) {
          const trimmed = store.trim();
          if (!trimmed) throw Object.assign(new Error('store cannot be empty'), { toolError: true });
          let vendor = await tx.platform.findFirst({ where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } } });
          if (!vendor) vendor = await tx.platform.create({ data: { user_id: userId, name: trimmed, type: 'Vendor', fee_pct: 0 } });
          vendorId = vendor.id;
        }

        let newQtyPurchased = existing.qty_purchased;
        let newQtyOnHand = existing.qty_on_hand;
        if (qty !== undefined) {
          const sold = existing.qty_purchased - existing.qty_on_hand;
          if (qty < sold) throw Object.assign(new Error(`Cannot set qty below ${sold}, the amount already sold from this purchase`), { toolError: true });
          newQtyPurchased = qty;
          newQtyOnHand = qty - sold;
        }

        const data = {};
        const changes = [];
        if (unit_cost !== undefined && unit_cost !== existing.unit_purchase_cost) { data.unit_purchase_cost = unit_cost; changes.push({ field: 'unit_purchase_cost', oldValue: existing.unit_purchase_cost, newValue: unit_cost }); }
        if (qty !== undefined && newQtyPurchased !== existing.qty_purchased) {
          data.qty_purchased = newQtyPurchased;
          data.qty_on_hand = newQtyOnHand;
          changes.push({ field: 'qty_purchased', oldValue: existing.qty_purchased, newValue: newQtyPurchased });
          changes.push({ field: 'qty_on_hand', oldValue: existing.qty_on_hand, newValue: newQtyOnHand });
        }
        if (purchase_date !== undefined) {
          const oldDate = toDateOnly(existing.purchase_date);
          if (purchase_date !== oldDate) { data.purchase_date = localNoon(purchase_date); changes.push({ field: 'purchase_date', oldValue: oldDate, newValue: purchase_date }); }
        }
        if (store !== undefined && vendorId !== existing.vendor_id) { data.vendor_id = vendorId; changes.push({ field: 'vendor_id', oldValue: existing.vendor_id, newValue: vendorId }); }
        if (order_number !== undefined) {
          const newOrderNumber = order_number || null;
          if (newOrderNumber !== existing.order_number) { data.order_number = newOrderNumber; changes.push({ field: 'order_number', oldValue: existing.order_number, newValue: newOrderNumber }); }
        }
        if (tracking_number !== undefined) {
          const newTracking = tracking_number || null;
          const advance = trackingGateAndAdvance('inventory', existing, tracking_number, false);
          Object.assign(data, advance);
          if (advance.receiving_status) changes.push({ field: 'receiving_status', oldValue: existing.receiving_status, newValue: advance.receiving_status });
          if (newTracking !== existing.tracking_number) { data.tracking_number = newTracking; changes.push({ field: 'tracking_number', oldValue: existing.tracking_number, newValue: newTracking }); }
        }
        if (carrier !== undefined) {
          const newCarrier = carrier || null;
          if (newCarrier !== existing.carrier) { data.carrier = newCarrier; changes.push({ field: 'carrier', oldValue: existing.carrier, newValue: newCarrier }); }
        }
        if (tax_exempt !== undefined && tax_exempt !== existing.tax_exempt) { data.tax_exempt = tax_exempt; changes.push({ field: 'tax_exempt', oldValue: existing.tax_exempt, newValue: tax_exempt }); }
        if (notes !== undefined && notes !== (existing.notes || '')) { data.notes = notes; changes.push({ field: 'notes', oldValue: existing.notes, newValue: notes }); }

        if (Object.keys(data).length === 0) return existing;

        const claim = await tx.inventory.updateMany({ where: { id: purchase_id, qty_on_hand: existing.qty_on_hand }, data });
        if (claim.count !== 1) throw Object.assign(new Error('Purchase changed while saving. Reload and retry.'), { status: 409 });

        await recordChanges(tx, userId, 'Inventory', purchase_id, changes);
        return tx.inventory.findUnique({ where: { id: purchase_id } });
      });
      await logWrite(userId, apiKeyId, 'update_purchase', { purchase_id, qty, unit_cost, purchase_date, store, order_number, tracking_number, carrier, tax_exempt, notes });
      return jsonResult({
        id: result.id,
        item: result.product_name,
        qty: result.qty_purchased,
        qty_on_hand: result.qty_on_hand,
        unit_cost: toNum(result.unit_purchase_cost),
        purchase_date: toDateOnly(result.purchase_date),
        order_number: result.order_number,
        tracking_number: result.tracking_number,
        carrier: resolveCarrier(result.carrier, result.tracking_number, result.tracking_info),
        tax_exempt: result.tax_exempt,
        status: result.receiving_status || result.status,
        notes: result.notes,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to update purchase');
    }
  });

  server.registerTool('add_sale', {
    description: 'Log a new sale against an existing purchase. The platform (marketplace/cashout -- the sale\'s buyer) must already exist.',
    inputSchema: z.object({
      inventory_id: z.string().uuid(),
      qty: z.number().int().min(1),
      sale_price: z.number().nonnegative().describe('Per-unit sale price.'),
      fees: z.number().nonnegative().optional().describe('Marketplace/cashout commission. Defaults to 0.'),
      sale_date: strictDate,
      platform: z.string().min(1).describe('Existing marketplace/cashout name -- the sale\'s buyer.'),
      tracking_number: z.string().optional().describe('Outbound tracking number, if already known.'),
      carrier: z.string().optional().describe('Auto-detected from the tracking number when not set.'),
      notes: z.string().max(2000).optional(),
    }).strict(),
  }, async ({ inventory_id, qty, sale_price, fees, sale_date, platform, tracking_number, carrier, notes }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const inv = await tx.inventory.findUnique({ where: { id: inventory_id } });
        if (!inv || inv.user_id !== userId) {
          throw Object.assign(new Error('Purchase not found or access denied'), { toolError: true });
        }
        const platformRecord = await findPlatformByName(userId, platform, tx);
        const claim = await tx.inventory.updateMany({
          where: { id: inventory_id, qty_on_hand: { gte: qty } },
          data: { qty_on_hand: { decrement: qty } },
        });
        if (claim.count !== 1) throw Object.assign(new Error('Insufficient quantity on hand'), { toolError: true });

        const workflowType = statusTransitions.resolveSaleWorkflow(platformRecord.workflow_preset);
        return tx.sales.create({
          data: {
            inventory_id,
            platform_id: platformRecord.id,
            quantity: qty,
            unit_price: sale_price,
            commission_fee: fees || 0,
            sale_date: localNoon(sale_date),
            status: 'SOLD',
            workflow_type: workflowType,
            workflow_status: statusTransitions.legacyWorkflowStatus('SOLD', workflowType),
            workflow_status_changed_at: new Date(),
            tracking_number: tracking_number || null,
            carrier: carrier || null,
            notes: notes || null,
          },
        });
      });
      await logWrite(userId, apiKeyId, 'add_sale', { inventory_id, qty, sale_price, fees, sale_date, platform, tracking_number, carrier, notes });
      return jsonResult({
        id: result.id,
        inventory_id: result.inventory_id,
        qty: result.quantity,
        sale_price: toNum(result.unit_price),
        fees: toNum(result.commission_fee),
        sale_date: toDateOnly(result.sale_date),
        platform_id: result.platform_id,
        tracking_number: result.tracking_number,
        carrier: resolveCarrier(result.carrier, result.tracking_number, result.tracking_info),
        notes: result.notes,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to add sale');
    }
  });

  // Mirrors the Shipping page's exact inbound/outbound window (see
  // profit-tracker-app/src/pages/Shipping.jsx): a purchase only belongs here while it
  // is still waiting to arrive and has stock left, and a sale only belongs
  // here from "sold, needs a label" through "in transit" -- once a purchase is
  // received or a sale reaches its next milestone, it drops off the Shipping
  // page (and this tool) the same way.
  const SHIPMENT_INBOUND_RECEIVING_STATUSES = ['PRE_ORDER', 'PURCHASED', 'INBOUND'];
  const SHIPMENT_OUTBOUND_WORKFLOW_STATUSES = ['AWAITING_SHIPMENT', 'OUTBOUND'];

  server.registerTool('list_shipments', {
    description: 'List items on the Shipping page: inbound purchases still waiting to arrive, and outbound sales still waiting to ship/arrive. Each row has a tracking number, carrier, status, and when it was last updated.',
    inputSchema: {
      direction: z.enum(['inbound', 'outbound']).optional(),
      status: z.string().optional().describe('Filter by the item\'s current receiving/workflow status (case-insensitive), e.g. "INBOUND" or "AWAITING_SHIPMENT".'),
      missing_tracking: z.boolean().optional().describe('true to list only items with no tracking number yet.'),
    },
  }, async ({ direction, status, missing_tracking }) => {
    const rows = [];
    if (direction !== 'outbound') {
      const inbound = await prisma.inventory.findMany({
        where: { user_id: userId, receiving_status: { in: SHIPMENT_INBOUND_RECEIVING_STATUSES }, qty_on_hand: { gt: 0 } },
        orderBy: { purchase_date: 'desc' },
      });
      for (const inv of inbound) {
        rows.push({
          id: inv.id,
          item: inv.product_name,
          direction: 'inbound',
          carrier: resolveCarrier(inv.carrier, inv.tracking_number, inv.tracking_info),
          tracking_number: inv.tracking_number || null,
          status: inv.receiving_status || inv.status,
          last_updated: toDateOnly(inv.tracking_info?.checkedAt || inv.receiving_status_changed_at),
        });
      }
    }
    if (direction !== 'inbound') {
      const outbound = await prisma.sales.findMany({
        where: { inventory: { user_id: userId }, workflow_status: { in: SHIPMENT_OUTBOUND_WORKFLOW_STATUSES } },
        include: { inventory: true },
        orderBy: { sale_date: 'desc' },
      });
      for (const sale of outbound) {
        rows.push({
          id: sale.id,
          item: sale.inventory.product_name,
          direction: 'outbound',
          carrier: resolveCarrier(sale.carrier, sale.tracking_number, sale.tracking_info),
          tracking_number: sale.tracking_number || null,
          status: sale.workflow_status || sale.status,
          last_updated: toDateOnly(sale.tracking_info?.checkedAt || sale.workflow_status_changed_at),
        });
      }
    }
    const filtered = rows.filter((r) => {
      if (status && r.status?.toUpperCase() !== status.toUpperCase()) return false;
      if (missing_tracking && r.tracking_number) return false;
      return true;
    });
    return jsonResult(filtered);
  });

  server.registerTool('update_shipment', {
    description: 'Set or correct the tracking number, carrier, or shipping status on one inbound purchase or outbound sale, looked up by id -- works the same way for either, no need to say which. Adding a tracking number for the first time is rejected if the item is already past the shipping stage, same as the website. Every change is recorded and reviewable via list_changes.',
    inputSchema: z.object({
      item_id: z.string().uuid().describe('An id from list_shipments (or list_inventory/list_sales).'),
      tracking_number: z.string().optional().describe('Empty string clears it.'),
      carrier: z.string().optional().describe('Empty string clears it. Auto-detected from the tracking number when not set.'),
      status: z.string().optional().describe('Receiving status for an inbound item (PRE_ORDER, PURCHASED, INBOUND, ON_HAND) or workflow status for an outbound sale -- see list_shipments for the item\'s current value and workflow.'),
    }).strict(),
  }, async ({ item_id, tracking_number, carrier, status }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const inv = await tx.inventory.findUnique({ where: { id: item_id } });
        if (inv && inv.user_id === userId) {
          return updateInventoryShipment(tx, userId, inv, { tracking_number, carrier, status });
        }
        const sale = await tx.sales.findUnique({ where: { id: item_id }, include: { inventory: true } });
        if (sale && sale.inventory.user_id === userId) {
          return updateSaleShipment(tx, userId, sale, { tracking_number, carrier, status });
        }
        throw Object.assign(new Error('Shipment item not found or access denied'), { toolError: true });
      });
      await logWrite(userId, apiKeyId, 'update_shipment', { item_id, tracking_number, carrier, status });
      return jsonResult(result);
    } catch (err) {
      return errorResult(err.message || 'Failed to update shipment');
    }
  });

  server.registerTool('get_card_net_to_pay', {
    description: 'Per-card reselling snapshot: the same numbers as the Credit Card page -- card name, last 4 digits, "Net to Pay" (reselling spend still owed after cashback earned is applied to losses), and the next payment due date if the card has one configured. One short row per card.',
    inputSchema: {
      month: z.string().regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM').optional().describe('Defaults to the current month. Only changes which purchases count toward Net to Pay -- due dates are always the next real one from today.'),
    },
  }, async ({ month }) => {
    const { cards } = await computeCardDashboard(prisma, userId, month);
    const now = new Date();
    return jsonResult(cards.map((card) => ({
      card: card.name,
      last4: card.last4,
      net_to_pay: card.amountToPay,
      due_date: toDateOnly(nextDueDate(card.due_day, now)),
    })));
  });

  server.registerTool('list_changes', {
    description: 'List recent field-level changes made by update_sale/update_purchase/update_shipment, most recent first, so an edit can be reviewed (and manually reversed using old_value).',
    inputSchema: z.object({
      limit: z.number().int().min(1).max(500).optional().describe('Omit to return every matching change.'),
      record_id: z.string().uuid().optional().describe('Limit to the change history of one sale or purchase.'),
    }).strict(),
  }, async ({ limit, record_id }) => {
    try {
      const where = { user_id: userId };
      if (record_id) where.record_id = record_id;
      const changes = await prisma.changeLog.findMany({
        where,
        orderBy: { created_at: 'desc' },
        ...(limit ? { take: limit } : {}),
      });
      return jsonResult(changes.map((c) => ({
        id: c.id,
        table: c.table_name,
        record_id: c.record_id,
        field: c.field,
        old_value: c.old_value,
        new_value: c.new_value,
        source: c.source,
        changed_at: c.created_at.toISOString(),
      })));
    } catch (err) {
      return errorResult(err.message || 'Failed to list changes');
    }
  });

  return server;
}

router.post('/', async (req, res) => {
  const server = buildServer(req.user.id, req.apiKeyId);
  try {
    // enableJsonResponse: none of these tools stream partial results or
    // server notifications mid-call, so a single JSON response per request
    // is simpler for clients than SSE.
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (err) {
    console.error('[mcp] request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
    }
  }
});

// Stateless mode has no server-initiated stream and no session to terminate.
router.get('/', (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});
router.delete('/', (req, res) => {
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null });
});

module.exports = router;
