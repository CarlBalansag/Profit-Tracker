// Settings > Data > Fill in costs from store orders. Cashout reports have no
// purchase price, so purchases made by the cashout import are saved at $0 with
// the "Cost needed" note. This reads a store's own order export (Amazon first)
// and fills those costs in.
//
// Two steps, both stateless, like the cashout import:
//   preview(): parse the export and pair each "Cost needed" purchase with an
//     order line: by tracking number first (an Amazon TBA that shipped straight
//     to the cashout), then by item name + order date. Nothing is written.
//   commit(): write the pairs the user kept. Only purchases that still cost $0
//     and still carry the note are touched, so a second tab or a double click
//     can't overwrite a cost that has been filled in meanwhile.
const prisma = require('../../prisma');
const { requireOwned } = require('../ownership');
const activityLog = require('../activityLog');
const { COST_NEEDED_NOTE, parseCsv, money, isoDate, cleanText, tokens } = require('../cashouts/importSold');

const SOURCES = { amazon: 'Amazon' };
const MAX_LINES = 50000;
const MAX_ITEMS = 3000;
// Several exports (one per Amazon account, or an older and a newer one) can be
// read together. Each file's lines are numbered from its id * FILE_STRIDE, so
// a line keeps its number when another file is added or removed.
const MAX_FILES = 10;
const FILE_STRIDE = 100000;
const MAX_TOTAL_LINES = 150000;
// A cashout receives an item some days after it was ordered. Name + date
// matches only look this far back from the cashout's date.
const NAME_MATCH_DAYS = 60;
const NAME_MATCH_SCORE = 0.6;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const round2 = (n) => Math.round(n * 100) / 100;
const headerKey = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Amazon writes some amounts as '-5.00' (with a leading quote) or "Not Available".
const amount = (value) => money(String(value ?? '').trim().replace(/^'+|'+$/g, ''));

// "AMZN_US(TBA336581719552)", "UPS(1Z999...) : USPS(9400...)", "Not Available".
function trackingNumbers(value) {
  return [...new Set((String(value ?? '').toUpperCase().match(/[A-Z0-9]{8,40}/g) || [])
    .filter((t) => /\d/.test(t)))];
}

// "Visa - 1234", "Mastercard - 5678 and Gift Certificate/Card" -> "1234".
function cardLast4(value) {
  const m = String(value ?? '').match(/(?:^|\D)(\d{4})(?!\d)/);
  return m ? m[1] : null;
}

// ─── Amazon export ───────────────────────────────────────────────────────────
// Request Your Data > Your Orders > Retail.OrderHistory.1.csv: one row per item
// per shipment. The older Order History Reports "Items" export (and Amazon
// Business's) use different names for the same things, so each field takes the
// first column that's present.
const AMAZON_COLUMNS = {
  orderId: ['order id'],
  orderDate: ['order date'],
  name: ['product name', 'title'],
  asin: ['asin', 'asin isbn'],
  qty: ['quantity', 'original quantity'],
  unitPrice: ['unit price', 'purchase price per unit'],
  unitTax: ['unit price tax'],
  lineTax: ['shipment item subtotal tax', 'item subtotal tax'],
  shipping: ['shipping charge'],
  discount: ['total discounts'],
  total: ['total owed', 'item total'],
  orderStatus: ['order status'],
  tracking: ['carrier name tracking number'],
  payment: ['payment instrument type'],
  currency: ['currency'],
};

