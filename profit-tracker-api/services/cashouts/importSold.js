// Settings > Data > Import from cashouts. Turns a cashout's sold/received
// items report into purchases + sales, for people starting out with history
// already sitting on a cashout's website.
//
// Two steps, both stateless:
//   preview(): parse (or pull) the report, group it into purchases, and mark
//     each group as new, already imported, or already in Profit Tracker
//     (matched by tracking number). Nothing is written.
//   commit(): write the groups the user kept, each as one purchase + one sale
//     in a single transaction. Groups whose rows were imported meanwhile are
//     skipped, so a double click or a second tab can't import twice.
//
// Every report row has a stable `ref` (EB: invoice + serial, LA/P4D: the line
// ID). Each sale keeps the refs of the rows it came from in import_refs, so a
// later import of an overlapping date range skips them.
//
// The reports have no purchase cost, store or card. Cost is whatever the user
// types in the preview; left blank it is saved as $0 and the purchase is
// noted "Cost needed" so it's easy to find and fix.
const prisma = require('../../prisma');
const statusTransitions = require('../statusTransitions');
const { requireOwned } = require('../ownership');

const SOURCES = {
  eb: 'ElectronicsBuyer',
  la: 'EarnFromBuying (LA)',
  p4d: 'Points4Days',
};
const MAX_ROWS = 10000;
const MAX_GROUPS = 3000;
const COST_NEEDED_NOTE = 'Cost needed: imported from a cashout report, which has no purchase price.';

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// ─── CSV ─────────────────────────────────────────────────────────────────────
// RFC 4180: quoted fields, doubled quotes, commas/newlines inside quotes.
function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((v) => v.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((v) => v.trim() !== '')) rows.push(row);
  return rows;
}

const headerKey = (h) => String(h || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Rows as objects keyed by normalised header ("Invoice #" -> "invoice").
function csvRecords(text) {
  const [header, ...body] = parseCsv(text);
  if (!header) throw badRequest('The file is empty.');
  if (body.length > MAX_ROWS) throw badRequest(`The file has ${body.length} rows. Import at most ${MAX_ROWS} at a time (pick a shorter date range).`);
  const keys = header.map(headerKey);
  return { keys, records: body.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? '').trim()]))) };
}

