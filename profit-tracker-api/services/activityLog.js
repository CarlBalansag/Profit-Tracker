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
// Bringing back a whole cashout import takes longer than Prisma's default 5
// seconds, more so on a remote database.
const UNDO_TRANSACTION = { timeout: 120000, maxWait: 10000 };

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
//
// Setup records (cards, store accounts, platforms, buyers, goals, recurring
// expenses) are tracked the same way. Deleting one makes the database clear
// the link on everything that used it (ON DELETE SET NULL), so a setup delete
// also snapshots those rows (`linkRefs`): their cleared link is stored as an
// update marked `link: true`. Undo puts the record back first, then the links
// -- each only where the field still holds what the delete left (empty), so a
// purchase that was given another card since keeps it.
// Lock / write order: parents before children (inventory before sales is the
// order routes/sales.js uses; setup records are parents of all of those).
const PARENT_FIRST = {
  platform: 0, account: 1, paymentMethod: 2, buyer: 3, goal: 4, recurringExpense: 5,
  cashoutConnection: 6, calendarEvent: 7, productNote: 8,
  inventory: 9, sales: 10, refund: 11, cashoutCommitment: 12, cashoutItemMatch: 13, expense: 14, transactionNote: 15,
  taxForm1099K: 16, importBatch: 17,
};
const MODELS = Object.keys(PARENT_FIRST);
// Background refreshes (carrier tracking, market price checks, the card
// catalog sync, recurring-expense generation, cashout syncs) rewrite these on
// their own. They are never part of a change set and never block an undo.
// receipt_url is here too: Add Transaction attaches the receipt in a second
// request right after saving, which must not make the add impossible to undo.
const VOLATILE = new Set([
  'tracking_info', 'carrier', 'market_value', 'market_source', 'market_checked_at', 'tax_version', 'receipt_url', 'updated_at',
  'catalog_synced_at', 'catalog_applied', 'last_generated', 'last_synced_at',
]);
// The same, for one model only. A cashout connection's status and last error
// come from syncs, and its key (which never goes into the log) is changed by
// replacing it, which undo can't reverse.
const MODEL_VOLATILE = {
  cashoutConnection: new Set(['status', 'last_error', 'key_last4', 'encrypted_key']),
};
const isVolatile = (model, key) => VOLATILE.has(key) || Boolean(MODEL_VOLATILE[model]?.has(key));
const TABLE = {
  inventory: 'Inventory', sales: 'Sales', refund: 'Refund', cashoutCommitment: 'CashoutCommitment', expense: 'Expense',
  paymentMethod: 'PaymentMethod', account: 'Account', platform: 'Platform', buyer: 'Buyer', goal: 'Goal',
  recurringExpense: 'RecurringExpense', cashoutConnection: 'CashoutConnection', cashoutItemMatch: 'CashoutItemMatch',
  calendarEvent: 'CalendarEvent', productNote: 'ProductNote', transactionNote: 'TransactionNote',
  taxForm1099K: 'TaxForm1099K', importBatch: 'ImportBatch',
};
// A removed cashout connection comes back without its key (the key is never
// logged), marked as needing attention so background sync leaves it alone
// until the user enters the key again.
const RESTORE_OVERRIDES = {
  cashoutConnection: {
    encrypted_key: '',
    status: 'attention_needed',
    last_error: 'Brought back by Undo without its key. Enter the key again.',
  },
};
// Records that point at a setup record, as [model, field]. Platforms also own
// their store accounts (ON DELETE CASCADE), whose purchases lose that account.
// Invoices are left out: the database refuses to delete a buyer that has them.
const LINKS = {
  paymentMethod: [['inventory', 'payment_method_id'], ['expense', 'payment_method_id'], ['recurringExpense', 'payment_method_id'], ['sales', 'sale_shipping_payment_method_id']],
  account: [['inventory', 'account_id']],
  // A 1099-K form keeps its payer name, and a past import stays listed, when
  // their platform goes; undo relinks them.
  platform: [['inventory', 'vendor_id'], ['sales', 'platform_id'], ['cashoutConnection', 'platform_id'], ['account', 'platform_id'], ['taxForm1099K', 'platform_id'], ['importBatch', 'platform_id']],
  buyer: [['sales', 'buyer_id']],
  recurringExpense: [['expense', 'recurring_expense_id']],
  // Removing a connection deletes its commitments and item matches (ON DELETE
  // CASCADE), so they are logged with it. Its deal-price history is a cache
  // the next sync rebuilds and is not.
  cashoutConnection: [['cashoutCommitment', 'connection_id'], ['cashoutItemMatch', 'connection_id']],
  goal: [],
};
const ownerFilter = (model, userId) => (model === 'sales' ? { inventory: { user_id: userId } } : { user_id: userId });

