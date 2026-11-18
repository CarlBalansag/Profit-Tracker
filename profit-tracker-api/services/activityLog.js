// Activity log + Undo (part 1: refunds and status actions).
//
// Every user-visible action writes one ActivityLog row in the SAME transaction
// as the change itself, so a logged action always happened and an action that
// happened is always logged. Each row carries what it takes to reverse it:
//
//   refund.add     the refund it created        -> undo removes that refund
//   refund.remove  the refund it deleted        -> undo records it again
//   status         every field the transition   -> undo writes the "before"
//                  wrote, before and after,        values back, and moves any
//                  plus any stock it moved         stock back
//
// Undo never guesses. It refuses, with a reason, when something changed after
// the action (the fields it wrote no longer hold what it wrote, the units it
// put back in stock were sold again, ...). An undo is logged as its own entry
// (reverts_id -> the entry it reversed) and stamps undone_at on the original,
// so an undo can itself be undone. Entries older than UNDO_WINDOW_DAYS stay in
// the log but can no longer be undone.
const prisma = require('../prisma');
const { Prisma } = require('@prisma/client');

const UNDO_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const requestError = (status, message) => Object.assign(new Error(message), { status });

// ─── Value snapshots ─────────────────────────────────────────────────────────
// Stored as JSON, so Dates become ISO strings (flagged so they come back as
// Dates) and Prisma Decimals become strings (Prisma accepts those on write).
const isDecimal = (v) => v && typeof v === 'object' && typeof v.toFixed === 'function' && !(v instanceof Date);
const serialize = (v) => {
  if (v === undefined || v === null) return null;
  if (v instanceof Date) return v.toISOString();
  if (isDecimal(v)) return v.toString();
  return v;
};
const restoreValue = ({ date }, v) => (date && v !== null ? new Date(v) : v);

// Equal as stored values: a Decimal read back as "10" equals 10.00, a Date
// equals its ISO string.
function sameValue(a, b) {
  const x = serialize(a);
  const y = serialize(b);
  if (x === y) return true;
  if (x === null || y === null) return false;
  if (typeof x === 'object' || typeof y === 'object') return JSON.stringify(x) === JSON.stringify(y);
  if (typeof x === 'boolean' || typeof y === 'boolean') return String(x) === String(y);
  const nx = Number(x);
  const ny = Number(y);
  if (x !== '' && y !== '' && Number.isFinite(nx) && Number.isFinite(ny)) return nx === ny;
  return String(x) === String(y);
}

function fieldSnapshot(before, after, keys) {
  const fields = {};
  for (const key of keys) {
    fields[key] = {
      before: serialize(before[key]),
      after: serialize(after[key]),
      ...(before[key] instanceof Date || after[key] instanceof Date ? { date: true } : {}),
    };
  }
  return fields;
}

const swapFields = (fields) => Object.fromEntries(
  Object.entries(fields).map(([key, f]) => [key, { ...f, before: f.after, after: f.before }]),
);

// ─── Writing entries ─────────────────────────────────────────────────────────

// Stamps the entry an undo reversed. Guarded on undone_at still being empty so
// two undos of the same entry racing each other cannot both succeed.
async function markUndone(tx, userId, entryId, undoneBy) {
  const claim = await tx.activityLog.updateMany({
    where: { id: entryId, user_id: userId, undone_at: null },
    data: { undone_at: new Date(), undone_by: undoneBy },
  });
  if (claim.count !== 1) throw requestError(409, 'This was already undone.');
}

async function write(tx, userId, { kind, recordType, recordId, detail, source = 'web', revertsId = null }) {
  const entry = await tx.activityLog.create({
    data: {
      user_id: userId,
      kind,
      record_type: recordType,
      record_id: recordId,
      detail,
      source,
      reverts_id: revertsId,
    },
  });
  if (revertsId) await markUndone(tx, userId, revertsId, entry.id);
  return entry;
}

const refundSnapshot = (refund) => ({
  id: refund.id,
  inventory_id: refund.inventory_id || null,
  sale_id: refund.sale_id || null,
  amount: serialize(refund.amount),
  quantity: Number(refund.quantity) || 0,
  date: serialize(refund.date),
  note: refund.note ?? null,
});