// ─── Field parsing ───────────────────────────────────────────────────────────
function money(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const text = String(value).trim();
  if (!text) return null;
  const negative = /^\(.*\)$/.test(text) || text.startsWith('-');
  const n = Number(text.replace(/[$,()\s-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round((negative ? -n : n) * 100) / 100;
}

const pad = (n) => String(n).padStart(2, '0');

// "2026-11-19", "2026-11-19 10:20:00", "11/19/2026", "11/19/26" -> "2026-11-19".
function isoDate(value) {
  const text = String(value ?? '').trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  return null;
}
function validDate(y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

const truthy = (value) => /^(1|y|yes|true|x|✓|verified|void|voided)$/i.test(String(value ?? '').trim());

function trackingList(value) {
  return [...new Set(String(value ?? '')
    .split(/[\s,;|]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t.length >= 6 && t.length <= 60 && /^[A-Z0-9-]+$/.test(t)))];
}

const cleanText = (value, max = 300) => {
  const text = String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  return text ? text.slice(0, max) : null;
};

// ─── Report formats ──────────────────────────────────────────────────────────
// Each parser returns normalised rows:
// { ref, invoice, date, tracking[], name, upc, sku, serial, qty, unitPrice,
//   fee, paid, status, problem }
// unitPrice is what the cashout pays per unit; fee is any amount it takes
// back out of the line (saved as the sale's commission_fee).
// `problem` set means the row can't be imported (shown, never written).

// ElectronicsBuyer > Balance Summary > Items Sold export. One row per unit.
// Columns: Date, Invoice #, Tracking, Item Name, UPC, SKU, Condition,
// Location, Serial, Sale Price, Owed. Owed is what EB still has to pay: 0 means paid.
function parseEbRecords(records) {
  const seen = new Map();
  return records.map((r) => {
    const invoice = cleanText(r.invoice, 60);
    const serial = cleanText(r.serial, 120);
    const upc = cleanText(r.upc, 40);
    const name = cleanText(r['item name']);
    const unitPrice = money(r['sale price']);
    const owed = money(r.owed);
    // No serial: number the unit within its invoice + item, so the same file
    // imported twice still gives every row the same ref.
    const base = `eb:${invoice || '-'}:${serial || `${upc || name || '-'}`}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const row = {
      ref: serial ? base : `${base}#${n}`,
      invoice,
      date: isoDate(r.date),
      tracking: trackingList(r.tracking),
      name,
      upc,
      sku: cleanText(r.sku, 120),
      serial,
      qty: 1,
      unitPrice,
      fee: 0,
      paid: owed !== null ? owed <= 0 : false,
      status: owed !== null && owed <= 0 ? 'Paid' : 'Owed',
      problem: null,
    };
    row.problem = rowProblem(row);
    return row;
  });
}

// Parsefile sites (EarnFromBuying, Points4Days): Receiving analytics >
// received items CSV, identical to their REST API's response. Columns:
// VERIFIED, VOID, ID, RECEIPT ID, CREATED DATE, USER, ITEM, WAREHOUSE, QTY,
// PRICE, TAX, COMMISSION, EXT TOTAL, STATUS, DELIVERY, TRACKING NUMBERS.
function parseParsefileRecords(source, records) {
  return records.map((r) => {
    const id = cleanText(r.id, 60);
    const status = cleanText(r.status, 60);
    const qty = Number(String(r.qty ?? '').replace(/,/g, ''));
    const row = {
      ref: `${source}:${id || '-'}`,
      invoice: cleanText(r['receipt id'], 60),
      date: isoDate(r['created date']),
      tracking: trackingList(r['tracking numbers']),
      name: cleanText(r.item),
      upc: null,
      sku: null,
      serial: null,
      qty: Number.isInteger(qty) ? qty : NaN,
      // COMMISSION is the group's bonus on top of PRICE, and EXT TOTAL is
      // QTY x (PRICE + COMMISSION): the payout. Per unit from EXT TOTAL when
      // it divides evenly, else PRICE + COMMISSION.
      unitPrice: parsefileUnitPrice(qty, money(r['ext total']), money(r.price), money(r.commission)),
      fee: 0,
      paid: /\bpaid\b/i.test(status || '') && !/\bunpaid\b/i.test(status || ''),
      status,
      problem: null,
    };
    if (!id) row.problem = 'No line ID in the report.';
    else if (truthy(r.void)) row.problem = 'Voided on the cashout.';
    else row.problem = rowProblem(row);
    return row;
  });
}

function parsefileUnitPrice(qty, extTotal, price, bonus) {
  if (Number.isInteger(qty) && qty > 0 && extTotal !== null) {
    const unit = Math.round((extTotal / qty) * 100) / 100;
    if (Math.abs(unit * qty - extTotal) < 0.005) return unit;
  }
  if (price === null) return null;
  return Math.round((price + (bonus || 0)) * 100) / 100;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// The site's own date, as it shows it: "Mon Oct 12 2026 12:51:21 -0700" -> "2026-10-12".
function parsefileDate(value) {
  const m = String(value ?? '').match(/^[A-Za-z]{3} ([A-Za-z]{3}) (\d{1,2}) (\d{4})\b/);
  if (m && MONTHS[m[1].toLowerCase()]) return validDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return isoDate(value);
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : money(v));

// Rows of the parsefile site's own Received items table (it@receipt-items-
// details), read with the saved login. Kept when created within from..to.
function parseParsefileTableRows(source, rows, { from, to } = {}) {
  if (!Array.isArray(rows)) throw Object.assign(new Error(`${SOURCES[source]} returned received items in an unexpected format.`), { status: 502 });
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const date = parsefileDate(r.f_created);
    if (date && ((from && date < from) || (to && date > to))) continue;
    const qty = Number(r.f_qty);
    const net = num(r.f_net_total);
    const row = {
      ref: `${source}:${cleanText(r.f_id, 60) || '-'}`,
      invoice: cleanText(r.f_receipt, 60),
      date,
      tracking: trackingList(r.f_tracking),
      name: cleanText(r.f_item),
      upc: cleanText(r.f_upc, 40),
      sku: cleanText(r.f_model, 120),
      serial: null,
      qty: Number.isInteger(qty) ? qty : NaN,
      unitPrice: parsefileUnitPrice(qty, num(r.f_ext_total), num(r.f_price), num(r.f_commission)),
      // Expenses the group charged on the line come out of the payout.
      fee: Math.max(0, Math.round((num(r.f_ext_expense) || 0) * 100) / 100),
      paid: Boolean(r.f_paid),
      status: cleanText(r.f_status, 60),
      problem: null,
    };
    if (!r.f_id) row.problem = 'No line ID in the report.';
    else if (r.f_void === 1 || r.f_void === true) row.problem = 'Voided on the cashout.';
    else if (net !== null && net < 0) row.problem = 'Payout is negative.';
    else row.problem = rowProblem(row);
    out.push(row);
  }
  return out;
}

function rowProblem(row) {
  if (!row.name) return 'No item name.';
  if (!row.date) return 'No valid date.';
  if (!Number.isInteger(row.qty) || row.qty < 1) return 'Quantity is not a whole number of at least 1.';
  if (row.unitPrice === null || row.unitPrice < 0) return 'No valid price.';
  return null;
}

const has = (keys, ...names) => names.every((n) => keys.includes(n));

// Reads a pasted/uploaded CSV, checking it is the report the source expects.
function parseReport(source, csv) {
  if (!SOURCES[source]) throw badRequest('Pick EB, LA or P4D.');
  if (typeof csv !== 'string' || !csv.trim()) throw badRequest('Choose the CSV file exported from the cashout.');
  const { keys, records } = csvRecords(csv);
  if (source === 'eb') {
    if (!has(keys, 'invoice', 'item name', 'sale price')) {
      throw badRequest('This doesn\'t look like ElectronicsBuyer\'s Items Sold export (expected Invoice #, Item Name and Sale Price columns).');
    }
    return parseEbRecords(records);
  }
  if (!has(keys, 'id', 'item', 'qty', 'price')) {
    throw badRequest(`This doesn't look like ${SOURCES[source]}'s received items export (expected ID, ITEM, QTY and PRICE columns).`);
  }
  return parseParsefileRecords(source, records);
}

// ─── Grouping and matching ───────────────────────────────────────────────────
const normName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Rows for the same item, price, date, box and pay state become one purchase.
function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (row.problem) continue;
    const key = [row.invoice || '', row.date, row.tracking.join('+'), normName(row.name), row.upc || '', row.unitPrice, row.paid ? 'p' : 'u'].join('|');
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        name: row.name,
        upc: row.upc,
        sku: row.sku,
        date: row.date,
        invoice: row.invoice,
        tracking: row.tracking,
        unitPrice: row.unitPrice,
        paid: row.paid,
        status: row.status,
        qty: 0,
        fee: 0,
        serials: [],
        refs: [],
      };
      groups.set(key, group);
    }
    group.qty += row.qty;
    group.fee = Math.round((group.fee + row.fee) * 100) / 100;
    if (row.serial) group.serials.push(row.serial);
    group.refs.push(row.ref);
  }
  return [...groups.values()];
}