// Every row of the user's that points at `model` `id`, as refs for trackChange
// (a platform's store accounts bring their purchases along).
async function linkedRefs(tx, userId, model, id) {
  const refs = {};
  const add = (m, ids) => { refs[m] = [...new Set([...(refs[m] || []), ...ids])]; };
  for (const [m, field] of LINKS[model] || []) {
    const rows = await tx[m].findMany({ where: { [field]: id, ...ownerFilter(m, userId) }, select: { id: true } });
    add(m, rows.map((r) => r.id));
    if (m === 'account') {
      for (const accountId of rows.map((r) => r.id)) {
        const nested = await linkedRefs(tx, userId, 'account', accountId);
        for (const [nm, ids] of Object.entries(nested)) add(nm, ids);
      }
    }
  }
  return refs;
}
// Secrets never go into the log. A cashout connection is only ever snapshotted
// for its platform link, but its key columns are dropped regardless.
const NEVER_STORED = new Set(['encrypted_key']);
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

// refs: { inventory: [ids], sales: [ids], expense: [ids], ... } -> Map "model:id" -> row
// (scalar columns only: no relations are included; secrets are dropped).
async function snapshotRows(tx, refs = {}) {
  const rows = new Map();
  for (const model of MODELS) {
    const ids = [...new Set((refs[model] || []).filter(Boolean))];
    // One query per 500 ids: a card can be on hundreds of purchases.
    for (let i = 0; i < ids.length; i += 500) {
      const found = await tx[model].findMany({ where: { id: { in: ids.slice(i, i + 500) } } });
      for (const row of found) {
        for (const key of NEVER_STORED) delete row[key];
        rows.set(`${model}:${row.id}`, row);
      }
    }
  }
  return rows;
}