// kind: 'refund.add' | 'refund.remove'
function logRefund(tx, userId, kind, refund, { productName = null, source, revertsId } = {}) {
  return write(tx, userId, {
    kind,
    recordType: refund.inventory_id ? 'purchase' : 'sale',
    recordId: refund.inventory_id || refund.sale_id,
    detail: { refund: refundSnapshot(refund), product_name: productName },
    source,
    revertsId,
  });
}

async function productNameFor(tx, kind, record) {
  if (kind === 'inventory') return record.product_name ?? null;
  if (record.inventory?.product_name !== undefined) return record.inventory.product_name;
  const inv = await tx.inventory.findUnique({ where: { id: record.inventory_id }, select: { product_name: true } });
  return inv?.product_name ?? null;
}

// `before` is the row the transition was decided from; `result` is what
// statusTransitions.applyTransition returned (its `data` is exactly what it
// wrote, `restored` the units it put back on the purchase).
async function logStatus(tx, userId, kind, before, result, { source, revertsId, extra = {} } = {}) {
  const keys = Object.keys(result.data || {});
  const restored = Number(result.restored) || 0;
  return write(tx, userId, {
    kind: 'status',
    recordType: kind === 'sale' ? 'sale' : 'purchase',
    recordId: before.id,
    detail: {
      action: result.action,
      from: result.from ?? null,
      to: result.to ?? null,
      product_name: await productNameFor(tx, kind, before),
      fields: fieldSnapshot(before, result.record, keys),
      stock: restored ? { inventory_id: before.inventory_id, delta: restored } : null,
      // What a sale's stock math was computed from. Undo refuses if a later
      // edit changed it, rather than moving the wrong number of units.
      guard: kind === 'sale'
        ? { quantity: serialize(before.quantity), refunded_qty: serialize(before.refunded_qty ?? 0) }
        : null,
      ...extra,
    },
    source,
    revertsId,
  });
}

// ─── Change sets: edits and adds (part 2) ────────────────────────────────────
// An edit or an add can touch several rows at once (a sale edit moves the
// purchase's stock; the detail window saves a purchase and all its sales). So
// the rows involved are snapshotted before and after the write, inside the
// same transaction, and only the difference is stored:
//   update  the fields that changed, before and after
//   create  the whole new row     -> undo deletes it
//   delete  the whole removed row -> undo puts it back with the same id
// Undo reverses every row of the set or none of them.

// refund and cashoutCommitment ride along with a deleted purchase or sale:
// its refunds are cascaded away and a cashout commitment loses its sale link
// (ON DELETE SET NULL), so both have to come back with it.
const MODELS = ['inventory', 'sales', 'refund', 'cashoutCommitment', 'expense'];
// Lock / write order: parents before children, the order routes/sales.js uses.
const PARENT_FIRST = { inventory: 0, sales: 1, refund: 2, cashoutCommitment: 3, expense: 4 };
// Background refreshes (carrier tracking, market price checks) rewrite these on
// their own. They are never part of a change set and never block an undo.
// receipt_url is here too: Add Transaction attaches the receipt in a second
// request right after saving, which must not make the add impossible to undo.
const VOLATILE = new Set(['tracking_info', 'carrier', 'market_value', 'market_source', 'market_checked_at', 'tax_version', 'receipt_url', 'updated_at']);
const TABLE = { inventory: 'Inventory', sales: 'Sales', refund: 'Refund', cashoutCommitment: 'CashoutCommitment', expense: 'Expense' };
// Prisma refuses a bare null for a Json column: it has to be DbNull.
const JSON_FIELDS = Object.fromEntries(Object.entries(TABLE).map(([model, name]) => [
  model,
  new Set((Prisma.dmmf?.datamodel.models.find((m) => m.name === name)?.fields || [])
    .filter((f) => f.type === 'Json').map((f) => f.name)),
]));
const writeValue = (model, key, value) => (value === null && JSON_FIELDS[model]?.has(key) ? Prisma.DbNull : value);

