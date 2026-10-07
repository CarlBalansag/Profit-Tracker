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
const { decimal, Decimal } = require('../services/money');
const { saleEconomics, allocatedCost, batchCost, isRealizedSale } = require('../services/decimalFinance');
const { payoutStatus } = require('../services/payoutStatus');
const { markSalesPaid } = require('../services/markSalesPaid');
const { findOrCreateBuyer } = require('../services/buyers');

const toDateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const toNum = (d) => (d === null || d === undefined ? 0 : (typeof d.toNumber === 'function' ? d.toNumber() : Number(d)));
const localNoon = (dateStr) => new Date(`${dateStr}T12:00:00.000Z`);

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

function buildServer(userId, apiKeyId) {
  const server = new McpServer({ name: 'selvora-profit-tracker', version: '1.0.0' }, { capabilities: {} });

  // ------------------------------------------------------------------ reads

  server.registerTool('list_sales', {
    description: 'List sales with optional filters. Dates are YYYY-MM-DD.',
    inputSchema: {
      start_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
      end_date: z.string().optional().describe('YYYY-MM-DD, inclusive'),
      buyer: z.string().optional().describe('Filter by buyer name (case-insensitive, partial match)'),
      payout_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
      limit: z.number().int().min(1).max(500).optional(),
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
      include: { inventory: { include: { vendor: true } }, buyer: true },
      orderBy: { sale_date: 'desc' },
      take: limit || 100,
    });
    const filtered = sales.filter((s) => {
      if (buyer && !(s.buyer?.name || '').toLowerCase().includes(buyer.toLowerCase())) return false;
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
        buyer: s.buyer?.name || null,
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
    description: 'Overall cash-flow snapshot: owed to you (sold but unpaid/short-paid), spend, on-hand inventory value, and how much the reselling business owes your personal account, broken down by buyer.',
    inputSchema: {},
  }, async () => {
    const [inventories, sales, expenses, personalMethods] = await Promise.all([
      prisma.inventory.findMany({ where: { user_id: userId } }),
      prisma.sales.findMany({ where: { inventory: { user_id: userId } }, include: { inventory: true, buyer: true } }),
      prisma.expense.findMany({ where: { user_id: userId } }),
      prisma.paymentMethod.findMany({ where: { user_id: userId, is_personal: true }, select: { id: true } }),
    ]);
    const personalIds = new Set(personalMethods.map((m) => m.id));
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
      const name = sale.buyer?.name || 'Unknown';
      const entry = byBuyer.get(name) || { buyer: name, revenue: decimal(0), owed: decimal(0) };
      entry.revenue = entry.revenue.plus(revenue);
      entry.owed = entry.owed.plus(owedForThis);
      byBuyer.set(name, entry);
    }

    // "Owed to personal account": unreimbursed spend on any purchase/expense
    // paid from a personal-flagged PaymentMethod, less every expense logged
    // under the "Owner Reimbursement" category (see PaymentMethod.is_personal
    // in prisma/schema.prisma).
    let personalSpend = decimal(0);
    for (const inv of inventories) if (personalIds.has(inv.payment_method_id)) personalSpend = personalSpend.plus(batchCost(inv));
    for (const exp of expenses) if (personalIds.has(exp.payment_method_id)) personalSpend = personalSpend.plus(decimal(exp.amount));
    const reimbursed = expenses
      .filter((e) => String(e.category || '').trim().toLowerCase() === 'owner reimbursement')
      .reduce((sum, e) => sum.plus(decimal(e.amount)), decimal(0));
    const owedToPersonal = Decimal.max(0, personalSpend.minus(reimbursed));

    return jsonResult({
      owed_to_me: toNum(owed.toDecimalPlaces(2)),
      coming_back: toNum(comingBack.toDecimalPlaces(2)),
      spent: toNum(spent.toDecimalPlaces(2)),
      on_hand_value: toNum(onHand.toDecimalPlaces(2)),
      owed_to_personal_account: toNum(owedToPersonal.toDecimalPlaces(2)),
      by_buyer: [...byBuyer.values()].map((b) => ({
        buyer: b.buyer,
        revenue: toNum(b.revenue.toDecimalPlaces(2)),
        owed: toNum(b.owed.toDecimalPlaces(2)),
      })),
    });
  });

  server.registerTool('get_unpaid_by_buyer', {
    description: 'Totals of sold-but-unpaid (and short-paid) sales, grouped by buyer.',
    inputSchema: {},
  }, async () => {
    const sales = await prisma.sales.findMany({ where: { inventory: { user_id: userId } }, include: { inventory: true, buyer: true } });
    const byBuyer = new Map();
    for (const sale of sales.filter(isRealizedSale)) {
      const status = payoutStatus(sale);
      if (status === 'paid') continue;
      const { revenue } = saleEconomics(sale.inventory, sale);
      const owedForThis = status === 'unpaid' ? revenue : decimal(sale.payout_short_amount || 0);
      const name = sale.buyer?.name || 'Unknown';
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
      buyer: z.string().optional().describe('Who paid, e.g. "Windy City", "Blake". Created automatically if new; applied to every sale in this batch.'),
    },
  }, async ({ sale_ids, payout_date, payout_amount, payout_account, payout_reference, buyer }) => {
    try {
      const updated = await markSalesPaid({
        userId,
        saleIds: sale_ids,
        payoutDate: localNoon(payout_date),
        payoutAmount: payout_amount,
        payoutAccount: payout_account || null,
        payoutReference: payout_reference || null,
        buyerName: buyer || null,
      });
      await logWrite(userId, apiKeyId, 'mark_sale_paid', { sale_ids, payout_date, payout_amount, payout_account, payout_reference, buyer });
      return jsonResult(updated.map((s) => ({
        id: s.id,
        payout_status: payoutStatus(s),
        payout_amount: toNum(s.paid_amount),
        payout_short_amount: s.payout_short_amount !== null ? toNum(s.payout_short_amount) : 0,
        payout_account: s.payout_account,
        payout_date: toDateOnly(s.paid_at),
        payout_reference: s.paid_reference,
        buyer_id: s.buyer_id,
      })));
    } catch (err) {
      return errorResult(err.message || 'Failed to mark sales paid');
    }
  });

  server.registerTool('update_sale_buyer', {
    description: 'Set or correct which buyer a sale is attributed to, independent of its payment status (use this to backfill a sale that was already marked paid before its buyer was known). The buyer is created automatically if new.',
    inputSchema: {
      sale_id: z.string().uuid(),
      buyer: z.string().min(1).describe('Who paid, e.g. "Windy City", "Blake".'),
    },
  }, async ({ sale_id, buyer }) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const sale = await tx.sales.findUnique({ where: { id: sale_id }, include: { inventory: true } });
        if (!sale || sale.inventory.user_id !== userId) {
          throw Object.assign(new Error('Sale not found or access denied'), { toolError: true });
        }
        const buyerRecord = await findOrCreateBuyer(userId, buyer, tx);
        return tx.sales.update({ where: { id: sale_id }, data: { buyer_id: buyerRecord.id } });
      });
      await logWrite(userId, apiKeyId, 'update_sale_buyer', { sale_id, buyer });
      return jsonResult({ id: result.id, buyer_id: result.buyer_id });
    } catch (err) {
      return errorResult(err.message || 'Failed to update sale buyer');
    }
  });

  server.registerTool('set_account_personal', {
    description: 'Flag (or unflag) a payment method as a personal account/card funding the business, so get_cashflow_summary\'s owed_to_personal_account can include it. The account must already exist.',
    inputSchema: {
      account_name: z.string().min(1).describe('Existing payment method name, e.g. "Wells Fargo Debit Card".'),
      is_personal: z.boolean(),
    },
  }, async ({ account_name, is_personal }) => {
    try {
      const trimmed = account_name.trim();
      const method = await prisma.paymentMethod.findFirst({
        where: { user_id: userId, name: { equals: trimmed, mode: 'insensitive' } },
      });
      if (!method) {
        const all = await prisma.paymentMethod.findMany({ where: { user_id: userId }, select: { name: true } });
        const names = all.map((m) => m.name).join(', ') || '(none set up yet)';
        throw Object.assign(new Error(`No payment method named "${trimmed}". Existing methods: ${names}`), { toolError: true });
      }
      const updated = await prisma.paymentMethod.update({ where: { id: method.id }, data: { is_personal } });
      await logWrite(userId, apiKeyId, 'set_account_personal', { account_name, is_personal });
      return jsonResult({ id: updated.id, name: updated.name, is_personal: updated.is_personal });
    } catch (err) {
      return errorResult(err.message || 'Failed to update account');
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
    },
  }, async ({ item, qty, unit_cost, store, card_used, purchase_date, tax_exempt }) => {
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
        },
      });
      await logWrite(userId, apiKeyId, 'add_purchase', { item, qty, unit_cost, store, card_used, purchase_date, tax_exempt });
      return jsonResult({
        id: created.id,
        item: created.product_name,
        qty: created.qty_purchased,
        unit_cost: toNum(decimal(created.unit_purchase_cost)),
        store: vendor.name,
        card_used: paymentMethod.name,
        purchase_date: toDateOnly(created.purchase_date),
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