function tokens(name) {
  return new Set(normName(name).split(' ').filter((t) => t.length > 1));
}
function similarName(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  if (!x.size || !y.size) return false;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared += 1;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

// Marks each group 'new', 'imported' (its rows are already on a sale from an
// earlier import) or 'existing' (a sale with the same tracking number is
// already recorded, e.g. through Log Purchase). Existing sales are used up by
// quantity, so a box with 2 sticks recorded and 4 on the report leaves 2 new.
async function matchGroups(userId, groups, client = prisma) {
  const refs = groups.flatMap((g) => g.refs);
  const trackings = [...new Set(groups.flatMap((g) => g.tracking))];
  const [imported, tracked] = await Promise.all([
    refs.length
      ? client.sales.findMany({
        where: { inventory: { user_id: userId }, import_refs: { hasSome: refs } },
        select: { import_refs: true },
      })
      : [],
    trackings.length
      ? client.sales.findMany({
        where: {
          inventory: { user_id: userId },
          voided_at: null,
          import_refs: { isEmpty: true },
          OR: [
            { tracking_number: { in: trackings, mode: 'insensitive' } },
            { inventory: { tracking_number: { in: trackings, mode: 'insensitive' } } },
          ],
        },
        select: { id: true, quantity: true, tracking_number: true, inventory: { select: { product_name: true, tracking_number: true } } },
      })
      : [],
  ]);

  const importedRefs = new Set(imported.flatMap((s) => s.import_refs));
  const pool = tracked.map((s) => ({
    id: s.id,
    left: s.quantity,
    name: s.inventory.product_name,
    tracking: [s.tracking_number, s.inventory.tracking_number].filter(Boolean).map((t) => t.toUpperCase()),
  }));

  // Similar names claim their sales first, then anything left in the same box.
  const take = (group, needName) => {
    for (const sale of pool) {
      if (group.need <= 0) return;
      if (sale.left <= 0 || !sale.tracking.some((t) => group.tracking.includes(t))) continue;
      if (needName && !similarName(sale.name, group.name)) continue;
      const used = Math.min(sale.left, group.need);
      sale.left -= used;
      group.need -= used;
      group.matchedSaleIds.add(sale.id);
    }
  };

  for (const group of groups) {
    group.matchedSaleIds = new Set();
    const already = group.refs.filter((r) => importedRefs.has(r)).length;
    if (already === group.refs.length) {
      group.match = 'imported';
      group.need = 0;
    } else {
      group.match = 'new';
      group.need = group.qty;
    }
  }
  for (const pass of [true, false]) {
    for (const group of groups) if (group.match === 'new' && group.tracking.length) take(group, pass);
  }
  for (const group of groups) {
    if (group.match === 'new' && group.need === 0) group.match = 'existing';
    else if (group.match === 'new' && group.need < group.qty) group.match = 'partial';
    group.newQty = group.match === 'new' || group.match === 'partial' ? group.need : 0;
    group.matchedSaleIds = [...group.matchedSaleIds];
    delete group.need;
  }
  return groups;
}

function summarise(rows, groups) {
  const count = (m) => groups.filter((g) => g.match === m).length;
  return {
    rows: rows.length,
    problems: rows.filter((r) => r.problem).length,
    groups: groups.length,
    new: count('new') + count('partial'),
    imported: count('imported'),
    existing: count('existing'),
    newUnits: groups.reduce((n, g) => n + g.newQty, 0),
    newPayout: Math.round(groups.reduce((n, g) => n + g.newQty * g.unitPrice, 0) * 100) / 100,
  };
}

// ─── Preview ─────────────────────────────────────────────────────────────────
async function preview(userId, { source, csv, rows: pulledRows }) {
  const rows = pulledRows || parseReport(source, csv);
  const groups = await matchGroups(userId, groupRows(rows));
  if (groups.length > MAX_GROUPS) throw badRequest(`That's ${groups.length} purchases. Import at most ${MAX_GROUPS} at a time (pick a shorter date range).`);
  return {
    source,
    sourceName: SOURCES[source],
    summary: summarise(rows, groups),
    groups,
    problems: rows.filter((r) => r.problem).map((r) => ({ ref: r.ref, name: r.name, date: r.date, problem: r.problem })),
  };
}

// ─── Commit ──────────────────────────────────────────────────────────────────
const dateAtNoon = (iso) => new Date(`${iso}T12:00:00.000Z`);

function cleanGroup(raw, index) {
  const at = `Row ${index + 1}`;
  if (!raw || typeof raw !== 'object') throw badRequest(`${at} is invalid.`);
  const name = cleanText(raw.name);
  const date = isoDate(raw.date);
  const qty = Number(raw.qty);
  const unitPrice = money(raw.unitPrice);
  const unitCost = raw.unitCost === null || raw.unitCost === undefined || raw.unitCost === '' ? null : money(raw.unitCost);
  const refs = Array.isArray(raw.refs) ? raw.refs.map((r) => cleanText(r, 200)).filter(Boolean) : [];
  if (!name) throw badRequest(`${at} has no item name.`);
  if (!date) throw badRequest(`${at} has no valid date.`);
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw badRequest(`${at}: quantity must be a whole number of at least 1.`);
  if (unitPrice === null || unitPrice < 0) throw badRequest(`${at} has no valid sale price.`);
  if (unitCost !== null && unitCost < 0) throw badRequest(`${at}: cost can't be negative.`);
  if (raw.unitCost !== undefined && raw.unitCost !== null && raw.unitCost !== '' && unitCost === null) throw badRequest(`${at}: cost is not a valid amount.`);
  if (!refs.length || refs.length > 100000) throw badRequest(`${at} is missing its report reference. Preview the file again.`);
  return {
    name,
    date,
    qty,
    unitPrice,
    unitCost,
    refs,
    upc: cleanText(raw.upc, 40),
    invoice: cleanText(raw.invoice, 60),
    tracking: trackingList(Array.isArray(raw.tracking) ? raw.tracking.join(' ') : raw.tracking),
    serials: Array.isArray(raw.serials) ? raw.serials.map((s) => cleanText(s, 120)).filter(Boolean).slice(0, 1000) : [],
    fee: Math.abs(money(raw.fee) || 0),
    paid: raw.paid === true,
  };
}

async function commit(userId, { source, platformId, vendorId, paymentMethodId, groups }) {
  if (!SOURCES[source]) throw badRequest('Pick EB, LA or P4D.');
  if (!Array.isArray(groups) || groups.length === 0) throw badRequest('Nothing selected to import.');
  if (groups.length > MAX_GROUPS) throw badRequest(`Import at most ${MAX_GROUPS} purchases at a time.`);
  const clean = groups.map(cleanGroup);
  const allRefs = clean.flatMap((g) => g.refs);
  if (new Set(allRefs).size !== allRefs.length) throw badRequest('The same report row is in two purchases. Preview the file again.');

  if (!platformId) throw badRequest('Pick which cashout these sales go to.');
  const platform = await requireOwned('platform', platformId, userId, 'Cashout');
  if (platform.type !== 'Cashout') throw badRequest('Sales have to go to one of your cashouts.');
  if (vendorId) await requireOwned('platform', vendorId, userId, 'Store');
  if (paymentMethodId) await requireOwned('paymentMethod', paymentMethodId, userId, 'Payment method');

  const workflow = statusTransitions.resolveSaleWorkflow(platform.workflow_preset);
  const path = statusTransitions.SALE_STATUSES_BY_WORKFLOW?.[workflow] || [];
  const waitingStatus = path.includes('WAITING_FOR_PAYMENT') ? 'WAITING_FOR_PAYMENT' : statusTransitions.legacyWorkflowStatus('SHIPPED_OUT', workflow);
  const now = new Date();
  const label = SOURCES[source];

  return prisma.$transaction(async (tx) => {
    // One import per user at a time, so two at once can't both see a row as new.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashout-import:${userId}`}))`;
    // Rows imported since the preview (another tab, a double click) are left out.
    const already = await tx.sales.findMany({
      where: { inventory: { user_id: userId }, import_refs: { hasSome: allRefs } },
      select: { import_refs: true },
    });
    const taken = new Set(already.flatMap((s) => s.import_refs));

    let created = 0;
    let units = 0;
    let costNeeded = 0;
    let skipped = 0;
    for (const g of clean) {
      if (g.refs.some((r) => taken.has(r))) { skipped += 1; continue; }
      const notes = [
        `Imported from ${label}${g.invoice ? ` (${source === 'eb' ? 'invoice' : 'receipt'} ${g.invoice})` : ''}.`,
        g.upc ? `UPC ${g.upc}.` : null,
        g.serials.length ? `Serials: ${g.serials.join(', ')}.` : null,
      ].filter(Boolean).join(' ');

      const inventory = await tx.inventory.create({
        data: {
          user_id: userId,
          product_name: g.name,
          vendor_id: vendorId || null,
          payment_method_id: paymentMethodId || null,
          purchase_date: dateAtNoon(g.date),
          unit_purchase_cost: g.unitCost ?? 0,
          qty_purchased: g.qty,
          qty_on_hand: 0,
          tracking_number: g.tracking[0] || null,
          status: 'PURCHASED',
          ...statusTransitions.legacyReceivingPatch('PURCHASED'),
          notes: g.unitCost === null ? COST_NEEDED_NOTE : null,
        },
      });
      await tx.sales.create({
        data: {
          inventory_id: inventory.id,
          platform_id: platform.id,
          quantity: g.qty,
          unit_price: g.unitPrice,
          commission_fee: g.fee,
          sale_date: dateAtNoon(g.date),
          status: g.paid ? 'PAID' : 'SHIPPED_OUT',
          workflow_type: workflow,
          workflow_status: g.paid ? 'PAID' : waitingStatus,
          workflow_status_changed_at: now,
          delivered_at: dateAtNoon(g.date),
          paid_at: g.paid ? dateAtNoon(g.date) : null,
          paid_amount: g.paid ? Math.round((g.unitPrice * g.qty - g.fee) * 100) / 100 : null,
          tracking_number: g.tracking[0] || null,
          notes,
          import_refs: g.refs,
        },
      });
      g.refs.forEach((r) => taken.add(r));
      created += 1;
      units += g.qty;
      if (g.unitCost === null) costNeeded += 1;
    }
    return { created, units, costNeeded, skipped };
  }, { timeout: 60000, maxWait: 10000 });
}

module.exports = {
  SOURCES,
  COST_NEEDED_NOTE,
  parseCsv,
  csvRecords,
  money,
  isoDate,
  cleanText,
  tokens,
  parseReport,
  parseParsefileRecords,
  parseParsefileTableRows,
  groupRows,
  matchGroups,
  preview,
  commit,
};
