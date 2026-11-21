// Read-only bookkeeping helpers behind the MCP tools find_records,
// reconcile_transactions, list_all_costs, data_quality_report and
// match_deposit. Every function here is pure: it takes rows the caller already
// loaded (inventories with their sales, expenses, transaction notes) and
// returns plain objects, so nothing in this file can ever write.
//
// Money rules are not repeated here -- they come from decimalFinance.js
// (batchCost, saleEconomics, isRealizedSale), payoutStatus.js and
// derivedExpenses.js, so these tools always agree with the website.
const { decimal, batchCost, grossBatchCost, saleEconomics, isRealizedSale } = require('./decimalFinance');
const { payoutStatus } = require('./payoutStatus');
const { derivedExpenseLines } = require('./derivedExpenses');
const { needsPayoutBackfill } = require('./markSalesPaid');
const statusTransitions = require('./statusTransitions');

const DAY_MS = 24 * 60 * 60 * 1000;
const money = (v) => decimal(v || 0).toDecimalPlaces(2).toNumber();
const cents = (v) => Math.round(Number(v || 0) * 100);
const dateOnly = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const dayNumber = (d) => Math.floor(new Date(d).getTime() / DAY_MS);
// A YYYY-MM-DD string read the same way the rest of the app stores dates
// (local noon), so a range boundary includes the whole day.
const dayOf = (text) => dayNumber(`${text}T12:00:00.000Z`);
const inRange = (date, from, to) => {
  if (!date) return false;
  const day = dayNumber(date);
  return (from === undefined || day >= from) && (to === undefined || day <= to);
};
const normalizeId = (v) => String(v || '').replace(/[\s-]/g, '').toLowerCase();

const isCancelledPurchase = (inv) => Boolean(inv.cancelled_at)
  || inv.receiving_status === 'CANCELLED'
  || String(inv.status || '').toUpperCase() === 'CANCELLED';
const saleStatus = (s) => s.workflow_status || s.status || null;
const purchaseStatus = (inv) => (inv.cancelled_at ? 'CANCELLED' : (inv.receiving_status || inv.status || null));

// Flattens inventories (each with .sales) into sales that still know their
// purchase, the shape every tool below works on.
function salesOf(inventories) {
  return inventories.flatMap((inv) => (inv.sales || []).map((sale) => ({ ...sale, inventory: inv })));
}

// --------------------------------------------------------------- similarity

const STOP_WORDS = new Set(['inc', 'llc', 'co', 'com', 'the', 'www', 'store', 'payment', 'purchase', 'pos', 'debit', 'credit', 'online', 'transfer']);
const tokens = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
  .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

// 0..1. Token overlap, plus credit for one name containing the other once
// spaces are removed ("bestbuy" vs "Best Buy").
function similarity(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length || !tb.length) return 0;
  const joinedA = ta.join('');
  const joinedB = tb.join('');
  if (joinedA === joinedB) return 1;
  if (joinedA.length >= 4 && joinedB.length >= 4 && (joinedA.includes(joinedB) || joinedB.includes(joinedA))) return 0.8;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return shared / Math.max(ta.length, tb.length);
}

// ----------------------------------------------------------------- find_records

const FIND_FIELDS = ['order_number', 'tracking_number', 'product_name', 'notes'];

