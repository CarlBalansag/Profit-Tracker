// Shared per-transaction note logic for the MCP tools (routes/mcp.js) and the
// website's REST routes (routes/transactionNotes.js). A note belongs to one
// sale ('sale' -> Sales.id) or one purchase ('purchase' -> Inventory.id).
// Every write records ChangeLog rows against the PARENT record (table
// 'Sales'/'Inventory', record_id = the sale/purchase id), so a record's
// change history shows its note activity alongside its field edits.
const { recordChanges } = require('./changeLog');

const ENTITY_TYPES = ['sale', 'purchase'];
const BODY_MAX = 2000;
const TABLE_FOR = { sale: 'Sales', purchase: 'Inventory' };
const LABEL_FOR = { sale: 'Sale', purchase: 'Purchase' };
const ORDER = [{ pinned: 'desc' }, { created_at: 'desc' }];

// Carries both shapes the callers use: `toolError` for MCP, `status` for REST.
const noteError = (message, status) => Object.assign(new Error(message), { toolError: true, status });

const normalizeProductName = (name) => String(name || '').trim().toLowerCase();

// Returns { product_name } for a sale/purchase owned by userId, else null.
// A sale has no user_id of its own; its owner is its purchase's owner.
async function findOwnedEntity(client, userId, entityType, entityId) {
  if (entityType === 'purchase') {
    const inv = await client.inventory.findUnique({ where: { id: entityId } });
    return inv && inv.user_id === userId ? { product_name: inv.product_name } : null;
  }
  if (entityType === 'sale') {
    const sale = await client.sales.findUnique({ where: { id: entityId }, include: { inventory: true } });
    return sale && sale.inventory && sale.inventory.user_id === userId ? { product_name: sale.inventory.product_name } : null;
  }
  return null;
}

async function requireOwnedEntity(client, userId, entityType, entityId) {
  const entity = await findOwnedEntity(client, userId, entityType, entityId);
  if (!entity) throw noteError(`${LABEL_FOR[entityType] || 'Record'} not found or access denied`, 404);
  return entity;
}

async function requireLiveNote(client, userId, noteId) {
  const note = await client.transactionNote.findUnique({ where: { id: noteId } });
  if (!note || note.user_id !== userId || note.deleted_at) throw noteError('Note not found or access denied', 404);
  return note;
}

// Trims and length-checks a note body. Returns the trimmed body.
function cleanBody(body) {
  if (typeof body !== 'string') throw noteError('body must be a string', 400);
  const trimmed = body.trim();
  if (!trimmed) throw noteError('body cannot be empty', 400);
  if (trimmed.length > BODY_MAX) throw noteError(`body must be ${BODY_MAX} characters or fewer`, 400);
  return trimmed;
}

function serializeNote(note) {
  return {
    id: note.id,
    entity_type: note.entity_type,
    entity_id: note.entity_id,
    body: note.body,
    author: note.author,
    pinned: note.pinned,
    created_at: new Date(note.created_at).toISOString(),
    updated_at: new Date(note.updated_at).toISOString(),
  };
}

async function createNote(client, userId, { entity_type, entity_id, body, pinned, author }, source) {
  const entity = await requireOwnedEntity(client, userId, entity_type, entity_id);
  const cleaned = cleanBody(body);
  const note = await client.transactionNote.create({
    data: { user_id: userId, entity_type, entity_id, body: cleaned, author, pinned: pinned === true },
  });
  await recordChanges(client, userId, TABLE_FOR[entity_type], entity_id, [
    { field: 'note_added', oldValue: null, newValue: cleaned },
  ], source);
  return { note, product: entity.product_name };
}

// Applies body/pinned edits. A call that changes nothing returns the note
// untouched and records no ChangeLog rows.
async function updateNote(client, userId, noteId, { body, pinned }, source) {
  const existing = await requireLiveNote(client, userId, noteId);
  const data = {};
  const changes = [];
  if (body !== undefined) {
    const cleaned = cleanBody(body);
    if (cleaned !== existing.body) { data.body = cleaned; changes.push({ field: 'note_body', oldValue: existing.body, newValue: cleaned }); }
  }
  if (pinned !== undefined && pinned !== existing.pinned) {
    data.pinned = pinned;
    changes.push({ field: 'note_pinned', oldValue: existing.pinned, newValue: pinned });
  }
  if (!changes.length) return existing;
  const claim = await client.transactionNote.updateMany({ where: { id: noteId, user_id: userId, deleted_at: null }, data });
  if (claim.count !== 1) throw noteError('Note not found or access denied', 404);
  await recordChanges(client, userId, TABLE_FOR[existing.entity_type], existing.entity_id, changes, source);
  return client.transactionNote.findUnique({ where: { id: noteId } });
}

// Soft delete: sets deleted_at; the row (and its body) is kept.
async function deleteNote(client, userId, noteId, source) {
  const existing = await requireLiveNote(client, userId, noteId);
  const claim = await client.transactionNote.updateMany({
    where: { id: noteId, user_id: userId, deleted_at: null },
    data: { deleted_at: new Date() },
  });
  if (claim.count !== 1) throw noteError('Note not found or access denied', 404);
  await recordChanges(client, userId, TABLE_FOR[existing.entity_type], existing.entity_id, [
    { field: 'note_deleted', oldValue: existing.body, newValue: null },
  ], source);
  return client.transactionNote.findUnique({ where: { id: noteId } });
}

// Non-deleted notes for one entity, pinned first, then newest first.
async function listEntityNotes(client, userId, entityType, entityId) {
  return client.transactionNote.findMany({
    where: { user_id: userId, entity_type: entityType, entity_id: entityId, deleted_at: null },
    orderBy: ORDER,
  });
}

// Map of `${entity_type}:${entity_id}` -> product name for the given notes,
// scoped to userId (a note pointing at something no longer owned/present maps
// to nothing).
async function productNamesFor(client, userId, notes) {
  const purchaseIds = [...new Set(notes.filter((n) => n.entity_type === 'purchase').map((n) => n.entity_id))];
  const saleIds = [...new Set(notes.filter((n) => n.entity_type === 'sale').map((n) => n.entity_id))];
  const names = new Map();
  if (purchaseIds.length) {
    const invs = await client.inventory.findMany({ where: { id: { in: purchaseIds }, user_id: userId }, select: { id: true, product_name: true } });
    for (const inv of invs) names.set(`purchase:${inv.id}`, inv.product_name);
  }
  if (saleIds.length) {
    const sales = await client.sales.findMany({
      where: { id: { in: saleIds }, inventory: { user_id: userId } },
      select: { id: true, inventory: { select: { product_name: true } } },
    });
    for (const sale of sales) names.set(`sale:${sale.id}`, sale.inventory?.product_name ?? null);
  }
  return names;
}

module.exports = {
  ENTITY_TYPES,
  BODY_MAX,
  TABLE_FOR,
  ORDER,
  noteError,
  normalizeProductName,
  findOwnedEntity,
  requireOwnedEntity,
  cleanBody,
  serializeNote,
  createNote,
  updateNote,
  deleteNote,
  listEntityNotes,
  productNamesFor,
};