function amazonLines(csv) {
  if (typeof csv !== 'string' || !csv.trim()) throw badRequest('Choose the CSV file from your Amazon order export.');
  const [header, ...body] = parseCsv(csv);
  if (!header) throw badRequest('The file is empty.');
  if (body.length > MAX_LINES) throw badRequest(`The file has ${body.length} rows. Import at most ${MAX_LINES} at a time.`);
  const keys = header.map(headerKey);
  const col = Object.fromEntries(Object.entries(AMAZON_COLUMNS).map(([field, names]) => [field, names.map((n) => keys.indexOf(n)).find((i) => i >= 0) ?? -1]));
  if (col.orderId < 0 || col.name < 0 || col.unitPrice < 0 || col.qty < 0) {
    throw badRequest('This doesn\'t look like an Amazon order export (expected Order ID, Product Name, Unit Price and Quantity columns). Use Retail.OrderHistory.1.csv from Amazon\'s "Request Your Data" download.');
  }
  const get = (cells, field) => (col[field] >= 0 ? String(cells[col[field]] ?? '').trim() : '');

  return body.map((cells, index) => {
    const qty = Number(get(cells, 'qty'));
    const unitPrice = amount(get(cells, 'unitPrice'));
    const unitTax = amount(get(cells, 'unitTax'));
    const lineTax = amount(get(cells, 'lineTax'));
    const line = {
      index,
      orderId: cleanText(get(cells, 'orderId'), 60),
      orderDate: isoDate(get(cells, 'orderDate')),
      name: cleanText(get(cells, 'name')),
      asin: cleanText(get(cells, 'asin'), 20),
      qty: Number.isInteger(qty) ? qty : null,
      unitPrice,
      tracking: trackingNumbers(get(cells, 'tracking')),
      last4: cardLast4(get(cells, 'payment')),
      payment: cleanText(get(cells, 'payment'), 80),
      problem: null,
    };
    const currency = get(cells, 'currency');
    if (/cancel/i.test(get(cells, 'orderStatus'))) line.problem = 'Cancelled order.';
    else if (!line.name) line.problem = 'No product name.';
    else if (!line.qty || line.qty < 1) line.problem = 'No quantity.';
    else if (unitPrice === null || unitPrice < 0) line.problem = 'No unit price.';
    else if (currency && currency.toUpperCase() !== 'USD') line.problem = `Paid in ${currency}, not USD.`;
    if (line.problem) return line;
    // What one unit cost: price less its share of discounts, plus its share of
    // tax and shipping. Tax and shipping go to the purchase's own fields.
    const discount = Math.abs(amount(get(cells, 'discount')) || 0);
    const shipping = Math.max(0, amount(get(cells, 'shipping')) || 0);
    line.perUnit = {
      cost: round2(Math.max(0, unitPrice - discount / line.qty)),
      tax: round2(Math.max(0, unitTax ?? (lineTax !== null ? lineTax / line.qty : 0))),
      shipping: round2(shipping / line.qty),
    };
    return line;
  });
}

function parseOrders(source, csv) {
  if (!SOURCES[source]) throw badRequest('Pick which store the export is from.');
  return amazonLines(csv);
}

// The store accounts files are tagged with: this user's, and on a store.
async function accountsById(userId, ids, client = prisma) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await client.account.findMany({
    where: { id: { in: unique }, user_id: userId },
    select: { id: true, name: true, platform_id: true, platform: { select: { type: true } } },
  });
  if (rows.length !== unique.length) throw Object.assign(new Error('Store account not found or access denied'), { status: 404 });
  if (rows.some((a) => a.platform?.type !== 'Vendor')) throw badRequest('Pick an account that belongs to one of your stores.');
  return new Map(rows.map((a) => [a.id, { id: a.id, name: a.name, vendorId: a.platform_id }]));
}

