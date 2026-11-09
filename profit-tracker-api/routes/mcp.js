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
const { listRefunds, recordRefund, removeRefund } = require('../services/refunds');
const { saleEconomics, allocatedCost, batchCost, isRealizedSale, keptQuantity, keptSaleQuantity } = require('../services/decimalFinance');
const { payoutStatus } = require('../services/payoutStatus');
const { markSalesPaid } = require('../services/markSalesPaid');
const statusTransitions = require('../services/statusTransitions');
const { detectCarrier } = require('../services/tracking');
const { computeCardDashboard, nextDueDate } = require('../services/cardNetToPay');
const { recordChanges } = require('../services/changeLog');
const transactionNotes = require('../services/transactionNotes');
const cashoutService = require('../services/cashouts/service');
const { presentDeal } = require('../services/cashouts/dealPresenter');
const cashoutCommits = require('../services/cashouts/commits');
const { logPurchase } = require('../services/cashouts/logPurchase');

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

// Every live deal across every connected cashout, each paired with the
// connection it came from. Uses the same 60s cache fetchConnectionDeals
// already keeps, so calling this doesn't hammer the provider on every tool
// call -- only sync_cashout_deals and get_cashout_deal force a fresh fetch.
async function loadLiveCashoutDeals(userId) {
  const connections = await cashoutService.listConnections(userId);
  const perConnection = await Promise.all(connections.map(async (conn) => {
    try {
      const result = await cashoutService.fetchConnectionDeals(userId, conn.id);
      return { conn, result };
    } catch (err) {
      return { conn, result: { deals: [], lastUpdated: null, isStale: true, warning: err.message } };
    }
  }));
  const deals = [];
  for (const { conn, result } of perConnection) {
    for (const deal of result.deals || []) {
      deals.push({ deal: presentDeal(deal, conn), connection: conn, synced_at: result.lastUpdated });
    }
  }
  return { deals, connections: perConnection.map(({ conn, result }) => ({ conn, result })) };
}

// Resolves the same loose "cashout" name match sync_cashout_deals already
// uses (display name or provider, case-insensitive, partial) to one
// connection -- shared so the commit/tracking tools below agree on it.
async function resolveConnection(userId, cashoutQuery) {
  const connections = await cashoutService.listConnections(userId);
  if (!cashoutQuery) {
    if (connections.length === 1) return connections[0];
    throw Object.assign(new Error(connections.length === 0
      ? 'No cashout is connected.'
      : 'More than one cashout is connected -- pass "cashout" to say which one.'), { toolError: true });
  }
  const query = cashoutQuery.toLowerCase();
  const match = connections.find((c) => (c.displayName || '').toLowerCase().includes(query) || c.provider.toLowerCase().includes(query));
  if (!match) throw Object.assign(new Error(`No connected cashout matches "${cashoutQuery}".`), { toolError: true });
  return match;
}

