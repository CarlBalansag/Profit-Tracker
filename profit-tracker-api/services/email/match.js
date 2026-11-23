// Matches an order from email to the user's own records and says why.
//   purchase orders -> purchases (one or several rows of the same order)
//   sale emails     -> sales
//   receipts        -> expenses
// Score 0-100 from weighted signals. 70+ is "sure" (linked automatically when
// the user allows it), 40-69 goes to the review list, below 40 is not shown.
const { trackChange, logEvent } = require('../activityLog');
const { SENDERS } = require('./config');

const CASHOUTS = new Set(SENDERS.filter((s) => s.cashout).map((s) => s.key));

const HIGH = 70;
const MEDIUM = 40;
const DAY = 86400000;

const MERCHANT_NAMES = {
  amazon: ['amazon'], walmart: ['walmart'], bestbuy: ['best buy', 'bestbuy'], target: ['target'], apple: ['apple'],
  costco: ['costco'], samsclub: ["sam's club", 'sams club', 'samsclub'], homedepot: ['home depot', 'homedepot'],
  lowes: ["lowe's", 'lowes'], gamestop: ['gamestop'], nike: ['nike'], ebay: ['ebay'], stockx: ['stockx'], goat: ['goat'],
  paypal: ['paypal'], pirateship: ['pirate ship', 'pirateship'], points4days: ['points4days', 'points 4 days', 'p4d'],
};
const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim();
const normOrder = (s) => String(s || '').toUpperCase().replace(/[\s#]/g, '');
const num = (d, f) => Number(d ?? f ?? 0);
const cents = (n) => Math.round(Number(n) * 100);

function nameMatches(merchant, name) {
  const n = normName(name);
  if (!n) return null;
  const mine = MERCHANT_NAMES[merchant] || [merchant];
  if (mine.some((m) => n.includes(m))) return true;
  const other = Object.entries(MERCHANT_NAMES).some(([k, names]) => k !== merchant && names.some((m) => n.includes(m)));
  return other ? false : null;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'new', 'of', 'a', 'in', 'pack', 'set', 'edition']);
const tokens = (s) => new Set(normName(s).split(' ').filter((t) => t.length > 2 && !STOP.has(t)));
function itemOverlap(items, names) {
  const want = tokens((items || []).map((i) => i.name).join(' '));
  const have = tokens(names.join(' '));
  if (!want.size || !have.size) return 0;
  let shared = 0;
  for (const t of have) if (want.has(t)) shared += 1;
  return shared / Math.min(want.size, have.size);
}
const last4 = (hint) => (String(hint || '').match(/(\d{4})$/) || [])[1] || null;

function purchaseCost(inv) {
  return num(inv.unit_purchase_cost_decimal, inv.unit_purchase_cost) * inv.qty_purchased;
}
function purchaseTotal(inv) {
  return purchaseCost(inv) + num(inv.sales_tax_decimal, inv.sales_tax) + num(inv.shipping_cost_inbound_decimal, inv.shipping_cost_inbound);
}

// rows: purchases treated as one order. Returns { score, reasons }.
function scorePurchases(order, rows) {
  const reasons = [];
  const add = (code, text, points) => reasons.push({ code, text, points });
  const orderNo = normOrder(order.order_number);
  const rowNos = [...new Set(rows.map((r) => normOrder(r.order_number)).filter(Boolean))];
  if (orderNo && rowNos.includes(orderNo)) add('order_number', 'Same order number', 60);
  else if (orderNo && rowNos.length) add('order_number_conflict', 'Different order number', -60);
  const tracking = new Set(order.tracking_numbers.map(normOrder));
  if (rows.some((r) => r.tracking_number && tracking.has(normOrder(r.tracking_number)))) add('tracking', 'Same tracking number', 50);

  if (order.total != null) {
    const total = rows.reduce((t, r) => t + purchaseTotal(r), 0);
    const items = rows.reduce((t, r) => t + purchaseCost(r), 0);
    if (Math.abs(cents(total) - cents(order.total)) <= 1) add('total', 'Same total', 25);
    else if (order.subtotal != null && Math.abs(cents(items) - cents(order.subtotal)) <= 1) add('subtotal', 'Same item cost', 20);
    else if (Math.abs(total - Number(order.total)) <= Number(order.total) * 0.02) add('total_close', 'Total within 2%', 8);
  }
  if (order.first_seen) {
    const days = Math.min(...rows.map((r) => Math.abs(r.purchase_date - order.first_seen) / DAY));
    if (days <= 1.5) add('date', 'Same day', 10);
    else if (days <= 4) add('date', `Within ${Math.ceil(days)} days`, 5);
    else if (days > 10) add('date_far', `${Math.round(days)} days apart`, -15);
  }
  const vendor = rows.map((r) => nameMatches(order.merchant, r.vendor?.name)).find((v) => v !== null);
  if (vendor === true) add('store', 'Same store', 10);
  if (vendor === false) add('store_conflict', 'Different store', -20);
  const overlap = itemOverlap(order.items, rows.map((r) => r.product_name));
  if (overlap >= 0.5) add('items', 'Item names match', 10);
  const card = last4(order.payment_hint);
  const cards = rows.map((r) => r.payment_method?.last4).filter(Boolean);
  if (card && cards.includes(card)) add('card', `Same card (${card})`, 10);
  else if (card && cards.length) add('card_conflict', 'Different card', -5);
  return finish(reasons);
}

function scoreSale(order, sale) {
  const reasons = [];
  const add = (code, text, points) => reasons.push({ code, text, points });
  const tracking = new Set(order.tracking_numbers.map(normOrder));
  if (sale.tracking_number && tracking.has(normOrder(sale.tracking_number))) add('tracking', 'Same tracking number', 50);
  const gross = num(sale.unit_price_decimal, sale.unit_price) * sale.quantity;
  if (order.total != null) {
    if (Math.abs(cents(gross) - cents(order.total)) <= 1) add('total', 'Same sale price', 30);
    else if (Math.abs(gross - Number(order.total)) <= Number(order.total) * 0.15) add('total_close', 'Price within 15% (fees or shipping)', 10);
  }
  if (order.first_seen) {
    const days = Math.abs(sale.sale_date - order.first_seen) / DAY;
    if (days <= 1.5) add('date', 'Same day', 15);
    else if (days <= 4) add('date', `Within ${Math.ceil(days)} days`, 8);
    else if (days > 10) add('date_far', `${Math.round(days)} days apart`, -15);
  }
  const platform = nameMatches(order.merchant, sale.platform?.name);
  if (platform === true) add('store', 'Same marketplace', 15);
  if (platform === false) add('store_conflict', 'Different marketplace', -25);
  if (itemOverlap(order.items, [sale.inventory?.product_name]) >= 0.5) add('items', 'Item name matches', 15);
  return finish(reasons);
}

// Cash-out receipts: one line per item scanned in, each paid for one sale.
// line: { name, quantity, unit_payout, total, tracking }.
// partial: the line may be part of the sale (a sale already paid, whose units
// were scanned in over several receipts).
function scoreCashoutLine(order, line, sale, { partial = false } = {}) {
  const reasons = [];
  const add = (code, text, points) => reasons.push({ code, text, points });
  const tracking = normOrder(line.tracking);
  const saleTracking = [sale.tracking_number, sale.inventory?.tracking_number].filter(Boolean).map(normOrder);
  if (tracking && saleTracking.includes(tracking)) add('tracking', 'Same tracking number', 50);
  const qty = Number(line.quantity) || null;
  if (qty && sale.quantity === qty) add('quantity', 'Same quantity', 10);
  else if (qty && partial && qty < sale.quantity) add('quantity_part', `${qty} of the ${sale.quantity} sold`, 10);
  else if (qty) add('quantity_conflict', `${sale.quantity} sold, ${qty} paid`, -30);
  const unit = Number(line.unit_payout ?? line.unit_price) || null;
  const saleUnit = num(sale.unit_price_decimal, sale.unit_price);
  if (unit && Math.abs(cents(saleUnit) - cents(unit)) <= 1) add('price', 'Same price per unit', 30);
  else if (unit && Math.abs(saleUnit - unit) <= unit * 0.03) add('price_close', 'Price within 3%', 10);
  // Cash-out titles are SKU-like ("IPAD-11-128GB-SILVER"): one shared word counts a little.
  const overlap = itemOverlap([line], [sale.inventory?.product_name]);
  if (overlap >= 0.5) add('items', 'Item name matches', 15);
  else if (overlap > 0) add('items_some', 'Item names share a word', 8);
  const platform = nameMatches(order.merchant, sale.platform?.name);
  if (platform === true) add('store', 'Same cash-out', 15);
  if (platform === false) add('store_conflict', 'Sold somewhere else', -40);
  if (order.first_seen && sale.sale_date) {
    const days = (order.first_seen - sale.sale_date) / DAY;
    if (days >= -1.5 && days <= 1.5) add('date', 'Same day', 10);
    else if (days > 1.5 && days <= 45) add('date', `Sold ${Math.round(days)} days before`, 10);
    else if (days < -1.5) add('date_far', 'Sold after the receipt', -30);
    else add('date_far', `${Math.round(days)} days apart`, -10);
  }
  return finish(reasons);
}

const receiptLines = (order) => (Array.isArray(order.items) ? order.items.filter((i) => i && Number(i.quantity) > 0) : []);

// Pairs each receipt line with one sale, best pairs first; a sale pays one line.
function pairCashoutLines(order, sales, { minScore = MEDIUM } = {}) {
  const lines = receiptLines(order);
  const all = [];
  lines.forEach((line, index) => {
    for (const sale of sales) all.push({ index, line, sale, ...scoreCashoutLine(order, line, sale) });
  });
  all.sort((a, b) => b.score - a.score);
  const usedLines = new Set();
  const usedSales = new Set();
  const pairs = [];
  for (const p of all) {
    if (p.score < minScore || usedLines.has(p.index) || usedSales.has(p.sale.id)) continue;
    usedLines.add(p.index);
    usedSales.add(p.sale.id);
    pairs.push(p);
  }
  return { lines, pairs: pairs.sort((a, b) => a.index - b.index) };
}

async function cashoutCandidates(prisma, userId, order) {
  const center = order.first_seen || new Date();
  const sales = await prisma.sales.findMany({
    where: {
      inventory: { user_id: userId },
      paid_at: null,
      OR: [
        { platform: { type: 'Cashout' }, sale_date: { gte: new Date(center.getTime() - 60 * DAY), lte: new Date(center.getTime() + 2 * DAY) } },
        ...(order.tracking_numbers.length ? [{ tracking_number: { in: order.tracking_numbers } }, { inventory: { tracking_number: { in: order.tracking_numbers } } }] : []),
      ],
    },
    include: { platform: { select: { name: true, type: true } }, inventory: { select: { product_name: true, tracking_number: true } } },
    take: 300,
  });
  const lines = receiptLines(order);
  let found = [];
  if (lines.length === 1) {
    // One item: the best few sales, each its own suggestion.
    found = sales.map((s) => ({ record_type: 'sale', rows: [s], ...scoreCashoutLine(order, lines[0], s) }));
  } else if (lines.length) {
    // Several items: one suggestion that pays a sale for every line.
    const { pairs } = pairCashoutLines(order, sales);
    if (pairs.length === lines.length) {
      const weakest = pairs.reduce((low, p) => (p.score < low.score ? p : low));
      found = [{
        record_type: 'sale', rows: pairs.map((p) => p.sale), score: weakest.score,
        reasons: [{ code: 'all_items', text: `All ${lines.length} items matched a sale`, points: 0 }, ...weakest.reasons],
      }];
    }
  }
  if (found.some((c) => c.score >= MEDIUM)) return found;
  return [...found, ...await paidSaleCandidates(prisma, userId, order, lines)];
}

// A receipt for a sale the user already marked paid (the money came some
// other way, or before this email was read): linked to that sale so it
// leaves "No match", and never paid again. All the receipt's items must be
// part of the one sale.
async function paidSaleCandidates(prisma, userId, order, lines) {
  if (!lines.length) return [];
  const center = order.first_seen || new Date();
  const sales = await prisma.sales.findMany({
    where: {
      inventory: { user_id: userId }, paid_at: { not: null }, platform: { type: 'Cashout' },
      sale_date: { gte: new Date(center.getTime() - 60 * DAY), lte: new Date(center.getTime() + 2 * DAY) },
    },
    include: { platform: { select: { name: true, type: true } }, inventory: { select: { product_name: true, tracking_number: true } } },
    take: 300,
  });
  const out = [];
  for (const sale of sales) {
    if (lines.reduce((t, l) => t + Number(l.quantity), 0) > sale.quantity) continue;
    const scored = lines.map((l) => scoreCashoutLine(order, l, sale, { partial: true }));
    const weakest = scored.reduce((low, s) => (s.score < low.score ? s : low));
    if (weakest.score < MEDIUM) continue;
    out.push({
      record_type: 'sale', rows: [sale], score: weakest.score,
      reasons: [{ code: 'already_paid', text: 'Sale already marked paid', points: 0 }, ...weakest.reasons],
    });
  }
  return out;
}

function scoreExpense(order, expense) {
  const reasons = [];
  const add = (code, text, points) => reasons.push({ code, text, points });
  const amount = num(expense.amount_decimal, expense.amount);
  if (order.total != null && Math.abs(cents(amount) - cents(order.total)) <= 1) add('total', 'Same amount', 40);
  if (order.first_seen) {
    const days = Math.abs(expense.date - order.first_seen) / DAY;
    if (days <= 1.5) add('date', 'Same day', 15);
    else if (days <= 4) add('date', `Within ${Math.ceil(days)} days`, 8);
    else if (days > 10) add('date_far', `${Math.round(days)} days apart`, -20);
  }
  const named = nameMatches(order.merchant, expense.name);
  if (named === true) add('store', 'Same name', 20);
  const card = last4(order.payment_hint);
  if (card && expense.payment_method?.last4 === card) add('card', `Same card (${card})`, 10);
  return finish(reasons);
}

function finish(reasons) {
  const score = Math.max(0, Math.min(100, reasons.reduce((t, r) => t + r.points, 0)));
  return { score, reasons };
}
const band = (score) => (score >= HIGH ? 'high' : score >= MEDIUM ? 'medium' : null);

async function candidatesFor(prisma, userId, order) {
  const center = order.first_seen || new Date();
  const from = new Date(center.getTime() - 10 * DAY);
  const to = new Date(center.getTime() + 4 * DAY);
  if (order.type === 'purchase') {
    const or = [{ purchase_date: { gte: from, lte: to } }];
    if (order.order_number) or.push({ order_number: { equals: order.order_number, mode: 'insensitive' } });
    if (order.tracking_numbers.length) or.push({ tracking_number: { in: order.tracking_numbers } });
    const rows = await prisma.inventory.findMany({
      where: { user_id: userId, status: { notIn: ['VOID'] }, OR: or },
      include: { vendor: { select: { name: true } }, payment_method: { select: { last4: true } } },
      take: 300,
    });
    // Rows that share an order number are one order with several items.
    const sets = new Map();
    for (const r of rows) {
      const key = r.order_number ? `o:${normOrder(r.order_number)}` : `r:${r.id}`;
      sets.set(key, [...(sets.get(key) || []), r]);
    }
    return [...sets.values()].map((set) => ({ record_type: 'purchase', rows: set, ...scorePurchases(order, set) }));
  }
  if (order.type === 'sale' && CASHOUTS.has(order.merchant)) return cashoutCandidates(prisma, userId, order);
  if (order.type === 'sale') {
    const sales = await prisma.sales.findMany({
      where: { inventory: { user_id: userId }, OR: [{ sale_date: { gte: from, lte: to } }, ...(order.tracking_numbers.length ? [{ tracking_number: { in: order.tracking_numbers } }] : [])] },
      include: { platform: { select: { name: true } }, inventory: { select: { product_name: true } } },
      take: 300,
    });
    return sales.map((s) => ({ record_type: 'sale', rows: [s], ...scoreSale(order, s) }));
  }
  if (order.type === 'receipt') {
    const expenses = await prisma.expense.findMany({
      where: { user_id: userId, date: { gte: from, lte: to } },
      include: { payment_method: { select: { last4: true } } },
      take: 300,
    });
    return expenses.map((e) => ({ record_type: 'expense', rows: [e], ...scoreExpense(order, e) }));
  }
  return [];
}

const carrierFor = (t) => (/^1Z/i.test(t) ? 'UPS' : /^9[1-5]\d{18,}/.test(t) ? 'USPS' : null);

// What linking writes on one record: only its blank fields, from the order.
// Shared by fillBlanks and the "Review & link" preview, so they agree.
function purchaseFills(row, order) {
  const tracking = order.tracking_numbers?.[0] || null;
  const data = {};
  if (!row.order_number && order.order_number) data.order_number = order.order_number;
  if (!row.tracking_number && tracking) { data.tracking_number = tracking; if (!row.carrier && carrierFor(tracking)) data.carrier = carrierFor(tracking); }
  return data;
}
function saleFills(sale, order) {
  const tracking = order.tracking_numbers?.[0];
  if (!tracking || sale.tracking_number || CASHOUTS.has(order.merchant)) return {};
  return { tracking_number: tracking, carrier: sale.carrier || carrierFor(tracking) };
}

// Fills blank fields on the linked records from the order (never overwrites
// what the user typed), as one Activity entry with Undo.
async function fillBlanks(prisma, userId, order, match) {
  if (match.record_type === 'purchase') {
    return prisma.$transaction((tx) => trackChange(tx, userId, {
      action: 'edit', recordType: 'purchase', source: 'email', extra: { email_order_id: order.id },
      recordId: match.record_ids[0],
      refs: async () => ({ inventory: match.record_ids }),
    }, async () => {
      for (const id of match.record_ids) {
        const row = await tx.inventory.findFirst({ where: { id, user_id: userId } });
        if (!row) continue;
        const data = purchaseFills(row, order);
        if (Object.keys(data).length) await tx.inventory.update({ where: { id }, data });
      }
      return null;
    }));
  }
  // Cash-out receipts fill their sales line by line when they are applied.
  if (match.record_type === 'sale' && CASHOUTS.has(order.merchant)) return null;
  if (match.record_type === 'sale') {
    const tracking = order.tracking_numbers[0];
    if (!tracking) return null;
    const sale = await prisma.sales.findFirst({ where: { id: match.record_ids[0], inventory: { user_id: userId } } });
    if (!sale || sale.tracking_number) return null;
    return prisma.$transaction((tx) => trackChange(tx, userId, {
      action: 'edit', recordType: 'sale', source: 'email', recordId: sale.id, extra: { email_order_id: order.id },
      refs: async () => ({ sales: [sale.id] }),
    }, () => tx.sales.update({ where: { id: sale.id }, data: saleFills(sale, order) })));
  }
  return null;
}

// Scores the given orders again and saves the best suggestions. A sure,
// unambiguous match is linked when `autoLink` is on.
async function matchOrders(prisma, userId, orderIds, { autoLink = true } = {}) {
  const summary = { linked: 0, review: 0, unmatched: 0 };
  for (const id of orderIds) {
    const order = await prisma.emailOrder.findFirst({ where: { id, user_id: userId } });
    if (!order || order.match_state === 'linked' || order.match_state === 'dismissed' || ['shipment', 'check'].includes(order.type)) continue;
    const scored = (await candidatesFor(prisma, userId, order)).filter((c) => band(c.score)).sort((a, b) => b.score - a.score).slice(0, 3);
    const rejected = await prisma.emailMatch.findMany({ where: { order_id: order.id, state: 'rejected' } });
    const isRejected = (c) => rejected.some((r) => r.record_type === c.record_type && r.record_ids.join() === c.rows.map((x) => x.id).sort().join());
    const usable = scored.filter((c) => !isRejected(c));
    await prisma.emailMatch.deleteMany({ where: { order_id: order.id, state: 'suggested' } });
    for (const c of usable) {
      await prisma.emailMatch.create({ data: {
        user_id: userId, order_id: order.id, record_type: c.record_type, record_ids: c.rows.map((r) => r.id).sort(),
        score: c.score, band: band(c.score), reasons: c.reasons,
      } });
    }
    const best = usable[0];
    const sure = best && best.score >= HIGH && !(usable[1] && usable[1].score >= HIGH);
    if (sure && autoLink) {
      const match = await prisma.emailMatch.findFirst({ where: { order_id: order.id, state: 'suggested' }, orderBy: { score: 'desc' } });
      await linkMatch(prisma, userId, match.id, { auto: true });
      summary.linked += 1;
    } else if (best) {
      await prisma.emailOrder.update({ where: { id: order.id }, data: { match_state: 'review' } });
      summary.review += 1;
    } else {
      await prisma.emailOrder.update({ where: { id: order.id }, data: { match_state: 'unmatched' } });
      summary.unmatched += 1;
    }
  }
  return summary;
}

async function linkMatch(prisma, userId, matchId, { auto = false } = {}) {
  const match = await prisma.emailMatch.findFirst({ where: { id: matchId, user_id: userId }, include: { order: true } });
  if (!match) return null;
  // Every record must still be the user's.
  const model = { purchase: 'inventory', sale: 'sales', expense: 'expense' }[match.record_type];
  const owner = match.record_type === 'sale' ? { inventory: { user_id: userId } } : { user_id: userId };
  const count = await prisma[model].count({ where: { id: { in: match.record_ids }, ...owner } });
  if (count !== match.record_ids.length) return null;
  await prisma.$transaction([
    prisma.emailMatch.updateMany({ where: { order_id: match.order_id, id: { not: match.id }, state: 'suggested' }, data: { state: 'rejected', decided_at: new Date() } }),
    prisma.emailMatch.update({ where: { id: match.id }, data: { state: 'linked', auto, decided_at: new Date() } }),
    prisma.emailOrder.update({ where: { id: match.order_id }, data: { match_state: 'linked' } }),
  ]);
  const filled = await fillBlanks(prisma, userId, match.order, match);
  if (auto) await logAutoLink(prisma, userId, match);
  // The user reviewed this link (Review & link): nothing left to confirm.
  else if (filled?.activity?.id) await prisma.activityLog.update({ where: { id: filled.activity.id }, data: { review_state: 'confirmed', reviewed_at: new Date() } });
  return match;
}

// An automatic link is logged on its own (Activity and the Automation page),
// even when it filled nothing in. Undo doesn't apply: it only links.
async function logAutoLink(prisma, userId, match) {
  try {
    const model = { purchase: 'inventory', sale: 'sales', expense: 'expense' }[match.record_type];
    const rows = await prisma[model].findMany({
      where: { id: { in: match.record_ids } },
      select: match.record_type === 'expense' ? { name: true } : match.record_type === 'sale' ? { inventory: { select: { product_name: true } } } : { product_name: true },
    });
    const names = rows.map((r) => r.name || r.product_name || r.inventory?.product_name).filter(Boolean);
    const order = match.order || {};
    await logEvent(prisma, userId, {
      recordType: 'email_link', recordId: match.order_id, action: 'link', source: 'email',
      name: names.join(', ').slice(0, 200) || null,
      detail: {
        store: SENDERS.find((s) => s.key === order.merchant)?.label || String(order.merchant || '').replace(/^custom:/, ''),
        order_number: order.order_number || null, order_type: order.type || null,
        linked_to: match.record_type, count: match.record_ids.length, score: match.score,
      },
    });
  } catch (err) {
    console.error('[email] could not log a link:', err?.code || err?.message);
  }
}

async function rejectMatch(prisma, userId, matchId) {
  const match = await prisma.emailMatch.findFirst({ where: { id: matchId, user_id: userId } });
  if (!match) return null;
  await prisma.emailMatch.update({ where: { id: match.id }, data: { state: 'rejected', decided_at: new Date() } });
  const left = await prisma.emailMatch.count({ where: { order_id: match.order_id, state: 'suggested' } });
  if (!left) await prisma.emailOrder.update({ where: { id: match.order_id }, data: { match_state: 'unmatched' } });
  return match;
}

module.exports = { purchaseFills, saleFills, matchOrders, linkMatch, rejectMatch, scorePurchases, scoreSale, scoreExpense, scoreCashoutLine, pairCashoutLines, CASHOUTS, nameMatches, itemOverlap, HIGH, MEDIUM, carrierFor };