// query matches when the normalized field contains it (identifiers ignore
// spaces and dashes; names are case-insensitive substrings). ASINs and UPCs
// have no column of their own, so they are found in product_name and notes.
function findRecords(inventories, { query, fields = FIND_FIELDS, notesByEntity = new Map(), limit = 25 }) {
  const term = String(query || '').trim().toLowerCase();
  const idTerm = normalizeId(term);
  const wanted = new Set(fields);
  const idHit = (v) => idTerm.length > 0 && v && normalizeId(v).includes(idTerm);
  const textHit = (v) => v && String(v).toLowerCase().includes(term);
  const rows = [];

  for (const inv of inventories) {
    const matched = [];
    if (wanted.has('order_number') && idHit(inv.order_number)) matched.push('order_number');
    if (wanted.has('tracking_number') && idHit(inv.tracking_number)) matched.push('tracking_number');
    if (wanted.has('product_name') && textHit(inv.product_name)) matched.push('product_name');
    if (wanted.has('notes') && (textHit(inv.notes) || (notesByEntity.get(inv.id) || []).some(textHit))) matched.push('notes');
    if (!matched.length) continue;
    rows.push({
      type: 'purchase',
      id: inv.id,
      item: inv.product_name,
      date: dateOnly(inv.purchase_date),
      qty: inv.qty_purchased,
      qty_on_hand: inv.qty_on_hand,
      total_cost: money(batchCost(inv)),
      store: inv.vendor?.name || null,
      order_number: inv.order_number || null,
      tracking_number: inv.tracking_number || null,
      status: purchaseStatus(inv),
      sale_ids: (inv.sales || []).map((s) => s.id),
      matched_on: matched,
    });
  }

  for (const sale of salesOf(inventories)) {
    const matched = [];
    if (wanted.has('order_number') && idHit(sale.inventory.order_number)) matched.push('purchase_order_number');
    if (wanted.has('tracking_number') && idHit(sale.tracking_number)) matched.push('tracking_number');
    if (wanted.has('product_name') && textHit(sale.inventory.product_name)) matched.push('product_name');
    if (wanted.has('notes') && (textHit(sale.notes) || (notesByEntity.get(sale.id) || []).some(textHit))) matched.push('notes');
    if (!matched.length) continue;
    rows.push({
      type: 'sale',
      id: sale.id,
      item: sale.inventory.product_name,
      date: dateOnly(sale.sale_date),
      qty: sale.quantity,
      net: money(saleEconomics(sale.inventory, sale).revenue),
      platform: sale.platform?.name || null,
      tracking_number: sale.tracking_number || null,
      status: saleStatus(sale),
      payout_status: payoutStatus(sale),
      purchase_id: sale.inventory.id,
      matched_on: matched,
    });
  }

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return { results: rows.slice(0, limit), total: rows.length, truncated: rows.length > limit };
}

// ----------------------------------------------------------------- list_all_costs

// Every cost the Expenses tab shows: manual expenses plus the lines derived
// from purchases (tax, inbound shipping, fees, gift-card credit) and realized
// sales (shipping label, platform fee).
function allCostLines(inventories, expenses) {
  const manual = expenses.map((e) => ({
    id: e.id,
    source: 'expense',
    category: e.category || 'UNCATEGORIZED',
    name: e.name,
    amount: money(e.amount),
    date: e.date,
    expense_id: e.id,
    inventory_id: null,
    sale_id: null,
    paid_from: e.payment_method?.name || null,
    notes: e.notes || null,
    external_id: e.external_id || null,
  }));
  const derived = derivedExpenseLines(inventories).map((line) => ({
    id: line.id,
    source: line.source,
    category: line.category,
    name: line.name,
    amount: line.amount,
    date: line.date,
    expense_id: null,
    inventory_id: line.inventory_id,
    sale_id: line.sale_id,
    paid_from: line.payment_method?.name || (line.paid_from_payout ? 'payout' : null),
  }));
  return [...manual, ...derived];
}

