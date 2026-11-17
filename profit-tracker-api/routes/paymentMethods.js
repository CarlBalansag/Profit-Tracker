const express = require('express');
const router = express.Router();
const prisma = require('../prisma');
const { validateBody } = require('../middleware/validate');
const { paymentMethod, reworkPrompt } = require('../validation/schemas');
const { resolveRewardFields } = require('../services/cardRewards');
const { fieldsFromCatalog, refreshFromCatalog } = require('../services/catalogCardFields');
const { getCatalogIndex } = require('../services/cardCatalog');
const { publishCalendarFeed } = require('../services/calendarFeed');
const { withExactFields, MAPPINGS } = require('../services/decimalRead');
const { Decimal, batchCost, isRealizedSale } = require('../services/decimalFinance');

const isAuthenticated = (req, res, next) => {
  if (req.user) return next();
  res.status(401).json({ message: 'Unauthorized' });
};

// Parse category_rates JSON stored in DB and attach as array, and substitute
// each Decimal column's exact value into its paired Float field (Task 8).
const parseRates = (method) => {
  // catalog_applied is internal bookkeeping, not something the UI reads.
  const { catalog_applied: _applied, ...rest } = method;
  return withExactFields({
    ...rest,
    category_rates: rest.category_rates ? JSON.parse(rest.category_rates) : []
  }, MAPPINGS.paymentMethod);
};

// Keeps cards added from the card catalog current: when the catalog's data
// for a card changed since it was last copied, update the saved card (the
// user's own edits are kept -- see services/catalogCardFields.js). Runs on
// every card list load, so a monthly catalog refresh or a newer bundled copy
// reaches users the next time their cards load. A failure here never blocks
// loading cards.
async function autoUpdateFromCatalog(methods, userId) {
  const linked = methods.filter(m => m.catalog_card_id);
  if (!linked.length) return methods;
  try {
    const byId = await getCatalogIndex(prisma);
    const updatedById = new Map();
    for (const method of linked) {
      const data = refreshFromCatalog(method, byId.get(method.catalog_card_id));
      if (!data) continue;
      // Scoped to the user's own row; count 0 means it was deleted meanwhile.
      const { count } = await prisma.paymentMethod.updateMany({ where: { id: method.id, user_id: userId }, data });
      // Re-read rather than merging: the database trigger recomputes the
      // exact Decimal columns that the response prefers over the Floats.
      if (count) {
        const fresh = await prisma.paymentMethod.findFirst({ where: { id: method.id, user_id: userId } });
        if (fresh) updatedById.set(method.id, fresh);
      }
    }
    return methods.map(m => updatedById.get(m.id) || m);
  } catch (err) {
    console.warn('[paymentMethods] catalog auto-update failed:', err.message);
    return methods;
  }
}

// When the request asks to take a card's rewards from the catalog
// (apply_catalog), fill the reward fields from the catalog card. Store rates
// sent along are the user's own and win over the catalog's for that store.
async function withCatalogFields(rawBody) {
  // Only the server writes the catalog bookkeeping fields.
  const { catalog_applied: _a, catalog_synced_at: _s, ...body } = rawBody;
  if (!body.apply_catalog) return body;
  const byId = await getCatalogIndex(prisma);
  const card = byId.get(body.catalog_card_id);
  if (!card) {
    const err = new Error('That card is not in the card list');
    err.status = 400;
    throw err;
  }
  return {
    ...body,
    ...fieldsFromCatalog(card, {
      includeStoreRates: body.include_store_rates !== false,
      userRates: body.category_rates || [],
    }),
  };
}

// GET all payment methods for the authenticated user, with lifetime spend
// (ISSUES #7 "Payment Methods always shows zero spend"). Spend reuses the
// same batchCost() formula Card Tracker uses, summed across every inventory
// purchase ever made on each card -- not scoped to a statement month, since
// this page has no month selector (Card Tracker is where monthly detail lives).
router.get('/', isAuthenticated, async (req, res, next) => {
  try {
    const [storedMethods, inventories, labelSales] = await Promise.all([
      prisma.paymentMethod.findMany({ where: { user_id: req.user.id } }),
      prisma.inventory.findMany({
        where: { user_id: req.user.id, payment_method_id: { not: null } },
        select: {
          payment_method_id: true, unit_purchase_cost: true, qty_purchased: true,
          sales_tax: true, shipping_cost_inbound: true, fees: true, gift_card_amount: true,
          // batchCost() subtracts store refunds, so lifetime spend is net of them
          // (the Credit Card page shows each refund as a credit in its month).
          refunded_amount: true,
        },
      }),
      // Shipping labels bought on a card count as that card's spend too,
      // matching the Credit Card page (services/cardNetToPay.js).
      prisma.sales.findMany({
        where: { inventory: { user_id: req.user.id }, sale_shipping_payment_method_id: { not: null } },
        select: { sale_shipping_payment_method_id: true, sale_shipping: true, status: true, workflow_status: true },
      }),
    ]);
    const methods = await autoUpdateFromCatalog(storedMethods, req.user.id);
    const spendByCard = {};
    for (const inv of inventories) {
      const prior = spendByCard[inv.payment_method_id] || new Decimal(0);
      spendByCard[inv.payment_method_id] = prior.plus(batchCost(inv));
    }
    for (const sale of labelSales.filter(sale => sale.sale_shipping_payment_method_id && isRealizedSale(sale))) {
      const prior = spendByCard[sale.sale_shipping_payment_method_id] || new Decimal(0);
      spendByCard[sale.sale_shipping_payment_method_id] = prior.plus(sale.sale_shipping || 0);
    }
    const withSpend = methods.map(method => ({
      ...method,
      total_spend: (spendByCard[method.id] || new Decimal(0)).toDecimalPlaces(2).toNumber(),
    }));
    res.json(withSpend.map(parseRates));
  } catch (err) {
    next(err);
  }
});

