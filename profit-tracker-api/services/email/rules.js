// Trusted store rules (E4): receipts from a store the user trusts become
// expenses on their own, with the category and tax treatment the user chose
// once. Custom sender domains add subscriptions and tools to the search.
const { trackChange } = require('../activityLog');
const { SENDERS } = require('./config');
const { nameMatches } = require('./match');

const LABELS = Object.fromEntries(SENDERS.map((s) => [s.key, s.label]));
const labelFor = (merchant, rules = []) => rules.find((r) => r.merchant === merchant)?.label
  || LABELS[merchant] || String(merchant).replace(/^custom:/, '');

// "custom:<domain>" for a sender at a rule's domain (or a subdomain).
function customMerchant(address, rules) {
  const domain = String(address || '').toLowerCase().split('@')[1] || '';
  const rule = rules.find((r) => r.domain && (domain === r.domain || domain.endsWith(`.${r.domain}`)));
  return rule ? rule.merchant : null;
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
function normalizeDomain(input) {
  const d = String(input || '').trim().toLowerCase().replace(/^.*@/, '').replace(/^www\./, '').replace(/\.$/, '');
  return DOMAIN.test(d) ? d : null;
}

const dateOnly = (d) => new Date(d).toISOString().slice(0, 10);

// Creates the expense for one order from email and links it. `rule` gives the
// tax treatment; without one the expense waits for review on Schedule C.
async function createExpenseFromOrder(prisma, userId, order, rule = null, { auto = false } = {}) {
  if (order.total == null || Number(order.total) <= 0) return null;
  const externalId = `email:${order.id}`;
  const existing = await prisma.expense.findFirst({ where: { user_id: userId, external_id: externalId } });
  if (existing) return existing;
  const date = order.first_seen || new Date();
  const name = rule?.label || labelFor(order.merchant);
  const tax = rule ? {
    business_use: rule.business_use, business_percent: String(Number(rule.business_percent)),
    tax_category: rule.tax_category || undefined, payee: rule.label, purpose: rule.purpose || undefined,
    payment_status: 'paid', paid_date: dateOnly(date),
    // The user set this treatment once for the store; that is the review.
    reviewed: Boolean(rule.tax_category), source: 'email rule',
  } : null;
  const { result: expense } = await prisma.$transaction((tx) => trackChange(tx, userId, {
    action: 'create', recordType: 'expense', source: 'email',
    recordId: (made) => made.id,
    refs: async (_t, made) => ({ expense: made ? [made.id] : [] }),
  }, () => tx.expense.create({ data: {
    user_id: userId, name, amount: Number(order.total), amount_decimal: order.total, date,
    category: rule?.category || null, external_id: externalId,
    payment_method_id: rule?.payment_method_id || null,
    tax_details: tax ? JSON.parse(JSON.stringify(tax)) : undefined,
    notes: order.order_number ? `From email, order ${order.order_number}` : 'From email',
  } })));
  await prisma.emailMatch.upsert({
    where: { order_id_record_type_record_ids: { order_id: order.id, record_type: 'expense', record_ids: [expense.id] } },
    create: { user_id: userId, order_id: order.id, record_type: 'expense', record_ids: [expense.id], score: 100, band: 'high',
      reasons: [{ code: 'created', text: auto ? 'Created by your rule' : 'Created from this email', points: 100 }], state: 'linked', auto, decided_at: new Date() },
    update: { state: 'linked' },
  });
  await prisma.emailOrder.update({ where: { id: order.id }, data: { match_state: 'linked' } });
  return expense;
}

// After matching: unmatched receipts from stores with a rule. "ignore" rules
// set the order aside; "create_expense" rules make the expense when the user
// allows automatic expenses.
async function applyRules(prisma, userId, { createExpenses }) {
  const rules = await prisma.emailMerchantRule.findMany({ where: { user_id: userId } });
  if (!rules.length) return { created: 0, ignored: 0 };
  const byMerchant = new Map(rules.map((r) => [r.merchant, r]));
  const orders = await prisma.emailOrder.findMany({
    where: { user_id: userId, match_state: 'unmatched', merchant: { in: [...byMerchant.keys()] }, type: { in: ['receipt', 'purchase'] }, status: { notIn: ['cancelled', 'refund'] } },
    take: 200,
  });
  let created = 0;
  let ignored = 0;
  for (const order of orders) {
    const rule = byMerchant.get(order.merchant);
    if (rule.action === 'ignore') {
      await prisma.emailOrder.update({ where: { id: order.id }, data: { match_state: 'dismissed' } });
      ignored += 1;
    } else if (rule.auto && createExpenses && order.type === 'receipt') {
      if (await createExpenseFromOrder(prisma, userId, order, rule, { auto: true })) created += 1;
    }
  }
  return { created, ignored };
}

// Rules the user would likely want: stores with receipts in email, with the
// category and tax treatment of expenses the user already entered for them.
async function suggestRules(prisma, userId) {
  const [orders, rules, expenses] = await Promise.all([
    prisma.emailOrder.groupBy({ by: ['merchant'], where: { user_id: userId, type: 'receipt' }, _count: { _all: true } }),
    prisma.emailMerchantRule.findMany({ where: { user_id: userId }, select: { merchant: true } }),
    prisma.expense.findMany({ where: { user_id: userId }, select: { name: true, category: true, tax_details: true, payment_method_id: true }, orderBy: { date: 'desc' }, take: 2000 }),
  ]);
  const taken = new Set(rules.map((r) => r.merchant));
  const out = [];
  for (const { merchant, _count: count } of orders) {
    if (taken.has(merchant)) continue;
    const mine = expenses.filter((e) => nameMatches(merchant, e.name) === true);
    const common = (pick) => {
      const tally = new Map();
      for (const e of mine) { const v = pick(e); if (v) tally.set(v, (tally.get(v) || 0) + 1); }
      return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    };
    out.push({
      merchant, label: labelFor(merchant), receipts: count._all, past_expenses: mine.length,
      category: common((e) => e.category), tax_category: common((e) => e.tax_details?.tax_category),
      business_use: common((e) => e.tax_details?.business_use) || 'business',
      payment_method_id: common((e) => e.payment_method_id),
    });
  }
  return out.sort((a, b) => b.past_expenses - a.past_expenses || b.receipts - a.receipts);
}

module.exports = { applyRules, createExpenseFromOrder, suggestRules, customMerchant, normalizeDomain, labelFor };