function listAllCosts(inventories, expenses, { startDate, endDate } = {}) {
  const from = startDate ? dayOf(startDate) : undefined;
  const to = endDate ? dayOf(endDate) : undefined;
  const lines = allCostLines(inventories, expenses)
    .filter((line) => inRange(line.date, from, to))
    .sort((a, b) => new Date(b.date) - new Date(a.date) || a.id.localeCompare(b.id));

  const sumBy = (keyOf) => {
    const map = new Map();
    for (const line of lines) {
      const key = keyOf(line);
      map.set(key, (map.get(key) || decimal(0)).plus(line.amount));
    }
    return Object.fromEntries([...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, money(v)]));
  };
  const total = lines.reduce((sum, line) => sum.plus(line.amount), decimal(0));
  return {
    lines: lines.map((line) => ({ ...line, date: dateOnly(line.date) })),
    total: money(total),
    by_month: sumBy((line) => dateOnly(line.date).slice(0, 7)),
    by_category: sumBy((line) => line.category),
    by_source: sumBy((line) => line.source),
    count: lines.length,
  };
}

// ----------------------------------------------------------------- reconcile_transactions

// Things in the tracker a bank or card statement line could be:
//   expense        a manual expense (money out)
//   purchase       the card charge for a purchase -- the receipt total, i.e.
//                  grossBatchCost (unit cost x qty + tax + shipping + fees,
//                  less any gift card) -- plus each part on its own, since a
//                  store sometimes charges shipping or tax separately
//   sale_cost      a sale's shipping label or platform fee
//   payout         money in: one deposit, i.e. the sales sharing a paid_at day,
//                  payout_account and paid_reference, summed (that is how
//                  mark_sale_paid records one deposit across several sales)
function reconcileCandidates(inventories, expenses) {
  const candidates = [];
  for (const e of expenses) {
    candidates.push({
      match_type: 'expense', record_id: e.id, record_ids: [e.id], direction: 'out',
      amount: money(e.amount), date: e.date, merchant: e.name, account: e.payment_method?.name || null,
      label: e.name, external_id: e.external_id || null,
    });
  }
  for (const inv of inventories) {
    if (isCancelledPurchase(inv)) continue;
    const base = {
      record_id: inv.id, record_ids: [inv.id], direction: 'out', date: inv.purchase_date,
      merchant: inv.vendor?.name || inv.product_name, account: inv.payment_method?.name || null,
    };
    candidates.push({ ...base, match_type: 'purchase', part: 'total', amount: money(grossBatchCost(inv)), label: inv.product_name });
    for (const [field, part] of [['sales_tax', 'sales_tax'], ['shipping_cost_inbound', 'inbound_shipping'], ['fees', 'fees']]) {
      if (money(inv[field]) > 0) candidates.push({ ...base, match_type: 'purchase', part, amount: money(inv[field]), label: `${inv.product_name} · ${part}` });
    }
  }
  const deposits = new Map();
  for (const sale of salesOf(inventories)) {
    if (!isRealizedSale(sale)) continue;
    for (const [field, part] of [['sale_shipping', 'shipping_label'], ['commission_fee', 'platform_fee']]) {
      if (money(sale[field]) <= 0) continue;
      const card = part === 'shipping_label' ? sale.sale_shipping_payment_method : null;
      candidates.push({
        match_type: 'sale_cost', part, record_id: sale.id, record_ids: [sale.id], direction: 'out',
        amount: money(sale[field]), date: sale.sale_date,
        merchant: part === 'platform_fee' ? sale.platform?.name : (card?.name || sale.platform?.name),
        account: card?.name || null, label: `${sale.inventory.product_name} · ${part}`,
      });
    }
    if (!sale.paid_at || sale.paid_amount === null || sale.paid_amount === undefined) continue;
    const key = [dateOnly(sale.paid_at), sale.payout_account || '', sale.paid_reference || ''].join('|');
    const group = deposits.get(key) || {
      match_type: 'payout', record_ids: [], direction: 'in', amount: decimal(0), date: sale.paid_at,
      merchant: sale.platform?.name || null, account: sale.payout_account || null, reference: sale.paid_reference || null,
    };
    group.record_ids.push(sale.id);
    group.amount = group.amount.plus(sale.paid_amount);
    deposits.set(key, group);
  }
  for (const group of deposits.values()) {
    candidates.push({
      ...group, record_id: group.record_ids[0], amount: money(group.amount),
      label: `Payout of ${group.record_ids.length} sale${group.record_ids.length === 1 ? '' : 's'}`,
    });
  }
  return candidates;
}