// { csv } (one file) or { files: [{ id, csv, accountId }] }. Returns every
// file's lines as one list. A line that's in two files (overlapping exports)
// is used once. An order that shows up under two different accounts can't be
// right, so its lines are set aside instead of guessing.
async function readOrderFiles(userId, source, { csv, files }) {
  if (!SOURCES[source]) throw badRequest('Pick which store the export is from.');
  const list = Array.isArray(files) ? files : (typeof csv === 'string' ? [{ id: 1, csv, accountId: null }] : null);
  if (!list || list.length === 0) throw badRequest('Choose the CSV file from your Amazon order export.');
  if (list.length > MAX_FILES) throw badRequest(`Add at most ${MAX_FILES} order files at a time.`);
  const clean = list.map((f, i) => {
    const id = Number(f?.id);
    if (!f || !Number.isInteger(id) || id < 1 || id > 9999) throw badRequest(`File ${i + 1} is invalid. Add it again.`);
    const accountId = typeof f.accountId === 'string' && f.accountId ? f.accountId : null;
    return { id, csv: f.csv, accountId };
  });
  if (new Set(clean.map((f) => f.id)).size !== clean.length) throw badRequest('The same file is in the list twice. Add it again.');
  const accounts = await accountsById(userId, clean.map((f) => f.accountId));

  const all = [];
  const fileInfo = [];
  for (const [n, f] of clean.entries()) {
    let lines;
    try {
      lines = amazonLines(f.csv);
    } catch (err) {
      if (clean.length > 1 && err.status === 400) err.message = `File ${n + 1}: ${err.message}`;
      throw err;
    }
    fileInfo.push({ id: f.id, accountId: f.accountId, lines: lines.length, problems: 0, duplicates: 0 });
    for (const l of lines) all.push({ ...l, index: f.id * FILE_STRIDE + l.index, file: f.id, accountId: f.accountId });
    if (all.length > MAX_TOTAL_LINES) throw badRequest(`These files have more than ${MAX_TOTAL_LINES} rows together. Add fewer files at a time.`);
  }
  const infoOf = (id) => fileInfo.find((fi) => fi.id === id);

  // Same order under two different accounts: set aside.
  const orderAccounts = new Map();
  for (const l of all) {
    if (!l.orderId || !l.accountId) continue;
    if (!orderAccounts.has(l.orderId)) orderAccounts.set(l.orderId, new Set());
    orderAccounts.get(l.orderId).add(l.accountId);
  }
  // Same line in two files: keep the first, take an account from the other.
  const seen = new Map();
  const lines = [];
  for (const l of all) {
    if (l.orderId && orderAccounts.get(l.orderId)?.size > 1 && !l.problem) {
      l.problem = 'This order is in the files for two different accounts.';
      delete l.perUnit;
    }
    const key = [l.orderId, l.orderDate, l.asin, l.name, l.qty, l.unitPrice, l.tracking.join(' ')].join('|');
    const first = seen.get(key);
    if (first && first.file !== l.file) {
      if (!first.accountId && l.accountId) first.accountId = l.accountId;
      infoOf(l.file).duplicates += 1;
      continue;
    }
    if (!first) seen.set(key, l);
    lines.push(l);
  }
  for (const l of lines) if (l.problem) infoOf(l.file).problems += 1;
  return { lines, files: fileInfo, accounts };
}

// ─── Matching ────────────────────────────────────────────────────────────────
// Share of the shorter name's words found in the other (cashout names are short,
// Amazon's are long).
function nameScore(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / Math.min(x.size, y.size);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const isoOf = (date) => (date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10));
const daysBetween = (fromIso, toIso) => Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / DAY_MS);

const costNeededWhere = (userId) => ({ user_id: userId, unit_purchase_cost: 0, notes: { contains: COST_NEEDED_NOTE } });

async function costNeededPurchases(userId, client = prisma) {
  const rows = await client.inventory.findMany({
    where: costNeededWhere(userId),
    select: {
      id: true, product_name: true, purchase_date: true, qty_purchased: true, tracking_number: true,
      vendor_id: true, payment_method_id: true, order_number: true,
      sales: { select: { tracking_number: true, platform: { select: { name: true } } } },
    },
    orderBy: { purchase_date: 'asc' },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.product_name,
    date: isoOf(r.purchase_date),
    qty: r.qty_purchased,
    tracking: [...new Set([r.tracking_number, ...r.sales.map((s) => s.tracking_number)].filter(Boolean).map((t) => t.toUpperCase()))],
    cashout: r.sales[0]?.platform?.name || null,
    hasStore: Boolean(r.vendor_id),
    hasCard: Boolean(r.payment_method_id),
    hasOrderNumber: Boolean(r.order_number),
  }));
}