// linkKeys: "model:id" of rows only snapshotted for the link a setup delete
// clears; their updates are marked `link: true` (see LINKS above).
function diffRows(before, after, linkKeys = new Set()) {
  const changes = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const [model, id] = key.split(':');
    const b = before.get(key);
    const a = after.get(key);
    if (b && a) {
      const keys = Object.keys({ ...b, ...a }).filter((k) => !isVolatile(model, k) && !sameValue(b[k], a[k]));
      if (keys.length) changes.push({ model, id, op: 'update', fields: fieldSnapshot(b, a, keys), ...(linkKeys.has(key) ? { link: true } : {}) });
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
//   meta.linkRefs(tx)      optional: rows that point at a setup record being
//                          deleted (see linkedRefs), snapshotted for undo.
async function trackChange(tx, userId, meta, work) {
  const refs = await meta.refs(tx);
  const links = meta.linkRefs ? await meta.linkRefs(tx) : {};
  const own = new Set(Object.entries(refs).flatMap(([m, ids]) => (ids || []).map((id) => `${m}:${id}`)));
  const linkKeys = new Set(Object.entries(links).flatMap(([m, ids]) => ids.map((id) => `${m}:${id}`)).filter((k) => !own.has(k)));
  const merged = { ...refs };
  for (const [m, ids] of Object.entries(links)) merged[m] = [...(merged[m] || []), ...ids];
  const before = await snapshotRows(tx, merged);
  const result = await work();
  const afterRefs = await meta.refs(tx, result);
  // Rows that existed before stay in view after, so a delete is noticed too.
  for (const key of before.keys()) {
    const [model, id] = key.split(':');
    afterRefs[model] = [...(afterRefs[model] || []), id];
  }
  const after = await snapshotRows(tx, afterRefs);
  const changes = diffRows(before, after, linkKeys);
  if (!changes.length) return { result, activity: null };
  const recordId = typeof meta.recordId === 'function' ? meta.recordId(result) : meta.recordId;
  const productName = meta.productName !== undefined
    ? meta.productName
    // After wins (an edit shows the new name); before covers a deleted record.
    : await nameFor(tx, meta.recordType, recordId, new Map([...before, ...after]));
  const activity = await write(tx, userId, {
    kind: 'change',
    recordType: meta.recordType,
    recordId,
    detail: {
      action: meta.action,
      product_name: productName,
      rows: changes,
      // e.g. { email_order_id } so the Automation page can reject the change.
      ...(meta.extra || {}),
    },
    source: meta.source,
  });
  return { result, activity };
}

// Activity record_type -> model, for setup records.
const SETUP_MODEL = {
  card: 'paymentMethod', account: 'account', platform: 'platform', buyer: 'buyer', goal: 'goal', recurring_expense: 'recurringExpense',
  cashout_connection: 'cashoutConnection', calendar_event: 'calendarEvent',
};
// Records that can be tracked the same way but belong with purchases and sales
// on the Activity page (notes about a product or one purchase/sale).
const RECORD_MODEL = { ...SETUP_MODEL, product_note: 'productNote', transaction_note: 'transactionNote' };
// Log-only entries ('event'): things undo can't reverse. Setup ones show under
// Setup; 'cashout' (commitments, Log Purchase) under buys and sales.
const SETUP_EVENT_TYPES = ['api_key', 'setting', 'data_reset'];

// trackChange for one tracked record (see RECORD_MODEL), run inside the
// caller's transaction.
//   action    'create' | 'edit' | 'delete'
//   id        the record (edit/delete); a create takes it from `work`'s result
//   extraRefs (tx, result) => refs of other rows the work changes, e.g. the
//             expenses a recurring expense generates
// A delete also snapshots everything that points at the record, so undo can
// put those links back.
function trackSetupChange(tx, userId, { action, recordType, id, source, extraRefs }, work) {
  const model = RECORD_MODEL[recordType];
  if (!model) throw new Error(`Unknown setup record type: ${recordType}`);
  const idOf = (result) => id ?? result?.id;
  return trackChange(tx, userId, {
    action,
    recordType,
    source,
    recordId: (result) => idOf(result),
    refs: async (t, result) => {
      const own = idOf(result);
      const extra = extraRefs ? await extraRefs(t, result) : {};
      return { ...extra, [model]: [...(extra[model] || []), ...(own ? [own] : [])] };
    },
    ...(action === 'delete' ? { linkRefs: (t) => linkedRefs(t, userId, model, id) } : {}),
  }, work);
}

// A purchase/sale note is shown under the product it is about.
async function productNameForNote(tx, note) {
  if (note.entity_type === 'purchase') {
    return (await tx.inventory.findUnique({ where: { id: note.entity_id }, select: { product_name: true } }))?.product_name ?? null;
  }
  const sale = await tx.sales.findUnique({ where: { id: note.entity_id }, select: { inventory: { select: { product_name: true } } } });
  return sale?.inventory?.product_name ?? null;
}

// Writes a log-only entry: something the user did that undo can't reverse
// (an API key, a setting, a data reset, a cashout commitment sent to the
// provider). `client` is a transaction or the prisma client.
function logEvent(client, userId, { recordType, recordId, action, name = null, detail = {}, source = 'web' }) {
  return write(client, userId, {
    kind: 'event',
    recordType,
    recordId: recordId || userId,
    detail: { action, product_name: name, ...detail },
    source,
  });
}

// logEvent after the action already succeeded outside a transaction: a failed
// log write is reported, never turned into a failed request.
async function recordEvent(userId, options) {
  try {
    return await logEvent(prisma, userId, options);
  } catch (err) {
    console.error('[activity] could not log event:', err.message);
    return null;
  }
}

// What the Activity page calls the record: the product (purchases and sales),
// the expense name, or the setup record's name (a goal's metric).
async function nameFor(tx, recordType, recordId, rows) {
  if (recordType === 'expense') return (rows.get(`expense:${recordId}`) || {}).name ?? null;
  const setupModel = RECORD_MODEL[recordType];
  if (setupModel) {
    const row = rows.get(`${setupModel}:${recordId}`) || await tx[setupModel].findUnique({ where: { id: recordId } });
    if (!row) return null;
    if (recordType === 'cashout_connection') return row.display_name || row.provider;
    if (recordType === 'transaction_note') return productNameForNote(tx, row);
    return row.name ?? row.metric ?? row.title ?? row.product_name ?? null;
  }
  if (recordType === 'purchase') {
    const row = rows.get(`inventory:${recordId}`) || await tx.inventory.findUnique({ where: { id: recordId } });
    return row?.product_name ?? null;
  }
  const sale = rows.get(`sales:${recordId}`) || await tx.sales.findUnique({ where: { id: recordId } });
  if (!sale) return null;
  const inv = rows.get(`inventory:${sale.inventory_id}`) || await tx.inventory.findUnique({ where: { id: sale.inventory_id } });
  return inv?.product_name ?? null;
}

const rowMatches = (model, current, { values }) => Object.entries(values)
  .every(([key, v]) => isVolatile(model, key) || sameValue(current[key], v));

// What the messages call each record type.
const RECORD_LABEL = {
  purchase: 'purchase', sale: 'sale', expense: 'expense', card: 'card', account: 'store account',
  platform: 'platform', buyer: 'buyer', goal: 'goal', recurring_expense: 'recurring expense',
  cashout_connection: 'cashout connection', calendar_event: 'calendar event', product_note: 'note', transaction_note: 'note',
};
const labelFor = (recordType) => RECORD_LABEL[recordType] || 'record';
const changedMessage = (recordType) => `This ${labelFor(recordType)} changed after this, so it can't be undone safely.`;
// What a model's rows are called when other records still point at them.
const USED_BY = {
  inventory: 'purchases', sales: 'sales', expense: 'expenses', recurringExpense: 'recurring expenses',
  cashoutConnection: 'cashout connections', account: 'store accounts',
  cashoutCommitment: 'cashout commitments', cashoutItemMatch: 'matched cashout items',
  taxForm1099K: '1099-K forms', importBatch: 'past imports',
};

// One undo can hold thousands of rows (a whole cashout import), so rows are
// read, locked and written a batch at a time, never one query per row.
const BATCH = 500;
const batches = (list) => Array.from({ length: Math.ceil(list.length / BATCH) }, (_, i) => list.slice(i * BATCH, (i + 1) * BATCH));
const byModel = (changes) => {
  const groups = new Map();
  for (const c of changes) {
    if (!groups.has(c.model)) groups.set(c.model, []);
    groups.get(c.model).push(c);
  }
  return groups;
};
async function findIn(tx, model, field, values, args = {}) {
  const found = [];
  for (const part of batches([...new Set(values)])) found.push(...await tx[model].findMany({ ...args, where: { [field]: { in: part } } }));
  return found;
}

// Bringing back a sale that came from a cashout report must not add it a second
// time: its report rows may have been imported again since it was removed.
async function refuseImportedAgain(tx, userId, rows) {
  const refs = rows.filter((c) => c.model === 'sales' && c.op === 'delete').flatMap((c) => c.row.values.import_refs || []);
  if (!refs.length) return;
  // The lock an import takes (services/cashouts/importSold.js), before any row
  // lock, so an import can't add them while this is deciding.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cashout-import:${userId}`}))`;
  for (const part of batches([...new Set(refs)])) {
    const again = await tx.sales.findFirst({ where: { inventory: { user_id: userId }, import_refs: { hasSome: part } }, select: { id: true } });
    if (again) throw requestError(409, 'These items were imported again since, so bringing them back would add them twice. Undo the newer import first (Settings > Data > Past imports).');
  }
}

async function undoChange(tx, userId, entry, source) {
  const rows = entry.detail.rows || [];
  const refused = changedMessage(entry.record_type);
  await refuseImportedAgain(tx, userId, rows);
  // What a merge moved is on the group it kept. Once that group is gone, the
  // records are somewhere else and this would bring back an empty group.
  if (entry.detail.action === 'merge' && !entry.detail.undo) {
    const kept = await tx.platform.findFirst({ where: { id: entry.detail.merged_into_id, user_id: userId }, select: { id: true } });
    if (!kept) throw requestError(409, `${entry.detail.merged_into} was merged or removed since. Undo that first.`);
  }

  // Lock every row involved first, parents before children. TABLE is a fixed
  // whitelist, so the table name is never user input.
  const current = new Map();
  for (const [model, changes] of byModel(rows)) {
    if (!TABLE[model]) throw requestError(409, 'This entry can\'t be undone.');
    const ids = changes.map((c) => c.id);
    for (const part of batches(ids)) {
      await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${TABLE[model]}"`)} WHERE id IN (${Prisma.join(part)}) ORDER BY id FOR UPDATE`;
    }
  }
  for (const [model, changes] of byModel(rows)) {
    for (const row of await findIn(tx, model, 'id', changes.map((c) => c.id))) current.set(`${model}:${row.id}`, row);
  }
  // A sale belongs to whoever owns its purchase.
  const soldFrom = [...current].filter(([key]) => key.startsWith('sales:')).map(([, row]) => row.inventory_id);
  const ownerOf = new Map((await findIn(tx, 'inventory', 'id', soldFrom, { select: { id: true, user_id: true } })).map((r) => [r.id, r.user_id]));

  // Check everything before writing anything. A link a setup delete cleared
  // (`link: true`) is only put back where it still holds what the delete left:
  // a purchase deleted since, or given another card since, is skipped.
  const skipped = new Set();
  for (const change of rows) {
    const row = current.get(`${change.model}:${change.id}`) || null;
    const owner = change.model === 'sales' ? (row ? ownerOf.get(row.inventory_id) : null) : row?.user_id;
    if (change.op === 'delete') {
      if (row) throw requestError(409, refused);
      continue;
    }
    const fieldsMatch = change.op !== 'update'
      || Object.entries(change.fields).every(([key, f]) => row && sameValue(row[key], f.after));
    if (change.link && change.op === 'update') {
      if (!row || owner !== userId || !fieldsMatch) skipped.add(change);
      continue;
    }
    if (!row || owner !== userId) throw requestError(409, `This ${labelFor(entry.record_type)} no longer exists.`);
    if (change.op === 'update') {
      if (!fieldsMatch) throw requestError(409, refused);
    } else if (!rowMatches(change.model, row, change.row)) {
      throw requestError(409, refused);
    }
  }
  const applied = rows.filter((c) => !skipped.has(c));
  // Removing an added record must not take anything else with it.
  const removing = new Set(applied.filter((c) => c.op === 'create').map((c) => `${c.model}:${c.id}`));
  const added = byModel(applied.filter((c) => c.op === 'create'));
  const idsOf = (model) => (added.get(model) || []).map((c) => c.id);
  const salesOn = new Set((await findIn(tx, 'sales', 'inventory_id', idsOf('inventory'), { select: { id: true, inventory_id: true } }))
    .filter((r) => !removing.has(`sales:${r.id}`)).map((r) => r.inventory_id));
  const refundsOn = async (model, field) => new Set((await findIn(tx, 'refund', field, idsOf(model), { select: { id: true, [field]: true } }))
    .filter((r) => !removing.has(`refund:${r.id}`)).map((r) => r[field]));
  const refunded = { inventory: await refundsOn('inventory', 'inventory_id'), sales: await refundsOn('sales', 'sale_id') };
  for (const change of applied.filter((c) => c.op === 'create')) {
    // A setup record: everything pointing at it now must be part of this undo
    // (removed with it, or unlinked by it). Otherwise removing it would quietly
    // clear the card / account / platform on records added since.
    for (const [m, field] of LINKS[change.model] || []) {
      const users = await tx[m].findMany({ where: { [field]: change.id }, select: { id: true } });
      const handled = (id) => removing.has(`${m}:${id}`)
        || applied.some((c) => c.model === m && c.id === id && c.op === 'update' && c.fields[field]);
      const left = users.filter((u) => !handled(u.id)).length;
      if (left) throw requestError(409, `This ${labelFor(entry.record_type)} is used by ${left} ${USED_BY[m] || 'records'} now, so undo can't remove it. Remove it from its own page instead.`);
    }
    if (change.model === 'inventory') {
      if (salesOn.has(change.id)) throw requestError(409, 'This purchase has sales recorded since, so it can\'t be removed. Delete those first.');
    }
    if (change.model === 'inventory' || change.model === 'sales') {
      if (refunded[change.model].has(change.id)) throw requestError(409, `This ${change.model === 'sales' ? 'sale' : 'purchase'} has refunds recorded since, so it can't be removed. Remove those first.`);
    }
  }

  // Write: put removed rows back (parents first), restore edited fields, then
  // remove added rows (children first).
  try {
    for (const [model, changes] of byModel(applied.filter((c) => c.op === 'delete'))) {
      for (const part of batches(changes)) {
        await tx[model].createMany({ data: part.map((c) => ({ ...rowData(c.row), ...(RESTORE_OVERRIDES[model] || {}) })) });
      }
    }
    for (const change of applied.filter((c) => c.op === 'update')) {
      const data = Object.fromEntries(Object.entries(change.fields)
        .map(([key, f]) => [key, writeValue(change.model, key, restoreValue(f, f.before))]));
      // An expense's tax worksheet watches tax_version to notice edits.
      if (change.model === 'expense') data.tax_version = { increment: 1 };
      await tx[change.model].update({ where: { id: change.id }, data });
    }
    for (const [model, changes] of [...added].reverse()) {
      for (const part of batches(changes)) await tx[model].deleteMany({ where: { id: { in: part.map((c) => c.id) } } });
    }
  } catch (err) {
    // Foreign key / unique conflicts: something else now points at, or took
    // the place of, a row this would change.
    if (err.code === 'P2003' || err.code === 'P2002' || err.code === 'P2014') {
      throw requestError(409, `Other records are linked to this ${labelFor(entry.record_type)} now, so it can't be undone.`);
    }
    throw err;
  }

  // Skipped links were not written, so the undo entry leaves them out.
  const inverse = applied.map((c) => (c.op === 'update'
    ? { ...c, fields: swapFields(c.fields) }
    : { ...c, op: c.op === 'create' ? 'delete' : 'create' }))
    .sort((x, y) => PARENT_FIRST[x.model] - PARENT_FIRST[y.model]);
  const keyNeeded = applied.some((c) => c.op === 'delete' && c.model === 'cashoutConnection');
  return write(tx, userId, {
    kind: 'change',
    recordType: entry.record_type,
    recordId: entry.record_id,
    detail: { ...entry.detail, undo: !entry.detail.undo, rows: inverse, ...(keyNeeded ? { key_needed: true } : {}) },
    revertsId: entry.id,
    source,
  });
}

// ─── Reading ─────────────────────────────────────────────────────────────────

const undoDeadline = (entry) => new Date(new Date(entry.created_at).getTime() + UNDO_WINDOW_DAYS * DAY_MS);

function undoState(entry, now = new Date()) {
  if (entry.kind === 'event') return 'not_undoable';
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
  review_state: entry.review_state ?? null,
  reviewed_at: entry.reviewed_at ?? null,
});

// Newest first, `limit` at a time; pass the last entry's created_at as
// `before` for the next page.
// `group`: 'setup' (cards, accounts, platforms, buyers, goals, recurring
// expenses), 'records' (everything else: purchases, sales, expenses), or
// omitted for all.
const SETUP_TYPES = [...Object.keys(SETUP_MODEL), ...SETUP_EVENT_TYPES];
// source: only entries made by one actor ('email' = the email sync's automatic
// changes, shown on the Automation page; 'assistant'; 'web').
const SOURCES = ['web', 'assistant', 'email'];
// review (Automation page): 'open' = not confirmed, rejected or undone yet;
// 'done' = any of those.
const REVIEW_FILTER = {
  open: { review_state: null, undone_at: null },
  done: { OR: [{ review_state: { not: null } }, { undone_at: { not: null } }] },
};
async function listActivity(userId, { before, limit, group, source, review } = {}) {
  const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const beforeDate = before ? new Date(before) : null;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) throw requestError(400, 'Invalid "before" date');
  if (group !== undefined && group !== 'setup' && group !== 'records') throw requestError(400, 'Invalid "group"');
  if (source !== undefined && !SOURCES.includes(source)) throw requestError(400, 'Invalid "source"');
  if (review !== undefined && !REVIEW_FILTER[review]) throw requestError(400, 'Invalid "review"');
  const typeFilter = group === 'setup' ? { record_type: { in: SETUP_TYPES } }
    : group === 'records' ? { record_type: { notIn: SETUP_TYPES } } : {};
  const rows = await prisma.activityLog.findMany({
    where: { user_id: userId, ...typeFilter, ...(source ? { source } : {}), ...(review ? REVIEW_FILTER[review] : {}), ...(beforeDate ? { created_at: { lt: beforeDate } } : {}) },
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
  if (state === 'not_undoable') throw requestError(409, 'This can\'t be undone.');

  let created;
  if (entry.kind === 'status') {
    created = await prisma.$transaction((tx) => undoStatus(tx, userId, entry, source));
  } else if (entry.kind === 'change') {
    created = await prisma.$transaction((tx) => undoChange(tx, userId, entry, source), UNDO_TRANSACTION);
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
  trackSetupChange,
  logEvent,
  recordEvent,
  SETUP_TYPES,
  linkedRefs,
  LINKS,
  TABLE,
  listActivity,
  undoActivity,
  // exported for tests
  sameValue,
  undoState,
};