// Tiers, highest first:
//   amount_date  amount equal to the cent and date within tolerance  0.80-1.00
//   amount       amount equal, date outside tolerance (within 30 days) 0.45-0.60
//   merchant     merchant similar (>= 0.5), date within tolerance,
//                amount within 10%                                   0.25-0.45
function scoreCandidate(txn, cand, toleranceDays) {
  const txnAmount = Math.abs(cents(txn.amount));
  const candAmount = Math.abs(cents(cand.amount));
  const dayDiff = Math.abs(dayNumber(txn.date) - dayNumber(cand.date));
  const merchant = Math.max(similarity(txn.merchant, cand.merchant), similarity(txn.merchant, cand.label) * 0.8);
  const accountBonus = txn.account && cand.account && similarity(txn.account, cand.account) >= 0.5 ? 0.05 : 0;
  const dateCloseness = toleranceDays > 0 ? 1 - dayDiff / (toleranceDays + 1) : (dayDiff === 0 ? 1 : 0);
  if (txnAmount === candAmount && txnAmount > 0) {
    if (dayDiff <= toleranceDays) {
      return { type: 'amount_date', confidence: Math.min(1, 0.8 + 0.1 * dateCloseness + 0.1 * merchant + accountBonus), dayDiff, merchant };
    }
    if (dayDiff <= 30) {
      return { type: 'amount', confidence: 0.45 + 0.1 * merchant + accountBonus, dayDiff, merchant };
    }
    return null;
  }
  if (dayDiff <= toleranceDays && merchant >= 0.5 && candAmount > 0
    && Math.abs(txnAmount - candAmount) <= candAmount * 0.1) {
    return { type: 'merchant', confidence: 0.25 + 0.15 * merchant + accountBonus, dayDiff, merchant };
  }
  return null;
}

function reconcileTransactions(inventories, expenses, { transactions, toleranceDays = 3, maxMatches = 3 }) {
  const candidates = reconcileCandidates(inventories, expenses);
  const results = [];
  const unmatched = [];
  const usedKeys = new Set();
  const keyOf = (c) => `${c.match_type}:${c.part || ''}:${c.record_ids.join(',')}`;

  for (const txn of transactions) {
    const scored = [];
    for (const cand of candidates) {
      const score = scoreCandidate(txn, cand, toleranceDays);
      if (score) scored.push({ cand, ...score });
    }
    // An external id already stored on an expense is a certain match.
    if (txn.id) {
      for (const cand of candidates) {
        if (cand.external_id && cand.external_id === String(txn.id)) {
          scored.push({ cand, type: 'external_id', confidence: 1, dayDiff: Math.abs(dayNumber(txn.date) - dayNumber(cand.date)), merchant: 1 });
        }
      }
    }
    scored.sort((a, b) => b.confidence - a.confidence || a.dayDiff - b.dayDiff);
    const seen = new Set();
    const matches = [];
    for (const s of scored) {
      const key = keyOf(s.cand);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        match_type: s.cand.match_type,
        part: s.cand.part || null,
        record_id: s.cand.record_id,
        record_ids: s.cand.record_ids,
        tier: s.type,
        confidence: Math.round(s.confidence * 100) / 100,
        amount: s.cand.amount,
        date: dateOnly(s.cand.date),
        days_apart: s.dayDiff,
        direction: s.cand.direction,
        label: s.cand.label,
        account: s.cand.account,
      });
      if (matches.length >= maxMatches) break;
    }
    if (matches.length) {
      usedKeys.add(`${matches[0].match_type}:${matches[0].part || ''}:${matches[0].record_ids.join(',')}`);
      results.push({ transaction: txn, best: matches[0], matches });
    } else {
      unmatched.push(txn);
    }
  }

  // Tracker records in the statement's date range that no transaction's best
  // match points at -- possibly missing from the bank feed, or entered twice.
  const days = transactions.map((t) => dayNumber(t.date)).filter(Number.isFinite);
  let unmatchedRecords = [];
  if (days.length) {
    const from = Math.min(...days) - toleranceDays;
    const to = Math.max(...days) + toleranceDays;
    // Only whole charges and deposits: a purchase's tax/shipping parts and a
    // sale's platform fee are inside another amount, not separate lines.
    unmatchedRecords = candidates
      .filter((c) => (c.match_type === 'purchase' ? c.part === 'total' : !(c.match_type === 'sale_cost' && c.part === 'platform_fee')))
      .filter((c) => c.amount !== 0 && inRange(c.date, from, to) && !usedKeys.has(keyOf(c)))
      .map((c) => ({
        match_type: c.match_type, part: c.part || null, record_id: c.record_id, record_ids: c.record_ids,
        amount: c.amount, date: dateOnly(c.date), direction: c.direction, label: c.label, account: c.account,
      }));
  }

  return {
    matched: results,
    unmatched_transactions: unmatched,
    unmatched_records: unmatchedRecords,
    summary: { transactions: transactions.length, matched: results.length, unmatched: unmatched.length, unmatched_records: unmatchedRecords.length },
  };
}