const rowSnapshot = (row) => {
  const values = {};
  const dates = [];
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) dates.push(key);
    values[key] = serialize(value);
  }
  return { values, dates };
};
// Columns that were NULL are left out, so the row comes back with them NULL
// (and Json columns never see a bare null).
const rowData = ({ values, dates }) => Object.fromEntries(
  Object.entries(values)
    .filter(([, v]) => v !== null)
    .map(([key, v]) => [key, dates.includes(key) ? new Date(v) : v]),
);

// refs: { inventory: [ids], sales: [ids], expense: [ids] } -> Map "model:id" -> row
// (scalar columns only: no relations are included).
async function snapshotRows(tx, refs = {}) {
  const rows = new Map();
  for (const model of MODELS) {
    for (const id of new Set((refs[model] || []).filter(Boolean))) {
      const row = await tx[model].findUnique({ where: { id } });
      if (row) rows.set(`${model}:${id}`, row);
    }
  }
  return rows;
}

function diffRows(before, after) {
  const changes = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const [model, id] = key.split(':');
    const b = before.get(key);
    const a = after.get(key);
    if (b && a) {
      const keys = Object.keys({ ...b, ...a }).filter((k) => !VOLATILE.has(k) && !sameValue(b[k], a[k]));
      if (keys.length) changes.push({ model, id, op: 'update', fields: fieldSnapshot(b, a, keys) });
    } else if (a) {
      changes.push({ model, id, op: 'create', row: rowSnapshot(a) });
    } else if (b) {
      changes.push({ model, id, op: 'delete', row: rowSnapshot(b) });
    }
  }
  return changes.sort((x, y) => PARENT_FIRST[x.model] - PARENT_FIRST[y.model]);
}

// Runs `work` inside the caller's transaction and logs what it changed.
//   meta.refs(tx, result)  rows to snapshot; called before (result undefined)
//                          and after, so rows the work creates are seen.
//   meta.recordId(result)  the purchase/sale/expense the entry is about.
// Returns { result, activity } (activity is null when nothing changed).
async function trackChange(tx, userId, meta, work) {
  const before = await snapshotRows(tx, await meta.refs(tx));
  const result = await work();
  const afterRefs = await meta.refs(tx, result);
  // Rows that existed before stay in view after, so a delete is noticed too.
  for (const key of before.keys()) {
    const [model, id] = key.split(':');
    afterRefs[model] = [...(afterRefs[model] || []), id];
  }
  const after = await snapshotRows(tx, afterRefs);
  const changes = diffRows(before, after);
  if (!changes.length) return { result, activity: null };
  const recordId = typeof meta.recordId === 'function' ? meta.recordId(result) : meta.recordId;
  const productName = meta.productName !== undefined
    ? meta.productName
    : await nameFor(tx, meta.recordType, recordId, after.size ? after : before);
  const activity = await write(tx, userId, {
    kind: 'change',
    recordType: meta.recordType,
    recordId,
    detail: {
      action: meta.action,
      product_name: productName,
      rows: changes,
    },
    source: meta.source,
  });
  return { result, activity };
}

// What the Activity page calls the record: the product (purchases and sales)
// or the expense name.
async function nameFor(tx, recordType, recordId, rows) {
  if (recordType === 'expense') return (rows.get(`expense:${recordId}`) || {}).name ?? null;
  if (recordType === 'purchase') {
    const row = rows.get(`inventory:${recordId}`) || await tx.inventory.findUnique({ where: { id: recordId } });
    return row?.product_name ?? null;
  }
  const sale = rows.get(`sales:${recordId}`) || await tx.sales.findUnique({ where: { id: recordId } });
  if (!sale) return null;
  const inv = rows.get(`inventory:${sale.inventory_id}`) || await tx.inventory.findUnique({ where: { id: sale.inventory_id } });
  return inv?.product_name ?? null;
}

const rowMatches = (current, { values }) => Object.entries(values)
  .every(([key, v]) => VOLATILE.has(key) || sameValue(current[key], v));

const CHANGE_REFUSED = {
  purchase: 'This purchase changed after this, so it can\'t be undone safely.',
  sale: 'This sale changed after this, so it can\'t be undone safely.',
  expense: 'This expense changed after this, so it can\'t be undone safely.',
};