// Pairs purchases with order lines. Each line is used up by quantity: name +
// date matches only take lines with units left, while a tracking match always
// wins (the box went straight to the cashout) and is flagged if it overdraws.
function matchPurchases(purchases, lines) {
  const usable = lines.filter((l) => !l.problem);
  const left = new Map(usable.map((l) => [l.index, l.qty]));
  const byTracking = new Map();
  for (const l of usable) for (const t of l.tracking) {
    if (!byTracking.has(t)) byTracking.set(t, []);
    byTracking.get(t).push(l);
  }

  const results = purchases.map((p) => ({ ...p, lineIndex: null, match: 'none', candidates: [], review: null }));

  // Pass 1: tracking number.
  for (const r of results) {
    const found = [...new Set(r.tracking.flatMap((t) => byTracking.get(t) || []))];
    if (!found.length) continue;
    const ranked = found
      .map((l) => ({ l, score: nameScore(r.name, l.name) }))
      .sort((a, b) => b.score - a.score || (left.get(b.l.index) - left.get(a.l.index)));
    const best = ranked[0];
    r.lineIndex = best.l.index;
    r.match = 'tracking';
    r.candidates = ranked.slice(0, 8).map((c) => c.l.index);
    if (ranked.length > 1 && (best.score < NAME_MATCH_SCORE || ranked[1].score === best.score)) {
      r.review = 'This box had more than one item. Check that the right one is picked.';
    }
    left.set(best.l.index, left.get(best.l.index) - r.qty);
  }

  // Pass 2: name + order date (ordered on or up to NAME_MATCH_DAYS before the
  // cashout's date), closest date first.
  for (const r of results) {
    if (r.match !== 'none') continue;
    const ranked = usable
      .filter((l) => l.orderDate)
      .map((l) => ({ l, score: nameScore(r.name, l.name), days: daysBetween(l.orderDate, r.date) }))
      .filter((c) => c.score >= NAME_MATCH_SCORE && c.days >= 0 && c.days <= NAME_MATCH_DAYS)
      .sort((a, b) => b.score - a.score || a.days - b.days);
    if (!ranked.length) continue;
    r.candidates = ranked.slice(0, 8).map((c) => c.l.index);
    const best = ranked.find((c) => left.get(c.l.index) >= r.qty);
    if (!best) {
      r.review = 'Matching orders were already used by other purchases. Pick one if it\'s right.';
      continue;
    }
    r.lineIndex = best.l.index;
    r.match = 'name';
    r.review = 'Matched by name and date. Check it\'s the right order.';
    left.set(best.l.index, left.get(best.l.index) - r.qty);
  }

  for (const r of results) {
    if (r.lineIndex === null) continue;
    if (left.get(r.lineIndex) < 0 && !r.review) {
      r.review = 'This order line has fewer units than the purchases matched to it.';
    }
  }
  return results;
}

// ─── Preview ─────────────────────────────────────────────────────────────────
async function cardsByLast4(userId, client = prisma) {
  const cards = await client.paymentMethod.findMany({ where: { user_id: userId, last4: { not: null } }, select: { id: true, last4: true } });
  const map = new Map();
  for (const c of cards) {
    const key = String(c.last4).trim().slice(-4);
    map.set(key, map.has(key) ? null : c.id); // two cards with the same digits: don't guess
  }
  return map;
}

// Only the lines a purchase can pick from, with the card each was paid with.
async function linesFor(userId, lines, results, accounts = new Map()) {
  const cards = await cardsByLast4(userId);
  const used = new Set(results.flatMap((r) => r.candidates));
  return lines.filter((l) => used.has(l.index)).map((l) => ({
    index: l.index,
    orderId: l.orderId,
    orderDate: l.orderDate,
    name: l.name,
    qty: l.qty,
    tracking: l.tracking,
    perUnit: l.perUnit,
    payment: l.payment,
    paymentMethodId: l.last4 ? cards.get(l.last4) || null : null,
    accountId: l.accountId || null,
    accountName: l.accountId ? accounts.get(l.accountId)?.name || null : null,
    vendorId: l.accountId ? accounts.get(l.accountId)?.vendorId || null : null,
  }));
}