// ----------------------------------------------------------------- data_quality_report

// Wording that says the money has not come in, on a sale counted as paid.
const UNPAID_WORDING = /\b(not\s+(yet\s+)?(been\s+)?(paid|received)|payment\s+(not\s+received|pending|missing)|never\s+(got\s+)?paid|still\s+(waiting|owed|unpaid)|awaiting\s+payment|unpaid|haven'?t\s+(been\s+)?paid|no\s+payment)\b/i;
// Wording that says it has, on a sale counted as unpaid.
const PAID_WORDING = /\b(got\s+paid|payment\s+received|paid\s+in\s+full|received\s+payment|deposit(ed)?\s+(received|landed))\b/i;

function dataQualityReport(inventories, { notesByEntity = new Map() } = {}) {
  const live = inventories.filter((inv) => !isCancelledPurchase(inv));
  const sales = salesOf(inventories).filter(isRealizedSale);
  const issues = {};
  const add = (key, description, items) => {
    issues[key] = { description, count: items.length, items };
  };
  const purchaseRow = (inv) => ({ id: inv.id, item: inv.product_name, date: dateOnly(inv.purchase_date) });
  const saleRow = (s) => ({ id: s.id, item: s.inventory.product_name, date: dateOnly(s.sale_date), status: saleStatus(s) });

  add('purchases_missing_order_number', 'Purchases with no order number.', live.filter((inv) => !String(inv.order_number || '').trim()).map(purchaseRow));
  add('purchases_missing_inbound_tracking', 'Purchases with no inbound tracking number (fine for in-store buys).', live.filter((inv) => !String(inv.tracking_number || '').trim()).map(purchaseRow));
  add('sales_paid_without_payment', 'Sales counted as paid by status alone, with no payout date or amount. mark_sale_paid can backfill them.',
    sales.filter((s) => payoutStatus(s) !== 'unpaid' && (!s.paid_at || s.paid_amount === null || s.paid_amount === undefined))
      .map((s) => ({ ...saleRow(s), can_backfill: needsPayoutBackfill(s) })));
  add('purchases_zero_cost', 'Purchases whose total cost works out to $0 or less even though a unit cost is set (usually a gift card or refund covering it, or a typo).',
    live.filter((inv) => decimal(inv.unit_purchase_cost || 0).gt(0) && !batchCost(inv).gt(0))
      .map((inv) => ({ ...purchaseRow(inv), unit_cost: money(inv.unit_purchase_cost), total_cost: money(batchCost(inv)) })));

  const byTracking = new Map();
  for (const s of sales) {
    const key = normalizeId(s.tracking_number);
    if (!key) continue;
    byTracking.set(key, [...(byTracking.get(key) || []), s]);
  }
  add('duplicate_sale_tracking', 'The same outbound tracking number on more than one sale (fine for one box holding several sales).',
    [...byTracking.values()].filter((group) => group.length > 1)
      .map((group) => ({ tracking_number: group[0].tracking_number, sale_ids: group.map((s) => s.id) })));

  add('sales_missing_platform', 'Sales with no marketplace/cashout and no buyer.', sales.filter((s) => !s.platform_id && !s.buyer_id).map(saleRow));

  const byPurchase = new Map();
  for (const inv of live) {
    const key = [String(inv.product_name || '').trim().toLowerCase(), dateOnly(inv.purchase_date), inv.qty_purchased, cents(inv.unit_purchase_cost)].join('|');
    byPurchase.set(key, [...(byPurchase.get(key) || []), inv]);
  }
  add('possible_duplicate_purchases', 'Purchases with the same item, date, quantity and unit cost.',
    [...byPurchase.values()].filter((group) => group.length > 1).map((group) => ({
      item: group[0].product_name, date: dateOnly(group[0].purchase_date), qty: group[0].qty_purchased,
      unit_cost: money(group[0].unit_purchase_cost), purchase_ids: group.map((inv) => inv.id),
    })));

  const contradictions = [];
  for (const s of sales) {
    const texts = [s.notes, ...(notesByEntity.get(s.id) || [])].filter(Boolean);
    if (!texts.length) continue;
    const status = payoutStatus(s);
    const unpaidText = texts.find((t) => UNPAID_WORDING.test(t));
    const paidText = texts.find((t) => PAID_WORDING.test(t) && !UNPAID_WORDING.test(t));
    if (status !== 'unpaid' && unpaidText) contradictions.push({ ...saleRow(s), payout_status: status, note: String(unpaidText).slice(0, 200) });
    else if (status === 'unpaid' && paidText) contradictions.push({ ...saleRow(s), payout_status: status, note: String(paidText).slice(0, 200) });
  }
  add('notes_contradict_payment', 'Sales whose notes say the opposite of their payment state (e.g. "payment not received" on a paid sale).', contradictions);

  const total = Object.values(issues).reduce((sum, issue) => sum + issue.count, 0);
  return { issues, total_issues: total };
}

// ----------------------------------------------------------------- match_deposit

const MAX_NODES = 300000;

// Combinations of sales whose expected nets sum to a deposit. Candidates are
// the sales mark_sale_paid would accept -- unpaid, realized, at a payable
// status (or PAID with no payment yet) -- sold on or before the deposit date.
// Exact sums come first (fewest sales, one platform, then oldest), and when
// there is none, the closest sums either side of the deposit.
function matchDeposit(inventories, { amount, date, platform, account, maxSales = 8, maxResults = 5 }) {
  const target = cents(amount);
  const depositDay = dayOf(date);
  const all = salesOf(inventories).filter(isRealizedSale);

  // Platforms that have paid into this account before, so "account" can
  // narrow the search even though an unpaid sale has no account yet.
  let accountPlatforms = null;
  if (account) {
    accountPlatforms = new Set(all.filter((s) => s.payout_account && similarity(s.payout_account, account) >= 0.5).map((s) => s.platform_id).filter(Boolean));
    if (!accountPlatforms.size) accountPlatforms = null;
  }

  const excluded = { partial: 0, not_payable: 0 };
  const candidates = [];
  for (const sale of all) {
    const status = payoutStatus(sale);
    if (status === 'paid' && !needsPayoutBackfill(sale)) continue;
    if (status === 'partial') { excluded.partial += 1; continue; }
    if (sale.sale_date && dayNumber(sale.sale_date) > depositDay) continue;
    if (platform && similarity(sale.platform?.name, platform) < 0.5 && !String(sale.platform?.name || '').toLowerCase().includes(String(platform).toLowerCase())) continue;
    if (accountPlatforms && !accountPlatforms.has(sale.platform_id)) continue;
    const payable = statusTransitions.isActionAllowed(sale, 'sale', 'mark_paid') || needsPayoutBackfill(sale);
    if (!payable) { excluded.not_payable += 1; continue; }
    const net = cents(saleEconomics(sale.inventory, sale).revenue);
    if (net <= 0) continue;
    candidates.push({ sale, net });
  }
  // Largest first prunes the search fastest.
  candidates.sort((a, b) => b.net - a.net || new Date(a.sale.sale_date) - new Date(b.sale.sale_date));

  const exact = [];
  const near = [];
  let nodes = 0;
  const suffix = new Array(candidates.length + 1).fill(0);
  for (let i = candidates.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + candidates[i].net;

  const consider = (picked, sum) => {
    if (!picked.length) return;
    if (sum === target) { exact.push([...picked]); return; }
    near.push({ picked: [...picked], diff: Math.abs(sum - target) });
    if (near.length > 200) {
      near.sort((a, b) => a.diff - b.diff || a.picked.length - b.picked.length);
      near.length = 50;
    }
  };
  const search = (start, picked, sum) => {
    if (nodes++ > MAX_NODES || exact.length >= 50) return;
    for (let i = start; i < candidates.length; i++) {
      const next = sum + candidates[i].net;
      picked.push(i);
      consider(picked, next);
      // Keep going only while the sum can still reach the target.
      if (next < target && picked.length < maxSales && next + suffix[i + 1] >= target - 0) search(i + 1, picked, next);
      picked.pop();
      if (nodes > MAX_NODES) return;
    }
  };
  search(0, [], 0);

  const describe = (picked) => {
    const rows = picked.map((i) => candidates[i]);
    const total = rows.reduce((sum, r) => sum + r.net, 0);
    const platforms = [...new Set(rows.map((r) => r.sale.platform?.name || null))];
    const oldest = Math.min(...rows.map((r) => dayNumber(r.sale.sale_date)));
    return {
      sale_ids: rows.map((r) => r.sale.id),
      sales: rows.map((r) => ({
        id: r.sale.id, item: r.sale.inventory.product_name, sale_date: dateOnly(r.sale.sale_date),
        platform: r.sale.platform?.name || null, status: saleStatus(r.sale), expected_net: r.net / 100,
      })),
      total: total / 100,
      difference: (target - total) / 100,
      platforms,
      _rank: [platforms.length, rows.length, oldest],
    };
  };
  const rank = (a, b) => a._rank[0] - b._rank[0] || a._rank[1] - b._rank[1] || a._rank[2] - b._rank[2];
  const strip = ({ _rank, ...rest }) => rest;

  const exactCombos = exact.map(describe).sort(rank).slice(0, maxResults).map(strip);
  const closest = exactCombos.length ? [] : near
    .sort((a, b) => a.diff - b.diff || a.picked.length - b.picked.length)
    .slice(0, maxResults)
    .map((n) => strip(describe(n.picked)));

  return {
    deposit: { amount: target / 100, date },
    exact: exactCombos,
    closest,
    candidates_considered: candidates.length,
    search_complete: nodes <= MAX_NODES,
    excluded,
    how_to_record: 'Pass a combination\'s sale_ids to mark_sale_paid with this deposit\'s date and full amount. If the deposit is smaller than the total, mark_sale_paid records the difference as a shortfall; if it is larger, the extra is not recorded anywhere.',
  };
}

module.exports = {
  similarity, findRecords, FIND_FIELDS, listAllCosts, allCostLines, reconcileCandidates, reconcileTransactions,
  dataQualityReport, matchDeposit,
};