// Label / catalog link fields, shared by POST and PUT. undefined = keep.
const optionalText = (value, existingValue) => (value !== undefined ? (value || null) : existingValue);

// POST new payment method
router.post('/', isAuthenticated, validateBody(paymentMethod), async (req, res, next) => {
  try {
    const input = await withCatalogFields(req.body);
    const { name, type, preset_card_id, last4,
            statement_close_day, due_day, credit_limit, min_payment_pct, is_personal,
            rewards_label, catalog_card_id, rework_prompt_state } = input;
    const rewards = resolveRewardFields(input, null);
    const method = await prisma.paymentMethod.create({
      data: {
        user_id: req.user.id,
        name,
        type,
        reward_type: rewards.reward_type,
        points_base_rate: rewards.points_base_rate,
        point_value_cents: rewards.point_value_cents,
        default_cashback_rate: rewards.default_cashback_rate,
        rewards_label: optionalText(rewards_label, null),
        catalog_card_id: optionalText(catalog_card_id, null),
        // A card added from the new catalog never needs the rework notice.
        rework_prompt_state: rework_prompt_state ?? (catalog_card_id ? 'switched' : null),
        catalog_applied: input.catalog_applied ?? null,
        catalog_synced_at: input.catalog_synced_at ?? null,
        preset_card_id: preset_card_id || null,
        last4: last4 || null,
        category_rates: rewards.category_rates.length ? JSON.stringify(rewards.category_rates) : null,
        statement_close_day: statement_close_day ? parseInt(statement_close_day) : null,
        due_day: due_day ? parseInt(due_day) : null,
        credit_limit: credit_limit ? parseFloat(credit_limit) : null,
        min_payment_pct: min_payment_pct ? parseFloat(min_payment_pct) : null,
        is_personal: is_personal === true || is_personal === 'true',
      }
    });
    await publishCalendarFeed(req.user.id);
    res.json(parseRates(method));
  } catch (err) {
    next(err);
  }
});

// UPDATE payment method
router.put('/:id', isAuthenticated, validateBody(paymentMethod), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    const input = await withCatalogFields(req.body);
    const { name, type, preset_card_id, last4, category_rates,
            statement_close_day, due_day, credit_limit, min_payment_pct, is_personal,
            rewards_label, catalog_card_id, rework_prompt_state } = input;

    // For a cashback card the sent default_cashback_rate is used as before
    // (the schema fills 0 when it's left out). For a points card it's ignored
    // and re-derived from the multiplier and point value.
    const rewards = resolveRewardFields(input, existing);
    const ratesTouched = category_rates !== undefined || rewards.reward_type === 'points' || existing.reward_type !== rewards.reward_type;

    const updated = await prisma.paymentMethod.update({
      where: { id },
      data: {
        name,
        type,
        reward_type: rewards.reward_type,
        points_base_rate: rewards.points_base_rate,
        point_value_cents: rewards.point_value_cents,
        default_cashback_rate: rewards.default_cashback_rate,
        rewards_label: optionalText(rewards_label, existing.rewards_label ?? null),
        catalog_card_id: optionalText(catalog_card_id, existing.catalog_card_id ?? null),
        rework_prompt_state: rework_prompt_state !== undefined ? rework_prompt_state : (existing.rework_prompt_state ?? null),
        catalog_applied: input.catalog_applied !== undefined ? input.catalog_applied : (existing.catalog_applied ?? null),
        catalog_synced_at: input.catalog_synced_at !== undefined ? input.catalog_synced_at : (existing.catalog_synced_at ?? null),
        preset_card_id: preset_card_id ?? existing.preset_card_id,
        last4: last4 !== undefined ? (last4 || null) : existing.last4,
        category_rates: ratesTouched
          ? JSON.stringify(rewards.category_rates)
          : existing.category_rates,
        statement_close_day: statement_close_day !== undefined ? (statement_close_day ? parseInt(statement_close_day) : null) : existing.statement_close_day,
        due_day: due_day !== undefined ? (due_day ? parseInt(due_day) : null) : existing.due_day,
        credit_limit: credit_limit !== undefined ? (credit_limit ? parseFloat(credit_limit) : null) : existing.credit_limit,
        min_payment_pct: min_payment_pct !== undefined ? (min_payment_pct ? parseFloat(min_payment_pct) : null) : existing.min_payment_pct,
        is_personal: is_personal !== undefined ? (is_personal === true || is_personal === 'true') : existing.is_personal,
      }
    });
    await publishCalendarFeed(req.user.id);
    res.json(parseRates(updated));
  } catch (err) {
    next(err);
  }
});

// Answer the one-time "cards were reworked" notice without editing the card
// ("kept" = leave it as-is). Switching goes through PUT, which sends the new
// catalog values along with rework_prompt_state: 'switched'.
router.patch('/:id/rework-prompt', isAuthenticated, validateBody(reworkPrompt), async (req, res, next) => {
  try {
    const { id } = req.params;
    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }
    const updated = await prisma.paymentMethod.update({
      where: { id },
      data: { rework_prompt_state: req.body.state },
    });
    res.json(parseRates(updated));
  } catch (err) {
    next(err);
  }
});

// DELETE payment method
router.delete('/:id', isAuthenticated, async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await prisma.paymentMethod.findUnique({ where: { id } });
    if (!existing || existing.user_id !== req.user.id) {
      return res.status(404).json({ error: 'Not found' });
    }

    await prisma.paymentMethod.delete({ where: { id } });
    await publishCalendarFeed(req.user.id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