async function preview(userId, { source, csv, files }) {
  const { lines, files: fileInfo, accounts } = await readOrderFiles(userId, source, { csv, files });
  const purchases = await costNeededPurchases(userId);
  if (purchases.length > MAX_ITEMS) throw badRequest(`You have ${purchases.length} purchases waiting for a cost. Fill in at most ${MAX_ITEMS} at a time.`);
  const results = matchPurchases(purchases, lines);
  const sentLines = await linesFor(userId, lines, results, accounts);

  const count = (m) => results.filter((r) => r.match === m).length;
  return {
    source,
    sourceName: SOURCES[source],
    summary: {
      lines: lines.length,
      problems: lines.filter((l) => l.problem).length,
      costNeeded: purchases.length,
      files: fileInfo,
      byTracking: count('tracking'),
      byName: count('name'),
      unmatched: count('none'),
    },
    purchases: results,
    lines: sentLines,
  };
}

// ─── Matching a cashout report before it's imported ─────────────────────────
// The cashout import's review sends the purchases it is about to create
// ({ key, name, date, qty, tracking }); each gets its store order, so the
// import saves real costs instead of "Cost needed". Writes nothing.
async function matchReport(userId, { source, csv, files, groups }) {
  if (!SOURCES[source]) throw badRequest('Pick which store the export is from.');
  if (!Array.isArray(groups) || groups.length === 0) throw badRequest('Read the cashout report first.');
  if (groups.length > MAX_ITEMS) throw badRequest(`Match at most ${MAX_ITEMS} purchases at a time.`);
  const purchases = groups.map((g, i) => {
    const date = isoDate(g?.date);
    const qty = Number(g?.qty);
    const name = cleanText(g?.name);
    if (!g || typeof g.key !== 'string' || !name || !date || !Number.isInteger(qty) || qty < 1) throw badRequest(`Row ${i + 1} is invalid. Read the report again.`);
    const tracking = (Array.isArray(g.tracking) ? g.tracking : []).map((t) => String(t).toUpperCase()).filter((t) => /^[A-Z0-9-]{6,60}$/.test(t));
    return { id: g.key, name, date, qty, tracking };
  });
  const { lines, files: fileInfo, accounts } = await readOrderFiles(userId, source, { csv, files });
  const results = matchPurchases(purchases, lines);
  const count = (m) => results.filter((r) => r.match === m).length;
  return {
    source,
    sourceName: SOURCES[source],
    summary: {
      lines: lines.length,
      problems: lines.filter((l) => l.problem).length,
      byTracking: count('tracking'),
      byName: count('name'),
      unmatched: count('none'),
      files: fileInfo,
    },
    matches: results.map((r) => ({ key: r.id, lineIndex: r.lineIndex, match: r.match, candidates: r.candidates, review: r.review })),
    lines: await linesFor(userId, lines, results, accounts),
  };
}

// ─── Commit ──────────────────────────────────────────────────────────────────
const dateAtNoon = (iso) => new Date(`${iso}T12:00:00.000Z`);

function cleanItem(raw, index) {
  const at = `Row ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw badRequest(`${at} is invalid.`);
  const field = (key, label) => {
    const v = raw[key];
    if (v === undefined || v === null || v === '') return 0;
    const n = money(v);
    if (n === null) throw badRequest(`${at}: ${label} is not a valid amount.`);
    if (n < 0) throw badRequest(`${at}: ${label} can't be negative.`);
    if (n > 1000000) throw badRequest(`${at}: ${label} is too large.`);
    return n;
  };
  const inventoryId = typeof raw.inventory_id === 'string' ? raw.inventory_id : null;
  if (!inventoryId) throw badRequest(`${at} is missing its purchase. Preview the file again.`);
  const unitCost = field('unit_cost', 'cost');
  if (!(unitCost > 0)) throw badRequest(`${at}: enter a cost above $0.`);
  const orderDate = raw.order_date ? isoDate(raw.order_date) : null;
  if (raw.order_date && !orderDate) throw badRequest(`${at}: order date is not valid.`);
  return {
    inventoryId,
    unitCost,
    salesTax: field('sales_tax', 'tax'),
    shipping: field('shipping', 'shipping'),
    orderNumber: cleanText(raw.order_number, 60),
    orderDate,
    paymentMethodId: typeof raw.payment_method_id === 'string' && raw.payment_method_id ? raw.payment_method_id : null,
    accountId: typeof raw.account_id === 'string' && raw.account_id ? raw.account_id : null,
  };
}