async function undoChange(tx, userId, entry, source) {
  const rows = entry.detail.rows || [];
  const refused = CHANGE_REFUSED[entry.record_type] || CHANGE_REFUSED.purchase;

  // Lock every row involved first, parents before children.
  for (const change of rows) {
    const id = change.id;
    if (change.model === 'inventory') await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${id} FOR UPDATE`;
    else if (change.model === 'sales') await tx.$queryRaw`SELECT id FROM "Sales" WHERE id = ${id} FOR UPDATE`;
    else if (change.model === 'refund') await tx.$queryRaw`SELECT id FROM "Refund" WHERE id = ${id} FOR UPDATE`;
    else if (change.model === 'cashoutCommitment') await tx.$queryRaw`SELECT id FROM "CashoutCommitment" WHERE id = ${id} FOR UPDATE`;
    else await tx.$queryRaw`SELECT id FROM "Expense" WHERE id = ${id} FOR UPDATE`;
  }

  // Check everything before writing anything.
  const current = new Map();
  for (const change of rows) {
    const row = await tx[change.model].findUnique({ where: { id: change.id } });
    current.set(`${change.model}:${change.id}`, row);
    const owner = change.model === 'sales'
      ? (row ? (await tx.inventory.findUnique({ where: { id: row.inventory_id } }))?.user_id : null)
      : row?.user_id;
    if (change.op === 'delete') {
      if (row) throw requestError(409, refused);
      continue;
    }
    if (!row || owner !== userId) throw requestError(409, `This ${entry.record_type} no longer exists.`);
    if (change.op === 'update') {
      for (const [key, f] of Object.entries(change.fields)) {
        if (!sameValue(row[key], f.after)) throw requestError(409, refused);
      }
    } else if (!rowMatches(row, change.row)) {
      throw requestError(409, refused);
    }
  }
  // Removing an added purchase or sale must not take anything else with it.
  const removing = new Set(rows.filter((c) => c.op === 'create').map((c) => `${c.model}:${c.id}`));
  for (const change of rows.filter((c) => c.op === 'create')) {
    if (change.model === 'inventory') {
      const sales = await tx.sales.findMany({ where: { inventory_id: change.id }, select: { id: true } });
      if (sales.some((s) => !removing.has(`sales:${s.id}`))) throw requestError(409, 'This purchase has sales recorded since, so it can\'t be removed. Delete those first.');
    }
    if (change.model === 'inventory' || change.model === 'sales') {
      const refunds = (await tx.refund.findMany({ where: change.model === 'inventory' ? { inventory_id: change.id } : { sale_id: change.id }, select: { id: true } }))
        .filter((r) => !removing.has(`refund:${r.id}`)).length;
      if (refunds) throw requestError(409, `This ${change.model === 'sales' ? 'sale' : 'purchase'} has refunds recorded since, so it can't be removed. Remove those first.`);
    }
  }

  // Write: put removed rows back (parents first), restore edited fields, then
  // remove added rows (children first).
  try {
    for (const change of rows.filter((c) => c.op === 'delete')) {
      await tx[change.model].create({ data: rowData(change.row) });
    }
    for (const change of rows.filter((c) => c.op === 'update')) {
      const data = Object.fromEntries(Object.entries(change.fields)
        .map(([key, f]) => [key, writeValue(change.model, key, restoreValue(f, f.before))]));
      // An expense's tax worksheet watches tax_version to notice edits.
      if (change.model === 'expense') data.tax_version = { increment: 1 };
      await tx[change.model].update({ where: { id: change.id }, data });
    }
    for (const change of rows.filter((c) => c.op === 'create').reverse()) {
      await tx[change.model].delete({ where: { id: change.id } });
    }
  } catch (err) {
    // Foreign key / unique conflicts: something else now points at, or took
    // the place of, a row this would change.
    if (err.code === 'P2003' || err.code === 'P2002' || err.code === 'P2014') {
      throw requestError(409, `Other records are linked to this ${entry.record_type} now, so it can't be undone.`);
    }
    throw err;
  }

  const inverse = rows.map((c) => (c.op === 'update'
    ? { ...c, fields: swapFields(c.fields) }
    : { ...c, op: c.op === 'create' ? 'delete' : 'create' }))
    .sort((x, y) => PARENT_FIRST[x.model] - PARENT_FIRST[y.model]);
  return write(tx, userId, {
    kind: 'change',
    recordType: entry.record_type,
    recordId: entry.record_id,
    detail: { ...entry.detail, undo: !entry.detail.undo, rows: inverse },
    revertsId: entry.id,
    source,
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const undoDeadline = (entry) => new Date(new Date(entry.created_at).getTime() + UNDO_WINDOW_DAYS * DAY_MS);

function undoState(entry, now = new Date()) {
  if (entry.undone_at) return 'undone';
  if (now > undoDeadline(entry)) return 'expired';
  return 'available';
}

const toJson = (entry, now) => entry && ({
  id: entry.id,
  kind: entry.kind,
  record_type: entry.record_type,
  record_id: entry.record_id,
  detail: entry.detail,
  source: entry.source,
  reverts_id: entry.reverts_id,
  undone_at: entry.undone_at,
  undone_by: entry.undone_by,
  created_at: entry.created_at,
  undo_state: undoState(entry, now),
  undo_until: undoDeadline(entry),
});

// Newest first, `limit` at a time; pass the last entry's created_at as
// `before` for the next page.
async function listActivity(userId, { before, limit } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const beforeDate = before ? new Date(before) : null;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) throw requestError(400, 'Invalid "before" date');
  const rows = await prisma.activityLog.findMany({
    where: { user_id: userId, ...(beforeDate ? { created_at: { lt: beforeDate } } : {}) },
    orderBy: { created_at: 'desc' },
    take: take + 1,
  });
  const now = new Date();
  const page = rows.slice(0, take);
  return {
    entries: page.map((row) => toJson(row, now)),
    next_before: rows.length > take ? page[page.length - 1].created_at : null,
  };
}

// ─── Undo ────────────────────────────────────────────────────────────────────

const CHANGED_MESSAGE = {
  sale: 'This sale changed after this action, so it can\'t be undone safely.',
  purchase: 'This purchase changed after this action, so it can\'t be undone safely.',
};

async function undoStatus(tx, userId, entry, source) {
  const { detail } = entry;
  const kind = entry.record_type === 'sale' ? 'sale' : 'inventory';
  // Lock the rows before checking them, so nothing can change between the
  // checks below and the writes (inventory before sale: routes/sales.js order).
  if (detail.stock?.inventory_id) {
    await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${detail.stock.inventory_id} FOR UPDATE`;
  }
  if (kind === 'sale') await tx.$queryRaw`SELECT id FROM "Sales" WHERE id = ${entry.record_id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Inventory" WHERE id = ${entry.record_id} FOR UPDATE`;
  const current = kind === 'sale'
    ? await tx.sales.findUnique({ where: { id: entry.record_id }, include: { inventory: true } })
    : await tx.inventory.findUnique({ where: { id: entry.record_id } });
  const owner = kind === 'sale' ? current?.inventory?.user_id : current?.user_id;
  if (!current || owner !== userId) throw requestError(404, `This ${entry.record_type} no longer exists.`);

  const fields = detail.fields || {};
  for (const [key, f] of Object.entries(fields)) {
    if (!sameValue(current[key], f.after)) throw requestError(409, CHANGED_MESSAGE[entry.record_type]);
  }
  if (detail.guard) {
    for (const [key, value] of Object.entries(detail.guard)) {
      if (!sameValue(current[key] ?? 0, value)) throw requestError(409, CHANGED_MESSAGE[entry.record_type]);
    }
  }

  // Stock first (inventory before sale: the lock order routes/sales.js uses).
  const delta = Number(detail.stock?.delta) || 0;
  if (delta) {
    const back = -delta;
    const stock = await tx.inventory.updateMany({
      where: {
        id: detail.stock.inventory_id,
        user_id: userId,
        ...(back < 0 ? { qty_on_hand: { gte: -back } } : {}),
      },
      data: back < 0 ? { qty_on_hand: { decrement: -back } } : { qty_on_hand: { increment: back } },
    });
    if (stock.count !== 1) {
      const n = Math.abs(back);
      throw requestError(409, `The ${n} unit${n === 1 ? '' : 's'} this put back in stock ${n === 1 ? 'has' : 'have'} since been sold or used, so it can't be undone.`);
    }
  }

  // Write the "before" values back, claimed on the status field still holding
  // what this action left (cheap, and a real guard under concurrency).
  const statusField = kind === 'sale' ? 'workflow_status' : 'receiving_status';
  const data = Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, restoreValue(f, f.before)]));
  const where = { id: current.id, [statusField]: current[statusField] ?? null };
  const claim = kind === 'sale'
    ? await tx.sales.updateMany({ where: { ...where, inventory: { user_id: userId } }, data })
    : await tx.inventory.updateMany({ where: { ...where, user_id: userId }, data });
  if (claim.count !== 1) throw requestError(409, CHANGED_MESSAGE[entry.record_type]);

  const updated = kind === 'sale'
    ? await tx.sales.findUnique({ where: { id: current.id } })
    : await tx.inventory.findUnique({ where: { id: current.id } });

  return write(tx, userId, {
    kind: 'status',
    recordType: entry.record_type,
    recordId: entry.record_id,
    detail: {
      action: detail.action,
      undo: !detail.undo,
      from: detail.to ?? null,
      to: detail.from ?? null,
      product_name: detail.product_name ?? null,
      fields: swapFields(fields),
      stock: delta ? { inventory_id: detail.stock.inventory_id, delta: -delta } : null,
      guard: kind === 'sale'
        ? { quantity: serialize(updated.quantity), refunded_qty: serialize(updated.refunded_qty ?? 0) }
        : null,
    },
    revertsId: entry.id,
    source,
  });
}