function presentCommitment(record) {
  return {
    id: record.id,
    cashout: record.connection?.displayName || record.connection?.provider || null,
    deal_id: record.external_deal_id,
    item_id: record.external_item_id,
    provider_commitment_id: record.external_commitment_id,
    quantity: record.quantity,
    status: record.status,
    sale_id: record.sale_id,
    tracking_codes: record.tracking_codes || [],
    tracking_submitted_at: record.tracking_submitted_at ? new Date(record.tracking_submitted_at).toISOString() : null,
    tracking_error: record.tracking_error,
    created_at: new Date(record.created_at).toISOString(),
  };
}

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
    if (statusTransitions.reopensRestoredSale(existing, { workflow_status: normalized })) {
      throw Object.assign(new Error(statusTransitions.REOPEN_REFUSED_MESSAGE), { toolError: true });
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
    description: 'List inventory purchases, newest first, paged. status = receiving status (did it arrive); availability = Available/Sold Out from qty_on_hand.',
    inputSchema: {
      status: z.string().optional(),
      availability: z.enum(['Available', 'Sold Out']).optional(),
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
      offset: z.number().int().min(0).optional().describe('Default 0.'),
    },
  }, async ({ status, availability, limit, offset }) => {
    const inventories = await prisma.inventory.findMany({
      where: { user_id: userId },
      include: { vendor: true },
      orderBy: { purchase_date: 'desc' },
    });
    const now = Date.now();
    const filtered = inventories
      .filter((inv) => !status || String(inv.receiving_status || inv.status || '').toUpperCase() === status.toUpperCase())
      .filter((inv) => !availability || statusTransitions.availabilityLabel(inv) === availability);
    const start = offset ?? 0;
    const page = filtered.slice(start, start + (limit ?? 20));
    const items = page.map((inv) => ({
      id: inv.id,
      item: inv.product_name,
      qty: inv.qty_purchased,
      qty_on_hand: inv.qty_on_hand,
      unit_cost: toNum(decimal(inv.unit_purchase_cost)),
      total_cost: toNum(batchCost(inv).toDecimalPlaces(2)),
      purchase_date: toDateOnly(inv.purchase_date),
      store: inv.vendor?.name || null,
      status: inv.receiving_status || inv.status,
      availability: statusTransitions.availabilityLabel(inv),
      days_held: Math.max(0, Math.floor((now - new Date(inv.purchase_date).getTime()) / 86400000)),
      order_number: inv.order_number || null,
      tracking_number: inv.tracking_number || null,
      carrier: resolveCarrier(inv.carrier, inv.tracking_number, inv.tracking_info),
      tax_exempt: inv.tax_exempt,
      notes: inv.notes || null,
      market_value: inv.market_value === null || inv.market_value === undefined ? null : toNum(decimal(inv.market_value)),
    }));
    return jsonResult({ items, total: filtered.length, truncated: start + page.length < filtered.length });
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
    description: 'Overall cash-flow snapshot: owed to you (sold but unpaid/short-paid), spend, and on-hand inventory value, broken down by buyer (the sale\'s marketplace/cashout), plus market value and unrealized profit of priced stock.',
    inputSchema: {},
  }, async () => {
    const [inventories, sales] = await Promise.all([
      prisma.inventory.findMany({ where: { user_id: userId } }),
      prisma.sales.findMany({ where: { inventory: { user_id: userId } }, include: { inventory: true, platform: true } }),
    ]);
    const spent = inventories.reduce((sum, inv) => sum.plus(batchCost(inv)), decimal(0));
    const onHand = inventories.reduce((sum, inv) => sum.plus(allocatedCost(inv, inv.qty_on_hand)), decimal(0));

    // Market-value view over live (not cancelled) stock. Unpriced rows are
    // counted, not valued, so unrealized_profit only compares like with like.
    const isCancelledPurchase = (inv) => Boolean(inv.cancelled_at)
      || inv.receiving_status === 'CANCELLED'
      || String(inv.status || '').toUpperCase() === 'CANCELLED';
    const liveStock = inventories.filter((inv) => !isCancelledPurchase(inv) && inv.qty_on_hand > 0);
    const pricedStock = liveStock.filter((inv) => inv.market_value !== null && inv.market_value !== undefined);
    const marketValueOnHand = pricedStock.reduce((sum, inv) => sum.plus(decimal(inv.market_value).times(inv.qty_on_hand)), decimal(0));
    const pricedCostBasis = pricedStock.reduce((sum, inv) => sum.plus(allocatedCost(inv, inv.qty_on_hand)), decimal(0));

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
      market_value_on_hand: toNum(marketValueOnHand.toDecimalPlaces(2)),
      priced_cost_basis: toNum(pricedCostBasis.toDecimalPlaces(2)),
      unrealized_profit: toNum(marketValueOnHand.minus(pricedCostBasis).toDecimalPlaces(2)),
      unpriced_items: liveStock.length - pricedStock.length,
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
    description: 'Log a general business expense (shipping supplies, tools, subscriptions, etc.). Do NOT use this for a cost that belongs to one purchase or sale -- purchase tax/shipping/fees and a sale\'s shipping label or platform fee are entered on that purchase or sale (update_purchase / update_sale) and already appear on the Expenses tab automatically. The account must already exist.',
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
    description: 'Edit an existing sale\'s price, fees, shipping, the card its shipping label was paid with, quantity, sale date, platform (buyer), outbound tracking/carrier, or notes. Never touches payout fields (paid_at, paid_amount, payout_account, payout_reference, payout_short_amount) -- use mark_sale_paid for those. Every changed field is recorded and reviewable via list_changes.',
    inputSchema: z.object({
      sale_id: z.string().uuid(),
      price: z.number().nonnegative().optional().describe('Per-unit sale price.'),
      fees: z.number().nonnegative().optional().describe('Marketplace/cashout commission.'),
      shipping: z.number().nonnegative().optional().describe('Outbound shipping cost.'),
      label_paid_with: z.string().optional().describe('Name of the existing card or account the shipping label was bought with (Pirate Ship, Shippo, ...). Empty string means it came out of the payout, with no card.'),
      qty: z.number().int().min(1).optional(),
      sale_date: strictDate.optional(),
      platform: z.string().min(1).optional().describe('Existing marketplace/cashout name -- the sale\'s buyer. Must already exist (see list_sales for names in use).'),
      tracking_number: z.string().optional().describe('Outbound tracking number. Empty string clears it.'),
      carrier: z.string().optional().describe('Empty string clears it. Auto-detected from the tracking number when not set.'),
      notes: z.string().max(2000).optional().describe('Legacy single note field. Prefer add_note, which keeps a dated history of notes.'),
    }).strict(),
  }, async ({ sale_id, price, fees, shipping, label_paid_with, qty, sale_date, platform, tracking_number, carrier, notes }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.sales.findUnique({ where: { id: sale_id }, include: { inventory: true } });
        if (!existing || existing.inventory.user_id !== userId) {
          throw Object.assign(new Error('Sale not found or access denied'), { toolError: true });
        }

        let platformId = existing.platform_id;
        if (platform !== undefined) platformId = (await findPlatformByName(userId, platform, tx)).id;

        const newQty = qty !== undefined ? qty : existing.quantity;
        // Units the buyer sent back, or a cancel/void/return action restored,
        // are already in stock; the qty can't drop below them.
        const backInStock = (existing.refunded_qty || 0) + (existing.restored_qty || 0);
        if (newQty < backInStock) {
          throw Object.assign(new Error(`Cannot set qty below ${backInStock}, the units already returned to stock`), { toolError: true });
        }
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
        if (label_paid_with !== undefined) {
          const labelCardId = label_paid_with.trim() ? (await findPaymentMethod(userId, label_paid_with)).id : null;
          if (labelCardId !== (existing.sale_shipping_payment_method_id ?? null)) {
            data.sale_shipping_payment_method_id = labelCardId;
            changes.push({ field: 'sale_shipping_payment_method_id', oldValue: existing.sale_shipping_payment_method_id, newValue: labelCardId });
          }
        }
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

        const claim = await tx.sales.updateMany({
          where: {
            id: sale_id, quantity: existing.quantity,
            ...(existing.refunded_qty !== undefined ? { refunded_qty: existing.refunded_qty } : {}),
            ...(existing.restored_qty !== undefined ? { restored_qty: existing.restored_qty } : {}),
          },
          data,
        });
        if (claim.count !== 1) throw Object.assign(new Error('Sale changed while saving. Reload and retry.'), { status: 409 });

        await recordChanges(tx, userId, 'Sales', sale_id, changes);
        return tx.sales.findUnique({ where: { id: sale_id } });
      });
      await logWrite(userId, apiKeyId, 'update_sale', { sale_id, price, fees, shipping, label_paid_with, qty, sale_date, platform, tracking_number, carrier, notes });
      return jsonResult({
        id: result.id,
        qty: result.quantity,
        price: toNum(result.unit_price),
        fees: toNum(result.commission_fee),
        shipping: toNum(result.sale_shipping),
        label_card_id: result.sale_shipping_payment_method_id ?? null,
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
      notes: z.string().max(2000).optional().describe('Legacy single note field. Prefer add_note, which keeps a dated history of notes.'),
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
      shipping: z.number().nonnegative().optional().describe('Outbound shipping cost. Defaults to 0.'),
      label_paid_with: z.string().optional().describe('Name of the existing card or account the shipping label was bought with (Pirate Ship, Shippo, ...). Leave out when it came out of the payout.'),
      sale_date: strictDate,
      platform: z.string().min(1).describe('Existing marketplace/cashout name -- the sale\'s buyer.'),
      tracking_number: z.string().optional().describe('Outbound tracking number, if already known.'),
      carrier: z.string().optional().describe('Auto-detected from the tracking number when not set.'),
      notes: z.string().max(2000).optional().describe('Legacy single note field. Prefer add_note, which keeps a dated history of notes.'),
    }).strict(),
  }, async ({ inventory_id, qty, sale_price, fees, shipping, label_paid_with, sale_date, platform, tracking_number, carrier, notes }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const inv = await tx.inventory.findUnique({ where: { id: inventory_id } });
        if (!inv || inv.user_id !== userId) {
          throw Object.assign(new Error('Purchase not found or access denied'), { toolError: true });
        }
        const platformRecord = await findPlatformByName(userId, platform, tx);
        const labelCard = label_paid_with?.trim() ? await findPaymentMethod(userId, label_paid_with) : null;
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
            sale_shipping: shipping || 0,
            sale_shipping_payment_method_id: labelCard ? labelCard.id : null,
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
      await logWrite(userId, apiKeyId, 'add_sale', { inventory_id, qty, sale_price, fees, shipping, label_paid_with, sale_date, platform, tracking_number, carrier, notes });
      return jsonResult({
        id: result.id,
        inventory_id: result.inventory_id,
        qty: result.quantity,
        sale_price: toNum(result.unit_price),
        fees: toNum(result.commission_fee),
        shipping: toNum(result.sale_shipping),
        label_card_id: result.sale_shipping_payment_method_id ?? null,
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

  // ------------------------------------------- platforms and payment methods

  const toolError = (message) => Object.assign(new Error(message), { toolError: true });

  server.registerTool('add_platform', {
    description: 'Create a marketplace, cashout, or vendor platform.',
    inputSchema: z.object({
      name: z.string().trim().min(1).max(100),
      type: z.enum(['Marketplace', 'Cashout', 'Vendor']),
      fee_pct: z.number().min(0).max(100).optional().describe('Platform fee percent, e.g. 12.9. Defaults to 0.'),
    }).strict(),
  }, async ({ name, type, fee_pct }) => {
    try {
      const created = await prisma.$transaction(async (tx) => {
        // add_sale/findPlatformByName look platforms up by name across every
        // type, so a name may exist only once per user, whatever its type.
        const existing = await tx.platform.findFirst({
          where: { user_id: userId, name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) throw toolError(`A platform named "${existing.name}" (${existing.type}) already exists`);
        // Same defaults as POST /api/platforms. fee_pct_decimal is filled by
        // the database trigger; workflow_preset is left unset there too.
        const platform = await tx.platform.create({
          data: { user_id: userId, name, type, fee_pct: fee_pct ?? 0 },
        });
        await recordChanges(tx, userId, 'Platform', platform.id, [
          { field: 'created', oldValue: null, newValue: `${platform.name} (${platform.type})` },
        ]);
        return platform;
      });
      await logWrite(userId, apiKeyId, 'add_platform', { name, type, fee_pct });
      return jsonResult({ id: created.id, name: created.name, type: created.type, fee_pct: toNum(created.fee_pct) });
    } catch (err) {
      return errorResult(err.message || 'Failed to add platform');
    }
  });

  server.registerTool('add_payment_method', {
    description: 'Create a credit or debit card/account for logging purchases and expenses.',
    inputSchema: z.object({
      name: z.string().trim().min(1).max(100),
      type: z.enum(['Credit', 'Debit']),
      last4: z.string().regex(/^\d{4}$/, 'last4 must be exactly 4 digits').optional(),
      cashback_rate: z.number().min(0).max(100).optional().describe('Default cashback percent, e.g. 2 for 2%. Defaults to 0.'),
    }).strict(),
  }, async ({ name, type, last4, cashback_rate }) => {
    try {
      const created = await prisma.$transaction(async (tx) => {
        const existing = await tx.paymentMethod.findFirst({
          where: { user_id: userId, name: { equals: name, mode: 'insensitive' } },
        });
        if (existing) throw toolError(`A payment method named "${existing.name}" (${existing.type}) already exists`);
        // Same defaults as POST /api/payment-methods; default_cashback_rate is
        // the percent itself, and its _decimal twin is filled by the trigger.
        const method = await tx.paymentMethod.create({
          data: { user_id: userId, name, type, default_cashback_rate: cashback_rate ?? 0, last4: last4 || null },
        });
        await recordChanges(tx, userId, 'PaymentMethod', method.id, [
          { field: 'created', oldValue: null, newValue: `${method.name} (${method.type})` },
        ]);
        return method;
      });
      await logWrite(userId, apiKeyId, 'add_payment_method', { name, type, last4, cashback_rate });
      return jsonResult({
        id: created.id,
        name: created.name,
        type: created.type,
        last4: created.last4 || null,
        cashback_rate: toNum(created.default_cashback_rate),
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to add payment method');
    }
  });

  // ------------------------------------------------------------------ voids

  // Both void tools go through statusTransitions.applyTransition, the same
  // function the website's status-action routes use, so status, legacy status,
  // timestamps and the inventory restore behave identically. Nothing is ever
  // deleted.
  const confirmFlag = z.literal(true).describe('Must be true to confirm the void.');

  server.registerTool('void_sale', {
    description: 'Void a mistaken sale: marks it cancelled and puts its quantity back in stock.',
    inputSchema: z.object({
      sale_id: z.string().uuid(),
      reason: z.string().trim().min(1).max(500),
      confirm: confirmFlag,
    }).strict(),
  }, async ({ sale_id, reason, confirm }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.sales.findUnique({ where: { id: sale_id }, include: { inventory: true } });
        if (!existing || existing.inventory.user_id !== userId) throw toolError('Sale not found or access denied');
        if (existing.voided_at) {
          throw toolError(`Sale was already voided on ${new Date(existing.voided_at).toISOString()}`);
        }
        if (!statusTransitions.isActionAllowed(existing, 'sale', 'void_sale')) {
          throw toolError(`This sale cannot be voided from its current status (${existing.workflow_status || existing.status || 'none'})`);
        }

        const transition = await statusTransitions.applyTransition(tx, 'sale', existing, 'void_sale', { user_id: userId });
        const updated = await tx.sales.update({ where: { id: sale_id }, data: { void_reason: reason } });
        await recordChanges(tx, userId, 'Sales', sale_id, [
          { field: 'voided', oldValue: null, newValue: new Date(updated.voided_at).toISOString() },
          { field: 'void_reason', oldValue: existing.void_reason ?? null, newValue: reason },
          { field: 'workflow_status', oldValue: transition.from, newValue: transition.to },
        ]);
        return { updated, restored: transition.restored };
      });
      await logWrite(userId, apiKeyId, 'void_sale', { sale_id, reason, confirm });
      return jsonResult({
        id: result.updated.id,
        status: result.updated.workflow_status,
        voided_at: new Date(result.updated.voided_at).toISOString(),
        void_reason: result.updated.void_reason,
        qty_restored: result.restored,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to void sale');
    }
  });

  const isClosedSale = (sale) => Boolean(sale.voided_at)
    || sale.workflow_status === 'CANCELLED'
    || String(sale.status || '').toUpperCase() === 'CANCELLED';

  server.registerTool('void_purchase', {
    description: 'Void a mistaken purchase by cancelling it; its sales must be voided first.',
    inputSchema: z.object({
      purchase_id: z.string().uuid(),
      reason: z.string().trim().min(1).max(500),
      confirm: confirmFlag,
    }).strict(),
  }, async ({ purchase_id, reason, confirm }) => {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.inventory.findUnique({ where: { id: purchase_id } });
        if (!existing || existing.user_id !== userId) throw toolError('Purchase not found or access denied');
        if (existing.cancelled_at) {
          throw toolError(`Purchase was already cancelled on ${new Date(existing.cancelled_at).toISOString()}`);
        }
        if (!statusTransitions.isActionAllowed(existing, 'inventory', 'cancel')) {
          throw toolError(`This purchase cannot be voided from its current receiving status (${existing.receiving_status || 'none'}); only purchases not yet received can be cancelled`);
        }

        // The cancel transition is guarded only on receiving_status, which it
        // does not change, so claim the row on cancelled_at first: a second
        // concurrent void blocks here and then matches nothing. Taking the row
        // lock before reading the sales also means a concurrent add_sale has
        // either committed (and is seen below) or waits for this to finish.
        const claim = await tx.inventory.updateMany({
          where: { id: purchase_id, user_id: userId, cancelled_at: null },
          data: { void_reason: reason },
        });
        if (claim.count !== 1) throw toolError('Purchase was already cancelled');

        const sales = await tx.sales.findMany({
          where: { inventory_id: purchase_id },
          select: { id: true, status: true, workflow_status: true, voided_at: true },
        });
        const live = sales.filter((s) => !isClosedSale(s));
        if (live.length) {
          throw toolError(`Purchase still has ${live.length} sale(s) that are not voided or cancelled; void them first: ${live.map((s) => s.id).join(', ')}`);
        }

        const transition = await statusTransitions.applyTransition(tx, 'inventory', existing, 'cancel', { user_id: userId });
        await recordChanges(tx, userId, 'Inventory', purchase_id, [
          { field: 'voided', oldValue: null, newValue: new Date(transition.record.cancelled_at).toISOString() },
          { field: 'void_reason', oldValue: existing.void_reason ?? null, newValue: reason },
        ]);
        return transition.record;
      });
      await logWrite(userId, apiKeyId, 'void_purchase', { purchase_id, reason, confirm });
      return jsonResult({
        id: updated.id,
        item: updated.product_name,
        cancelled_at: new Date(updated.cancelled_at).toISOString(),
        void_reason: updated.void_reason,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to void purchase');
    }
  });

  // ------------------------------------------------------------------ notes

  // Compact row shared by the note tools. `product` is the linked purchase's
  // product name (a sale's comes via its purchase).
  const noteRow = (note, product, withDeleted = false) => ({
    id: note.id,
    entity_type: note.entity_type,
    entity_id: note.entity_id,
    product: product ?? null,
    ...transactionNotes.serializeNote(note),
    ...(withDeleted ? { deleted_at: note.deleted_at ? new Date(note.deleted_at).toISOString() : null } : {}),
  });
  const noteProduct = async (note) => (await transactionNotes.findOwnedEntity(prisma, userId, note.entity_type, note.entity_id))?.product_name ?? null;

  const refundJson = (refund) => ({
    id: refund.id,
    purchase_id: refund.inventory_id ?? null,
    sale_id: refund.sale_id ?? null,
    amount: toNum(decimal(refund.amount).toDecimalPlaces(2)),
    units_returned: refund.quantity,
    date: toDateOnly(refund.date),
    note: refund.note ?? null,
  });
  const refundTarget = {
    purchase_id: z.string().uuid().optional().describe('The purchase, for money back from the store. Give this or sale_id, not both.'),
    sale_id: z.string().uuid().optional().describe('The sale, for money back to a buyer. Give this or purchase_id, not both.'),
  };

  server.registerTool('list_refunds', {
    description: 'List the refunds on one purchase or one sale, newest first.',
    inputSchema: z.object(refundTarget).strict(),
  }, async ({ purchase_id, sale_id }) => {
    try {
      const refunds = await listRefunds(userId, { inventory_id: purchase_id, sale_id });
      return jsonResult(refunds.map(refundJson));
    } catch (err) {
      return errorResult(err.message || 'Failed to list refunds');
    }
  });

  server.registerTool('add_refund', {
    description: 'Record a refund instead of deleting a transaction. On a purchase: money back from the store, lowering its cost. On a sale: money back to the buyer, lowering its revenue while fees and the label stay as costs. units_returned is how many units physically came back (0 for a price adjustment or when the item stays put): on a purchase they leave stock, on a sale they go back into stock.',
    inputSchema: z.object({
      ...refundTarget,
      amount: z.number().nonnegative().describe('Refunded amount in dollars. For a sale, what you are actually out after any fee credit.'),
      units_returned: z.number().int().min(0).optional().describe('Defaults to 0.'),
      date: strictDate.describe('Day the refund happened (YYYY-MM-DD). On the Credit Card page a store refund is a credit in this month.'),
      note: z.string().max(2000).optional(),
    }).strict(),
  }, async ({ purchase_id, sale_id, amount, units_returned, date, note }) => {
    try {
      const refund = await recordRefund(userId, { inventory_id: purchase_id, sale_id, amount, quantity: units_returned, date, note });
      await logWrite(userId, apiKeyId, 'add_refund', { purchase_id, sale_id, amount, units_returned, date, note });
      return jsonResult(refundJson(refund));
    } catch (err) {
      return errorResult(err.message || 'Failed to add refund');
    }
  });

  server.registerTool('delete_refund', {
    description: 'Remove a refund entered by mistake. Undoes it exactly: cost or revenue and stock go back. Refused if the returned units were sold again, or the sale has been cancelled, returned or disputed.',
    inputSchema: z.object({
      refund_id: z.string().uuid(),
      confirm: z.literal(true).describe('Must be true to confirm removing the refund.'),
    }).strict(),
  }, async ({ refund_id, confirm }) => {
    try {
      const refund = await removeRefund(userId, refund_id);
      await logWrite(userId, apiKeyId, 'delete_refund', { refund_id, confirm });
      return jsonResult({ deleted: true, ...refundJson(refund) });
    } catch (err) {
      return errorResult(err.message || 'Failed to delete refund');
    }
  });

  server.registerTool('add_note', {
    description: 'Add a dated note to one sale or purchase.',
    inputSchema: z.object({
      entity_type: z.enum(['sale', 'purchase']),
      entity_id: z.string().uuid().describe('The sale id or purchase id.'),
      body: z.string().min(1).max(2000),
      pinned: z.boolean().optional().describe('Pinned notes list first. Defaults to false.'),
    }).strict(),
  }, async ({ entity_type, entity_id, body, pinned }) => {
    try {
      const { note, product } = await prisma.$transaction((tx) => transactionNotes.createNote(
        tx, userId, { entity_type, entity_id, body, pinned, author: 'bot' }, 'mcp',
      ));
      await logWrite(userId, apiKeyId, 'add_note', { entity_type, entity_id, body, pinned });
      return jsonResult(noteRow(note, product));
    } catch (err) {
      return errorResult(err.message || 'Failed to add note');
    }
  });

  server.registerTool('list_notes', {
    description: 'List notes on sales and purchases, pinned first then newest, with optional filters.',
    inputSchema: z.object({
      entity_type: z.enum(['sale', 'purchase']).optional().describe('Use together with entity_id.'),
      entity_id: z.string().uuid().optional().describe('Use together with entity_type.'),
      product: z.string().min(1).optional().describe('Case-insensitive partial match on the product name.'),
      start_date: strictDate.optional().describe('YYYY-MM-DD, inclusive, on when the note was written.'),
      end_date: strictDate.optional().describe('YYYY-MM-DD, inclusive, on when the note was written.'),
      text: z.string().min(1).optional().describe('Case-insensitive search in the note text.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
      include_deleted: z.boolean().optional().describe('Default false.'),
    }).strict(),
  }, async ({ entity_type, entity_id, product, start_date, end_date, text, limit, include_deleted }) => {
    try {
      if ((entity_type === undefined) !== (entity_id === undefined)) {
        throw Object.assign(new Error('entity_type and entity_id must be given together'), { toolError: true });
      }
      const where = { user_id: userId };
      if (!include_deleted) where.deleted_at = null;

      // Which product's shared ProductNote to return, if any.
      let productNoteName;
      if (entity_type) {
        const entity = await transactionNotes.requireOwnedEntity(prisma, userId, entity_type, entity_id);
        where.entity_type = entity_type;
        where.entity_id = entity_id;
        productNoteName = transactionNotes.normalizeProductName(entity.product_name);
      }
      if (product !== undefined) {
        const term = product.trim();
        if (!term) throw Object.assign(new Error('product cannot be blank'), { toolError: true });
        const invs = await prisma.inventory.findMany({
          where: { user_id: userId, product_name: { contains: term, mode: 'insensitive' } },
          select: { id: true, product_name: true },
        });
        const invIds = invs.map((i) => i.id);
        const sales = invIds.length
          ? await prisma.sales.findMany({ where: { inventory_id: { in: invIds } }, select: { id: true } })
          : [];
        where.AND = [{ OR: [
          { entity_type: 'purchase', entity_id: { in: invIds } },
          { entity_type: 'sale', entity_id: { in: sales.map((s) => s.id) } },
        ] }];
        if (productNoteName === undefined) {
          // Exact product name first; otherwise, if the partial match landed
          // on exactly one product, that product's shared note.
          productNoteName = transactionNotes.normalizeProductName(term);
          const exact = await prisma.productNote.findFirst({ where: { user_id: userId, product_name: productNoteName } });
          const distinct = [...new Set(invs.map((i) => transactionNotes.normalizeProductName(i.product_name)))];
          if (!exact && distinct.length === 1) productNoteName = distinct[0];
        }
      }
      if (start_date || end_date) {
        where.created_at = {};
        if (start_date) where.created_at.gte = new Date(`${start_date}T00:00:00.000Z`);
        if (end_date) where.created_at.lte = new Date(`${end_date}T23:59:59.999Z`);
      }
      if (text !== undefined) where.body = { contains: text, mode: 'insensitive' };

      const notes = await prisma.transactionNote.findMany({ where, orderBy: transactionNotes.ORDER, take: limit ?? 20 });
      const names = await transactionNotes.productNamesFor(prisma, userId, notes);
      const result = {};
      if (productNoteName !== undefined) {
        const record = await prisma.productNote.findFirst({ where: { user_id: userId, product_name: productNoteName } });
        result.product_note = record?.note ?? null;
      }
      result.notes = notes.map((n) => noteRow(n, names.get(`${n.entity_type}:${n.entity_id}`), include_deleted === true));
      return jsonResult(result);
    } catch (err) {
      return errorResult(err.message || 'Failed to list notes');
    }
  });

  server.registerTool('update_note', {
    description: 'Edit a note\'s text or pinned flag.',
    inputSchema: z.object({
      note_id: z.string().uuid(),
      body: z.string().min(1).max(2000).optional(),
      pinned: z.boolean().optional(),
    }).strict(),
  }, async ({ note_id, body, pinned }) => {
    try {
      if (body === undefined && pinned === undefined) {
        throw Object.assign(new Error('Provide body and/or pinned'), { toolError: true });
      }
      const note = await prisma.$transaction((tx) => transactionNotes.updateNote(tx, userId, note_id, { body, pinned }, 'mcp'));
      await logWrite(userId, apiKeyId, 'update_note', { note_id, body, pinned });
      return jsonResult(noteRow(note, await noteProduct(note)));
    } catch (err) {
      return errorResult(err.message || 'Failed to update note');
    }
  });

  server.registerTool('delete_note', {
    description: 'Soft-delete a note; list_notes with include_deleted still shows it.',
    inputSchema: z.object({
      note_id: z.string().uuid(),
    }).strict(),
  }, async ({ note_id }) => {
    try {
      const note = await prisma.$transaction((tx) => transactionNotes.deleteNote(tx, userId, note_id, 'mcp'));
      await logWrite(userId, apiKeyId, 'delete_note', { note_id });
      return jsonResult(noteRow(note, await noteProduct(note), true));
    } catch (err) {
      return errorResult(err.message || 'Failed to delete note');
    }
  });

  // ------------------------------------------------------------ attachments

  const attachmentRow = (a) => ({
    id: a.id,
    entity_type: a.entity_type,
    entity_id: a.entity_id,
    url: a.url,
    label: a.label ?? null,
    kind: a.kind ?? null,
    created_at: new Date(a.created_at).toISOString(),
  });
  // Best-effort guess when the caller leaves kind out.
  const inferAttachmentKind = (url, label) => {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() === 'mail.google.com') return 'gmail';
    const mentionsLabel = /label/i.test(url) || /label/i.test(label || '');
    if (parsed.pathname.toLowerCase().endsWith('.pdf') && mentionsLabel) return 'label';
    return 'other';
  };

  server.registerTool('add_attachment', {
    description: 'Attach a link (Gmail thread, receipt, shipping label) to one sale or purchase.',
    inputSchema: z.object({
      entity_type: z.enum(['sale', 'purchase']),
      entity_id: z.string().uuid().describe('The sale id or purchase id.'),
      url: z.string().max(2000).url().refine((value) => {
        try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
      }, 'url must start with http:// or https://'),
      label: z.string().max(200).optional(),
      kind: z.enum(['gmail', 'receipt', 'label', 'other']).optional().describe('Inferred from the url when omitted.'),
    }).strict(),
  }, async ({ entity_type, entity_id, url, label, kind }) => {
    try {
      const resolvedKind = kind ?? inferAttachmentKind(url, label);
      const created = await prisma.$transaction(async (tx) => {
        const entity = await transactionNotes.findOwnedEntity(tx, userId, entity_type, entity_id);
        if (!entity) throw toolError(`${entity_type === 'sale' ? 'Sale' : 'Purchase'} not found or access denied`);
        const duplicate = await tx.attachment.findFirst({ where: { user_id: userId, entity_type, entity_id, url } });
        if (duplicate) throw toolError('That url is already attached to this record');
        const attachment = await tx.attachment.create({
          data: { user_id: userId, entity_type, entity_id, url, label: label ?? null, kind: resolvedKind },
        });
        await recordChanges(tx, userId, transactionNotes.TABLE_FOR[entity_type], entity_id, [
          { field: 'attachment_added', oldValue: null, newValue: url },
        ]);
        return attachment;
      });
      await logWrite(userId, apiKeyId, 'add_attachment', { entity_type, entity_id, url, label, kind });
      return jsonResult(attachmentRow(created));
    } catch (err) {
      return errorResult(err.message || 'Failed to add attachment');
    }
  });

  server.registerTool('list_attachments', {
    description: 'List attached links, newest first, optionally for one sale or purchase.',
    inputSchema: z.object({
      entity_type: z.enum(['sale', 'purchase']).optional().describe('Use together with entity_id.'),
      entity_id: z.string().uuid().optional().describe('Use together with entity_type.'),
      limit: z.number().int().min(1).max(100).optional().describe('Default 20.'),
    }).strict(),
  }, async ({ entity_type, entity_id, limit }) => {
    try {
      if ((entity_type === undefined) !== (entity_id === undefined)) {
        throw toolError('entity_type and entity_id must be given together');
      }
      const where = { user_id: userId };
      if (entity_type) {
        await transactionNotes.requireOwnedEntity(prisma, userId, entity_type, entity_id);
        where.entity_type = entity_type;
        where.entity_id = entity_id;
      }
      const rows = await prisma.attachment.findMany({ where, orderBy: { created_at: 'desc' }, take: limit ?? 20 });
      return jsonResult(rows.map(attachmentRow));
    } catch (err) {
      return errorResult(err.message || 'Failed to list attachments');
    }
  });

  // ----------------------------------------------------------- market value

  server.registerTool('set_market_value', {
    description: 'Set or clear (null) a purchase\'s current per-unit market value.',
    inputSchema: z.object({
      purchase_id: z.string().uuid(),
      market_value: z.number().min(0).max(999999999999.99).nullable().describe('Per unit. null clears it.'),
      market_source: z.string().max(100).optional().describe('e.g. "eBay sold comps".'),
      checked_at: strictDate.optional().describe('YYYY-MM-DD. Defaults to today.'),
    }).strict(),
  }, async ({ purchase_id, market_value, market_source, checked_at }) => {
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const existing = await tx.inventory.findUnique({ where: { id: purchase_id } });
        if (!existing || existing.user_id !== userId) throw toolError('Purchase not found or access denied');

        // Clearing (null) clears all three fields; setting keeps the previous
        // source unless a new one is given.
        const clearing = market_value === null;
        const newValueStr = clearing ? null : decimal(market_value).toDecimalPlaces(2).toFixed(2);
        const newSource = clearing ? null : (market_source ?? existing.market_source ?? null);
        const newCheckedStr = clearing ? null : (checked_at ?? new Date().toISOString().slice(0, 10));

        const hasOld = existing.market_value !== null && existing.market_value !== undefined;
        const oldValueStr = hasOld ? decimal(existing.market_value).toFixed(2) : null;
        const oldCheckedStr = existing.market_checked_at ? toDateOnly(existing.market_checked_at) : null;

        const data = {};
        const changes = [];
        if (oldValueStr !== newValueStr) {
          data.market_value = newValueStr;
          changes.push({ field: 'market_value', oldValue: oldValueStr, newValue: newValueStr });
        }
        if ((existing.market_source ?? null) !== newSource) {
          data.market_source = newSource;
          changes.push({ field: 'market_source', oldValue: existing.market_source ?? null, newValue: newSource });
        }
        if (oldCheckedStr !== newCheckedStr) {
          data.market_checked_at = newCheckedStr === null ? null : localNoon(newCheckedStr);
          changes.push({ field: 'market_checked_at', oldValue: oldCheckedStr, newValue: newCheckedStr });
        }
        if (!changes.length) return existing;
        const row = await tx.inventory.update({ where: { id: purchase_id }, data });
        await recordChanges(tx, userId, 'Inventory', purchase_id, changes);
        return row;
      });
      await logWrite(userId, apiKeyId, 'set_market_value', { purchase_id, market_value, market_source, checked_at });

      const qty = updated.qty_on_hand;
      const priced = updated.market_value !== null && updated.market_value !== undefined;
      const unrealized = priced ? decimal(updated.market_value).times(qty).minus(allocatedCost(updated, qty)) : null;
      return jsonResult({
        id: updated.id,
        item: updated.product_name,
        qty_on_hand: qty,
        market_value: priced ? toNum(decimal(updated.market_value)) : null,
        market_source: updated.market_source ?? null,
        market_checked_at: updated.market_checked_at ? toDateOnly(updated.market_checked_at) : null,
        unit_cost_basis: toNum(allocatedCost(updated, 1).toDecimalPlaces(2)),
        unrealized_profit: unrealized === null ? null : toNum(unrealized.toDecimalPlaces(2)),
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to set market value');
    }
  });

  // ---------------------------------------------------- search and profit

  // A purchase is out of the product-level profit picture once cancelled by
  // either path (same test get_cashflow_summary uses for live stock).
  const isCancelledInventory = (inv) => Boolean(inv.cancelled_at)
    || inv.receiving_status === 'CANCELLED'
    || String(inv.status || '').toUpperCase() === 'CANCELLED';
  // Counts toward profit: realized by status and not voided.
  const countsAsRealized = (sale) => isRealizedSale(sale) && !sale.voided_at;
  const money2 = (d) => toNum(d.toDecimalPlaces(2));

  server.registerTool('search', {
    description: 'Search purchases, sales and notes by text, newest first.',
    inputSchema: z.object({
      query: z.string().min(1).max(200).describe('Case-insensitive substring: product, order number, tracking, store, platform, buyer, or note text.'),
      types: z.array(z.enum(['purchase', 'sale', 'note'])).min(1).optional().describe('Default all three.'),
      limit: z.number().int().min(1).max(50).optional().describe('Default 10.'),
    }).strict(),
  }, async ({ query, types, limit }) => {
    try {
      const term = query.trim().toLowerCase();
      if (!term) throw toolError('query cannot be blank');
      const want = new Set(types && types.length ? types : ['purchase', 'sale', 'note']);
      const hit = (...values) => values.some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(term));
      const rows = [];

      if (want.has('purchase')) {
        const inventories = await prisma.inventory.findMany({ where: { user_id: userId }, include: { vendor: true } });
        for (const inv of inventories) {
          if (!hit(inv.product_name, inv.order_number, inv.tracking_number, inv.vendor?.name)) continue;
          rows.push({
            sortKey: new Date(inv.purchase_date).getTime(),
            row: {
              id: inv.id,
              type: 'purchase',
              name: inv.product_name,
              date: toDateOnly(inv.purchase_date),
              amount: money2(batchCost(inv)),
              status: inv.cancelled_at ? 'CANCELLED' : (inv.receiving_status || inv.status || null),
              availability: inv.cancelled_at ? null : statusTransitions.availabilityLabel(inv),
            },
          });
        }
      }
      if (want.has('sale')) {
        const sales = await prisma.sales.findMany({
          where: { inventory: { user_id: userId } },
          include: { inventory: true, platform: true, buyer: true },
        });
        for (const s of sales) {
          if (!hit(s.inventory?.product_name, s.tracking_number, s.platform?.name, s.buyer?.name, s.inventory?.order_number)) continue;
          rows.push({
            sortKey: new Date(s.sale_date).getTime(),
            row: {
              id: s.id,
              type: 'sale',
              name: s.inventory?.product_name ?? null,
              date: toDateOnly(s.sale_date),
              amount: money2(saleEconomics(s.inventory, s).revenue),
              status: s.workflow_status || s.status || null,
            },
          });
        }
      }
      if (want.has('note')) {
        const notes = await prisma.transactionNote.findMany({ where: { user_id: userId, deleted_at: null } });
        for (const n of notes) {
          if (!hit(n.body)) continue;
          rows.push({
            sortKey: new Date(n.created_at).getTime(),
            row: {
              id: n.id,
              type: 'note',
              name: String(n.body).slice(0, 80),
              date: toDateOnly(n.created_at),
              amount: null,
              status: n.entity_type,
              parent_id: n.entity_id,
            },
          });
        }
      }

      rows.sort((a, b) => (b.sortKey || 0) - (a.sortKey || 0));
      const max = limit ?? 10;
      return jsonResult({ results: rows.slice(0, max).map((r) => r.row), truncated: rows.length > max });
    } catch (err) {
      return errorResult(err.message || 'Failed to search');
    }
  });

  server.registerTool('get_item_profit', {
    description: 'Profit for one purchase, one sale, or every purchase of a product. net_profit = revenue - fees - shipping - refunds_to_buyers - cost_of_units_sold + cashback, over realized sales only. revenue is the gross sale price; refunds_to_buyers is money refunded on those sales; units a buyer returned are back in stock and not counted as sold; fees/shipping are sale-side; cost_of_units_sold already includes tax, purchase fees and inbound shipping (shown in purchase_fees_and_shipping); cashback is card cashback on the units sold.',
    inputSchema: z.object({
      purchase_id: z.string().uuid().optional(),
      sale_id: z.string().uuid().optional(),
      product: z.string().min(1).max(200).optional().describe('Exact product name, case-insensitive.'),
    }).strict(),
  }, async ({ purchase_id, sale_id, product }) => {
    try {
      const given = [purchase_id, sale_id, product].filter((v) => v !== undefined).length;
      if (given !== 1) throw toolError('Give exactly one of purchase_id, sale_id, or product');

      const zero = () => decimal(0);
      const totals = {
        units_bought: 0, units_sold: 0, units_on_hand: 0,
        total_cost: zero(), cost_of_units_sold: zero(), purchase_fees_and_shipping: zero(),
        revenue: zero(), fees: zero(), shipping: zero(), refunds: zero(), cashback: zero(),
        sales_count: 0, excluded_sales: 0,
      };
      // Realized sales only, priced with saleEconomics so net_profit is the
      // same profit the analytics routes report. Each component is reported
      // on its own so the formula in the description adds up.
      const addSale = (inv, sale) => {
        if (!countsAsRealized(sale)) { totals.excluded_sales += 1; return; }
        const econ = saleEconomics(inv, sale);
        const qty = Number(sale.quantity) || 0;
        // Units the buyer kept, out of the units the batch kept after store returns.
        const kept = keptSaleQuantity(sale);
        const purchased = keptQuantity(inv);
        totals.units_sold += kept;
        totals.cost_of_units_sold = totals.cost_of_units_sold.plus(econ.cost);
        if (purchased > 0) {
          totals.purchase_fees_and_shipping = totals.purchase_fees_and_shipping.plus(
            decimal(inv.fees || 0).plus(decimal(inv.shipping_cost_inbound || 0)).times(kept).div(purchased),
          );
        }
        totals.revenue = totals.revenue.plus(decimal(sale.unit_price || 0).times(qty));
        totals.fees = totals.fees.plus(decimal(sale.commission_fee || 0));
        totals.shipping = totals.shipping.plus(decimal(sale.sale_shipping || 0));
        totals.refunds = totals.refunds.plus(decimal(sale.refunded_amount || 0));
        totals.cashback = totals.cashback.plus(econ.cashback);
        totals.sales_count += 1;
      };
      const addPurchase = (inv) => {
        totals.units_bought += keptQuantity(inv);
        totals.units_on_hand += Number(inv.qty_on_hand) || 0;
        totals.total_cost = totals.total_cost.plus(batchCost(inv));
        for (const sale of inv.sales || []) addSale(inv, sale);
      };

      let scope;
      let productName;
      if (purchase_id) {
        scope = 'purchase';
        const inv = await prisma.inventory.findFirst({
          where: { id: purchase_id, user_id: userId },
          include: { vendor: true, payment_method: true, sales: true },
        });
        if (!inv) throw toolError('Purchase not found or access denied');
        productName = inv.product_name;
        addPurchase(inv);
      } else if (sale_id) {
        scope = 'sale';
        const sale = await prisma.sales.findUnique({
          where: { id: sale_id },
          include: { inventory: { include: { vendor: true, payment_method: true } } },
        });
        if (!sale || !sale.inventory || sale.inventory.user_id !== userId) throw toolError('Sale not found or access denied');
        const inv = sale.inventory;
        productName = inv.product_name;
        // One sale: its cost is the allocated cost of its own units.
        const qty = keptSaleQuantity(sale);
        totals.units_bought = qty;
        totals.units_on_hand = null;
        totals.total_cost = allocatedCost(inv, qty);
        addSale(inv, sale);
      } else {
        scope = 'product';
        const wanted = product.trim().toLowerCase();
        if (!wanted) throw toolError('product cannot be blank');
        const inventories = (await prisma.inventory.findMany({
          where: { user_id: userId },
          include: { vendor: true, payment_method: true, sales: true },
        })).filter((inv) => !isCancelledInventory(inv));
        const matched = inventories.filter((inv) => String(inv.product_name || '').trim().toLowerCase() === wanted);
        if (!matched.length) {
          const names = [...new Set(inventories.map((inv) => String(inv.product_name || '').trim()).filter(Boolean))];
          const words = wanted.split(/\s+/).filter((w) => w.length > 1);
          const suggestions = names.filter((name) => {
            const lower = name.toLowerCase();
            return lower.includes(wanted) || wanted.includes(lower) || words.some((w) => lower.includes(w));
          }).slice(0, 5);
          throw toolError(`No purchases of "${product.trim()}".${suggestions.length ? ` Did you mean: ${suggestions.join(', ')}` : ''}`);
        }
        productName = matched[0].product_name;
        for (const inv of matched) addPurchase(inv);
      }

      // Built from the rounded components so the published formula holds to
      // the cent (at most a cent off the unrounded analytics figure).
      const r = (d) => decimal(money2(d));
      const profitBeforeCashback = r(totals.revenue).minus(r(totals.fees)).minus(r(totals.shipping)).minus(r(totals.refunds)).minus(r(totals.cost_of_units_sold));
      const netProfit = profitBeforeCashback.plus(r(totals.cashback));
      return jsonResult({
        scope,
        product: productName,
        units_bought: totals.units_bought,
        units_sold: totals.units_sold,
        units_on_hand: totals.units_on_hand,
        availability: totals.units_on_hand === null ? null : statusTransitions.availabilityLabel({ qty_on_hand: totals.units_on_hand }),
        total_cost: money2(totals.total_cost),
        revenue: money2(totals.revenue),
        fees: money2(totals.fees),
        shipping: money2(totals.shipping),
        refunds_to_buyers: money2(totals.refunds),
        cost_of_units_sold: money2(totals.cost_of_units_sold),
        purchase_fees_and_shipping: money2(totals.purchase_fees_and_shipping),
        profit_before_cashback: money2(profitBeforeCashback),
        cashback: money2(totals.cashback),
        net_profit: money2(netProfit),
        roi_pct: totals.cost_of_units_sold.isZero() ? null : money2(netProfit.div(totals.cost_of_units_sold).times(100)),
        sales_count: totals.sales_count,
        excluded_sales: totals.excluded_sales,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to compute profit');
    }
  });

  server.registerTool('list_changes', {
    description: 'List recent field-level changes (edits, voids, new platforms/cards, notes, attachments, market value), newest first, for review or manual reversal via old_value.',
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

  server.registerTool('list_cashout_deals', {
    description: 'List live deals from every connected cashout service. spread_vs_retail is payout minus retail, before tax, shipping or coupons -- not a guarantee of real profit. Raw payout/retail/vendor_limit_total are included so you can run your own math (e.g. spread x vendor_limit_total for total opportunity on one deal). Each item\'s upc field may actually be a manufacturer model/part number -- see id_type. connections in the response shows when each cashout\'s data was last synced.',
    inputSchema: {
      category: z.enum(['all', 'above_retail', 'close_to_retail']).optional().describe('above_retail: spread > 0. close_to_retail: spread <= 0 or unknown retail. Default all.'),
      store: z.string().optional().describe('Filter to deals buyable at this retailer (case-insensitive, partial match).'),
      cashout: z.string().optional().describe('Filter to one connected cashout service by its display name (case-insensitive, partial match).'),
      search: z.string().optional().describe('Match against the deal name, or any item UPC or model number.'),
      include_expired: z.boolean().optional().describe('Default false.'),
      sort: z.enum(['profit_desc', 'payout_desc', 'ending_soon']).optional().describe('Default profit_desc.'),
      limit: z.number().int().min(1).max(200).optional(),
    },
  }, async ({ category, store, cashout, search, include_expired: includeExpired, sort, limit }) => {
    try {
      const { deals, connections } = await loadLiveCashoutDeals(userId);
      const query = (search || '').toLowerCase();
      const storeQuery = (store || '').toLowerCase();
      const cashoutQuery = (cashout || '').toLowerCase();
      let filtered = deals.filter(({ deal }) => {
        if (!includeExpired && deal.is_expired) return false;
        if (cashoutQuery && !deal.cashout.toLowerCase().includes(cashoutQuery)) return false;
        if (storeQuery && !deal.items.some((item) => item.stores.some((s) => s.name.toLowerCase().includes(storeQuery)))) return false;
        if (category === 'above_retail' && !(deal.spread_vs_retail && deal.spread_vs_retail.amount > 0)) return false;
        if (category === 'close_to_retail' && !(!deal.spread_vs_retail || deal.spread_vs_retail.amount <= 0)) return false;
        if (query) {
          const nameMatch = deal.name.toLowerCase().includes(query);
          const upcMatch = deal.items.some((item) => item.upc && item.upc.toLowerCase().includes(query));
          if (!nameMatch && !upcMatch) return false;
        }
        return true;
      }).map(({ deal }) => deal);

      filtered.sort((a, b) => {
        if (sort === 'payout_desc') return b.payout - a.payout;
        if (sort === 'ending_soon') {
          const da = a.days_left ?? Infinity, db = b.days_left ?? Infinity;
          return da - db;
        }
        return (b.spread_vs_retail?.amount ?? -Infinity) - (a.spread_vs_retail?.amount ?? -Infinity);
      });

      const total = filtered.length;
      if (limit) filtered = filtered.slice(0, limit);
      return jsonResult({
        deals: filtered,
        total,
        truncated: filtered.length < total,
        connections: connections.map(({ conn }) => ({
          cashout: conn.displayName || conn.provider,
          synced_at: conn.lastSyncedAt || null,
        })),
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to list cashout deals');
    }
  });

  server.registerTool('get_cashout_deal', {
    description: 'Re-check one specific cashout deal right before buying, instead of trusting a cached list. Forces a fresh fetch (respecting the normal sync cooldown; falls back to the last known data if the cooldown is active or the refresh fails -- check "fresh" to tell which happened, and "stale_reason" for why). synced_at always comes from the connection\'s own last-synced record, the same source list_cashout_connections.last_synced_at uses, so a stale response can never claim to be newer than it is. If found is false, the deal has sold out, expired, or been pulled -- do not buy it.',
    inputSchema: { id: z.string().describe('The deal id from list_cashout_deals.') },
  }, async ({ id }) => {
    const connections = await cashoutService.listConnections(userId);
    for (const conn of connections) {
      let result;
      let fresh = true;
      let staleReason = null;
      let cooldownSecondsRemaining = null;
      let fetchError = null;
      try {
        result = await cashoutService.syncUserConnection(userId, conn.id);
      } catch (err) {
        fresh = false;
        if (err.cooldown) {
          staleReason = 'cooldown';
          cooldownSecondsRemaining = err.remainingSeconds ?? null;
        } else {
          staleReason = 'fetch_failed';
          fetchError = err.message;
        }
        try {
          result = await cashoutService.fetchConnectionDeals(userId, conn.id);
        } catch (err2) {
          continue;
        }
      }
      const match = (result.deals || []).find((d) => d.id === id);
      if (match) {
        // Re-read the connection rather than trust result.lastUpdated: this is
        // the same field list_cashout_connections.last_synced_at reads, so the
        // two can never disagree about when this cashout was last synced.
        const current = await cashoutService.getConnection(userId, conn.id);
        return jsonResult({
          found: true,
          fresh,
          stale_reason: staleReason,
          cooldown_seconds_remaining: cooldownSecondsRemaining,
          ...(fetchError ? { error: fetchError } : {}),
          synced_at: current.last_synced_at ? current.last_synced_at.toISOString() : null,
          deal: presentDeal(match, conn),
        });
      }
    }
    return jsonResult({ found: false, reason: 'This deal is no longer listed by any connected cashout -- it may have sold out, expired, or been pulled.' });
  });

  server.registerTool('get_cashout_opportunity_summary', {
    description: 'Aggregate stats across every live cashout deal. estimated_opportunity_at_full_limit is only an estimate of the opportunity -- it ignores real all-in cost (tax, shipping, coupons) and the risk EB rejects a unit, so treat it as a ceiling, not a forecast. by_store.deals_available_at_store counts deals buyable at that store; one deal can be buyable at several stores, so these counts can add up to more than live_deal_count.',
    inputSchema: {},
  }, async () => {
    try {
      const { deals, connections } = await loadLiveCashoutDeals(userId);
      const live = deals.map((d) => d.deal).filter((deal) => !deal.is_expired);
      const withSpread = live.filter((deal) => deal.spread_vs_retail);
      const aboveRetail = withSpread.filter((deal) => deal.spread_vs_retail.amount > 0);

      const best = withSpread.reduce((top, deal) => (
        !top || deal.spread_vs_retail.pct > top.spread_vs_retail.pct ? deal : top
      ), null);

      const opportunity = live.reduce((sum, deal) => (
        deal.spread_vs_retail && deal.vendor_limit_total
          ? sum + deal.spread_vs_retail.amount * deal.vendor_limit_total
          : sum
      ), 0);

      const byStoreCounts = new Map();
      for (const deal of live) {
        const stores = new Set(deal.items.flatMap((item) => item.stores.map((s) => s.name)));
        for (const store of stores) byStoreCounts.set(store, (byStoreCounts.get(store) || 0) + 1);
      }

      const byCashout = connections.map(({ conn, result }) => ({
        cashout: conn.displayName || conn.provider,
        deal_count: (result.deals || []).filter((d) => !d.expiresAt || new Date(d.expiresAt).getTime() > Date.now()).length,
        status: conn.status,
      }));

      return jsonResult({
        live_deal_count: live.length,
        above_retail_count: aboveRetail.length,
        best_margin: best ? { deal_id: best.id, deal_name: best.name, amount: best.spread_vs_retail.amount, pct: best.spread_vs_retail.pct } : null,
        avg_margin_pct: withSpread.length ? Math.round((withSpread.reduce((sum, d) => sum + d.spread_vs_retail.pct, 0) / withSpread.length) * 100) / 100 : null,
        estimated_opportunity_at_full_limit: Math.round(opportunity * 100) / 100,
        by_store: [...byStoreCounts.entries()].map(([store, count]) => ({ store, deals_available_at_store: count })),
        by_cashout: byCashout,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to summarize cashout deals');
    }
  });

  server.registerTool('list_cashout_connections', {
    description: 'List this account\'s connected cashout services and whether each one is working.',
    inputSchema: {},
  }, async () => {
    const connections = await cashoutService.listConnections(userId);
    return jsonResult(connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      display_name: c.displayName,
      status: c.status,
      last_synced_at: c.lastSyncedAt,
      last_error: c.lastError,
    })));
  });

  server.registerTool('sync_cashout_deals', {
    description: 'Read-only refresh: re-fetch live deals from a connected cashout service right now instead of waiting for the normal 60s cache. Never places or logs a purchase. Subject to the same cooldown as the "Sync now" button -- a connection still cooling down is reported, not retried.',
    inputSchema: {
      cashout: z.string().optional().describe('Limit to one connection by display name or provider (case-insensitive, partial match). Omit to sync every connection.'),
    },
  }, async ({ cashout }) => {
    const query = (cashout || '').toLowerCase();
    const connections = await cashoutService.listConnections(userId);
    const targets = query
      ? connections.filter((c) => (c.displayName || '').toLowerCase().includes(query) || c.provider.toLowerCase().includes(query))
      : connections;
    if (query && targets.length === 0) {
      return errorResult(`No connected cashout matches "${cashout}".`);
    }
    const results = await Promise.all(targets.map(async (conn) => {
      const name = conn.displayName || conn.provider;
      try {
        const result = await cashoutService.syncUserConnection(userId, conn.id);
        return { cashout: name, synced: true, deal_count: (result.deals || []).length, cooldown_seconds_remaining: null };
      } catch (err) {
        return { cashout: name, synced: false, cooldown_seconds_remaining: err.cooldown ? err.remainingSeconds : null, error: err.message };
      }
    }));
    return jsonResult({ results });
  });

  server.registerTool('list_cashout_commitments', {
    description: 'List this account\'s cashout commitments -- pledges already made to send units for a deal line item, at a price locked in regardless of later price changes. Read from our own records (which also carry tracking info the provider itself can\'t give back), not a live provider call.',
    inputSchema: {
      cashout: z.string().optional().describe('Filter to one connected cashout by display name or provider (case-insensitive, partial match).'),
      status: z.enum(['active', 'withdrawn']).optional().describe('Omit for all.'),
    },
  }, async ({ cashout, status }) => {
    try {
      let connectionId;
      if (cashout) connectionId = (await resolveConnection(userId, cashout)).id;
      const records = await cashoutCommits.listLocalCommitments(userId, { connectionId, status });
      return jsonResult(records.map(presentCommitment));
    } catch (err) {
      return errorResult(err.message || 'Failed to list cashout commitments');
    }
  });

  server.registerTool('commit_cashout_deal', {
    description: 'Pledge units to a cashout deal line item -- a real, binding commitment: the cashout will pay the price locked in now even if it drops later, and expects you to send that many units. One commitment per item; committing to an item you\'re already committed to fails rather than creating a second one. This does not submit tracking or record a purchase -- see log_cashout_purchase for the combined action used when you already have a tracking number in hand.',
    inputSchema: {
      cashout: z.string().optional().describe('Which connected cashout, by display name or provider. Omit when only one is connected.'),
      deal_id: z.string().describe('The deal id from list_cashout_deals.'),
      item_id: z.string().describe('The item_id from that deal\'s items[] (list_cashout_deals / get_cashout_deal).'),
      quantity: z.number().int().min(1).describe('Units to commit. Capped by the item\'s vendor_limit and what\'s left on the deal.'),
    },
  }, async ({ cashout, deal_id, item_id, quantity }) => {
    try {
      const conn = await resolveConnection(userId, cashout);
      const record = await cashoutCommits.createCommitment(userId, conn.id, { dealId: deal_id, itemId: item_id, quantity });
      await logWrite(userId, apiKeyId, 'commit_cashout_deal', { cashout: conn.displayName || conn.provider, deal_id, item_id, quantity });
      return jsonResult(presentCommitment({ ...record, connection: conn }));
    } catch (err) {
      return errorResult(err.message || 'Failed to commit to this deal');
    }
  });

  server.registerTool('update_cashout_commitment', {
    description: 'Change the quantity on an existing cashout commitment. Must stay at least 1 -- use delete_cashout_commitment to withdraw entirely.',
    inputSchema: {
      commitment_id: z.string().describe('The id from list_cashout_commitments / commit_cashout_deal (our own record id, not the provider\'s).'),
      quantity: z.number().int().min(1),
    },
  }, async ({ commitment_id, quantity }) => {
    try {
      const record = await cashoutCommits.updateCommitment(userId, commitment_id, { quantity });
      await logWrite(userId, apiKeyId, 'update_cashout_commitment', { commitment_id, quantity });
      return jsonResult(presentCommitment(record));
    } catch (err) {
      return errorResult(err.message || 'Failed to update this commitment');
    }
  });

  server.registerTool('delete_cashout_commitment', {
    description: 'Withdraw a cashout commitment. The pledged quantity is freed back to the deal on the provider\'s side immediately -- you can re-commit while the deal is still active. The local record is kept, marked withdrawn, not deleted, so any purchase already logged against it keeps its history.',
    inputSchema: { commitment_id: z.string().describe('The id from list_cashout_commitments / commit_cashout_deal.') },
  }, async ({ commitment_id }) => {
    try {
      const record = await cashoutCommits.deleteCommitment(userId, commitment_id);
      await logWrite(userId, apiKeyId, 'delete_cashout_commitment', { commitment_id });
      return jsonResult(presentCommitment(record));
    } catch (err) {
      return errorResult(err.message || 'Failed to withdraw this commitment');
    }
  });

  server.registerTool('submit_cashout_tracking', {
    description: 'Submit inbound shipment tracking numbers to a cashout, on their own (not tied to a specific commitment on the provider\'s side -- it has no such link, only a free-text description). Each code must be 24 characters or fewer; the same codes submitted again within 14 days are rejected, and each account has an unpublished weekly cap -- on that specific error, do not retry automatically.',
    inputSchema: {
      cashout: z.string().optional().describe('Which connected cashout. Omit when only one is connected.'),
      tracking_codes: z.array(z.string()).min(1).describe('Tracking numbers, 24 characters or fewer each.'),
      description: z.string().describe('Brief note on what this shipment contains, e.g. the deal name.'),
      insured_value: z.number().min(200).max(1500).optional().describe('Declared insurance value in USD, $200-$1500. Omit to skip insurance.'),
    },
  }, async ({ cashout, tracking_codes: trackingCodes, description, insured_value: insuredValue }) => {
    try {
      const conn = await resolveConnection(userId, cashout);
      const result = await cashoutCommits.submitTracking(userId, conn.id, { trackingCodes, description, insuredValue });
      await logWrite(userId, apiKeyId, 'submit_cashout_tracking', { cashout: conn.displayName || conn.provider, tracking_codes: trackingCodes });
      return jsonResult({ received_tracking_codes: result?.received_tracking_codes || [] });
    } catch (err) {
      return errorResult(err.message || 'Failed to submit tracking');
    }
  });

  server.registerTool('list_cashout_tracking_submissions', {
    description: 'List tracking numbers previously submitted to a cashout, newest first. This is the provider\'s own record, not ours -- it has no link back to which commitment or purchase each one was for.',
    inputSchema: {
      cashout: z.string().optional().describe('Which connected cashout. Omit when only one is connected.'),
      limit: z.number().int().min(1).max(100).optional(),
      offset: z.number().int().min(0).optional(),
    },
  }, async ({ cashout, limit, offset }) => {
    try {
      const conn = await resolveConnection(userId, cashout);
      const result = await cashoutCommits.listTrackingSubmissions(userId, conn.id, { limit, offset });
      return jsonResult({ tracking_numbers: result?.tracking_numbers || [], total: result?.total ?? 0 });
    } catch (err) {
      return errorResult(err.message || 'Failed to list tracking submissions');
    }
  });

  server.registerTool('log_cashout_purchase', {
    description: 'The full action for a cashout item you have already bought and shipped: commits to the deal line item with the provider, submits the tracking number, then records the purchase and its sale in this app together (the same combined write Add Transaction does). Only call this once you actually have a tracking number -- it is required, since by the time this is used the item has shipped. If the commit itself is refused (deal closed, already committed, over the limit), nothing is written at all. If only the tracking submission fails, the purchase/sale/commitment are still saved, with the tracking failure reported back for a retry later via submit_cashout_tracking.',
    inputSchema: {
      cashout: z.string().optional().describe('Which connected cashout. Omit when only one is connected.'),
      deal_id: z.string().describe('The deal id from list_cashout_deals.'),
      item_id: z.string().describe('The item_id from that deal\'s items[].'),
      deal_name: z.string().optional().describe('For your own purchase record and the tracking description; defaults to a generic label if omitted.'),
      item_name: z.string().optional().describe('Defaults to deal_name if omitted.'),
      quantity: z.number().int().min(1),
      tracking_codes: z.array(z.string()).min(1).describe('At least one tracking number -- required.'),
      insured_value: z.number().min(200).max(1500).optional(),
      store: z.string().describe('Where you actually bought it (an existing Vendor by name, case-insensitive).'),
      payment_method: z.string().describe('Which saved payment method you used (by name).'),
      unit_cost: z.number().min(0).describe('What you actually paid per unit, including any coupon.'),
      tax_exempt: z.boolean().optional().describe('Default false.'),
      sales_tax: z.number().min(0).optional().describe('Total sales tax paid, default 0.'),
      cashback_rate: z.number().min(0).optional(),
      cashback_earned: z.number().min(0).optional(),
      unit_payout: z.number().min(0).describe('What the cashout will pay per unit -- the deal\'s payout price.'),
      purchase_date: z.string().optional().describe('YYYY-MM-DD, defaults to today.'),
      sale_date: z.string().optional().describe('YYYY-MM-DD, defaults to purchase_date.'),
    },
  }, async ({
    cashout, deal_id, item_id, deal_name, item_name, quantity, tracking_codes: trackingCodes, insured_value: insuredValue,
    store, payment_method, unit_cost: unitCost, tax_exempt: taxExempt, sales_tax: salesTax,
    cashback_rate: cashbackRate, cashback_earned: cashbackEarned, unit_payout: unitPayout, purchase_date: purchaseDate, sale_date: saleDate,
  }) => {
    try {
      const conn = await resolveConnection(userId, cashout);
      const vendor = await findOrCreateVendor(userId, store);
      const paymentMethod = await findPaymentMethod(userId, payment_method);
      const result = await logPurchase(userId, {
        connectionId: conn.id, dealId: deal_id, itemId: item_id, dealName: deal_name, itemName: item_name,
        quantity, trackingCodes, insuredValue,
        vendorId: vendor.id, paymentMethodId: paymentMethod.id, unitCost, taxExempt, salesTax,
        cashbackRate, cashbackEarned, purchaseDate, unitPayout, saleDate,
      });
      await logWrite(userId, apiKeyId, 'log_cashout_purchase', { cashout: conn.displayName || conn.provider, deal_id, item_id, quantity, tracking_codes: trackingCodes });
      return jsonResult({
        tracking_submitted: result.trackingSubmitted,
        tracking_error: result.trackingError,
        commitment: presentCommitment({ ...result.commitment, connection: conn }),
        purchase_id: result.inventory.id,
        sale_id: result.sale.id,
      });
    } catch (err) {
      return errorResult(err.message || 'Failed to log this purchase');
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