async function commit(userId, { source, vendorId, paymentMethodId, useOrderDate, items }) {
  if (!SOURCES[source]) throw badRequest('Pick which store the export is from.');
  if (!Array.isArray(items) || items.length === 0) throw badRequest('Nothing selected to save.');
  if (items.length > MAX_ITEMS) throw badRequest(`Save at most ${MAX_ITEMS} purchases at a time.`);
  const clean = items.map(cleanItem);
  if (new Set(clean.map((c) => c.inventoryId)).size !== clean.length) throw badRequest('The same purchase is in the list twice. Preview the file again.');

  if (vendorId) {
    const store = await requireOwned('platform', vendorId, userId, 'Store');
    if (store.type !== 'Vendor') throw badRequest('Pick one of your stores.');
  }
  const cardIds = [...new Set([paymentMethodId, ...clean.map((c) => c.paymentMethodId)].filter(Boolean))];
  const owned = await prisma.paymentMethod.findMany({ where: { id: { in: cardIds }, user_id: userId }, select: { id: true } });
  if (owned.length !== cardIds.length) throw Object.assign(new Error('Payment method not found'), { status: 404 });
  const accounts = await accountsById(userId, clean.map((c) => c.accountId));

  const label = SOURCES[source];
  const ids = clean.map((c) => c.inventoryId);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-order-costs:${userId}`}))`;
    const { result } = await activityLog.trackChange(tx, userId, {
      action: 'edit',
      recordType: 'purchase',
      refs: async () => ({ inventory: ids }),
      recordId: ids[0],
      productName: clean.length === 1 ? undefined : `Costs from ${label} for ${clean.length} purchases`,
    }, async () => {
      let updated = 0;
      let skipped = 0;
      for (const c of clean) {
        // Still waiting for a cost and still this user's? Locked so a cost
        // typed in another tab meanwhile is never overwritten.
        const [row] = await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${c.inventoryId} AND user_id = ${userId} FOR UPDATE`;
        const current = row && await tx.inventory.findFirst({
          where: { id: c.inventoryId, ...costNeededWhere(userId) },
          select: { notes: true, vendor_id: true, payment_method_id: true, order_number: true, purchase_date: true, account_id: true },
        });
        if (!current) { skipped += 1; continue; }
        const cardId = c.paymentMethodId || paymentMethodId;
        // The order's account names its store. Saved only when the purchase
        // has no account yet and ends up at that store.
        const account = c.accountId ? accounts.get(c.accountId) : null;
        const storeId = current.vendor_id || (account ? account.vendorId : vendorId) || null;
        const accountId = account && !current.account_id && storeId === account.vendorId ? account.id : null;
        const filledNote = `Cost from ${label}${c.orderNumber ? ` order ${c.orderNumber}` : ''}.`;
        await tx.inventory.update({
          where: { id: c.inventoryId },
          data: {
            unit_purchase_cost: c.unitCost,
            sales_tax: c.salesTax,
            shipping_cost_inbound: c.shipping,
            notes: current.notes.replace(COST_NEEDED_NOTE, filledNote).trim(),
            ...(c.orderNumber && !current.order_number ? { order_number: c.orderNumber } : {}),
            ...(storeId && !current.vendor_id ? { vendor_id: storeId } : {}),
            ...(accountId ? { account_id: accountId } : {}),
            ...(cardId && !current.payment_method_id ? { payment_method_id: cardId } : {}),
            // The cashout's date is when it got the item; the order date is
            // when it was bought. Never moved later than it already is.
            ...(useOrderDate && c.orderDate && dateAtNoon(c.orderDate) < current.purchase_date ? { purchase_date: dateAtNoon(c.orderDate) } : {}),
          },
        });
        updated += 1;
      }
      return { updated, skipped };
    });
    return result;
  }, { timeout: 60000, maxWait: 10000 });
}

module.exports = {
  SOURCES,
  trackingNumbers,
  cardLast4,
  amazonLines,
  parseOrders,
  readOrderFiles,
  accountsById,
  FILE_STRIDE,
  nameScore,
  matchPurchases,
  costNeededPurchases,
  preview,
  matchReport,
  commit,
};