// `source` marks who undid it ('web' by default, 'assistant' from routes/mcp.js).
async function undoActivity(userId, entryId, { source = 'web' } = {}) {
  const entry = await prisma.activityLog.findUnique({ where: { id: entryId } });
  if (!entry || entry.user_id !== userId) throw requestError(404, 'Activity not found');
  const state = undoState(entry);
  if (state === 'undone') throw requestError(409, 'This was already undone.');
  if (state === 'expired') throw requestError(409, `Only the last ${UNDO_WINDOW_DAYS} days can be undone.`);

  let created;
  if (entry.kind === 'status') {
    created = await prisma.$transaction((tx) => undoStatus(tx, userId, entry, source));
  } else if (entry.kind === 'change') {
    created = await prisma.$transaction((tx) => undoChange(tx, userId, entry, source));
  } else if (entry.kind === 'refund.add' || entry.kind === 'refund.remove') {
    // Lazy: services/refunds.js requires this module to log its writes.
    const refunds = require('./refunds');
    const { refund } = entry.detail;
    const options = { revertsId: entry.id, source };
    if (entry.kind === 'refund.add') {
      try {
        const removed = await refunds.removeRefund(userId, refund.id, options);
        created = { id: removed.activity_id };
      } catch (err) {
        if (err.status === 404) throw requestError(409, 'This refund was already removed.');
        throw err;
      }
    } else {
      const added = await refunds.recordRefund(userId, {
        inventory_id: refund.inventory_id || undefined,
        sale_id: refund.sale_id || undefined,
        amount: refund.amount,
        quantity: refund.quantity,
        date: refund.date,
        note: refund.note,
      }, options);
      created = { id: added.activity_id };
    }
  } else {
    throw requestError(400, 'This kind of activity can\'t be undone.');
  }

  const [original, undoEntry] = await Promise.all([
    prisma.activityLog.findUnique({ where: { id: entry.id } }),
    prisma.activityLog.findUnique({ where: { id: created.id } }),
  ]);
  const now = new Date();
  return { undone: toJson(original, now), entry: toJson(undoEntry, now) };
}

module.exports = {
  UNDO_WINDOW_DAYS,
  logRefund,
  logStatus,
  trackChange,
  listActivity,
  undoActivity,
  // exported for tests
  sameValue,
  undoState,
};
